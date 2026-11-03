import { describe, it, expect } from 'vitest';
import { layoutPreset } from '@some-useful-agents/core';
import { lookThumb } from './notebook-look.js';
import { render } from './html.js';

describe('a look drawn small', () => {
  it('draws each page from its own parts: the briefing a portrait, points and quotes; the shortlist a map and a grid', () => {
    const briefing = render(lookThumb(layoutPreset('dossier')!.layout.components));
    expect(briefing).toContain('lk-g--profile is-cover');
    expect(briefing).toContain('lk-g--agenda');
    expect(briefing).toContain('lk-g--quotes');
    expect(briefing).toContain('lk-part--lede');
    expect(briefing).toContain('grid-template-columns:2fr 1fr');
    const shortlist = render(lookThumb(layoutPreset('shortlist')!.layout.components));
    expect(shortlist).toContain('lk-g--map');
    expect(shortlist).toContain('lk-g--grid');
    expect(shortlist).not.toContain('lk-g--profile');
    // The representation parts have glyphs of their own, and a hero part a heavier title.
    expect(shortlist).toContain('lk-g--lead');
    expect(shortlist).toContain('lk-g--bars');
    expect(shortlist).toContain('lk-g--compare');
    const answer = render(lookThumb(layoutPreset('answer')!.layout.components));
    expect(answer).toContain('lk-part--hero');
    expect(render(lookThumb([{ id: 'root', component: 'Column', children: ['f'] }, { id: 'f', component: 'Figure', section: { path: '/notebook/section/x' } }]))).toContain('lk-g--figure');
  });
});

describe('the cards', () => {
  it('say which ready-made pages sua composes once written, and when a page is left as you asked', async () => {
    const { notebookLooks } = await import('./notebook-look.js');
    const drawn = { components: [{ id: 'root', component: 'Column', children: [] }], about: 'a page sua drew' };
    const yours = render(notebookLooks('nb', { now: drawn, by: 'you', working: false, undos: 0 }));
    expect(yours).toContain('Once it&#39;s written, sua composes the page around the answer.');
    expect(yours).toContain('Once it&#39;s written, sua composes the page around the plan.');
    expect(yours).toContain('As you asked: sua leaves it be.');
    const suas = render(notebookLooks('nb', { now: drawn, by: 'notebook', working: false, undos: 0 }));
    expect(suas).not.toContain('As you asked');
  });
});
