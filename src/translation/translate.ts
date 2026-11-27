import type { HubSpotClient } from '../hubspot/client.js';
import {
  createArticleTranslation,
  createVersion,
  extractItem,
  removeItem,
  updateDraft,
  type Item,
  type Kind,
} from '../hubspot/content.js';
import type { Extraction } from '../hubspot/extract.js';
import type { Politeness, SupertextClient } from '../supertext/client.js';
import type { JobItem } from '../store/store.js';
import type { ContentLinks, RewriteResult } from './links.js';
import { slugify, slugWords, withLastPart } from './slug.js';

/**
 * One item × one language: make the language version (unless it exists), translate its texts in
 * one Supertext request, then write them to the version's draft — a version made for the purpose
 * (HubSpot's language variant, an email clone, an article translation), or the
 * existing one when it is to be updated. Nothing is published.
 */

export interface TranslateArgs {
  client: HubSpotClient;
  /** Translates the segments (API translation); not needed with `produce`. */
  supertext?: Pick<SupertextClient, 'translateSegments'>;
  /** Supplies the translations instead of Supertext's API (an imported translation file): one per segment. */
  produce?: (extraction: Extraction) => string[];
  kind: Kind;
  /** The item (metadata). */
  source: Item;
  /** Its draft: the content that is translated. */
  draft: Item;
  /** The language's existing version, if there is one. */
  existingId?: string;
  /** HubSpot language code ("de", "de-ch"). */
  language: string;
  /** Supertext target code ("de-CH"). */
  supertextTarget: string;
  /** Supertext source code ("en"); '' = detect. */
  sourceLanguage: string;
  politeness: Politeness;
  /** Replace an existing version's draft (else it is kept). */
  overwrite: boolean;
  /** HubSpot code of the source's language when the page has none set (create-language-variation needs it). */
  primaryLanguage: string;
  /** Translate the address of a new version (Settings → Translation); not with an imported file. */
  translateUrls?: boolean;
  /** Point links between pages, posts and articles to the same language (Settings → Translation); one per job. */
  links?: ContentLinks;
}

/** Where an item keeps its address: a page's or post's slug, an article's path; emails have none. */
const ADDRESS: Partial<Record<Kind, 'slug' | 'path'>> = { 'site-page': 'slug', 'landing-page': 'slug', 'blog-post': 'slug', 'kb-article': 'path' };

export type TranslateResult = Pick<JobItem, 'state' | 'targetId'>;

export async function translateItem(args: TranslateArgs): Promise<TranslateResult> {
  const { client, kind, source, existingId } = args;
  if (existingId && !args.overwrite) return { state: 'kept', targetId: existingId };
  const { extraction, fields } = extractItem(kind, args.draft);
  // A new version's address travels as words with the other texts, in the same request.
  const address = ADDRESS[kind];
  const words =
    address && args.translateUrls && !existingId && !args.produce ? slugWords(String(args.draft[address] ?? source[address] ?? '')) : '';
  let slugPart = '';

  /** Translates and checks every segment (HubL tokens) before anything is written; returns the fields to write. */
  const translate = async (): Promise<Record<string, unknown>> => {
    const segments = extraction.segments;
    const texts = segments.map((segment) => segment.html);
    if (words) texts.push(words.replace(/&/g, '&amp;').replace(/</g, '&lt;'));
    const translated = args.produce
      ? args.produce(extraction)
      : texts.length === 0
        ? []
        : await args.supertext!.translateSegments(texts, {
            targetLanguage: args.supertextTarget,
            sourceLanguage: args.sourceLanguage,
            politeness: args.politeness,
          });
    if (words) slugPart = slugify(translated.pop() ?? '', args.language);
    extraction.apply(translated);
    const values = fields();
    if (links) {
      // A link problem never costs the translation: the links then stay as they are.
      try {
        linkResult = await links.rewrite(values, args.language, existingId ? await links.kept(kind, existingId) : []);
      } catch (error) {
        linkResult = undefined;
        console.warn(`Links of ${kind} ${String(source.id)} not updated:`, error instanceof Error ? error.message : error);
      }
    }
    return values;
  };
  const links = args.links;
  let linkResult: RewriteResult | undefined;
  /** After writing: stores the version's links, fixes drafts that waited for this item. */
  const linked = async (targetId: string) => {
    if (!links || !linkResult) return;
    try {
      await links.translated(kind, String(source.id), args.language, targetId, linkResult);
    } catch (error) {
      console.warn(`Links waiting for ${kind} ${String(source.id)} not updated:`, error instanceof Error ? error.message : error);
    }
  };

  if (existingId) {
    await updateDraft(client, kind, existingId, await translate());
    await linked(existingId);
    return { state: 'updated', targetId: existingId };
  }
  // The language version first: if HubSpot refuses it (a blog or knowledge base without that
  // language, an existing variant), nothing is sent to Supertext and nothing is paid for.
  // An article is created with the original's texts (HubSpot requires a title), then translated.
  const created =
    kind === 'kb-article'
      ? await createArticleTranslation(client, source, args.language, { title: args.draft.title ?? source.title })
      : await createVersion(client, kind, source, args.language, args.primaryLanguage);
  try {
    const values = await translate();
    if (Object.keys(values).length > 0) await updateDraft(client, kind, String(created.id), values);
  } catch (error) {
    // Don't leave an untranslated copy behind.
    await removeItem(client, kind, String(created.id)).catch(() => undefined);
    throw error;
  }
  if (address && slugPart) {
    // On its own: if HubSpot refuses the address (one that is taken), the version keeps the original's.
    const current = String(created[address] ?? source[address] ?? '');
    const translated = withLastPart(current, slugPart);
    if (current && translated !== current) {
      await updateDraft(client, kind, String(created.id), { [address]: translated }).catch(() => undefined);
    }
  }
  await linked(String(created.id));
  return { state: 'created', targetId: String(created.id) };
}
