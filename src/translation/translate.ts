import type { HubSpotClient } from '../hubspot/client.js';
import {
  createArticleTranslation,
  canPublish,
  createVersion,
  extractItem,
  KB_PUBLISH_SCOPE,
  publishDraft,
  removeItem,
  updateDraft,
  type Item,
  type Kind,
} from '../hubspot/content.js';
import type { Extraction } from '../hubspot/extract.js';
import { errorInfo, LocalizedError } from '../i18n/error.js';
import type { Politeness, SupertextClient } from '../supertext/client.js';
import type { Account, JobItem } from '../store/store.js';
import type { ContentLinks, RewriteResult } from './links.js';
import { slugify, slugWords, withLastPart } from './slug.js';

/**
 * One item × one language: make the language version (unless it exists), translate its texts in
 * one Supertext request, then write them to the version's draft — a version made for the purpose
 * (HubSpot's language variant, an email clone, an article translation), or the
 * existing one when it is to be updated. The version is published only with `publish`
 * (Settings → Publish translations right away; never emails).
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
  /**
   * Publish the version once it is written (Settings → Publish translations right away): `true`, or
   * `'noScope'` when the account didn't grant the knowledge base's publish scope (it stays a draft).
   * Ignored for emails.
   */
  publish?: boolean | 'noScope';
}

/** Where an item keeps its address: a page's or post's slug, an article's path; emails have none. */
const ADDRESS: Partial<Record<Kind, 'slug' | 'path'>> = { 'site-page': 'slug', 'landing-page': 'slug', 'blog-post': 'slug', 'kb-article': 'path' };

/** `publish` for an account and kind: the setting, and for articles the publish scope. */
export function publishMode(account: Pick<Account, 'publishTranslations' | 'scopes'>, kind: Kind): TranslateArgs['publish'] {
  if (!account.publishTranslations || !canPublish(kind)) return false;
  return kind === 'kb-article' && !account.scopes.includes(KB_PUBLISH_SCOPE) ? 'noScope' : true;
}

export type TranslateResult = Pick<JobItem, 'state' | 'targetId' | 'published' | 'publishError'>;

/**
 * Publishes a version the app has just written, if the account wants that. Publishing never fails
 * the translation: the version then stays a draft and the result says why.
 */
async function published(args: TranslateArgs, result: TranslateResult): Promise<TranslateResult> {
  if (!args.publish || !result.targetId || !canPublish(args.kind)) return result;
  if (args.publish === 'noScope') {
    const error = new LocalizedError('Connect HubSpot again to let the app publish knowledge base articles.', 'kbPublishScope');
    return { ...result, publishError: errorInfo(error) };
  }
  try {
    await publishDraft(args.client, args.kind, result.targetId);
    return { ...result, published: true };
  } catch (error) {
    console.warn(`Supertext: ${args.kind} ${result.targetId} not published:`, error instanceof Error ? error.message : error);
    return { ...result, publishError: errorInfo(error) };
  }
}

export async function translateItem(args: TranslateArgs): Promise<TranslateResult> {
  const result = await write(args);
  return result.state === 'kept' ? result : published(args, result);
}

async function write(args: TranslateArgs): Promise<TranslateResult> {
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
