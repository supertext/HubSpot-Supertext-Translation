// Translated addresses: the last part of a slug ("about-us") travels to Supertext as words
// ("about us") with the other texts, and comes back as a slug in the target language
// ("ueber-uns"). ASCII only, as HubSpot's own slugs: umlauts are written out in German
// (ü → ue), other accents dropped (é → e). A language whose words don't fit in ASCII
// (Japanese, Russian, Greek …) keeps the original slug.

/** The words of a slug's last part ("blog/how-we-roast" → "how we roast"); '' if there are none. */
export function slugWords(slug: string): string {
  const last = slug.split('/').filter(Boolean).pop() ?? '';
  // HubSpot's placeholder for a post without a title yet.
  if (/^-?temporary-slug-/.test(last)) return '';
  return last.replace(/[-_]+/g, ' ').trim();
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Translated words → a slug part ("Über uns" → "ueber-uns"); '' if nothing ASCII is left. */
export function slugify(text: string, language: string): string {
  let s = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (all, name: string) =>
      name[0] === '#' ? String.fromCodePoint(Number(name[1] === 'x' || name[1] === 'X' ? `0${name.slice(1)}` : name.slice(1))) : ENTITIES[name.toLowerCase()] ?? all,
    )
    .toLowerCase();
  if (/^(de|gsw)\b/i.test(language)) s = s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue');
  s = s
    .replace(/ß/g, 'ss')
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/œ/g, 'oe')
    .replace(/ł/g, 'l')
    .replace(/đ/g, 'd')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length > 80) s = s.slice(0, 80).replace(/-[^-]*$/, '');
  return s;
}

/** The new slug: the version's own prefix ("de-ch/blog/") with the translated last part. */
export function withLastPart(slug: string, part: string): string {
  const parts = slug.split('/');
  parts[parts.length - 1] = part;
  return parts.join('/');
}
