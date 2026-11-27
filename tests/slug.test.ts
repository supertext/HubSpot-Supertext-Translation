import { describe, expect, it } from 'vitest';
import { slugify, slugWords, withLastPart } from '../src/translation/slug.js';

describe('translated addresses', () => {
  it("takes the words of a slug's last part", () => {
    expect(slugWords('blog/how-we-roast-our-cocoa-beans')).toBe('how we roast our cocoa beans');
    expect(slugWords('en/about_us')).toBe('about us');
    expect(slugWords('blog/-temporary-slug-eedeba05-30b4')).toBe('');
    expect(slugWords('')).toBe('');
  });

  it('makes an ASCII slug in the way of the language', () => {
    expect(slugify('Über uns', 'de-ch')).toBe('ueber-uns');
    expect(slugify('Fünf Tipps zum Aufbewahren von Schokolade', 'de')).toBe('fuenf-tipps-zum-aufbewahren-von-schokolade');
    expect(slugify('À propos de nous', 'fr-ch')).toBe('a-propos-de-nous');
    expect(slugify('Calendario dell’Avvento 2026', 'it-ch')).toBe('calendario-dellavvento-2026');
    expect(slugify('Ödeme &amp; teslimat', 'tr')).toBe('odeme-teslimat');
    expect(slugify('Straße', 'de')).toBe('strasse');
    expect(slugify('Łódź', 'pl')).toBe('lodz');
  });

  it("gives nothing for a script that doesn't fit in an address, so the original stays", () => {
    expect(slugify('私たちについて', 'ja')).toBe('');
    expect(slugify('О нас', 'ru')).toBe('');
  });

  it("keeps the version's own prefix", () => {
    expect(withLastPart('de-ch/blog/how-we-roast', 'wie-wir-roesten')).toBe('de-ch/blog/wie-wir-roesten');
    expect(withLastPart('track-my-order', 'bestellung-verfolgen')).toBe('bestellung-verfolgen');
  });

  it('keeps addresses short', () => {
    const long = slugify('ein '.repeat(40) + 'Ende', 'de');
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith('-')).toBe(false);
  });
});
