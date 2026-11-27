import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { ApiKeyCheck } from 'supertext-sdk/v1';
import { SESSION_COOKIE, Sessions, STATE_COOKIE } from './auth/session.js';
import type { Config } from './config.js';
import { authorizeUrl, exchangeCode, HubSpotClient, type OAuthOptions } from './hubspot/client.js';
import { isKind, KINDS, MAX_LISTED, type Kind } from './hubspot/content.js';
import { TokenManager } from './hubspot/tokens.js';
import { errorInfo, LocalizedError, type ErrorInfo } from './i18n/error.js';
import { localeFromRequest, translator, type Translator } from './i18n/index.js';
import { Reporting } from './reporting.js';
import { defaultAccount, type Account, type Store } from './store/store.js';
import { SupertextClient } from './supertext/client.js';
import { exportItem, importFile, MAX_UPLOAD_BYTES, tooLarge, type ImportResult } from './translation/files.js';
import { Catalog, filterRows, ITEM_FILTERS, type ItemFilter } from './translation/catalog.js';
import { jobItemIds, MAX_BATCH, startJob, type JobDeps } from './translation/jobs.js';
import { hubspotCode, isLanguage, resolvedTarget, supertextCodeOf, supertextSource } from './translation/languages.js';
import { ConnectPage } from './views/connect.js';
import { JobPanel } from './views/job.js';
import { appUrl, type PageContext } from './views/layout.js';
import { KeyCheckMessage, keyCheckText, SettingsPage } from './views/settings.js';
import { ImportPage } from './views/import.js';
import { TranslatePage } from './views/translate.js';
import { HISTORY_OUTCOMES, HistoryPage, JobPage, type HistoryOutcome } from './views/history.js';
import { LINK_FILTERS, LinksPage, type LinkFilter, type LinkRow } from './views/links.js';
import { ContentLinks, LINK_TARGETS } from './translation/links.js';

type ItemRowList = NonNullable<Parameters<typeof TranslatePage>[0]['list']>;

export interface AppDeps {
  config: Config;
  store: Store;
  /** Injected for tests. */
  fetch?: typeof fetch;
  /** Called with each job's (and background report's) completion promise (tests wait on it). */
  onJob?: (done: Promise<unknown>) => void;
  /** Injected for tests (token expiry). */
  now?: () => number;
}

/** Items per page on the Translate page (as many as one batch takes). */
const PAGE_SIZE = 50;
/** The scope that lets the app write knowledge base articles (Service Hub Professional+). */
export const KB_SCOPE = 'cms.knowledge_base.articles.write';

/** The kinds an account can translate: the knowledge base only with its scopes. */
export const knowledgeBase = (account: Pick<Account, 'scopes'>): boolean => account.scopes.includes(KB_SCOPE);

/** The kinds links can point to for an account (the knowledge base only with its scopes). */
const linkKinds = (account: Account) => LINK_TARGETS.filter((kind) => kind !== 'kb-article' || knowledgeBase(account));

/** Everything the routes share. */
export function services(deps: AppDeps) {
  const { config } = deps;
  const oauth: OAuthOptions = {
    appBase: config.hubspotAppBase,
    apiBase: config.hubspotApiBase,
    clientId: config.hubspotClientId,
    clientSecret: config.hubspotClientSecret,
    redirectUri: `${config.appUrl}/oauth/callback`,
    scopes: config.hubspotScopes,
    optionalScopes: config.hubspotOptionalScopes,
    fetch: deps.fetch,
  };
  const tokens = new TokenManager(deps.store, oauth, deps.now);
  const hubspot = (account: Account) =>
    new HubSpotClient({ apiBase: config.hubspotApiBase, tokens: tokens.source(account), fetch: deps.fetch });
  const supertext = (account: Account) =>
    new SupertextClient({
      apiKey: account.apiKey || config.supertextApiKey,
      endpoint: config.supertextEndpoint || undefined,
      // Languages with Translation review on go through the review service (see SupertextClient.forReview).
      reviewEndpoint: config.reviewUrl,
      fetch: deps.fetch,
    });
  const reporting = new Reporting({ config, store: deps.store, fetch: deps.fetch, onTask: deps.onJob });
  const catalog = new Catalog(deps.now);
  const jobDeps: JobDeps = {
    store: deps.store,
    hubspot,
    supertext,
    // New versions: the Translate page's list is loaded again.
    onChanged: (accountId, kind) => catalog.forget(accountId, kind),
    onAuthenticationFailed: (account, status) => void reporting.inBackground(account, 'authenticationFailed', status),
  };
  return { oauth, hubspot, supertext, jobDeps, reporting, catalog };
}

export function createApp(deps: AppDeps) {
  const { config, store } = deps;
  const app = new Hono();
  const sessions = new Sessions(config.sessionSecret || config.hubspotClientSecret || 'local-development-only');
  const { oauth, hubspot, jobDeps, reporting, catalog } = services(deps);
  /** Back-end requests that run the app's code: the reporter notices upgrades and changed keys (in the background). */
  const onRequest = (account: Account) => void reporting.inBackground(account, 'onRequest');
  const hasKey = (account: Account) => Boolean(account.apiKey || config.supertextApiKey);
  const secure = config.appUrl.startsWith('https://');
  const configured = Boolean(config.hubspotClientId && config.hubspotClientSecret);
  // Links into HubSpot's editor go to app.hubspot.com, also when the install page is a stand-in.
  const editorBase = /^https:\/\/app(-[a-z0-9]+)?\.hubspot\.com$/.test(config.hubspotAppBase) ? config.hubspotAppBase : 'https://app.hubspot.com';

  app.use('*', async (c, next) => {
    await next();
    c.header('Content-Security-Policy', "frame-ancestors 'none'");
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('X-Content-Type-Options', 'nosniff');
    // Pages show the account's live state: never from a cache (static files set their own, see server.ts).
    if (!c.req.path.startsWith('/static/')) c.header('Cache-Control', 'no-cache, private');
  });

  // ?lang=de switches the interface language and remembers it.
  app.use('*', async (c, next) => {
    const lang = c.req.query('lang');
    if (lang && /^(en|de|fr|it)$/.test(lang)) {
      setCookie(c, 'st_locale', lang, { path: '/', maxAge: 365 * 86400, sameSite: 'Lax', secure });
    }
    await next();
  });

  const tr = (c: Context): Translator => translator(localeFromRequest(c.req.raw));

  /** The connected account of this browser, if any. */
  const current = async (c: Context): Promise<{ account: Account; cookie: string } | undefined> => {
    const cookie = getCookie(c, SESSION_COOKIE);
    const session = sessions.read(cookie);
    if (!session || !cookie) return undefined;
    const account = await store.getAccount(session.accountId);
    if (!account || !account.refreshToken) return undefined;
    return { account, cookie };
  };

  const pageContext = (t: Translator, page: PageContext['page'], session?: { account: Account; cookie: string }): PageContext => ({
    t,
    page,
    csrf: session ? sessions.csrf(session.cookie) : '',
    accountName: session?.account.accountName || session?.account.accountId,
  });

  /** API calls: a session and the CSRF token in a header (POST). */
  const apiSession = async (c: Context, write: boolean) => {
    const session = await current(c);
    if (!session) return c.json({ error: { message: 'Session expired', code: 'session' } satisfies ErrorInfo }, 401);
    if (write && !sessions.checkCsrf(session.cookie, c.req.header('x-csrf-token'))) {
      return c.json({ error: { message: 'Session expired', code: 'session' } satisfies ErrorInfo }, 403);
    }
    return session;
  };

  app.get('/health', (c) => c.text('ok'));

  app.get('/', async (c) => {
    const t = tr(c);
    const session = await current(c);
    if (!session) {
      const notice = c.req.query('denied') ? 'denied' : c.req.query('disconnected') ? 'disconnected' : undefined;
      const error = /^[a-zA-Z]{1,40}$/.test(c.req.query('error') ?? '') ? c.req.query('error') : undefined;
      return c.html(
        page(
          ConnectPage({
            ctx: pageContext(t, 'connect'),
            notice,
            configured,
            error: error ? { message: error, code: error } : undefined,
          }),
        ),
      );
    }
    const { account } = session;
    onRequest(account);
    const kinds = KINDS.filter((kind) => kind !== 'kb-article' || knowledgeBase(account));
    const requested = c.req.query('kind') ?? '';
    const kind: Kind = isKind(requested) ? requested : 'site-page';
    const kbMissing = kind === 'kb-article' && !knowledgeBase(account);
    const query = (c.req.query('q') ?? '').trim().slice(0, 100);
    const requestedFilter = c.req.query('show') as ItemFilter | undefined;
    const filter: ItemFilter = requestedFilter && ITEM_FILTERS.includes(requestedFilter) ? requestedFilter : 'all';
    let rows: ItemRowList | undefined;
    let error: ErrorInfo | undefined;
    if (account.targets.length > 0 && !kbMissing) {
      try {
        const list = await catalog.rows(hubspot(account), store, account, kind, c.req.query('refresh') === '1');
        const matching = filterRows(list.rows, account.targets, query, filter);
        const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
        const pageNumber = Math.min(pages, Math.max(1, Number.parseInt(c.req.query('page') ?? '1', 10) || 1));
        rows = {
          rows: matching.slice((pageNumber - 1) * PAGE_SIZE, pageNumber * PAGE_SIZE),
          matching: matching.length,
          total: list.rows.length,
          counts: Object.fromEntries(
            ITEM_FILTERS.map((each) => [each, filterRows(list.rows, account.targets, query, each).length]),
          ) as Record<ItemFilter, number>,
          complete: list.complete,
          page: pageNumber,
          pages,
        };
      } catch (caught) {
        console.error('Supertext: could not load the HubSpot content', caught);
        error = errorInfo(caught);
      }
    }
    const history = await store.recentJobs(account.accountId, 6);
    // `?job=`: the job that just finished (the page reloads with it), else the latest of this kind.
    const asked = /^[\w-]{1,64}$/.test(c.req.query('job') ?? '') ? await store.getJob(account.accountId, c.req.query('job')!) : undefined;
    const latest = asked ?? (await store.findJobs(account.accountId, { kind, limit: 1, offset: 0 })).jobs[0];
    // Checked: `?item=`, or the items of the job the page reloaded with (never just the latest job's).
    const selected = c.req.query('item') ? [c.req.query('item') as string] : asked?.kind === kind ? jobItemIds(asked) : [];
    return c.html(
      page(
        TranslatePage({
          ctx: pageContext(t, 'translate', session),
          account,
          hasKey: hasKey(account),
          kinds: kbMissing ? [...kinds, 'kb-article'] : kinds,
          kind,
          list: rows,
          query,
          filter,
          maxBatch: MAX_BATCH,
          maxListed: MAX_LISTED,
          selected,
          job: latest,
          history: history.filter((job) => job.id !== latest?.id).slice(0, 5),
          error,
          kbMissing,
          appBase: editorBase,
        }),
      ),
    );
  });

  // --- OAuth -----------------------------------------------------------------

  app.get('/oauth/start', (c) => {
    if (!configured) return c.redirect('/?error=notConfigured', 302);
    const { state, cookie } = sessions.state();
    setCookie(c, STATE_COOKIE, cookie, { path: '/oauth', maxAge: 600, httpOnly: true, sameSite: 'Lax', secure });
    return c.redirect(authorizeUrl(oauth, state), 302);
  });

  app.get('/oauth/callback', async (c) => {
    const stateCookie = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, { path: '/oauth' });
    if (c.req.query('error')) return c.redirect('/?denied=1', 302);
    const code = c.req.query('code');
    if (!code || !sessions.checkState(stateCookie, c.req.query('state'))) return c.redirect('/?error=session', 302);
    try {
      const { tokens, installation } = await exchangeCode(oauth, code);
      const existing = await store.getAccount(installation.portalId);
      const account: Account = {
        ...(existing ?? defaultAccount(installation.portalId)),
        accountName: installation.hubDomain,
        scopes: installation.scopes,
      };
      await store.saveAccount(account);
      await store.saveTokens(account.accountId, tokens);
      console.log(`Supertext: HubSpot account ${account.accountId} connected`);
      setCookie(c, SESSION_COOKIE, sessions.create(account.accountId), {
        path: '/',
        maxAge: 30 * 86400,
        httpOnly: true,
        sameSite: 'Lax',
        secure,
      });
      return c.redirect(account.targets.length > 0 ? '/' : '/settings', 302);
    } catch (error) {
      console.error('Supertext: OAuth failed', error);
      return c.redirect(`/?error=${encodeURIComponent(errorInfo(error).code ?? 'oauthFailed')}`, 302);
    }
  });

  app.post('/disconnect', async (c) => {
    const session = await current(c);
    const form = await c.req.parseBody();
    if (session && sessions.checkCsrf(session.cookie, String(form.csrf ?? ''))) {
      await store.deleteAccount(session.account.accountId);
      console.log(`Supertext: HubSpot account ${session.account.accountId} disconnected; its data was deleted.`);
    }
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.redirect('/?disconnected=1', 303);
  });

  // --- Jobs --------------------------------------------------------------------

  app.post('/api/jobs', async (c) => {
    const session = await apiSession(c, true);
    if (session instanceof Response) return session;
    const { account } = session;
    const body = (await c.req.json().catch(() => ({}))) as {
      kind?: string;
      itemId?: string;
      itemIds?: string[];
      languages?: string[];
      overwrite?: boolean;
    };
    const languages = (body.languages ?? []).filter((code) => typeof code === 'string' && account.targets.includes(code));
    const kind = typeof body.kind === 'string' && isKind(body.kind) ? body.kind : undefined;
    // `itemIds` (a batch), or `itemId` (one item, as before 1.4).
    const requested = Array.isArray(body.itemIds) ? body.itemIds : body.itemId !== undefined ? [body.itemId] : [];
    const itemIds = [...new Set(requested.filter((id): id is string => typeof id === 'string' && /^[\w-]{1,40}$/.test(id)))];
    if (!kind || itemIds.length === 0 || itemIds.length !== requested.length || languages.length === 0) {
      return c.json({ error: { message: 'Select an item and at least one language.', code: 'select' } }, 400);
    }
    if (itemIds.length > MAX_BATCH) {
      return c.json({ error: errorInfo(new LocalizedError(`Select at most ${MAX_BATCH} items.`, 'tooMany')) }, 400);
    }
    if (kind === 'kb-article' && !knowledgeBase(account)) {
      return c.json({ error: { message: 'The knowledge base is not connected.', code: 'hubspotForbidden' } }, 400);
    }
    if (!hasKey(account)) {
      return c.json({ error: errorInfo(new LocalizedError('No Supertext API key configured.', 'noApiKey')) }, 400);
    }
    onRequest(account);
    const { job, done } = await startJob(jobDeps, {
      accountId: account.accountId,
      kind,
      itemIds,
      languages,
      overwrite: Boolean(body.overwrite),
    });
    deps.onJob?.(done);
    return c.json({ id: job.id });
  });

  app.get('/api/jobs/:id', async (c) => {
    const session = await apiSession(c, false);
    if (session instanceof Response) return session;
    const job = await store.getJob(session.account.accountId, c.req.param('id'));
    if (!job) return c.json({ error: { message: 'Not found', code: 'notFound' } }, 404);
    const html = (await JobPanel({ t: tr(c), job, portalId: session.account.accountId, appBase: editorBase })).toString();
    return c.json({ status: job.status, html });
  });

  app.post('/api/test', async (c) => {
    const session = await apiSession(c, true);
    if (session instanceof Response) return session;
    const t = tr(c);
    const body = (await c.req.json().catch(() => ({}))) as { apiKey?: string };
    const typed = body.apiKey?.trim() ?? '';
    const saved = reporting.apiKey(session.account);
    let check: ApiKeyCheck | null;
    if (!typed || typed === saved) {
      // The saved key: the same check as after saving, stored and reported when its status changed.
      check = (await reporting.run(session.account, 'testConnection'))?.check ?? null;
    } else {
      // A key typed but not saved yet: only checked, nothing stored or reported.
      check = await new SupertextClient({ apiKey: typed, endpoint: config.supertextEndpoint || undefined, fetch: deps.fetch })
        .checkApiKey()
        .catch(() => null);
    }
    if (!check) return c.json({ ok: false, message: t.t('keyCheck.error', { status: '?' }) });
    return c.json({
      ok: check.status === 'ok',
      message: keyCheckText(t, check),
      html: (await KeyCheckMessage({ t, check })).toString(),
    });
  });

  // --- Translation files ------------------------------------------------------

  // Export for translation (from the Translate page): the item's texts as XLIFF 1.2 or HTML. No API key needed.
  app.post('/api/export', async (c) => {
    const session = await apiSession(c, true);
    if (session instanceof Response) return session;
    const { account } = session;
    const body = (await c.req.json().catch(() => ({}))) as { kind?: string; itemId?: string; languages?: string[]; format?: string };
    const languages = (body.languages ?? []).filter((code) => typeof code === 'string' && account.targets.includes(code));
    const kind = typeof body.kind === 'string' && isKind(body.kind) ? body.kind : undefined;
    if (!kind || !body.itemId || typeof body.itemId !== 'string' || languages.length === 0) {
      return c.json({ error: { message: 'Select an item and at least one language.', code: 'select' } }, 400);
    }
    if (kind === 'kb-article' && !knowledgeBase(account)) {
      return c.json({ error: { message: 'The knowledge base is not connected.', code: 'hubspotForbidden' } }, 400);
    }
    try {
      const file = await exportItem(jobDeps, account, { kind, itemId: body.itemId, languages, format: body.format === 'html' ? 'html' : 'xliff' });
      return new Response(file.body, {
        headers: {
          'Content-Type': file.contentType,
          'Content-Disposition': `attachment; filename="${file.filename}"`,
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      if (!(error instanceof LocalizedError)) console.error('Supertext: export failed', error);
      const t = tr(c);
      const info = errorInfo(error);
      return c.json({ error: { ...info, message: t.error(info) } }, 400);
    }
  });

  // Import translation: its own page (one file, at most 10 MB, read in memory and never stored).
  const importPage = (c: Context, session: { account: Account; cookie: string }, extra: { results?: ImportResult[]; error?: ErrorInfo } = {}) =>
    c.html(
      page(
        ImportPage({
          ctx: pageContext(tr(c), 'import', session),
          account: session.account,
          appBase: editorBase,
          ...extra,
        }),
      ),
      extra.error ? 400 : 200,
    );

  app.get('/import', async (c) => {
    const session = await current(c);
    if (!session) return c.redirect('/', 302);
    onRequest(session.account);
    return importPage(c, session);
  });

  app.post('/import', async (c) => {
    const session = await current(c);
    if (!session) return c.redirect('/', 303);
    try {
      const raw = await readLimited(c.req.raw, MAX_UPLOAD_BYTES + 64 * 1024);
      const form = await new Request(c.req.url, { method: 'POST', headers: { 'content-type': c.req.header('content-type') ?? '' }, body: raw }).formData();
      if (!sessions.checkCsrf(session.cookie, String(form.get('csrf') ?? ''))) return c.redirect('/?error=session', 303);
      const file = form.get('file');
      if (!file || typeof file === 'string' || file.size === 0) {
        throw new LocalizedError('Choose a file.', 'fileMissing');
      }
      if (file.size > MAX_UPLOAD_BYTES) throw tooLarge();
      const results = await importFile(jobDeps, session.account, {
        content: await file.text(),
        includeChanged: form.get('includeChanged') === '1',
        overwrite: form.get('overwrite') === '1',
      });
      return importPage(c, session, { results });
    } catch (error) {
      if (!(error instanceof LocalizedError)) console.error('Supertext: import failed', error);
      return importPage(c, session, { error: errorInfo(error) });
    }
  });

  // --- Links between translations (Settings → Translation) ------------------------

  /** Link helper for a page request (all kinds the account can read, whatever the setting). */
  const linkHelper = (account: Account) => new ContentLinks(hubspot(account), store, account.accountId, linkKinds(account));
  const PER_PAGE = 50;
  /** For the settings page: how many links there are, and how many wait. */
  const linkCounts = async (accountId: string) => {
    const all = await store.allLinks(accountId);
    return { all: all.length, waiting: all.filter((l) => l.status === 'waiting').length };
  };

  // History: every translation of the account, 50 per page, by kind and outcome.
  app.get('/history', async (c) => {
    const session = await current(c);
    if (!session) return c.redirect('/', 302);
    const t = tr(c);
    const { account } = session;
    const requested = c.req.query('kind') ?? '';
    const kind = isKind(requested) ? requested : undefined;
    const outcomeQuery = c.req.query('outcome') as HistoryOutcome | undefined;
    const outcome: HistoryOutcome = outcomeQuery && HISTORY_OUTCOMES.includes(outcomeQuery) ? outcomeQuery : 'all';
    const query = { kind, outcome: outcome === 'all' ? undefined : outcome };
    const first = await store.findJobs(account.accountId, { ...query, limit: 0, offset: 0 });
    const pages = Math.max(1, Math.ceil(first.total / PER_PAGE));
    const pageNumber = Math.min(pages, Math.max(1, Number.parseInt(c.req.query('page') ?? '1', 10) || 1));
    const { jobs, total } = await store.findJobs(account.accountId, { ...query, limit: PER_PAGE, offset: (pageNumber - 1) * PER_PAGE });
    return c.html(
      page(
        HistoryPage({
          ctx: pageContext(t, 'history', session),
          kinds: KINDS.filter((k) => k !== 'kb-article' || knowledgeBase(account)),
          kind,
          outcome,
          jobs,
          total,
          page: pageNumber,
          pages,
        }),
      ),
    );
  });

  app.get('/history/:id', async (c) => {
    const session = await current(c);
    if (!session) return c.redirect('/', 302);
    const job = await store.getJob(session.account.accountId, c.req.param('id'));
    if (!job) return c.redirect('/history', 302);
    return c.html(page(JobPage({ ctx: pageContext(tr(c), 'history', session), account: session.account, job, appBase: editorBase })));
  });

  app.get('/links', async (c) => {
    const session = await current(c);
    if (!session) return c.redirect('/', 302);
    const t = tr(c);
    const all = await store.allLinks(session.account.accountId);
    const status = c.req.query('status');
    const filter: LinkFilter = LINK_FILTERS.includes(status as LinkFilter) ? (status as LinkFilter) : 'all';
    const counts = Object.fromEntries(LINK_FILTERS.map((f) => [f, f === 'all' ? all.length : all.filter((l) => l.status === f).length])) as Record<LinkFilter, number>;
    const filtered = filter === 'all' ? all : all.filter((l) => l.status === filter);
    const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    const pageNumber = Math.min(pages, Math.max(1, Number(c.req.query('page')) || 1));
    const shown = filtered.slice((pageNumber - 1) * PER_PAGE, pageNumber * PER_PAGE);
    let rows: LinkRow[] = shown;
    if (shown.length) {
      try {
        const links = linkHelper(session.account);
        rows = [];
        for (const l of shown) rows.push({ ...l, item: await links.describe(l.kind, l.itemId, true), target: await links.describe(l.targetKind, l.targetId) });
      } catch (error) {
        console.warn('Links: items not read:', error instanceof Error ? error.message : error);
        rows = shown;
      }
    }
    const updated = c.req.query('updated');
    return c.html(
      page(
        LinksPage({
          ctx: pageContext(t, 'links', session),
          account: session.account,
          appBase: editorBase,
          rows,
          filter,
          counts,
          page: pageNumber,
          pages,
          updated: updated !== undefined && /^\d+$/.test(updated) ? Number(updated) : undefined,
          changed: c.req.query('changed') === '1',
        }),
      ),
    );
  });

  app.post('/links/keep', async (c) => {
    const session = await current(c);
    if (!session) return c.redirect('/', 303);
    const form = await c.req.parseBody();
    if (!sessions.checkCsrf(session.cookie, String(form.csrf ?? ''))) return c.redirect('/?error=session', 303);
    const kind = String(form.kind ?? '');
    const targetKind = String(form.targetKind ?? '');
    if (isKind(kind) && isKind(targetKind)) {
      await store.setKept(session.account.accountId, kind, String(form.itemId ?? ''), targetKind, String(form.targetId ?? ''), form.keep === '1');
    }
    const status = String(form.status ?? '');
    return c.redirect(appUrl('/links', { status: LINK_FILTERS.includes(status as LinkFilter) && status !== 'all' ? status : undefined, changed: '1' }), 303);
  });

  app.post('/links/update', async (c) => {
    const session = await current(c);
    if (!session) return c.redirect('/', 303);
    const form = await c.req.parseBody();
    if (!sessions.checkCsrf(session.cookie, String(form.csrf ?? ''))) return c.redirect('/?error=session', 303);
    if (!session.account.translateLinks) return c.redirect('/links', 303);
    const links = linkHelper(session.account);
    const seen = new Set<string>();
    let updated = 0;
    for (const l of await store.allLinks(session.account.accountId)) {
      if (l.status !== 'waiting' || seen.has(`${l.kind}:${l.itemId}`)) continue;
      seen.add(`${l.kind}:${l.itemId}`);
      try {
        if ((await links.recheck(l.kind, l.itemId, l.language)) === 'updated') updated++;
      } catch (error) {
        console.warn(`Links of ${l.kind} ${l.itemId} not updated:`, error instanceof Error ? error.message : error);
      }
    }
    return c.redirect(`/links?updated=${updated}`, 303);
  });

  // --- Settings ----------------------------------------------------------------

  app.get('/settings', async (c) => {
    const session = await current(c);
    if (!session) return c.redirect('/', 302);
    const t = tr(c);
    onRequest(session.account);
    return c.html(
      page(
        SettingsPage({
          ctx: pageContext(t, 'settings', session),
          account: session.account,
          serverKey: Boolean(config.supertextApiKey),
          reportsEnabled: reporting.enabled(session.account),
          reportsFixed: reporting.fixedByEnvironment,
          saved: c.req.query('saved') === '1',
          configResult: (['sent', 'off', 'failed'] as const).find((r) => r === c.req.query('config')),
          invalidCodes: c.req.query('invalid') || undefined,
          knowledgeBase: knowledgeBase(session.account),
          links: await linkCounts(session.account.accountId),
          review: config.reviewUrl !== '',
          uiLanguage: (() => {
            const chosen = getCookie(c, 'st_locale') ?? '';
            return /^(en|de|fr|it)$/.test(chosen) ? (chosen as 'en' | 'de' | 'fr' | 'it') : 'auto';
          })(),
        }),
      ),
    );
  });

  app.post('/settings', async (c) => {
    const session = await current(c);
    if (!session) return c.redirect('/', 303);
    const form = await c.req.parseBody({ all: true });
    const field = (name: string) => {
      const value = form[name];
      return String(Array.isArray(value) ? value[0] : (value ?? ''));
    };
    if (!sessions.checkCsrf(session.cookie, field('csrf'))) return c.redirect('/?error=session', 303);
    const account = { ...session.account };

    const apiKey = field('apiKey').trim();
    if (field('removeKey') === '1') account.apiKey = '';
    if (apiKey) account.apiKey = apiKey;
    const tone = field('tone');
    account.tone = tone === 'more' || tone === 'less' ? tone : 'default';
    account.translateUrls = field('translateUrls') === '1';
    account.translateLinks = field('translateLinks') === '1';
    account.publishTranslations = field('publishTranslations') === '1';
    const source = field('sourceLanguage');
    account.sourceLanguage = isLanguage(source) ? source : '';
    const chosen = form.target === undefined ? [] : Array.isArray(form.target) ? form.target : [form.target];
    account.targets = [...new Set(chosen.map(String))].filter((code) => isLanguage(code) && code !== account.sourceLanguage);
    const invalid: string[] = [];
    const codes: Record<string, string> = {};
    for (const [name, value] of Object.entries(form)) {
      if (!name.startsWith('code:')) continue;
      const code = String(Array.isArray(value) ? value[0] : value).trim();
      if (!code) continue;
      const language = name.slice(5);
      const exact = supertextCodeOf(code);
      if (isLanguage(language) && exact) codes[language] = exact;
      else invalid.push(code);
    }
    account.languageCodes = codes;
    // Translation review per language (the column is only shown while a review service is set).
    if (config.reviewUrl) {
      const review = form.review === undefined ? [] : Array.isArray(form.review) ? form.review : [form.review];
      account.reviewLanguages = [...new Set(review.map(String))].filter(isLanguage);
    }
    if (!reporting.fixedByEnvironment) account.versionReports = field('versionReports') === '1';

    // The interface language belongs to this browser (each colleague picks their own), not to the account.
    const uiLanguage = field('uiLanguage');
    if (/^(en|de|fr|it)$/.test(uiLanguage)) {
      setCookie(c, 'st_locale', uiLanguage, { path: '/', maxAge: 365 * 86400, sameSite: 'Lax', secure });
    } else if (uiLanguage === 'auto') {
      deleteCookie(c, 'st_locale', { path: '/' });
    }

    await store.saveAccount(account);
    // The automatic API key check (shown on the settings page) and the settings_saved report.
    await reporting.run(account, 'afterSettingsSaved');
    return c.redirect(appUrl('/settings', { saved: '1', invalid: invalid.join(', ') || undefined }), 303);
  });

  // "Send configuration to Supertext": the account's language mapping, for Supertext support.
  app.post('/settings/configuration', async (c) => {
    const session = await current(c);
    if (!session) return c.redirect('/', 303);
    const form = await c.req.parseBody();
    if (!sessions.checkCsrf(session.cookie, String(form.csrf ?? ''))) return c.redirect('/?error=session', 303);
    const account = session.account;
    let outcome: 'sent' | 'off' | 'failed' = 'off';
    if (reporting.enabled(account)) {
      const languages = [
        ...(account.sourceLanguage ? [{ code: account.sourceLanguage, supertext: supertextSource(account.sourceLanguage, account.languageCodes) || null }] : []),
        ...account.targets.map((code) => ({ code, supertext: resolvedTarget(code, account.languageCodes) })),
      ];
      const result = await reporting.sendConfiguration(account, languages);
      outcome = result?.sent ? 'sent' : 'failed';
    }
    return c.redirect(appUrl('/settings', { config: outcome }), 303);
  });

  return app;
}

/** The request body, refused (`fileTooLarge`) when the Content-Length or the body itself is larger than `limit`. */
async function readLimited(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(request.headers.get('content-length') ?? '0') > limit) throw tooLarge();
  if (!request.body) return new Uint8Array(new ArrayBuffer(0));
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** A full HTML page from a JSX element. */
async function page(element: { toString(): string | Promise<string> }): Promise<string> {
  return `<!doctype html>\n${await element.toString()}`;
}
