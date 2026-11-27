import type { Kind } from '../hubspot/content.js';
import type { Store } from '../store/store.js';

/**
 * Images in translations (the Links/Images page): which original image each image of a version
 * came from, so that updating a version keeps the translation's own (localized) screenshots.
 *
 * An image's *slot* is where it sits in the written fields: an `<img>` in an HTML field
 * (`postBody#0`, `widgets.rich_text.body.html#2`) or one of HubSpot's image fields, an object
 * with a `src` (`widgets.hero.body.img`), or a top-level image address (`featuredImage`).
 * When the app writes a version it records, per slot, the original's image (`originalSrc`) and
 * the version's (`src`). On the next update, per slot:
 *
 * - original unchanged → the version keeps the image it has now (its own, or the original's);
 * - original replaced, the version still had the old original → the version takes the new one;
 * - original replaced, the version had its own image → it takes the new one, marked `check`;
 * - no record (a version written before this existed) and the version's image differs → its
 *   own is kept, marked `check`;
 * - the version's images can't be lined up with the record (images added or removed by hand,
 *   or the original's reordered) → the original's images, those that change marked `check`.
 */

export type ImageStatus = 'same' | 'own' | 'check';
/** Why an image is to check. */
export type ImageReason = 'originalChanged' | 'noRecord' | 'layoutChanged';

export interface ImageRecord {
  slot: string;
  /** The original's image when the version was written. */
  originalSrc: string;
  /** The version's image as written. */
  src: string;
  status: ImageStatus;
  reason?: ImageReason;
}

/** Top-level fields that hold an image address directly. */
const IMAGE_FIELDS = new Set(['featuredImage']);
/** Keys an image field object has besides `src` (HubSpot's image field). */
const IMAGE_KEYS = ['alt', 'width', 'height', 'loading', 'size_type', 'max_width', 'max_height'];

interface Slot {
  key: string;
  src: string;
  /** Puts another image in this slot: `keep` is the slot of the version's current draft. */
  replace: (keep: Slot) => void;
  /** The slot's raw form (an `<img>` tag, an image object), for `replace`. */
  raw: unknown;
}

const IMG = /<img\b[^>]*>/gi;
const attr = (tag: string, name: string): string | undefined => {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return match ? (match[2] ?? match[3] ?? '') : undefined;
};
/** `tag` with attribute `name` set to `value` (added if missing). */
const withAttr = (tag: string, name: string, value: string | undefined): string => {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*')`, 'i');
  if (value === undefined) return tag.replace(pattern, '');
  const quoted = ` ${name}="${value.replace(/"/g, '&quot;')}"`;
  return pattern.test(tag) ? tag.replace(pattern, quoted) : tag.replace(/^<img\b/i, `<img${quoted}`);
};

const isImageObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  typeof (value as Record<string, unknown>).src === 'string' &&
  IMAGE_KEYS.some((key) => key in (value as Record<string, unknown>));

/**
 * The image slots of field values (the fields a translation writes), in document order.
 * `replace` changes the values in place.
 */
export function imageSlots(values: Record<string, unknown>): Slot[] {
  const slots: Slot[] = [];
  const walk = (holder: Record<string, unknown> | unknown[], key: string | number, path: string, top: boolean) => {
    const value = (holder as Record<string | number, unknown>)[key];
    if (typeof value === 'string') {
      if (top && IMAGE_FIELDS.has(String(key))) {
        if (value) {
          slots.push({
            key: path,
            src: value,
            raw: value,
            replace: (keep) => ((holder as Record<string | number, unknown>)[key] = keep.raw),
          });
        }
        return;
      }
      if (!/<img\b/i.test(value)) return;
      let index = 0;
      for (const match of value.matchAll(IMG)) {
        const tag = match[0];
        const n = index++;
        const src = attr(tag, 'src');
        if (!src) continue;
        slots.push({
          key: `${path}#${n}`,
          src,
          raw: tag,
          replace: (keep) => {
            // The version's own tag (address, size, srcset), with the alt text just translated.
            const ownTag = withAttr(String(keep.raw), 'alt', attr(tag, 'alt'));
            let i = 0;
            const current = String((holder as Record<string | number, unknown>)[key]);
            (holder as Record<string | number, unknown>)[key] = current.replace(IMG, (found) => (i++ === n ? ownTag : found));
          },
        });
      }
      return;
    }
    if (isImageObject(value)) {
      slots.push({
        key: path,
        src: String(value.src),
        raw: value,
        replace: (keep) => {
          const own = keep.raw as Record<string, unknown>;
          (holder as Record<string | number, unknown>)[key] = { ...own, ...(typeof value.alt === 'string' ? { alt: value.alt } : {}) };
        },
      });
      return;
    }
    if (Array.isArray(value)) value.forEach((_, i) => walk(value, i, `${path}.${i}`, false));
    else if (value && typeof value === 'object') for (const child of Object.keys(value)) walk(value as Record<string, unknown>, child, `${path}.${child}`, false);
  };
  for (const key of Object.keys(values)) walk(values, key, key, true);
  return slots;
}

/** The record for a version written with `values` (a new version: every image is the original's). */
export function recordOf(values: Record<string, unknown>): ImageRecord[] {
  return imageSlots(values).map((slot) => ({ slot: slot.key, originalSrc: slot.src, src: slot.src, status: 'same' }));
}

/**
 * Merges the images of an update: `values` (the original's fields, translated) get the version's
 * own images where the record says so. `current` is the version's draft now; `written` the record
 * of the last write (undefined: none). Changes `values` in place and returns the new record.
 */
export function mergeImages(
  values: Record<string, unknown>,
  current: Record<string, unknown>,
  written: ImageRecord[] | undefined,
): ImageRecord[] {
  const next = imageSlots(values);
  // Only the fields being written count in the version's draft.
  const scope = Object.fromEntries(Object.keys(values).map((key) => [key, structuredClone(current[key])]));
  const now = new Map(imageSlots(scope).map((slot) => [slot.key, slot]));
  const before = new Map((written ?? []).map((record) => [record.slot, record]));
  const sameLayout =
    written === undefined
      ? next.length === now.size && next.every((slot) => now.has(slot.key))
      : before.size === now.size && [...before.keys()].every((key) => now.has(key));

  const records: ImageRecord[] = [];
  for (const slot of next) {
    const original = slot.src;
    const own = now.get(slot.key);
    const record: ImageRecord = { slot: slot.key, originalSrc: original, src: original, status: 'same' };
    if (!sameLayout) {
      if (own && own.src !== original) Object.assign(record, { status: 'check', reason: 'layoutChanged' });
    } else if (!written) {
      if (own && own.src !== original) {
        slot.replace(own);
        Object.assign(record, { src: own.src, status: 'check', reason: 'noRecord' });
      }
    } else {
      const last = before.get(slot.key);
      if (!last) {
        // An image added to the original: the version gets it.
      } else if (last.originalSrc === original) {
        if (last.status === 'check' && own?.src === last.src) {
          // Still to check, unchanged since: it stays marked.
          Object.assign(record, { src: last.src, status: 'check', reason: last.reason });
          if (own.src !== original) slot.replace(own);
        } else if (own && own.src !== original) {
          slot.replace(own);
          Object.assign(record, { src: own.src, status: 'own' });
        }
      } else if (own && own.src !== last.originalSrc && own.src !== original) {
        // The original's image was replaced and the version had its own: the new one, to check.
        Object.assign(record, { status: 'check', reason: 'originalChanged' });
      }
    }
    records.push(record);
  }
  return records;
}

/** The image now in a slot of an item's draft (for "Mark as checked"). */
export function imageAt(draft: Record<string, unknown>, slot: string): string | undefined {
  return imageSlots(draft).find((s) => s.key === slot)?.src;
}

/** The image records of one original's versions in one language, kept in the store. */
export function imageBook(store: Store, accountId: string, kind: Kind, language: string, sourceId: string) {
  return {
    load: (targetId: string) => store.imagesOf(accountId, kind, targetId),
    save: (targetId: string, images: ImageRecord[]) => store.saveImages(accountId, { kind, itemId: targetId, language, sourceId, images }),
  };
}
