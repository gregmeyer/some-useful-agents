import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanTldrSpec, tldrOptionsGuide, TLDR_SIZES } from './notebook-tldr-spec.js';
import { NotebookStore } from './notebooks.js';
import { RunStore } from './run-store.js';

describe('a TL;DR picture\'s spec', () => {
  it('keeps known sizes, tones, layouts and parts; anything else falls back to the standard card', () => {
    expect(cleanTldrSpec({ size: 'landscape', tone: 'editorial', layout: 'split', parts: ['bars', 'lead', 'bars', 'nope'], bars: 99, headline: '  Eight ways   to power a cart ', takeaway: 'x'.repeat(400), about: 'Wide for LinkedIn', ask: 'for linkedin', at: '2026-11-10T00:00:00.000Z', extra: 1 })).toEqual({
      size: 'landscape', tone: 'editorial', layout: 'split', parts: ['bars', 'lead'], bars: TLDR_SIZES.landscape.bars,
      headline: 'Eight ways to power a cart', takeaway: `${'x'.repeat(179)}…`, about: 'Wide for LinkedIn', ask: 'for linkedin', at: '2026-11-10T00:00:00.000Z',
    });
    expect(cleanTldrSpec({ size: 'billboard', tone: 'neon', layout: 'spiral', parts: [], bars: 1 })).toEqual({ size: 'standard', tone: 'plain', layout: 'stack', parts: ['lead', 'stats', 'bars', 'points'], bars: 3 });
    expect(cleanTldrSpec({})).toEqual({ size: 'standard', tone: 'plain', layout: 'stack', parts: ['lead', 'stats', 'bars', 'points'] });
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
