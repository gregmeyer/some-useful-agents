import { describe, it, expect } from 'vitest';
import { checkNotebookLayout, notebookLayoutGuide, suaComponentDocs, type Notebook, type NotebookEntry } from '@some-useful-agents/core';
import { notebookWidgetData } from '../lib/notebook-widgets.js';
import { renderPageBrief } from './notebook-page-brief.js';

const at = '2026-11-10T00:00:00.000Z';
const components = [
  { id: 'root', component: 'Column', children: ['pic_panel', 'sum'] },
  { id: 'pic_panel', component: 'Panel', title: '', child: 'pic', hero: true, treatment: 'lede' },
  { id: 'pic', component: 'Picture', picture: { path: '/notebook/picture' } },
  { id: 'sum', component: 'Callout', text: { path: '/notebook/summary' } },
];
const nb = (over: Partial<Notebook> = {}): Notebook => ({
  id: 'choose-batteries', title: 'Choose batteries', statement: 'Good battery options', params: [], criteria: [], pipeline: [], stages: [], checks: [], cadence: '', status: 'active',
  fields: [{ key: 'price', label: 'Price', type: 'money', role: 'price' }],
  layout: { components }, createdAt: at, updatedAt: '2026-11-10T01:02:03.000Z', ...over,
} as Notebook);
const option = (id: string, title: string, price: number): NotebookEntry => ({ id, notebookId: 'choose-batteries', kind: 'option', title, body: '', by: 'agent:x', data: { price }, createdAt: at } as NotebookEntry);
const entries = [option('a', 'Werker 220Ah', 139.99), option('b', 'Eco bundle', 2130.99)];

describe("a page can lead with the notebook's TL;DR picture", () => {
  it('Picture is a page part bound to /notebook/picture, and the guide says how to lead with it', () => {
    expect(checkNotebookLayout(components)).toMatchObject({ ok: true });
    // A prop it doesn't have, or no picture, fails as any part does.
    expect(checkNotebookLayout(components.map((c) => (c.id === 'pic' ? { ...c, size: 'huge' } : c))).ok).toBe(false);
    const guide = notebookLayoutGuide(suaComponentDocs());
    expect(guide).toContain('/notebook/picture');
    expect(guide).toContain('To lead with a picture');
    expect(guide).toMatch(/Picture[^\n]*TL;DR picture/);
  });

  it('the notebook gives the picture: its image, what it is, and where it is redrawn; the address changes when the notebook or its drawing does', () => {
    const p = notebookWidgetData(nb(), entries).notebook.picture;
    expect(p).toEqual({
      src: `/notebooks/choose-batteries/tldr.png?v=${encodeURIComponent('2026-11-10T01:02:03.000Z.standard')}`,
      alt: 'Choose batteries, in short', href: '/notebooks/choose-batteries/tldr', caption: 'The TL;DR picture. Open it to redraw or download it.',
    });
    const redrawn = notebookWidgetData(nb({ tldr: { size: 'square', tone: 'bold', layout: 'hero', parts: ['lead'], at: '2026-11-10T05:00:00.000Z' } }), entries).notebook.picture;
    expect(redrawn.src).not.toBe(p.src);
    expect(redrawn.src).toContain(encodeURIComponent('2026-11-10T05:00:00.000Z'));
  });

  it("a saved page or PDF can't load the image, so the brief draws the picture's card in its place, as the notebook keeps it", () => {
    const page = renderPageBrief({ nb: nb(), entries });
    expect(page).toContain('<article class="tl" aria-label="Choose batteries, in short">');
    expect(page).toContain('<li class="tl__bar is-lead"><span>Werker 220Ah</span>');
    expect(page).not.toContain('tldr.png');
    const kept = renderPageBrief({ nb: nb({ tldr: { size: 'square', tone: 'bold', layout: 'hero', parts: ['lead', 'bars'], headline: 'From $139.99' } }), entries });
    expect(kept).toContain('<article class="tl tl--square tl--bold tl--hero"');
    expect(kept).toContain('<h1 class="tl__title">From $139.99</h1>');
  });
});

describe('a page can lead with a photo of what it is about', () => {
  const photoPage = [
    { id: 'root', component: 'Column', children: ['ph_p', 'sum'] },
    { id: 'ph_p', component: 'Panel', title: '', child: 'ph', hero: true, treatment: 'lede' },
    { id: 'ph', component: 'Picture', picture: { path: '/notebook/photo' } },
    { id: 'sum', component: 'Callout', text: { path: '/notebook/summary' } },
  ];
  // Kept photos come from the store (history), as the page gets them.
  const kinds: Record<string, string> = { d: 'illustration', e: 'representative', r: 'listing' };
  const history = { sightings: () => [], missedSearches: () => 0, hasPhoto: (id: string) => id in kinds, photoKind: (id: string) => kinds[id] } as never;
  const withPhoto = (id: string, title: string, link: string): NotebookEntry => ({ ...option(id, title, 1), data: { link } } as NotebookEntry);
  const src = (id: string) => `/notebooks/hot-dog/entries/${id}/photo`;
  const hotdog = (over: Partial<Notebook> = {}) => nb({ id: 'hot-dog', title: 'Is a hot dog a sandwich', fields: [{ key: 'link', label: 'Link', type: 'url', role: 'link' }], layout: { components: photoPage }, ...over });

  it('the guide sends "a picture of the thing" to /notebook/photo, not the TL;DR card, and a Panel needs a title', () => {
    expect(checkNotebookLayout(photoPage)).toMatchObject({ ok: true });
    const guide = notebookLayoutGuide(suaComponentDocs());
    expect(guide).toContain('/notebook/photo');
    expect(guide).toMatch(/picture of the thing itself[^\n]*\/notebook\/photo[^\n]*Never \/notebook\/picture/);
    expect(guide).not.toContain('treatment lede, no title');
  });

  it("the photo is a source's own photo before an example one, credited and linked to the source; none without one", () => {
    const es = [
      withPhoto('d', 'A drawing', 'https://example.com/d'),
      withPhoto('e', 'Babbel: is it a sandwich', 'https://www.babbel.com/a'),
      withPhoto('r', "Reader's Digest: is a hot dog a sandwich", 'https://www.rd.com/p'),
    ];
    const photo = notebookWidgetData(hotdog(), es, history).notebook.photo;
    expect(photo?.src).toBe(src('r'));
    expect(photo).toMatchObject({ entry: 'r', href: '/notebooks/hot-dog/entries/r', caption: "Photo from rd.com: Reader's Digest: is a hot dog a sandwich" });
    // Only an example photo: that, said so.
    expect(notebookWidgetData(hotdog(), es.filter((e) => e.id !== 'r'), history).notebook.photo?.caption).toMatch(/^An example photo from babbel\.com/);
    // A drawing is not a photo.
    expect(notebookWidgetData(hotdog(), es.slice(0, 1), history).notebook.photo).toBeUndefined();
  });

  it('the brief prints the photo, not the TL;DR card', () => {
    const page = renderPageBrief({ nb: hotdog(), entries: [withPhoto('r', "Reader's Digest", 'https://www.rd.com/p')], history });
    expect(page).toContain(`<figure class="photo"><img src="${src('r')}"`);
    expect(page).toContain('Photo from rd.com');
    expect(page).not.toContain('<article class="tl"');
  });
});
