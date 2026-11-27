// Links between pages, posts and articles, pointed to the version in the same language.
//
// HubSpot gives every website page, landing page, blog post and knowledge base article its
// address (`url`) and links its language versions (`translatedFromId` for pages and posts,
// `translationOfId` for articles). So a link in a translation to another item of the account,
// full (https://www.example.com/about-us) or relative (/en/knowledge-base/…), with an anchor or
// query string or without, can be pointed to that item's version in the translation's language,
// whatever kind either of them is (an email to a page, a page to an article …). The address used
// is the version's draft's: a version the app just made has its translated address only in the
// draft until an editor publishes it (slug.ts).
//
// Links are found in HTML (`<a href>`) and in HubSpot's link fields (`{ href, type, content_id }`
// in modules such as buttons; `content_id` is updated too). Every link to another item is stored
// (Store.saveLinks): `translated` when it points to the version, `waiting` when that item has no
// version in the language yet. When the app later translates an item, it fixes the waiting links
// in the drafts that wait for it. `kept` links ("Keep the original link") are never changed. Only
// links change; the rest of a draft, including an editor's changes, stays as it is. Links to
// anything else (other sites, #anchors on the same page, mailto:, HubL) are left alone.

import type { HubSpotClient } from '../hubspot/client.js';
import { basePath, getDraft, getItem, updateDraft, type Item, type Kind } from '../hubspot/content.js';
import type { Account, Store } from '../store/store.js';

/** Kinds a link can point to (emails have no address of their own). */
export const LINK_TARGETS: readonly Kind[] = ['site-page', 'landing-page', 'blog-post', 'kb-article'];

/** The fields of a draft that hold links, per kind (what the app writes back when fixing links). */
const LINK_FIELDS: Record<Kind, string[]> = {
  'site-page': ['widgets', 'widgetContainers', 'layoutSections'],
  'landing-page': ['widgets', 'widgetContainers', 'layoutSections'],
  'blog-post': ['postBody', 'postSummary', 'widgets', 'widgetContainers', 'layoutSections'],
  email: ['content'],
  'kb-article': ['body'],
};

interface Entry {
  kind: Kind;
  id: string;
  url: string;
  title: string;
  language: string;
  /** The original's ID for a version, else its own. */
  original: string;
}

const str = (value: unknown): string => (value === undefined || value === null ? '' : String(value));
const key = (url: URL): string => decodeURIComponent(url.pathname).replace(/\/+$/, '').toLowerCase();
const decode = (href: string): string => href.replace(/&amp;/g, '&').replace(/&#38;/g, '&');
const encode = (href: string): string => href.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const HREF = /(<a\b[^>]*?\bhref\s*=\s*)(["'])(.*?)\2/gi;

/** A target in the form the store and `kept` use. */
const ref = (kind: Kind, id: string) => `${kind}:${id}`;

export interface RewriteResult {
  links: { targetKind: Kind; targetId: string; status: 'translated' | 'waiting'; href?: string }[];
}

/** The link helper for an account's job or page, or undefined when the setting is off. */
export function linksFor(client: HubSpotClient, store: Store, account: Account): ContentLinks | undefined {
  if (!account.translateLinks) return undefined;
  // The knowledge base only with its scopes (see app.ts → knowledgeBase).
  const kinds = LINK_TARGETS.filter((kind) => kind !== 'kb-article' || account.scopes.includes('cms.knowledge_base.articles.write'));
  return new ContentLinks(client, store, account.accountId, kinds);
}

export class ContentLinks {
  private items?: Map<string, Entry>;
  private byAddress = new Map<string, Entry>();
  /** kind:original → language → version. */
  private versions = new Map<string, Map<string, Entry>>();
  private hosts = new Set<string>();
  private drafts = new Map<string, string>();

  constructor(
    private readonly client: HubSpotClient,
    private readonly store: Store,
    private readonly accountId: string,
    /** The kinds the account can read (the knowledge base only with its scopes). */
    private readonly kinds: readonly Kind[] = LINK_TARGETS,
  ) {}

  private remember(kind: Kind, item: Item): Entry {
    const id = str(item.id);
    const entry: Entry = {
      kind,
      id,
      url: str(item.url),
      title: str(item.title ?? item.name) || id,
      language: str(item.language).toLowerCase(),
      original: str(item.translatedFromId ?? item.translationOfId) || id,
    };
    this.items!.set(ref(kind, id), entry);
    const group = this.versions.get(ref(kind, entry.original)) ?? new Map<string, Entry>();
    if (entry.language) group.set(entry.language, entry);
    this.versions.set(ref(kind, entry.original), group);
    if (entry.url) {
      try {
        const url = new URL(entry.url);
        this.hosts.add(url.host.toLowerCase());
        // An original wins over a version at the same address.
        const there = this.byAddress.get(key(url));
        if (!there || there.original !== there.id || entry.original === entry.id) this.byAddress.set(key(url), entry);
      } catch {
        // no usable address: links to it can't be recognized
      }
    }
    return entry;
  }

  /** All pages, posts and articles with their addresses and versions, read once per job. */
  private async load(): Promise<void> {
    if (this.items) return;
    this.items = new Map();
    for (const kind of this.kinds.filter((k) => LINK_TARGETS.includes(k))) {
      let after: string | undefined;
      do {
        const query = new URLSearchParams({ limit: '100', archived: 'false' });
        if (after) query.set('after', after);
        const page = await this.client.json<{ results?: Item[]; paging?: { next?: { after?: string } } }>('GET', `${basePath(kind)}?${query}`);
        for (const item of page.results ?? []) this.remember(kind, item);
        after = page.paging?.next?.after || undefined;
      } while (after);
    }
    // Addresses the app pointed links to before: a version's draft address, which the list (the
    // published version) doesn't show until it is published.
    for (const link of await this.store.allLinks(this.accountId)) {
      if (link.status !== 'translated' || !link.href) continue;
      const version = this.versions.get(ref(link.targetKind, link.targetId))?.get(link.language);
      if (version) this.addAddress(link.href, version);
    }
  }

  /** Also recognize `address` as `entry` (a version's draft address). */
  private addAddress(address: string, entry: Entry): void {
    try {
      const url = new URL(address, 'https://relative.invalid/');
      if (url.host !== 'relative.invalid') this.hosts.add(url.host.toLowerCase());
      if (!this.byAddress.has(key(url))) this.byAddress.set(key(url), entry);
    } catch {
      // not an address
    }
  }

  /** The item a link points to, if it is one of the account's pages, posts or articles. */
  private target(href: string): { entry: Entry; url: URL; relative: boolean } | undefined {
    const raw = decode(href.trim());
    if (!raw || raw.startsWith('#') || /^(mailto|tel|javascript|data):/i.test(raw) || /\{\{|\{%/.test(raw)) return undefined;
    let url: URL;
    try {
      url = new URL(raw, 'https://relative.invalid/');
    } catch {
      return undefined;
    }
    const relative = url.host === 'relative.invalid';
    if (!relative && !this.hosts.has(url.host.toLowerCase())) return undefined;
    const entry = this.byAddress.get(key(url));
    return entry ? { entry, url, relative } : undefined;
  }

  /** The version in `language` of the item a link points to, if there is one. */
  private versionIn(entry: Entry, language: string): Entry | undefined {
    if (entry.language === language) return entry;
    return this.versions.get(ref(entry.kind, entry.original))?.get(language);
  }

  /** The address a version will have when it is published: its draft's. */
  private async addressOf(entry: Entry): Promise<string> {
    const id = ref(entry.kind, entry.id);
    let address = this.drafts.get(id);
    if (address === undefined) {
      const draft = await getDraft(this.client, entry.kind, entry.id);
      address = entry.url;
      if (entry.kind === 'kb-article') address = str(draft.url) || entry.url;
      else if (typeof draft.slug === 'string' && entry.url) {
        try {
          address = `${new URL(entry.url).origin}/${draft.slug}`.replace(/\/$/, '');
        } catch {
          // keep the published address
        }
      }
      this.drafts.set(id, address);
      if (address) this.addAddress(address, entry);
    }
    return address;
  }

  /** A link as it should be in `language`: the new href and ID, or nothing to leave it. Notes the link. */
  private resolve(
    href: string,
    language: string,
    keep: string[],
    noted: Map<string, RewriteResult['links'][number]>,
    addresses: Map<string, string>,
  ): { href?: string; id?: string } {
    const found = this.target(href);
    if (!found) return {};
    const original = this.items!.get(ref(found.entry.kind, found.entry.original)) ?? found.entry;
    const target = ref(original.kind, original.id);
    if (found.entry.language === language) {
      // Already in the language: a version (pointed there before, by the app or by hand) still counts as translated.
      if (found.entry !== original) noted.set(target, { targetKind: original.kind, targetId: original.id, status: 'translated', href: found.url.toString().replace('https://relative.invalid', '') });
      return {};
    }
    if (keep.includes(target)) return {};
    const version = this.versionIn(found.entry, language);
    if (!version) {
      noted.set(target, { targetKind: original.kind, targetId: original.id, status: 'waiting' });
      return {};
    }
    const address = addresses.get(ref(version.kind, version.id));
    noted.set(target, { targetKind: original.kind, targetId: original.id, status: 'translated', href: address });
    if (!address) return {};
    const to = new URL(address);
    to.search = found.url.search;
    to.hash = found.url.hash;
    return { href: found.relative ? `${to.pathname}${to.search}${to.hash}` : to.toString(), id: version.id };
  }

  /**
   * Points the links in `values` (fields of a translation: HTML strings, modules, link fields) to
   * the versions in `language`. Changes `values` in place; returns the links found.
   */
  async rewrite(values: Record<string, unknown>, language: string, keep: string[] = []): Promise<RewriteResult> {
    await this.load();
    // First the addresses of the versions the links need (one request each, then known for the job).
    const hrefs: string[] = [];
    walk(values, (href) => {
      hrefs.push(href);
    });
    const addresses = new Map<string, string>();
    for (const href of hrefs) {
      const found = this.target(href);
      const version = found && found.entry.language !== language ? this.versionIn(found.entry, language) : undefined;
      if (version && !addresses.has(ref(version.kind, version.id))) addresses.set(ref(version.kind, version.id), await this.addressOf(version));
    }
    const noted = new Map<string, RewriteResult['links'][number]>();
    walk(values, (href) => this.resolve(href, language, keep, noted, addresses));
    return { links: [...noted.values()] };
  }

  /**
   * After a version (`translatedId`, of `originalId`, in `language`) was written: stores its links,
   * and fixes the drafts in `language` whose links waited for this item.
   */
  async translated(kind: Kind, originalId: string, language: string, translatedId: string, result: RewriteResult): Promise<void> {
    await this.load();
    await this.store.saveLinks(this.accountId, kind, translatedId, language, result.links);
    if (!LINK_TARGETS.includes(kind)) return;
    const item = await getItem(this.client, kind, translatedId);
    if (item) this.remember(kind, item);
    this.drafts.delete(ref(kind, translatedId)); // its address may just have been translated
    for (const waiting of await this.store.waitingFor(this.accountId, language, kind, originalId)) {
      if (waiting.kind === kind && waiting.itemId === translatedId) continue;
      await this.recheck(waiting.kind, waiting.itemId, language);
    }
  }

  /**
   * Checks one translation's links again ("Update links now", or when an item it waits for was
   * translated): points them to the versions that exist now, also ones made by hand in HubSpot.
   */
  async recheck(kind: Kind, itemId: string, language: string): Promise<'updated' | 'unchanged' | 'gone'> {
    await this.load();
    if (!(await getItem(this.client, kind, itemId))) {
      await this.store.saveLinks(this.accountId, kind, itemId, language, []);
      return 'gone';
    }
    const draft = await getDraft(this.client, kind, itemId);
    const values: Record<string, unknown> = {};
    for (const name of LINK_FIELDS[kind]) if (draft[name] !== undefined && draft[name] !== null) values[name] = structuredClone(draft[name]);
    const result = await this.rewrite(values, language, await this.store.keptLinks(this.accountId, kind, itemId));
    const changed = Object.fromEntries(Object.entries(values).filter(([name, value]) => JSON.stringify(value) !== JSON.stringify(draft[name])));
    if (Object.keys(changed).length) await updateDraft(this.client, kind, itemId, changed);
    await this.store.saveLinks(this.accountId, kind, itemId, language, result.links);
    return Object.keys(changed).length ? 'updated' : 'unchanged';
  }

  /** The targets whose links in an item stay on the original ("Keep the original link"). */
  kept(kind: Kind, itemId: string): Promise<string[]> {
    return this.store.keptLinks(this.accountId, kind, itemId);
  }

  /** Title and address of an item, for the list of links (undefined: no longer there). */
  async describe(kind: Kind, id: string, draft = false): Promise<{ title: string; url: string } | undefined> {
    await this.load();
    let entry = this.items!.get(ref(kind, id));
    if (!entry && kind === 'email') {
      const item = await getItem(this.client, kind, id);
      if (!item) return undefined;
      entry = { kind, id, url: '', title: str(item.name) || id, language: str(item.language), original: id };
    }
    if (!entry) return undefined;
    let title = '';
    if (draft && kind !== 'email') {
      // A version's title is in its draft until it is published (it was made with the original's).
      const version = await getDraft(this.client, kind, id);
      title = str(version.title ?? version.name);
    }
    return { title: title || entry.title, url: entry.url };
  }
}

/**
 * Calls `visit` for every link in `value` (HTML strings, HubSpot link fields); writes back the new
 * href (and content ID) that `visit` returns.
 */
function walk(value: unknown, visit: (href: string) => { href?: string; id?: string } | void): void {
  if (!value || typeof value !== 'object') return;
  const object = value as Record<string, unknown>;
  for (const [name, child] of Object.entries(object)) {
    if (typeof child === 'string') {
      if (/<a\b/i.test(child)) {
        object[name] = child.replace(HREF, (all, start: string, quote: string, href: string) => {
          const result = visit(href);
          return result && result.href ? `${start}${quote}${encode(result.href)}${quote}` : all;
        });
      } else if (name === 'href' && child) {
        // A link field: { href, type: 'EXTERNAL' | 'CONTENT', content_id }.
        const result = visit(child);
        if (result && result.href) {
          object.href = result.href;
          if ('content_id' in object && result.id) object.content_id = /^\d+$/.test(result.id) ? Number(result.id) : result.id;
        }
      }
    } else if (child && typeof child === 'object') {
      walk(child, visit);
    }
  }
}
