import type { HubSpotClient } from '../hubspot/client.js';
import { hasVariants, listAllItems, MAX_LISTED, type ContentSummary, type Kind } from '../hubspot/content.js';
import type { Account, Store } from '../store/store.js';
import { hubspotCode } from './languages.js';

/**
 * The Translate page's list: every item of a kind that can be translated (not language versions),
 * loaded from HubSpot in pages of 100 (up to {@link MAX_LISTED}) and kept for a minute, so
 * searching, filtering and paging don't ask HubSpot again. Forgotten when a job of the account
 * ends, and by "Reload the list".
 */

export interface CatalogRow {
  item: ContentSummary;
  /** Language (the account's code) → ID of its version. */
  versions: Record<string, string>;
}

/** Which items the list shows. */
export type ItemFilter = 'all' | 'missing' | 'complete';
export const ITEM_FILTERS: readonly ItemFilter[] = ['all', 'missing', 'complete'];

export const CATALOG_TTL_MS = 60_000;

interface Entry {
  at: number;
  items: ContentSummary[];
  complete: boolean;
}

export class Catalog {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  /** All translatable items of the kind with their versions; `complete` is false past {@link MAX_LISTED}. */
  async rows(client: HubSpotClient, store: Store, account: Account, kind: Kind, fresh = false): Promise<{ rows: CatalogRow[]; complete: boolean }> {
    const key = `${account.accountId}|${kind}`;
    let entry = this.entries.get(key);
    if (fresh || !entry || this.now() - entry.at > CATALOG_TTL_MS) {
      const list = await listAllItems(client, kind);
      entry = { at: this.now(), ...list };
      this.entries.set(key, entry);
    }
    // Emails: versions are what the app recorded (read every time, it's the app's own database).
    const records = hasVariants(kind) ? undefined : await store.translations(account.accountId, kind);
    const made = new Set([...(records?.values() ?? [])].flatMap((languages) => Object.values(languages)));
    const rows = entry.items
      .filter((item) => !item.isVariant && !made.has(item.id))
      .map((item) => {
        const known = records ? (records.get(item.id) ?? {}) : item.translations;
        const versions: Record<string, string> = {};
        for (const code of account.targets) {
          const id = known[code] ?? known[hubspotCode(code)];
          if (id) versions[code] = id;
        }
        return { item, versions };
      });
    return { rows, complete: entry.complete };
  }

  /** The account's lists (one kind, or all) are loaded again next time. */
  forget(accountId: string, kind?: Kind): void {
    for (const key of [...this.entries.keys()]) {
      if (key === `${accountId}|${kind ?? ''}` || (!kind && key.startsWith(`${accountId}|`))) this.entries.delete(key);
    }
  }
}

/** Search (name, slug or ID, any case) and filter, as on the Translate page. */
export function filterRows(rows: CatalogRow[], targets: readonly string[], query: string, filter: ItemFilter): CatalogRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(({ item, versions }) => {
    const missing = targets.some((code) => !versions[code]);
    if (filter === 'missing' && !missing) return false;
    if (filter === 'complete' && missing) return false;
    if (words.length === 0) return true;
    const text = `${item.name} ${item.slug ?? ''} ${item.id}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
