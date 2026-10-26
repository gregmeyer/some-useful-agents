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
  });
});
