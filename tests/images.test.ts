import { describe, expect, it } from 'vitest';
import { imageAt, imageSlots, mergeImages, recordOf, type ImageRecord } from '../src/translation/images.js';

const page = (hero: string, body: string) => ({
  widgets: { hero: { body: { img: { src: hero, alt: 'Unser Atelier', width: 800 } } }, text: { body: { html: body } } },
});
const html = (...srcs: string[]) => srcs.map((src, i) => `<p>Text ${i}</p><img src="${src}" alt="Bild ${i}" width="400">`).join('');

describe('image slots', () => {
  it('finds images in HTML and image fields, in order, with stable keys', () => {
    const slots = imageSlots(page('https://cdn/a.jpg', html('https://cdn/b.png', 'https://cdn/c.png')));
    expect(slots.map((s) => [s.key, s.src])).toEqual([
      ['widgets.hero.body.img', 'https://cdn/a.jpg'],
      ['widgets.text.body.html#0', 'https://cdn/b.png'],
      ['widgets.text.body.html#1', 'https://cdn/c.png'],
    ]);
    expect(imageAt(page('x', html('y', 'z')), 'widgets.text.body.html#1')).toBe('z');
  });
});

describe('merging images on an update', () => {
  const written = (values: Record<string, unknown>): ImageRecord[] => recordOf(values);

  it("keeps the translation's own image while the original's doesn't change, with the new alt text", () => {
    const before = page('https://cdn/a.jpg', html('https://cdn/b.png'));
    const current = page('https://cdn/a-de.jpg', html('https://cdn/b-de.png').replace('alt="Bild 0"', 'alt="altes Bild"'));
    const values = page('https://cdn/a.jpg', html('https://cdn/b.png'));
    const records = mergeImages(values, current, written(before));
    expect(records.map((r) => r.status)).toEqual(['own', 'own']);
    expect(values.widgets.hero.body.img).toEqual({ src: 'https://cdn/a-de.jpg', alt: 'Unser Atelier', width: 800 });
    expect(values.widgets.text.body.html).toBe('<p>Text 0</p><img src="https://cdn/b-de.png" alt="Bild 0" width="400">');
  });

  it("gives the translation the original's new image: silently if it had the old one, marked when it had its own", () => {
    const before = page('https://cdn/a.jpg', html('https://cdn/b.png'));
    const current = page('https://cdn/a.jpg', html('https://cdn/b-de.png'));
    const values = page('https://cdn/a2.jpg', html('https://cdn/b2.png'));
    const records = mergeImages(values, current, written(before));
    expect(records.map((r) => [r.status, r.reason])).toEqual([
      ['same', undefined],
      ['check', 'originalChanged'],
    ]);
    expect(values.widgets.hero.body.img.src).toBe('https://cdn/a2.jpg');
    expect(values.widgets.text.body.html).toContain('https://cdn/b2.png');
  });

  it("keeps an image marked to check marked, until it's checked", () => {
    const record: ImageRecord[] = [{ slot: 'widgets.text.body.html#0', originalSrc: 'https://cdn/b2.png', src: 'https://cdn/b2.png', status: 'check', reason: 'originalChanged' }];
    const values = { widgets: { text: { body: { html: html('https://cdn/b2.png') } } } };
    const current = { widgets: { text: { body: { html: html('https://cdn/b2.png') } } } };
    expect(mergeImages(values, current, record)[0]).toMatchObject({ status: 'check', reason: 'originalChanged' });
  });

  it("keeps a translation's own images when there is no record yet, marked to check", () => {
    const values = page('https://cdn/a.jpg', html('https://cdn/b.png'));
    const records = mergeImages(values, page('https://cdn/a-de.jpg', html('https://cdn/b.png')), undefined);
    expect(records.map((r) => [r.status, r.reason ?? ''])).toEqual([
      ['check', 'noRecord'],
      ['same', ''],
    ]);
    expect(values.widgets.hero.body.img.src).toBe('https://cdn/a-de.jpg');
  });

  it("takes the original's images, marked, when the translation's no longer line up", () => {
    const before = page('https://cdn/a.jpg', html('https://cdn/b.png'));
    const current = page('https://cdn/a.jpg', html('https://cdn/b-de.png', 'https://cdn/extra.png'));
    const values = page('https://cdn/a.jpg', html('https://cdn/b.png'));
    const records = mergeImages(values, current, written(before));
    expect(records.map((r) => [r.status, r.reason ?? ''])).toEqual([
      ['same', ''],
      ['check', 'layoutChanged'],
    ]);
    expect(values.widgets.text.body.html).toContain('https://cdn/b.png');
  });

  it('gives the translation an image added to the original', () => {
    const before = page('https://cdn/a.jpg', html('https://cdn/b.png'));
    const values = page('https://cdn/a.jpg', html('https://cdn/b.png', 'https://cdn/new.png'));
    const records = mergeImages(values, page('https://cdn/a.jpg', html('https://cdn/b-de.png')), written(before));
    // The version had 2 slots like the record: they line up; the new one is the original's.
    expect(records.map((r) => r.status)).toEqual(['same', 'own', 'same']);
    expect(values.widgets.text.body.html).toContain('https://cdn/new.png');
  });
});
