import { randomUUID } from 'node:crypto';
import { SDK_VERSION } from 'supertext-sdk';
import { describe, expect, it } from 'vitest';
import { REVIEW_URL } from '../src/config.js';
import { PORTAL_ID, setup, STANDARD_SETTINGS } from './helpers.js';
import { KB_URL, SITE_URL } from './standin/hubspot.js';

/** The language version of `sourceId` in `language`, as the stand-in has it now. */
const version = (env: ReturnType<typeof setup>, kind: Parameters<ReturnType<typeof setup>['hubspot']['items']>[0], sourceId: string, language: string) =>
  env.hubspot.items(kind).find((item) => item.language === language && (item.translatedFromId === sourceId || item.translationOfId === sourceId || item.clonedFrom === sourceId));

describe('connecting HubSpot', () => {
  it('installs through OAuth and opens the settings', async () => {
    const env = setup();
    const start = await env.request('/');
    expect(await start.text()).toContain('Connect HubSpot');
    const begin = await env.request('/oauth/start');
    const location = new URL(begin.headers.get('location')!);
    expect(location.origin + location.pathname).toBe('https://hubspot.test/oauth/authorize');
    expect(location.searchParams.get('scope')).toBe('oauth content');
    expect(location.searchParams.get('optional_scope')).toBe('cms.knowledge_base.articles.read cms.knowledge_base.articles.write cms.knowledge_base.articles.publish');
    expect(location.searchParams.get('redirect_uri')).toBe('https://app.test/oauth/callback');

    const done = await env.connect();
    expect(done.headers.get('location')).toBe('/settings');
    const account = await env.store.getAccount(PORTAL_ID);
    expect(account).toMatchObject({ accountName: 'swiss-chocolate.example', refreshToken: 'standin-refresh' });
    expect(account!.scopes).toContain('cms.knowledge_base.articles.write');
    const settings = await (await env.request('/settings')).text();
    expect(settings).toContain('swiss-chocolate.example');
    expect(settings).toContain('Knowledge base: connected.');
  });

  it('refuses a forged OAuth state', async () => {
    const env = setup();
    const response = await env.request('/oauth/callback?code=standin-code&state=forged');
    expect(response.headers.get('location')).toBe('/?error=session');
  });

  it('refuses API calls without a session or CSRF token', async () => {
    const env = setup();
    expect((await env.request('/api/jobs', { method: 'POST', body: '{}' })).status).toBe(401);
    await env.connect();
    const response = await env.request('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(403);
  });
});

describe('website pages', () => {
  it('makes a HubSpot language variant per language, as a draft, with modules translated', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    const list = await (await env.request('/')).text();
    expect(list).toContain('About us');
    expect(list).toMatch(/title="[^"]+: Not translated"/);

    const { job, html } = await env.translate('site-page', '101', ['de-ch', 'fr-ch']);
    expect(job.status).toBe('done');
    expect(html).toContain('Done: 2 created, 0 updated, 0 kept, 0 failed.');
    expect(html).toContain(`https://app.hubspot.com/pages/${PORTAL_ID}/editor/`);

    const german = version(env, 'site-page', '101', 'de-ch')!;
    expect(german.state).toBe('DRAFT');
    expect(german.name).toBe('Über uns');
    expect(german.htmlTitle).toBe('Über Swiss Chocolate Co.');
    expect(german.metaDescription).toBe('Familienbetrieb für Schokolade in Bern seit 1932.');
    const widgets = german.widgets as Record<string, { body: Record<string, unknown> }>;
    expect(widgets.header_1.body.text).toBe('Seit 1932 in Bern gemacht');
    expect(widgets.header_1.body.heading_level).toBe('h1');
    expect(widgets.rich_text.body.html).toBe(
      '<h2>Unsere Geschichte</h2><p>Wir stellen in unserer Werkstatt in Bern <strong>Bean-to-Bar</strong>-Schokolade her. <a href="https://example.com/visit">Besuchen Sie uns</a> samstags.</p>',
    );
    expect(widgets.cta.body).toEqual({
      button_text: 'Jetzt bestellen',
      // A link to the contact page, which has no German version yet: it stays (and waits).
      link: { url: { href: 'https://www.swiss-chocolate.example/contact', type: 'CONTENT', content_id: 102 } },
      style: { color: '#ff6e40' },
    });
    expect((widgets.hero_image.body.img as Record<string, unknown>).alt).toBe('Unsere Werkstatt in Bern');
    const cell = ((german.layoutSections as any).dnd_area.rows[0]['0'].params) as Record<string, unknown>;
    expect(cell).toEqual({ html: '<p>Jede Tafel wird von Hand verpackt.</p>', path: '@hubspot/rich_text', schema_version: 2, css_class: 'dnd-module' });
    expect(((german.layoutSections as any).dnd_area.label)).toBe('Main section');

    // One Supertext document per language, from the bare source language.
    expect(env.supertext.documents.map((d) => [d.source, d.target])).toEqual([
      ['en', 'de-CH'],
      ['en', 'fr-CH'],
    ]);
    // The original is unchanged.
    expect(env.hubspot.draft('101')!.name).toBe('About us');

    const after = await (await env.request('/?kind=site-page')).text();
    expect(after.match(/<a class="version-icon done"/g)?.length).toBe(2);
    expect(after).not.toContain('Über uns'); // variants aren't listed as items of their own
  });

  it("translates a new version's address, and keeps the address of an existing one", async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings([...STANDARD_SETTINGS, ['target', 'it-ch']]);
    await env.translate('site-page', '101', ['de-ch', 'fr-ch', 'it-ch']);
    expect(version(env, 'site-page', '101', 'de-ch')!.slug).toBe('de-ch/ueber-uns');
    expect(version(env, 'site-page', '101', 'fr-ch')!.slug).toBe('fr-ch/a-propos-de-nous');
    expect(version(env, 'site-page', '101', 'it-ch')!.slug).toBe('it-ch/chi-siamo');
    // The words travel in the same Supertext request as the other texts.
    expect(env.supertext.documents.length).toBe(3);

    // An existing version keeps its address, even when its draft is translated again.
    const german = version(env, 'site-page', '101', 'de-ch')!;
    env.hubspot.edit(String(german.id), { slug: 'de-ch/unsere-geschichte' });
    await env.translate('site-page', '101', ['de-ch'], true);
    expect(version(env, 'site-page', '101', 'de-ch')!.slug).toBe('de-ch/unsere-geschichte');

    // Blog posts keep the blog's part of the address.
    await env.translate('blog-post', '301', ['de-ch']);
    expect(version(env, 'blog-post', '301', 'de-ch')!.slug).toBe('de-ch/blog/roesten');
  });

  it('keeps the original address when the setting is off', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS.filter(([name]) => name !== 'translateUrls'));
    await env.translate('site-page', '101', ['de-ch']);
    expect(version(env, 'site-page', '101', 'de-ch')!.slug).toBe('de-ch/about-us');
    expect((await env.store.getAccount(PORTAL_ID))!.translateUrls).toBe(false);
  });

  it('keeps existing versions unless asked to update their drafts', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    await env.translate('site-page', '101', ['de-ch']);
    const german = version(env, 'site-page', '101', 'de-ch')!;
    const kept = await env.translate('site-page', '101', ['de-ch']);
    expect(kept.html).toContain('0 created, 0 updated, 1 kept');
    expect(env.supertext.documents.length).toBe(1);

    const updated = await env.translate('site-page', '101', ['de-ch', 'fr-ch'], true);
    expect(updated.html).toContain('1 created, 1 updated, 0 kept');
    expect(updated.job.items[0]).toMatchObject({ language: 'de-ch', state: 'updated', targetId: german.id });
    expect(env.hubspot.items('site-page').filter((item) => item.language === 'de-ch').length).toBe(1);
  });

  it('gives a page without a language the content language of the settings', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    const { job } = await env.translate('site-page', '102', ['de-ch']);
    expect(job.status).toBe('done');
    const call = env.hubspot.requests.find((r) => r.path.endsWith('/create-language-variation'));
    expect(call?.body).toEqual({ id: '102', language: 'de-ch', primaryLanguage: 'en' });
    expect(version(env, 'site-page', '102', 'de-ch')!.name).toBe('Kontakt');
  });

  it('refuses to translate a language version itself', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    await env.translate('site-page', '101', ['de-ch']);
    const german = version(env, 'site-page', '101', 'de-ch')!;
    const { job } = await env.translate('site-page', german.id, ['fr-ch']);
    expect(job).toMatchObject({ status: 'failed', error: { code: 'isTranslation' } });
  });
});

describe('publishing right away', () => {
  it('is off by default: every version is a draft', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    expect((await env.store.getAccount(PORTAL_ID))!.publishTranslations).toBe(false);
    const { html } = await env.translate('site-page', '101', ['de-ch']);
    expect(version(env, 'site-page', '101', 'de-ch')?.state).toBe('DRAFT');
    expect(html).toContain('New version (draft)');
    expect(env.hubspot.requests.some((r) => r.path.endsWith('/push-live'))).toBe(false);
  });

  it('publishes pages, posts and articles once written, never sends emails', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings([...STANDARD_SETTINGS, ['publishTranslations', '1']]);
    const settings = await (await env.request('/settings')).text();
    expect(settings).toMatch(/name="publishTranslations"[^>]*checked/);
    const translatePage = await (await env.request('/?kind=site-page')).text();
    expect(translatePage).toContain('Translations are published right away');

    const page = await env.translate('site-page', '101', ['de-ch', 'fr-ch']);
    expect(page.html).toContain('New version (published)');
    expect(page.html).toContain('The published versions are live.');
    const german = version(env, 'site-page', '101', 'de-ch')!;
    expect(german).toMatchObject({ state: 'PUBLISHED', currentlyPublished: true, name: 'Über uns' });
    expect(page.job.items.every((item) => item.published)).toBe(true);

    // Updating publishes the new text too.
    const again = await env.translate('site-page', '101', ['de-ch'], true);
    expect(again.html).toContain('Updated and published');
    expect(env.hubspot.requests.filter((r) => r.method === 'POST' && r.path.endsWith(`/${german.id}/draft/push-live`)).length).toBe(2);

    await env.translate('kb-article', '501', ['de-ch']);
    expect(version(env, 'kb-article', '501', 'de-ch')?.state).toBe('PUBLISHED');

    const email = await env.translate('email', '401', ['de-ch']);
    expect(email.html).toContain('New version (draft)');
    expect(version(env, 'email', '401', 'de-ch')?.state).not.toMatch(/PUBLISHED|SENT/);
    expect(env.hubspot.requests.some((r) => r.path.includes('/marketing/') && r.path.endsWith('/push-live'))).toBe(false);
  });

  it('leaves an article a draft when the account did not grant the publish scope', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings([...STANDARD_SETTINGS, ['publishTranslations', '1']]);
    const account = (await env.store.getAccount(PORTAL_ID))!;
    await env.store.saveAccount({ ...account, scopes: account.scopes.filter((scope) => scope !== 'cms.knowledge_base.articles.publish') });
    expect(await (await env.request('/settings')).text()).toContain('To publish knowledge base articles, connect HubSpot again');
    const { job, html } = await env.translate('kb-article', '501', ['de-ch']);
    expect(job.items[0]).toMatchObject({ state: 'created', publishError: { code: 'kbPublishScope' } });
    expect(html).toContain('Saved as a draft, not published');
    expect(version(env, 'kb-article', '501', 'de-ch')?.state).not.toBe('PUBLISHED');
  });
});

describe('batches', () => {
  it('translates several items in one job, and an item that fails does not stop the others', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    await env.translate('site-page', '101', ['de-ch']);
    const german = version(env, 'site-page', '101', 'de-ch')!;

    const started = await env.api('POST', '/api/jobs', { kind: 'site-page', itemIds: ['101', '102', '999', german.id], languages: ['de-ch', 'fr-ch'] });
    const { id } = (await started.json()) as { id: string };
    await env.settle();
    const job = (await env.store.getJob(PORTAL_ID, id))!;
    expect(job.status).toBe('done');
    expect(job.itemIds).toEqual(['101', '102', '999', german.id]);
    expect(job.titles).toMatchObject({ '101': 'About us', '102': 'Contact' });
    const results = job.items.map((item) => `${item.itemId} ${item.language} ${item.state} ${item.error?.code ?? ''}`.trim());
    expect(results).toEqual([
      '101 de-ch kept',
      '101 fr-ch created',
      '102 de-ch created',
      '102 fr-ch created',
      '999 de-ch failed itemMissing',
      '999 fr-ch failed itemMissing',
      `${german.id} de-ch failed isTranslation`,
      `${german.id} fr-ch failed isTranslation`,
    ]);
    const { html } = (await (await env.api('GET', `/api/jobs/${id}`)).json()) as { html: string };
    expect(html).toContain('Translation: About us and 3 more');
    expect(html).toContain('Done: 3 created, 0 updated, 1 kept, 4 failed.');
    // The same error for every language of an item: said once.
    expect(html.match(/The item no longer exists in HubSpot\./g)?.length).toBe(1);
    expect(version(env, 'site-page', '102', 'fr-ch')?.state).toBe('DRAFT');

    // The page reloads with the job's items checked and the new versions listed.
    const list = await (await env.request(`/?kind=site-page&job=${id}`)).text();
    expect(list).toMatch(/value="102"[^>]*checked/);
    expect(list).not.toMatch(/<td class="version"><span class="version-icon none"/);
    // A later visit starts with nothing checked.
    expect(await (await env.request('/?kind=site-page')).text()).not.toMatch(/name="item"[^>]*checked/);
  });

  it('refuses more than 50 items, or items that are not IDs', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    const many = Array.from({ length: 51 }, (_, index) => String(2000 + index));
    const refused = await env.api('POST', '/api/jobs', { kind: 'site-page', itemIds: many, languages: ['de-ch'] });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: { code: 'tooMany' } });
    const odd = await env.api('POST', '/api/jobs', { kind: 'site-page', itemIds: ['101', '../x'], languages: ['de-ch'] });
    expect(odd.status).toBe(400);
    expect(env.supertext.documents.length).toBe(0);
  });
});

describe('connecting again', () => {
  it('offers Connect HubSpot again in the settings and keeps the settings, API key and history', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings([...STANDARD_SETTINGS.filter(([name]) => name !== 'tone'), ['apiKey', 'my-key'], ['tone', 'more'], ['publishTranslations', '1']]);
    const { job } = await env.translate('site-page', '101', ['de-ch']);
    // As an account connected before the app asked to publish articles.
    const before = (await env.store.getAccount(PORTAL_ID))!;
    await env.store.saveAccount({ ...before, scopes: before.scopes.filter((scope) => scope !== 'cms.knowledge_base.articles.publish') });
    const settings = await (await env.request('/settings')).text();
    expect(settings).toContain('Publishing articles is not allowed yet');
    expect(settings).toMatch(/<a class="button" href="\/oauth\/start" id="reconnect">Connect HubSpot again<\/a>/);

    await env.connect();
    const after = (await env.store.getAccount(PORTAL_ID))!;
    expect(after).toMatchObject({ apiKey: 'my-key', tone: 'more', targets: before.targets, publishTranslations: true, languageCodes: before.languageCodes });
    expect(after.scopes).toContain('cms.knowledge_base.articles.publish');
    expect(await env.store.getJob(PORTAL_ID, job.id)).toBeTruthy();
    expect(await (await env.request('/settings')).text()).toContain('Knowledge base: connected.');
  });
});

describe('history', () => {
  it('lists every translation, 50 per page, filtered by kind and outcome, each one opening its results', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    const page = await env.translate('site-page', '101', ['de-ch']);
    const failed = await env.translate('site-page', '999', ['de-ch']);
    const post = await env.translate('blog-post', '301', ['de-ch']);
    // Older jobs, as after months of use.
    for (let n = 0; n < 60; n++) {
      await env.store.saveJob({
        ...structuredClone(page.job),
        id: randomUUID(),
        itemTitle: `Old ${n}`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString(),
      });
    }

    const first = await (await env.request('/history')).text();
    expect(first).toContain('63 translations');
    expect(first).toContain('Page 1 of 2');
    expect(first.match(/href="\/history\/[0-9a-f-]{36}"/g)?.length).toBe(50);
    // Newest first: the blog post's job is the first row.
    expect(first.indexOf(`/history/${post.job.id}`)).toBeLessThan(first.indexOf(`/history/${page.job.id}`));
    expect((await (await env.request('/history?page=2')).text()).match(/href="\/history\/[0-9a-f-]{36}"/g)?.length).toBe(13);

    const posts = await (await env.request('/history?kind=blog-post')).text();
    expect(posts).toContain('1 translation');
    expect(posts).toContain(`/history/${post.job.id}`);
    const problems = await (await env.request('/history?outcome=problems')).text();
    expect(problems).toContain('1 translation');
    expect(problems).toContain(`/history/${failed.job.id}`);

    const detail = await (await env.request(`/history/${page.job.id}`)).text();
    expect(detail).toContain('Translation: About us');
    expect(detail).toContain('Open in HubSpot');
    expect((await env.request('/history/not-a-job')).headers.get('location')).toBe('/history');

    // The Translate page shows the latest job of its own tab, and links to the history.
    const blogTab = await (await env.request('/?kind=blog-post')).text();
    expect(blogTab).toContain('Translation: How we roast our cocoa beans');
    expect(blogTab).toContain('href="/history"');
    const landingTab = await (await env.request('/?kind=landing-page')).text();
    expect(landingTab).not.toContain('<div class="card job">');
  });
});

describe('long lists', () => {
  const addPages = (env: ReturnType<typeof setup>, count: number) => {
    for (let n = 1; n <= count; n++) {
      env.hubspot.add('site-page', {
        id: String(5000 + n),
        name: `Product ${n}`,
        slug: `products/item-${n}`,
        language: 'en',
        state: 'DRAFT',
        updated: `2026-01-01T00:00:${String(n % 60).padStart(2, '0')}Z`,
        widgets: {},
      });
    }
  };

  it('loads every item in pages of 100, then searches, filters and pages without asking HubSpot again', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    addPages(env, 230);
    const lists = () => env.hubspot.requests.filter((r) => r.method === 'GET' && /\/site-pages$/.test(r.path)).length;

    const first = await (await env.request('/?kind=site-page')).text();
    expect(lists()).toBe(3); // 233 pages (one a language version): 100 + 100 + 33
    expect(first.match(/name="item"/g)?.length).toBe(50);
    expect(first).toContain('Page 1 of 5 (232 items)');
    expect(first).toContain('href="/?kind=site-page&amp;page=2"');

    const last = await (await env.request('/?kind=site-page&page=5')).text();
    expect(last.match(/name="item"/g)?.length).toBe(32);
    expect(last).toContain('Previous page');

    const found = await (await env.request('/?kind=site-page&q=item-117')).text();
    expect(found.match(/name="item"/g)?.length).toBe(1);
    expect(found).toContain('Product 117');
    expect(lists()).toBe(3); // kept for a minute

    await env.translate('site-page', '101', ['de-ch', 'fr-ch']);
    const before = lists();
    const complete = await (await env.request('/?kind=site-page&show=complete')).text();
    expect(lists()).toBe(before + 3); // the job's new versions: loaded again
    expect(complete.match(/name="item"/g)?.length).toBe(1);
    expect(complete).toContain('About us');
    const missing = await (await env.request('/?kind=site-page&show=missing&page=9')).text();
    expect(missing).toContain('Page 5 of 5 (231 items)');

    await env.request('/?kind=site-page&refresh=1');
    expect(lists()).toBe(before + 6);
  });
});

describe('landing pages', () => {
  it('keeps HubL personalization tokens and leaves forms alone', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    await env.translate('landing-page', '201', ['fr-ch']);
    const french = version(env, 'landing-page', '201', 'fr-ch')!;
    const widgets = french.widgets as Record<string, { body: Record<string, unknown> }>;
    expect(widgets.rich_text.body.html).toBe(
      '<p>Bonjour {{ contact.firstname }}, notre calendrier de l’Avent peut être commandé.</p><p>Commandez avant le 30 novembre pour une livraison avant le 1er décembre.</p>',
    );
    expect(widgets.form.body).toEqual({ form_id: 'f0e1d2c3', response_type: 'inline' });
    // The placeholder carries the token's text, so the AI reads a normal sentence.
    expect(env.supertext.documents[0].html).toContain('Hello <span data-hs="0" translate="no">{{ contact.firstname }}</span>, our advent calendar');
  });
});

describe('blog posts', () => {
  it("translates the body and fails only the language the blog doesn't have", async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings([...STANDARD_SETTINGS, ['target', 'it-ch']]);
    const { job, html } = await env.translate('blog-post', '301', ['de-ch', 'fr-ch', 'it-ch']);
    expect(job.status).toBe('done');
    expect(html).toContain('2 created, 0 updated, 0 kept, 1 failed');
    expect(job.items[2]).toMatchObject({ language: 'it-ch', state: 'failed', error: { code: 'blogLanguageMissing', params: { language: 'it-ch' } } });
    expect(html).toContain('The blog has no “it-ch” version in HubSpot yet, so nothing was translated for this language.');
    // HubSpot refused the version before anything was sent to Supertext.
    expect(env.supertext.documents.map((d) => d.target)).toEqual(['de-CH', 'fr-CH']);
    const german = version(env, 'blog-post', '301', 'de-ch')!;
    expect(german.name).toBe('Wie wir unsere Kakaobohnen rösten');
    expect(german.postBody).toBe(
      '<p>Das Rösten bringt das Aroma der Bohnen zur Geltung.</p><h2>Sanft und langsam</h2><p>Wir rösten <em>vierzig Minuten</em> lang bei 120 °C.</p>',
    );
    expect(german.postSummary).toBe('<p>Das Rösten bringt das Aroma der Bohnen zur Geltung.</p>');
    expect(german.featuredImageAltText).toBe('Unser Röster');
    expect(german.featuredImage).toBe('https://cdn.example.com/roaster.jpg');
  });
});

describe('marketing emails', () => {
  it('clones the email per language and translates subject, preview text, body and plain text', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    const { job } = await env.translate('email', '401', ['de-ch']);
    expect(job.status).toBe('done');
    const clone = version(env, 'email', '401', 'de-ch')!;
    expect(clone.name).toBe('Autumn newsletter · DE-CH');
    expect(clone.subject).toBe('Unsere Herbstschokoladen sind da');
    const content = clone.content as Record<string, any>;
    expect(content.widgets.preview_text.body.value).toBe('Haselnuss, Marroni und Kürbisgewürz');
    expect(content.widgets['module-0-0-0'].body.html).toBe(
      '<p>Hallo {{ contact.firstname }},</p><p>Unsere Herbstkollektion ist eingetroffen: <a href="https://shop.example.com/autumn">alle Tafeln ansehen</a>.</p>',
    );
    expect(content.widgets.button.body).toEqual({ button_text: 'Jetzt einkaufen', destination: 'https://shop.example.com' });
    expect(content.plainTextVersion).toBe('Hallo {{ contact.firstname }},\n\nUnsere Herbstkollektion ist eingetroffen.\n\n{{ unsubscribe_link }}');
    expect(content.styleSettings).toEqual({ backgroundColor: '#ffffff', primaryAccentColor: '#ff6e40' });
    expect(content.flexAreas.main.sections[0].id).toBe('section-0');
    expect((clone.webversion as Record<string, unknown>).title).toBe('Herbst-Newsletter');

    // The list shows the clone as the original's translation, not as an email of its own.
    const list = await (await env.request('/?kind=email')).text();
    expect(list).toContain('Autumn newsletter');
    expect(list).not.toContain('Autumn newsletter · DE-CH');
    expect(list).toContain(`https://app.hubspot.com/email/${PORTAL_ID}/edit/${clone.id}/content`);

    // Translating a clone is refused; translating again updates the clone only when asked.
    expect((await env.translate('email', clone.id, ['fr-ch'])).job.error?.code).toBe('isTranslation');
    expect((await env.translate('email', '401', ['de-ch'])).job.items[0].state).toBe('kept');
    expect((await env.translate('email', '401', ['de-ch'], true)).job.items[0]).toMatchObject({ state: 'updated', targetId: clone.id });
  });

  it('makes a new clone when the earlier one was sent', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    await env.translate('email', '401', ['de-ch']);
    const first = version(env, 'email', '401', 'de-ch')!;
    env.hubspot.setState(first.id, 'PUBLISHED');
    const { job } = await env.translate('email', '401', ['de-ch']);
    expect(job.items[0].state).toBe('created');
    expect(job.items[0].targetId).not.toBe(first.id);
    expect((await env.store.translations(PORTAL_ID, 'email')).get('401')).toEqual({ 'de-ch': job.items[0].targetId });
    expect(env.hubspot.draft(first.id)!.subject).toBe('Unsere Herbstschokoladen sind da');
  });
});

describe('knowledge base', () => {
  it('creates the article translation linked to the primary', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    const list = await (await env.request('/?kind=kb-article')).text();
    expect(list).toContain('How do I track my order?');
    const { job } = await env.translate('kb-article', '501', ['de-ch']);
    expect(job.status).toBe('done');
    const german = version(env, 'kb-article', '501', 'de-ch')!;
    expect(german).toMatchObject({
      title: 'Wie verfolge ich meine Bestellung?',
      subtitle: 'Finden Sie Ihr Paket mit wenigen Klicks',
      metaDescription: 'Ihre Schokoladenbestellung verfolgen',
      // The address is translated too (Settings → Translation, on by default).
      path: 'bestellung-verfolgen',
      state: 'DRAFT',
      translationOfId: '501',
      tagIds: [],
    });
    expect(german.body).toBe(
      '<p>Sie erhalten einen Tracking-Link per E-Mail, sobald Ihre Bestellung versandt wird.</p><ol><li>Öffnen Sie die E-Mail.</li><li>Klicken Sie auf <strong>Paket verfolgen</strong>.</li></ol>',
    );
    // HubSpot lists articles' translations by language; the app reads them.
    const again = await (await env.request('/?kind=kb-article')).text();
    expect(again).toContain(`/knowledge-article/${PORTAL_ID}/editor/${german.id}/content`);
  });

  it("fails only the language the knowledge base doesn't have, before anything is sent to Supertext", async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings([...STANDARD_SETTINGS, ['target', 'de']]);
    const { job, html } = await env.translate('kb-article', '501', ['de-ch', 'de']);
    expect(job.status).toBe('done');
    expect(job.items[1]).toMatchObject({ language: 'de', state: 'failed', error: { code: 'kbLanguageMissing', params: { language: 'de' } } });
    expect(html).toContain('The knowledge base has no “de” version in HubSpot yet, so nothing was translated for this language.');
    expect(env.supertext.documents.map((d) => d.target)).toEqual(['de-CH']);
    expect(version(env, 'kb-article', '501', 'de')).toBeUndefined();
  });

  it('points links between articles to the translations, also when the linked article is translated later', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    const hrefs = (html: unknown) => [...String(html).matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

    // "Track my order" first; "Returning an order" links to it (full address), to "Damaged chocolate" (relative,
    // with an anchor) and to the website's contact page.
    await env.translate('kb-article', '501', ['de-ch']);
    await env.translate('kb-article', '502', ['de-ch']);
    const tracking = version(env, 'kb-article', '501', 'de-ch')!;
    const returning = version(env, 'kb-article', '502', 'de-ch')!;
    expect(hrefs(returning.body)).toEqual([
      `${KB_URL}/de-ch/knowledge-base/${tracking.path}`, // translated: the German article's (translated) address
      '/en/knowledge-base/damaged-chocolate#photos', // not translated yet: stays, and waits
      '#before', // an anchor on the same article
      `${SITE_URL}/contact`, // a website page, not translated yet: waits too
    ]);
    expect(await env.store.waitingFor(PORTAL_ID, 'de-ch', 'kb-article', '503')).toEqual([{ kind: 'kb-article', itemId: String(returning.id) }]);
    expect(await env.store.waitingFor(PORTAL_ID, 'de-ch', 'site-page', '102')).toEqual([{ kind: 'kb-article', itemId: String(returning.id) }]);

    // An editor changes the German draft meanwhile; then "Damaged chocolate" is translated.
    const edited = String(returning.body).replace('</p>', ' Danke!</p>');
    env.hubspot.edit(String(returning.id), { body: edited });
    await env.translate('kb-article', '503', ['de-ch']);
    const damaged = version(env, 'kb-article', '503', 'de-ch')!;
    const fixed = version(env, 'kb-article', '502', 'de-ch')!;
    // The waiting link now points to the German article, relative as it was and with its anchor; the editor's change stays.
    expect(hrefs(fixed.body)[1]).toBe(`/de-ch/knowledge-base/${damaged.path}#photos`);
    expect(String(fixed.body)).toContain('Danke!');
    expect(await env.store.waitingFor(PORTAL_ID, 'de-ch', 'kb-article', '503')).toEqual([]);
    // And the new article's own link to "Returning an order" points to its German version right away.
    expect(hrefs(damaged.body)).toEqual([`${KB_URL}/de-ch/knowledge-base/${fixed.path}`]);
    // The English originals are never changed.
    expect(hrefs(env.hubspot.draft('502')!.body)[0]).toBe(`${KB_URL}/en/knowledge-base/track-my-order`);
  });

  it('points links between all kinds of content: articles, pages, posts and emails', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    const hrefs = (html: unknown) => [...String(html).matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    await env.translate('kb-article', '502', ['de-ch']);
    const returning = () => version(env, 'kb-article', '502', 'de-ch')!;
    expect(hrefs(returning().body)[3]).toBe(`${SITE_URL}/contact`);

    // The contact page is translated: the article's waiting link points to it (its translated address).
    await env.translate('site-page', '102', ['de-ch']);
    const contact = version(env, 'site-page', '102', 'de-ch')!;
    expect(contact.slug).toBe('de-ch/kontakt');
    expect(hrefs(returning().body)[3]).toBe(`${SITE_URL}/de-ch/kontakt`);

    // "About us": its button links to the contact page with HubSpot's link field; both address and page ID follow.
    await env.translate('site-page', '101', ['de-ch']);
    const about = version(env, 'site-page', '101', 'de-ch')! as Record<string, any>;
    expect(about.widgets.cta.body.link.url).toEqual({ href: `${SITE_URL}/de-ch/kontakt`, type: 'CONTENT', content_id: Number(contact.id) });

    // An email linking to a blog post that gets its German version only afterwards.
    await env.translate('email', '401', ['de-ch']);
    const email = () => version(env, 'email', '401', 'de-ch')! as Record<string, any>;
    expect(email().content.widgets.roasting.body.link.url.href).toBe(`${SITE_URL}/blog/roasting`);
    await env.translate('blog-post', '301', ['de-ch']);
    expect(email().content.widgets.roasting.body.link.url.href).toBe(`${SITE_URL}/de-ch/blog/roesten`);
    // Only the article's links to the two articles not translated in this test still wait.
    expect((await env.store.allLinks(PORTAL_ID)).filter((l) => l.status === 'waiting').map((l) => l.targetId)).toEqual(['501', '503']);
  });

  it('lists all links, filters them, keeps a link on the original and updates waiting ones on request', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    const post = async (path: string, fields: [string, string][] = []) =>
      env.request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams([['csrf', await env.csrf()], ...fields]).toString(),
      });
    await env.translate('kb-article', '501', ['de-ch']);
    await env.translate('kb-article', '502', ['de-ch', 'fr-ch']);
    const german = version(env, 'kb-article', '502', 'de-ch')!;
    const french = version(env, 'kb-article', '502', 'fr-ch')!;

    // German: to "Track my order" translated, to "Damaged chocolate" and the contact page waiting; French: all three waiting.
    expect(await (await env.request('/settings')).text()).toContain('6 links between translations, 5 of them waiting for a translation.');
    const all = await (await env.request('/links')).text();
    expect(all).toContain('Links between translations');
    expect(all).toContain('All (6)');
    expect(all).toContain('Waiting (5)');
    expect(all).toContain('Translated (1)');
    expect(all).toContain('Damaged chocolate');
    expect(all).toContain('Website page');
    expect(all).toContain(`/knowledge-article/${PORTAL_ID}/editor/${german.id}/content`);
    const translated = await (await env.request('/links?status=translated')).text();
    expect(translated).toContain('How do I track my order?');
    expect(translated).not.toContain('Damaged chocolate');

    // Keep one on the original: it moves to "Kept", and stays there.
    await post('/links/keep', [['kind', 'kb-article'], ['itemId', String(french.id)], ['targetKind', 'kb-article'], ['targetId', '503'], ['keep', '1'], ['status', 'waiting']]);
    expect(await (await env.request('/links?status=kept')).text()).toContain('Kept on the original (1)');

    // "Damaged chocolate" translated while updating links was off (as if made by hand); then "Update links now".
    await env.saveSettings(STANDARD_SETTINGS.filter(([name]) => name !== 'translateLinks'));
    await env.translate('kb-article', '503', ['de-ch', 'fr-ch']);
    expect(String(version(env, 'kb-article', '502', 'de-ch')!.body)).toContain('/en/knowledge-base/damaged-chocolate#photos');
    await env.saveSettings(STANDARD_SETTINGS);
    const updated = await post('/links/update');
    expect(updated.headers.get('location')).toBe('/links?updated=1');
    const damaged = version(env, 'kb-article', '503', 'de-ch')!;
    expect(String(version(env, 'kb-article', '502', 'de-ch')!.body)).toContain(`/de-ch/knowledge-base/${damaged.path}#photos`);
    // The kept French link stays on the original.
    expect(String(version(env, 'kb-article', '502', 'fr-ch')!.body)).toContain('/en/knowledge-base/damaged-chocolate#photos');
    const status = (await env.store.allLinks(PORTAL_ID)).map((l) => `${l.language}:${l.targetKind}:${l.targetId}:${l.status}`).sort();
    expect(status).toEqual([
      'de-ch:kb-article:501:translated',
      'de-ch:kb-article:503:translated',
      'de-ch:site-page:102:waiting',
      'fr-ch:kb-article:501:waiting',
      'fr-ch:kb-article:503:kept',
      'fr-ch:site-page:102:waiting',
    ]);

    // "Wait for the translation" again: the link is updated with the next check.
    await post('/links/keep', [['kind', 'kb-article'], ['itemId', String(french.id)], ['targetKind', 'kb-article'], ['targetId', '503'], ['keep', '0']]);
    await post('/links/update');
    const frenchDamaged = version(env, 'kb-article', '503', 'fr-ch')!;
    expect(String(version(env, 'kb-article', '502', 'fr-ch')!.body)).toContain(`/fr-ch/knowledge-base/${frenchDamaged.path}#photos`);
  });

  it('is a beta, off for a new account', async () => {
    const env = setup();
    await env.connect();
    expect((await env.store.getAccount(PORTAL_ID))!.translateLinks).toBe(false);
    const html = await (await env.request('/settings')).text();
    expect(html).toMatch(/name="translateLinks" value="1"(?! checked)/);
    expect(html).toContain('<span class="badge beta">Beta</span>');
  });

  it('leaves links alone when the setting is off', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS.filter(([name]) => name !== 'translateLinks'));
    await env.translate('kb-article', '501', ['de-ch']);
    await env.translate('kb-article', '502', ['de-ch']);
    expect(String(version(env, 'kb-article', '502', 'de-ch')!.body)).toContain('href="https://help.swiss-chocolate.example/en/knowledge-base/track-my-order"');
    expect((await env.store.getAccount(PORTAL_ID))!.translateLinks).toBe(false);
    expect(await env.store.allLinks(PORTAL_ID)).toEqual([]);
  });

  it('is only offered when the account granted its scopes', async () => {
    const env = setup();
    env.hubspot.withoutKnowledgeBase();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    const page = await (await env.request('/')).text();
    expect(page).not.toContain('Knowledge base');
    expect(await (await env.request('/?kind=kb-article')).text()).toContain('The knowledge base isn&#39;t connected');
    const refused = await env.api('POST', '/api/jobs', { kind: 'kb-article', itemId: '501', languages: ['de-ch'] });
    expect(refused.status).toBe(400);
    expect(await (await env.request('/settings')).text()).toContain('Knowledge base: not connected');
  });
});

describe('languages', () => {
  it('sends nothing for a language without a Supertext code, and uses the mapping where there is one', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings([
      ['sourceLanguage', 'en'],
      ['target', 'fr-be'],
      ['target', 'it'],
      ['code:it', 'it-ch'],
      ['tone', 'more'],
    ]);
    const settings = await (await env.request('/settings')).text();
    expect(settings).toContain('These languages have no Supertext code yet');
    const { job } = await env.translate('landing-page', '201', ['fr-be', 'it']);
    expect(job.items[0]).toMatchObject({ language: 'fr-be', state: 'failed', error: { code: 'unsupportedLanguage', params: { code: 'fr-be' } } });
    expect(job.items[1]).toMatchObject({ language: 'it', state: 'created' });
    expect(env.supertext.documents.map((d) => [d.target, d.politeness])).toEqual([['it-CH', 'more']]);
    expect(version(env, 'landing-page', '201', 'it')!.htmlTitle).toBe('Calendario dell’Avvento 2026');
  });

  it("refuses codes Supertext doesn't offer", async () => {
    const env = setup();
    await env.connect();
    const saved = await env.saveSettings([['target', 'de'], ['code:de', 'de-XX']]);
    expect(saved.headers.get('location')).toContain('invalid=de-XX');
    expect((await env.store.getAccount(PORTAL_ID))!.languageCodes).toEqual({});
  });

  it('offers the Supertext codes as a dropdown, the same language first', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings([['target', 'de'], ['target', 'de-ch'], ['code:de', 'de-DE']]);
    const html = await (await env.request('/settings')).text();
    const row = (code: string) => html.slice(html.indexOf(`name="code:${code}"`), html.indexOf('</select>', html.indexOf(`name="code:${code}"`)));
    expect(row('de')).toContain('<option value="de-DE" selected');
    expect(row('de').indexOf('gsw-u-sd-chzh')).toBeLessThan(row('de').indexOf('All Supertext languages'));
    // Nothing saved: the exact match or the SDK's default is preselected, else "— choose —".
    expect(row('de-ch')).toContain('<option value="de-CH" selected');
    expect(row('zh-cn')).toContain('<option value="zh-Hans" selected');
    expect(row('zh-cn')).not.toContain('— choose —');
    expect(row('zh-cn')).toMatch(/Suggested[\s\S]*zh-Hans[\s\S]*zh-Hant[\s\S]*All Supertext/);
    expect(row('fr-be')).toContain('<option value="" selected="">— choose —');
    expect(html).not.toContain('<datalist');
    expect(row('de')).toContain('data-combobox');
  });
});

describe('Translation review', () => {
  it('sends languages with review on through the review service (all four calls), the others directly', async () => {
    const env = setup({ SUPERTEXT_REVIEW_URL: 'https://review.test/v1/' });
    await env.connect();
    await env.saveSettings([...STANDARD_SETTINGS, ['review', 'de-ch']]);
    expect((await env.store.getAccount(PORTAL_ID))!.reviewLanguages).toEqual(['de-ch']);
    const html = await (await env.request('/settings')).text();
    expect(html).toContain('<th>Translation review</th>');
    expect(html).toMatch(/name="review" value="de-ch" checked/);
    expect(html).not.toMatch(/name="review" value="fr-ch" checked/);

    env.supertextRequests.length = 0;
    const { job } = await env.translate('site-page', '101', ['de-ch', 'fr-ch']);
    expect(job.items.map((item) => item.state)).toEqual(['created', 'created']);
    expect(version(env, 'site-page', '101', 'de-ch')!.name).toBe('Über uns');
    const calls = (host: string) => env.supertextRequests.filter((call) => call.includes(` ${host}/`)).map((call) => call.replace(/\/[0-9a-f-]{8,}/, '/{id}'));
    expect(calls('review.test')).toEqual([
      'POST review.test/v1/translate/ai/file',
      'GET review.test/v1/translate/ai/file/{id}/status',
      'GET review.test/v1/translate/ai/file/{id}/translation',
      'DELETE review.test/v1/translate/ai/file/{id}',
    ]);
    expect(calls('supertext.test').filter((call) => call.includes('/translate/'))).toEqual([
      'POST supertext.test/v1/translate/ai/file',
      'GET supertext.test/v1/translate/ai/file/{id}/status',
      'GET supertext.test/v1/translate/ai/file/{id}/translation',
      'DELETE supertext.test/v1/translate/ai/file/{id}',
    ]);
    expect(env.supertext.documents.map((d) => d.target)).toEqual(['de-CH', 'fr-CH']);
  });

  it('is off for every language with an empty SUPERTEXT_REVIEW_URL (no column, everything direct)', async () => {
    const env = setup({ SUPERTEXT_REVIEW_URL: '' });
    await env.connect();
    await env.saveSettings([...STANDARD_SETTINGS, ['review', 'de-ch']]);
    expect(await (await env.request('/settings')).text()).not.toContain('Translation review');
    await env.translate('site-page', '101', ['de-ch']);
    expect(env.supertextRequests.some((call) => call.includes('review.test'))).toBe(false);
    expect(env.supertext.documents.map((d) => d.target)).toEqual(['de-CH']);
  });

  it("defaults to Supertext's review service, off for every language until ticked", async () => {
    const env = setup({ SUPERTEXT_REVIEW_URL: undefined as unknown as string });
    expect(env.config.reviewUrl).toBe(REVIEW_URL);
    await env.connect();
    expect((await env.store.getAccount(PORTAL_ID))!.reviewLanguages).toEqual([]);
  });
});

describe('interface language', () => {
  it('follows the browser, and Settings can choose another one for this browser only', async () => {
    const env = setup();
    await env.connect();
    const english = await (await env.request('/settings')).text();
    expect(english).toContain('Automatic (your browser&#39;s language)');
    expect(english).not.toContain('class="langs"'); // no switcher in the header any more
    await env.saveSettings([...STANDARD_SETTINGS, ['uiLanguage', 'de']]);
    const german = await (await env.request('/settings')).text();
    expect(german).toContain('Supertext-Einstellungen');
    expect(german).toMatch(/<option value="de" lang="de" selected/);
    expect(await (await env.request('/')).text()).toContain('Mit Supertext übersetzen');
    await env.saveSettings([...STANDARD_SETTINGS, ['uiLanguage', 'auto']]);
    expect(await (await env.request('/settings')).text()).toContain('Supertext settings');
  });

  it('offers the four languages as links on the connect page', async () => {
    const env = setup();
    const page = await (await env.request('/')).text();
    expect(page).toContain('href="/?lang=fr"');
    expect(await (await env.request('/?lang=fr')).text()).toContain('Connecter HubSpot');
  });
});

describe('HubSpot tokens', () => {
  it('refreshes an expired access token and goes on', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    env.hubspot.expireTokens();
    const { job } = await env.translate('site-page', '101', ['de-ch']);
    expect(job.status).toBe('done');
    expect((await env.store.getAccount(PORTAL_ID))!.accessToken).not.toBe('standin-token-1');
  });

  it('forgets the tokens when HubSpot refuses the refresh token (app uninstalled)', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    env.hubspot.revoke();
    const page = await (await env.request('/')).text();
    expect(page).toContain('HubSpot refused the connection');
    expect((await env.store.getAccount(PORTAL_ID))!.refreshToken).toBe('');
    expect(await (await env.request('/')).text()).toContain('Connect HubSpot');
  });
});

describe('disconnecting', () => {
  it('deletes the account and its data', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    await env.translate('site-page', '101', ['de-ch']);
    const form = new URLSearchParams({ csrf: await env.csrf() });
    const response = await env.request('/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    expect(response.headers.get('location')).toBe('/?disconnected=1');
    expect(await env.store.getAccount(PORTAL_ID)).toBeUndefined();
    expect(await env.store.recentJobs(PORTAL_ID, 5)).toEqual([]);
  });
});

describe('Commando Center', () => {
  it('checks the key and reports "installed", then "settings_saved", with the account as the site', async () => {
    const env = setup();
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    await env.saveSettings(STANDARD_SETTINGS);
    await env.settle();
    expect(env.supertext.reports.map((report) => report.event)).toEqual(['installed', 'settings_saved', 'settings_saved']);
    const [installed] = env.supertext.reports;
    expect(installed).toMatchObject({
      schema: 1,
      event: 'installed',
      site_url: `https://app.hubspot.com/settings/${PORTAL_ID}`,
      plugin: { name: 'HubSpot-Supertext-Translation' },
      system: { name: 'HubSpot' },
      runtime: { name: 'Node.js' },
      api_key_configured: true,
      api_key_check: { status: 'ok' },
      sdk_version: SDK_VERSION,
    });
    expect(installed).not.toHaveProperty('callback');
    expect(JSON.stringify(env.supertext.reports)).not.toContain('server-key');
    expect(JSON.stringify(env.supertext.reports)).not.toContain('swiss-chocolate');
    const page = await (await env.request('/settings')).text();
    expect(page).toContain('API key checked: the connection to Supertext works.');
  });

  it('sends nothing when the setting is off, but still checks the key', async () => {
    const env = setup({ SUPERTEXT_VERSION_REPORTS: '0' });
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    await env.request('/');
    await env.settle();
    expect(env.supertext.reports).toEqual([]);
    expect(await (await env.request('/settings')).text()).toContain('API key checked');
  });

  it('reports a key Supertext rejects during a translation once', async () => {
    const env = setup({ SUPERTEXT_API_KEY: 'invalid' });
    await env.connect();
    await env.saveSettings(STANDARD_SETTINGS);
    const { job } = await env.translate('site-page', '101', ['de-ch', 'fr-ch']);
    expect(job).toMatchObject({ status: 'failed', error: { code: 'auth' } });
    expect(job.items.length).toBe(1);
    // The version made before translating was removed again (archived, as HubSpot does).
    expect(version(env, 'site-page', '101', 'de-ch')?.archived).toBe(true);
  });
});
