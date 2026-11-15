import { describe, it, expect } from 'vitest';
import { cleanTldrSpec, type NotebookViewOption } from '@some-useful-agents/core';
import { tldrPhotos, tldrLayoutFor, tldrBigPicture, tldrCard, type TldrData } from './notebook-tldr.js';
import { cardForAgent } from '../lib/notebook-tldr-redraw.js';
import { render } from './html.js';

const opt = (id: string, link: string, imageKind?: string, extra: Partial<NotebookViewOption> = {}): NotebookViewOption =>
  ({ id, name: `Source ${id}`, link, image: `/notebooks/n/entries/${id}/photo`, ...(imageKind ? { imageKind } : {}), fields: {}, checked: [], ...extra }) as unknown as NotebookViewOption;
const briefOn = { name: 'Acme Trails', kind: 'organization' as const, site: 'https://acmetrails.example/' };
const pic = (o: NotebookViewOption) => (o.image ? `data:${o.id}` : undefined);

describe("a TL;DR picture uses a briefing's own photos", () => {
  const options = [
    opt('press', 'https://gazette.example/acme', 'listing'),
    opt('logo', 'https://acmetrails.example/', 'logo'),
    opt('own', 'https://www.acmetrails.example/about', 'listing'),
    opt('drawn', 'https://dir.example/acme', 'illustration'),
    opt('example', 'https://blog.example/acme', 'representative'),
    opt('gone', 'https://old.example/acme', 'listing', { ruledOut: { reason: 'gone' } } as Partial<NotebookViewOption>),
    opt('more', 'https://casts.example/acme', 'listing'),
  ];

  it("takes each source's own picture, the subject's site first, and never a logo, a drawing, an example photo or a ruled-out source's", () => {
    expect(tldrPhotos({ briefOn }, options, pic)).toEqual([
      { src: 'data:own', credit: 'acmetrails.example', name: 'Source own' },
      { src: 'data:press', credit: 'gazette.example', name: 'Source press' },
      { src: 'data:more', credit: 'casts.example', name: 'Source more' },
    ]);
    // Not a subject briefing, or no pictures to embed: none.
    expect(tldrPhotos({}, options, pic)).toEqual([]);
    expect(tldrPhotos({ briefOn }, options, undefined)).toEqual([]);
    // At most four, and one picture shown once.
    const many = Array.from({ length: 6 }, (_, i) => opt(`p${String(i)}`, `https://s${String(i)}.example/x`, 'listing'));
    expect(tldrPhotos({ briefOn }, many, pic)).toHaveLength(4);
    expect(tldrPhotos({ briefOn }, [options[0], options[0]], pic)).toHaveLength(1);
  });

  const base: TldrData = { title: 'Learn about Acme Trails', leadLabel: 'Briefing · sure', lead: 'Acme Trails is a trail guide.', leadFacts: [], stats: [{ value: '3', label: 'sources' }], points: ['It publishes guides.', 'Listeners rate it well.', 'Prices are not stated.'] };
  const photos = tldrPhotos({ briefOn }, options, pic);

  it('a gallery needs two photos; a cover or spotlight shows a photo large, not the logo', () => {
    const spec = (layout: string, size = 'standard') => cleanTldrSpec({ layout, size })!;
    expect(spec('gallery').layout).toBe('gallery');
    expect(tldrLayoutFor({ ...base, photos }, spec('gallery'))).toBe('gallery');
    expect(tldrLayoutFor({ ...base, photos: photos.slice(0, 1) }, spec('gallery'))).toBe('cover');
    expect(tldrLayoutFor(base, spec('gallery'))).toBe('stack');
    // A briefing on an organization leads with its logo; its photos take over a large picture.
    const org = { ...base, who: 'company' as const, leadPicture: 'data:logo', leadPictureKind: 'logo' as const, photos };
    expect(tldrBigPicture(org)).toEqual({ src: 'data:own', kind: 'photo' });
    expect(tldrBigPicture({ ...org, photos: undefined })).toEqual({ src: 'data:logo', kind: 'logo' });
    expect(tldrLayoutFor({ ...base, photos }, spec('cover', 'square'))).toBe('cover');
    expect(tldrLayoutFor(base, spec('cover', 'square'))).toBe('stack');
  });

  it('draws the photos as a strip with the site each is from: in the standard picture, first in a gallery, and not at all when left out', () => {
    const standard = render(tldrCard({ ...base, photos }));
    expect((standard.match(/class="tl__shot"/g) ?? []).length).toBe(3);
    expect(standard).toContain('<span class="tl__credit">gazette.example</span>');
    expect(standard.indexOf('tl__lead')).toBeLessThan(standard.indexOf('tl__photos'));
    const gallery = render(tldrCard({ ...base, photos }, { spec: cleanTldrSpec({ layout: 'gallery', parts: ['lead', 'points'] })! }));
    expect(gallery).toContain('class="tl__photos is-lead"');
    expect(gallery.indexOf('tl__photos')).toBeLessThan(gallery.indexOf('tl__lead'));
    // A spec whose parts leave photos out shows none; a notebook with no photos never has the strip.
    expect(render(tldrCard({ ...base, photos }, { spec: cleanTldrSpec({ layout: 'stack', parts: ['lead', 'points'] })! }))).not.toContain('tl__shot');
    expect(render(tldrCard(base))).not.toContain('tl__photos');
    // A cover shows the first one large and the rest in the strip.
    const cover = render(tldrCard({ ...base, photos }, { spec: cleanTldrSpec({ layout: 'cover', size: 'square', parts: ['lead', 'photos', 'points'] })! }));
    expect(cover).toContain('class="tl__art"');
    expect((cover.match(/class="tl__shot"/g) ?? []).length).toBe(2);
  });

  it('tells the redraw agent how many photos there are and where from', () => {
    expect(cardForAgent({ ...base, photos }).photos).toEqual({ count: 3, from: ['acmetrails.example', 'gazette.example', 'casts.example'] });
    expect(cardForAgent(base).photos).toBeUndefined();
  });
});
