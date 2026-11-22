import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanTldrSpec, tldrOptionsGuide, TLDR_SIZES, strayTldrNumbers } from './notebook-tldr-spec.js';
import { NotebookStore } from './notebooks.js';
import { RunStore } from './run-store.js';

describe('a TL;DR picture\'s spec', () => {
  it('keeps known sizes, tones, layouts and parts; anything else falls back to the standard card', () => {
    expect(cleanTldrSpec({ size: 'landscape', tone: 'editorial', layout: 'split', parts: ['bars', 'lead', 'bars', 'nope'], bars: 99, headline: '  Eight ways   to power a cart ', takeaway: 'x'.repeat(400), about: 'Wide for LinkedIn', ask: 'for linkedin', at: '2026-11-10T00:00:00.000Z', extra: 1 })).toEqual({
      size: 'landscape', tone: 'editorial', layout: 'split', parts: ['bars', 'lead'], bars: TLDR_SIZES.landscape.bars,
      headline: 'Eight ways to power a cart', takeaway: `${'x'.repeat(179)}…`, about: 'Wide for LinkedIn', ask: 'for linkedin', at: '2026-11-10T00:00:00.000Z',
    });
    expect(cleanTldrSpec({ size: 'billboard', tone: 'neon', layout: 'spiral', parts: [], bars: 1 })).toEqual({ size: 'standard', tone: 'plain', layout: 'stack', parts: ['lead', 'photos', 'stats', 'bars', 'points'], bars: 3 });
    expect(cleanTldrSpec({})).toEqual({ size: 'standard', tone: 'plain', layout: 'stack', parts: ['lead', 'photos', 'stats', 'bars', 'points'] });
    for (const bad of [undefined, null, 'landscape', 7, ['landscape']]) expect(cleanTldrSpec(bad)).toBeUndefined();
  });

  it('says what may be chosen, for a model', () => {
    const guide = tldrOptionsGuide();
    expect(guide).toContain('"landscape": 1200×627.');
    expect(guide).toContain('"standard": 1080×auto.');
    for (const word of ['"editorial"', '"bold"', '"split"', '"hero"', '"cover"', '"lineup"', '"spotlight"', '"points"', 'headline (optional): at most 90 characters.']) expect(guide).toContain(word);
    // The picture-led layouts say what they need.
    expect(guide).toContain('Needs pictures of at least three of the top options.');
    for (const layout of ['cover', 'lineup', 'spotlight']) expect(cleanTldrSpec({ layout })!.layout).toBe(layout);
  });
});

describe('a notebook keeps how its TL;DR picture is drawn', () => {
  let dir: string | undefined;
  let runs: RunStore | undefined;
  afterEach(() => { runs?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; runs = undefined; });

  it('sets it, undoes back through the last ones to the standard picture, and leaves the notebook\'s own date alone', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-tldr-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.create({ title: 'Choose batteries' });
    expect(nb.tldr).toBeUndefined();
    expect(s.tldrUndos(nb.id)).toBe(0);
    expect(s.undoTldr(nb.id)).toBe(false);

    const wide = s.setTldr(nb.id, { size: 'landscape', tone: 'editorial', layout: 'split', headline: 'Eight ways' });
    expect(wide.tldr).toMatchObject({ size: 'landscape', tone: 'editorial', layout: 'split', headline: 'Eight ways' });
    expect(wide.updatedAt).toBe(nb.updatedAt);
    // The same again isn't a change to undo.
    s.setTldr(nb.id, wide.tldr);
    expect(s.tldrUndos(nb.id)).toBe(1);
    s.setTldr(nb.id, { size: 'square', tone: 'bold', layout: 'hero' });
    expect(s.tldrUndos(nb.id)).toBe(2);
    expect(() => s.setTldr(nb.id, 'square')).toThrow(/isn't a way to draw/);

    // Undo: the wide one, then the standard picture (nothing kept).
    expect(s.undoTldr(nb.id)).toBe(true);
    expect(s.get(nb.id)!.tldr).toMatchObject({ size: 'landscape', headline: 'Eight ways' });
    expect(s.undoTldr(nb.id)).toBe(true);
    expect(s.get(nb.id)!.tldr).toBeUndefined();
    expect(s.undoTldr(nb.id)).toBe(false);

    // Back to the standard picture is a change too, and only the last 10 are kept.
    s.setTldr(nb.id, { size: 'portrait' });
    s.setTldr(nb.id, null);
    expect(s.get(nb.id)!.tldr).toBeUndefined();
    expect(s.tldrUndos(nb.id)).toBe(2);
    for (let i = 0; i < 14; i++) s.setTldr(nb.id, { size: i % 2 ? 'square' : 'landscape', headline: `Take ${String(i)}` });
    expect(s.tldrUndos(nb.id)).toBe(10);
    // Deleting the notebook takes its history with it.
    s.delete(nb.id);
    expect(Number((runs.databaseHandle().prepare('SELECT COUNT(*) AS n FROM notebook_tldr_history').get() as { n: number }).n)).toBe(0);
  });
});

describe('numbers in words written for the picture', () => {
  it('finds the ones the notebook does not have, as written', () => {
    const known = 'Revenue was 309M in Q3 2026; $2,130.99 at the top';
    expect(strayTldrNumbers(['Northwind at 309M a quarter', undefined], known)).toEqual([]);
    expect(strayTldrNumbers(['Up 45% since Q3'], known)).toEqual(['45']);
    expect(strayTldrNumbers(['Top price $2,130.99'], known)).toEqual([]);
    expect(strayTldrNumbers(['Top price $2,131'], known)).toEqual(['2131']);
  });
});

describe("the TL;DR picture a notebook's page prefers (ADR-0098)", () => {
  const full = { bars: true, photos: 3, leadPicture: true };
  it('each layout leads with its own thing, always landscape', async () => {
    const { tldrPreference } = await import('./notebook-tldr-spec.js');
    const lead = (preset: string) => tldrPreference(preset, full).lead;
    expect(['shortlist', 'watch'].map(lead)).toEqual(['bars', 'bars']);
    expect(['dossier', 'company'].map(lead)).toEqual(['photo', 'photo']);
    expect(lead('subject')).toBe('photos');
    expect(['answer', 'runbook', 'plan'].map(lead)).toEqual(['headline', 'headline', 'headline']);
    expect(tldrPreference('subject', full)).toEqual({ size: 'landscape', lead: 'photos', why: "a subject briefing: its sources' photos in a grid" });
  });
  it("steps down to what the card can draw, and a page with no preset goes by what it has", async () => {
    const { tldrPreference, tldrPreferenceWords, tldrPreferenceGuide } = await import('./notebook-tldr-spec.js');
    expect(tldrPreference('subject', { bars: false, photos: 1, leadPicture: false }).lead).toBe('photo');
    expect(tldrPreference('subject', { bars: false, photos: 0, leadPicture: false }).lead).toBe('headline');
    expect(tldrPreference('dossier', { bars: false, photos: 0, leadPicture: false }).lead).toBe('headline');
    expect(tldrPreference('shortlist', { bars: false, photos: 0, leadPicture: false }).lead).toBe('points');
    expect(tldrPreference(undefined, { bars: false, photos: 2, leadPicture: false }).lead).toBe('photos');
    expect(tldrPreference(undefined, { bars: false, photos: 0, leadPicture: true }).lead).toBe('photo');
    expect(tldrPreference(undefined, { bars: false, photos: 0, leadPicture: false })).toEqual({ size: 'landscape', lead: 'headline', why: 'this page: the headline, then its findings or steps' });
    const p = tldrPreference('runbook', full);
    expect(tldrPreferenceWords(p)).toBe('Landscape 1200×627, leading with the headline, then its findings or steps (a runbook)');
    expect(tldrPreferenceGuide(p)).toContain('Use this unless ASK names a size or what to lead with.');
  });
});
