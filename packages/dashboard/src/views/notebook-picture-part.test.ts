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
