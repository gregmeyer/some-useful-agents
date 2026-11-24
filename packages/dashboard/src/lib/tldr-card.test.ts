import { describe, it, expect } from 'vitest';
import type { Notebook, NotebookLayout } from '@some-useful-agents/core';
import { hasTldrPicture, keepAskedTldrCard } from './tldr-card.js';

const page = (withPicture: boolean, form: 'path' | '@path' = 'path'): NotebookLayout => ({
  components: [
    { id: 'root', component: 'Column', children: withPicture ? ['pic', 'answer'] : ['answer'] },
    { id: 'answer', component: 'Text', text: 'x' },
    ...(withPicture ? [{ id: 'pic', component: 'Picture', picture: { [form]: '/notebook/picture' } }] : []),
  ],
} as NotebookLayout);

describe('the TL;DR card when you ask for it (ADR-0093)', () => {
  it('a page you had redrawn to show the TL;DR picture keeps its card (Always), unless you chose', () => {
    expect(hasTldrPicture(page(true))).toBe(true);
    expect(hasTldrPicture(page(true, '@path'))).toBe(true);
    expect(hasTldrPicture(page(false))).toBe(false);
    expect(hasTldrPicture({ components: [{ id: 'p', component: 'Picture', picture: { path: '/notebook/photo' } }] } as NotebookLayout)).toBe(false);

    const set: string[] = [];
    const store = (nb: Partial<Notebook>) => ({ get: () => nb as Notebook, setTldrCard: (_id: string, m: 'auto' | 'always' | 'never') => { set.push(m); return nb as Notebook; } });
    keepAskedTldrCard(store({}), 'nb', page(false), page(true));
    expect(set).toEqual(['always']);
    // Already there, or you chose: left as it is.
    keepAskedTldrCard(store({}), 'nb', page(true), page(true));
    keepAskedTldrCard(store({ tldrCard: 'never' }), 'nb', page(false), page(true));
    keepAskedTldrCard(store({}), 'nb', page(true), page(false));
    expect(set).toEqual(['always']);
  });
});

describe('a card set to Always shows on a page with no place for it, its brief and its PDF', () => {
  it('gets a full-width "In short" place leading the page, under its header; a page with one is left as it is', async () => {
    const { withTldrCardSlot, layoutPreset } = await import('@some-useful-agents/core');
    const runbook = layoutPreset('runbook')!.layout.components;
    const out = withTldrCardSlot(runbook);
    const root = out.find((c) => c.id === 'root')!;
    expect((root.children as string[]).slice(0, 3)).toEqual(['header', 'tldr_card_p', 'top']);
    expect(out.find((c) => c.id === 'tldr_card_p')).toMatchObject({ component: 'Panel', title: 'In short', child: 'tldr_card' });
    expect(out.find((c) => c.id === 'tldr_card')).toMatchObject({ component: 'Picture', picture: { path: '/notebook/picture' } });
    expect(withTldrCardSlot(out)).toEqual(out);
    expect(withTldrCardSlot(page(true).components)).toEqual(page(true).components);
    expect(withTldrCardSlot(page(true, '@path').components)).toEqual(page(true, '@path').components);
  });

  it('the page, the brief and the PDF draw it, with the chosen photo credited as given', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { NotebookStore, RunStore, layoutPreset } = await import('@some-useful-agents/core');
    const { drawnNotebookLayout, notebookWidgetMessages } = await import('./notebook-widgets.js');
    const { renderPageBrief } = await import('../views/notebook-page-brief.js');
    const { showsTldrCard } = await import('../views/notebook-tldr.js');
    const dir = mkdtempSync(join(tmpdir(), 'sua-tldr-always-'));
    try {
      const s = NotebookStore.fromHandle(new RunStore(join(dir, 'runs.db')).databaseHandle());
      const nb = s.create({ title: 'Teach me how to make a sandwich' });
      s.setLayout(nb.id, layoutPreset('runbook')!.layout, 'picked');
      s.setAnswer(nb.id, { question: 'How?', by: 'agent:notebook-writer', text: 'A sandwich in about **5 minutes**.', confidence: 'medium', basis: '', findings: [], open: [], at: new Date().toISOString(),
        sections: [{ title: 'The steps', kind: 'steps', items: [{ text: 'Spread it', how: 'Use a knife.', from: [] }] }] });
      const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1]);
      s.setChosenPhoto(nb.id, { bytes: jpeg, contentType: 'image/jpeg', image: 'https://upload.wikimedia.org/x/a.jpg', page: 'https://commons.wikimedia.org/wiki/File:a.jpg', credit: 'A. Photographer', alt: 'A sandwich' });
      // Auto, on a ready-made page: no place for it, so nowhere.
      expect(drawnNotebookLayout(s.get(nb.id)!).components.some((c) => c.id === 'tldr_card_p')).toBe(false);
      expect(renderPageBrief({ nb: s.get(nb.id)!, entries: [] })).not.toContain('In short');
      // Always: the page has its place, and the brief (which the PDF prints) draws the card with the photo, credited.
      s.setTldrCard(nb.id, 'always');
      const now = s.get(nb.id)!;
      expect(showsTldrCard(now, [])).toBe(true);
      expect(JSON.stringify(notebookWidgetMessages(now, [], undefined, { tldrCard: true }))).toContain('"tldr_card"');
      const brief = renderPageBrief({ nb: now, entries: [] });
      expect(brief).toContain('In short');
      expect(brief).toContain(`/notebooks/${nb.id}/photo?v=`);
      expect(brief).toContain('<span class="tl__credit">A. Photographer</span>');
      // Shown large (a cover), it's credited on the photo.
      s.setTldr(nb.id, { size: 'standard', tone: 'plain', layout: 'cover', parts: ['lead', 'points'] });
      expect(renderPageBrief({ nb: s.get(nb.id)!, entries: [] })).toContain('<span class="tl__artcredit">Photo: A. Photographer</span>');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
