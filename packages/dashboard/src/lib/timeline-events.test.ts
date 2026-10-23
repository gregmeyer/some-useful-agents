import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import express from 'express';
import { assetsRouter } from '../routes/assets.js';

// A browser module (assets/timeline-events.js); a computed path keeps tsc from typing it.
const here = dirname(fileURLToPath(import.meta.url));
type Ev = Record<string, unknown>;
const { collapseRepeats, matchEvent, whenRange } = await import(join(here, '..', 'assets', 'timeline-events.js')) as {
  collapseRepeats: (e: Ev[]) => Array<Ev & { count: number; items: Ev[] }>;
  matchEvent: (e: Ev, q: string) => boolean;
  whenRange: (r: Ev, fmt: (at: string) => string) => string;
};

const search = (at: string, who = 'notebook-checker', extra: Ev = {}): Ev => ({ at, kind: 'search', who, title: 'Search returned no options', link: `/runs/${at}`, ...extra });

describe('timeline events', () => {
  it('folds the same event again in a row into one, keeping each', () => {
    const events = [
      { at: '2026-10-12T18:25:00Z', kind: 'decision', title: 'Decided', body: 'Chose the Redondo' },
      ...['2026-10-12T10:19:00Z', '2026-10-12T08:03:00Z', '2026-10-11T15:14:00Z'].map((at) => search(at)),
      { at: '2026-10-10T21:00:00Z', kind: 'note', title: 'A note' },
      search('2026-10-10T20:00:00Z'),
    ];
    const rows = collapseRepeats(events);
    expect(rows.map((r) => `${String(r.title)} ×${r.count}`)).toEqual(['Decided ×1', 'Search returned no options ×3', 'A note ×1', 'Search returned no options ×1']);
    expect(rows[1].items.map((e) => e.link)).toEqual(['/runs/2026-10-12T10:19:00Z', '/runs/2026-10-12T08:03:00Z', '/runs/2026-10-11T15:14:00Z']);
    expect(whenRange(rows[1], (at) => at.slice(5, 10))).toBe('10-11 – 10-12');
    expect(whenRange(rows[0], (at) => at.slice(5, 10))).toBe('10-12');
  });

  it('keeps apart events that differ in who, or that say something', () => {
    expect(collapseRepeats([search('a'), search('b', 'finder')])).toHaveLength(2);
    expect(collapseRepeats([search('a', 'x', { body: 'Reverb 0 · eBay blocked' }), search('b', 'x', { body: 'Reverb 0 · eBay blocked' })])).toHaveLength(2);
    expect(collapseRepeats([search('a'), search('b', 'notebook-checker', { faded: true })])).toHaveLength(2);
    expect(collapseRepeats(undefined as never)).toEqual([]);
  });

  it('searches title, body, who and tag, every word, any case', () => {
    const e = { title: 'Search failed', body: 'timed out after 240s', who: 'research-fanout', tag: 'step 2' };
    expect(matchEvent(e, '')).toBe(true);
    expect(matchEvent(e, 'FAILED')).toBe(true);
    expect(matchEvent(e, 'fanout timed')).toBe(true);
    expect(matchEvent(e, 'step 2')).toBe(true);
    expect(matchEvent(e, 'failed decided')).toBe(false);
  });

  it('is served for the timeline to import', async () => {
    const res = await request(express().use(assetsRouter)).get('/assets/timeline-events.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('export function collapseRepeats');
  });
});
