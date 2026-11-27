// Links between knowledge base articles, pointed to the article in the same language.
//
// HubSpot gives every article its address (`url`) and its language versions (`translations`,
// language → { id }), and a translation has an address of its own (translated by the app,
// see slug.ts). So a link to another article of the knowledge base, full
// (https://…/en-us/knowledge-base/troubleshooting-orders) or relative (/en-us/knowledge-base/…),
// with an anchor or query string or without, can be pointed to that article's version in the
// translation's language. Links to articles without that version yet stay on the original and
// are remembered (Store.saveWaitingLinks): when the app later translates the article they point
// to, it fixes them in the drafts that wait for it. Only href attributes of <a> change; the rest
// of a draft, including an editor's changes, stays as it is. Links to anything else (pages,
// other sites, #anchors on the same article, mailto:) are left alone.

import type { HubSpotClient } from '../hubspot/client.js';
import { basePath, getDraft, getItem, translationMap, updateDraft, type Item } from '../hubspot/content.js';
import type { Store } from '../store/store.js';

interface Article {
  id: string;
  url: string;
  title: string;
  language: string;
  /** The original's ID for a translation, else its own. */
  original: string;
  /** Language → ID of the other versions. */
  translations: Record<string, string>;
}

const str = (value: unknown): string => (value === undefined || value === null ? '' : String(value));

const key = (url: URL): string => decodeURIComponent(url.pathname).replace(/\/+$/, '').toLowerCase();

const decode = (href: string): string => href.replace(/&amp;/g, '&').replace(/&#38;/g, '&');
const encode = (href: string): string => href.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

export class KnowledgeBaseLinks {
  private articles?: Map<string, Article>;
  private byAddress = new Map<string, Article>();
  private hosts = new Set<string>();
  /** A translation's address as its draft has it (the list shows the published one). */
  private drafts = new Map<string, string>();

  constructor(
    private readonly client: HubSpotClient,
    private readonly store: Store,
    private readonly accountId: string,
  ) {}

  private remember(item: Item): Article {
    const id = str(item.id);
    const article: Article = {
      id,
      url: str(item.url),
      title: str(item.title),
      language: str(item.language).toLowerCase(),
      original: str(item.translationOfId) || id,
      translations: translationMap(item.translations, id),
    };
    this.articles!.set(id, article);
    if (article.url) {
      try {
        const url = new URL(article.url);
        this.hosts.add(url.host.toLowerCase());
        this.byAddress.set(key(url), article);
      } catch {
        // an address HubSpot didn't fill in: the article can't be found by its links
      }
    }
    return article;
  }

  /** All articles with their addresses and versions, read once per job. */
  private async load(): Promise<Map<string, Article>> {
    if (this.articles) return this.articles;
    this.articles = new Map();
    let after: string | undefined;
    do {
      const query = new URLSearchParams({ limit: '100', archived: 'false' });
      if (after) query.set('after', after);
      const page = await this.client.json<{ results?: Item[]; paging?: { next?: { after?: string } } }>('GET', `${basePath('kb-article')}?${query}`);
      for (const item of page.results ?? []) this.remember(item);
      after = page.paging?.next?.after || undefined;
    } while (after);
    return this.articles;
  }

  /** The article a link points to, if it is one of the knowledge base. */
  private target(href: string, base: string): { article: Article; url: URL; relative: boolean } | undefined {
    const raw = decode(href.trim());
    if (!raw || raw.startsWith('#') || /^(mailto|tel|javascript):/i.test(raw) || /\{\{|\{%/.test(raw)) return undefined;
    let url: URL;
    try {
      url = new URL(raw, base || 'https://knowledge-base.invalid/');
    } catch {
      return undefined;
    }
    const relative = !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(raw);
    if (!relative && !this.hosts.has(url.host.toLowerCase())) return undefined;
    const article = this.byAddress.get(key(url));
    return article ? { article, url, relative } : undefined;
  }

  /** The version of the linked article's group in `language`, if there is one. */
  private versionIn(article: Article, language: string): Article | undefined {
    if (article.language === language) return article;
    const original = this.articles!.get(article.original) ?? article;
    if (original.language === language) return original;
    const id = original.translations[language] ?? article.translations[language];
    return id ? this.articles!.get(id) : undefined;
  }

  /**
   * Points the links of a translation's HTML to the articles in `language`. Returns the HTML and
   * the originals it links to that have no version in `language` yet.
   */
  /**
   * The address a translation will have when it is published: its draft's. A translation the app
   * just made has its translated path only in the draft until an editor publishes it.
   */
  private async addressOf(article: Article): Promise<string> {
    let url = this.drafts.get(article.id);
    if (url === undefined) {
      url = str((await getDraft(this.client, 'kb-article', article.id)).url) || article.url;
      this.drafts.set(article.id, url);
    }
    return url;
  }

  async rewrite(html: string, language: string, keep: string[] = []): Promise<{ html: string; waiting: string[] }> {
    await this.load();
    const waiting = new Set<string>();
    const base = [...this.articles!.values()].find((a) => a.url)?.url ?? '';
    // First the addresses of the versions the links need (one request each, then known for the job).
    const pattern = /(<a\b[^>]*?\bhref\s*=\s*)(["'])(.*?)\2/gi;
    const addresses = new Map<string, string>();
    for (const m of html.matchAll(pattern)) {
      const found = this.target(m[3], base);
      const version = found && this.versionIn(found.article, language);
      if (version && version !== found.article && !addresses.has(version.id)) addresses.set(version.id, await this.addressOf(version));
    }
    const out = html.replace(pattern, (all, start: string, quote: string, href: string) => {
      const found = this.target(href, base);
      // Not an article, or one whose links are to stay ("Stop waiting").
      if (!found || keep.includes(found.article.original)) return all;
      const version = this.versionIn(found.article, language);
      if (!version) {
        waiting.add(found.article.original);
        return all;
      }
      const address = addresses.get(version.id);
      if (version === found.article || !address) return all;
      const to = new URL(address);
      to.search = found.url.search;
      to.hash = found.url.hash;
      const value = found.relative ? `${to.pathname}${to.search}${to.hash}` : to.toString();
      return `${start}${quote}${encode(value)}${quote}`;
    });
    return { html: out, waiting: [...waiting] };
  }

  /**
   * After `translatedId` (a version of `originalId` in `language`) was written: notes the links it
   * still waits for, and fixes the drafts in `language` that waited for this article.
   */
  /** The originals whose links in a translation are to stay ("Stop waiting"). */
  ignored(articleId: string): Promise<string[]> {
    return this.store.ignoredLinks(this.accountId, articleId);
  }

  async translated(originalId: string, language: string, translatedId: string, waiting: string[]): Promise<void> {
    await this.load();
    const item = await getItem(this.client, 'kb-article', translatedId);
    if (item) this.remember(item);
    this.drafts.delete(translatedId); // its address may just have been translated
    const original = this.articles!.get(originalId);
    if (original) original.translations[language] = translatedId;
    await this.store.saveWaitingLinks(this.accountId, translatedId, language, waiting);

    for (const articleId of await this.store.waitingFor(this.accountId, language, originalId)) {
      if (articleId !== translatedId) await this.recheck(articleId, language);
    }
  }

  /** Title and address of articles, for the list of waiting links (undefined: no longer there). */
  async describe(id: string, draft = false): Promise<{ title: string; url: string } | undefined> {
    const article = (await this.load()).get(id);
    if (!article) return undefined;
    // A translation's title is in its draft until it is published (it was created with the original's).
    const title = draft ? str((await getDraft(this.client, 'kb-article', id)).title) : '';
    return { title: title || article.title || id, url: article.url };
  }

  /**
   * Checks one translation's links again ("Update links now"): points them to the versions that
   * exist now, also ones made by hand in HubSpot, and keeps waiting for the rest.
   */
  async recheck(articleId: string, language: string): Promise<'updated' | 'unchanged' | 'gone'> {
    await this.load();
    if (!(await getItem(this.client, 'kb-article', articleId))) {
      await this.store.saveWaitingLinks(this.accountId, articleId, language, []);
      return 'gone';
    }
    const body = str((await getDraft(this.client, 'kb-article', articleId)).body);
    const result = await this.rewrite(body, language, await this.store.ignoredLinks(this.accountId, articleId));
    if (result.html !== body) await updateDraft(this.client, 'kb-article', articleId, { body: result.html });
    await this.store.saveWaitingLinks(this.accountId, articleId, language, result.waiting);
    return result.html !== body ? 'updated' : 'unchanged';
  }
}
