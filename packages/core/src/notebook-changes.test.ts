import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from './run-store.js';
import { NotebookStore, notebookViewData } from './notebooks.js';
import { notebookChanges } from './notebook-changes.js';

let dir: string | undefined;
let runs: RunStore | undefined;
afterEach(() => { vi.useRealTimers(); runs?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; runs = undefined; });

function store(): NotebookStore {
  dir = mkdtempSync(join(tmpdir(), 'sua-nb-changes-'));
  runs = new RunStore(join(dir, 'runs.db'));
  return NotebookStore.fromHandle(runs.databaseHandle());
}
const at = (iso: string) => vi.setSystemTime(new Date(iso));

describe('what changed since last time', () => {
  it('says only what the latest search changed: new, price, other facts, gone, not found again', () => {
    vi.useFakeTimers();
    const s = store();
    at('2026-10-20T08:00:00Z');
    const nb = s.create({ title: 'Watch for an X100V' });
    s.setFields(nb.id, [
      { key: 'price', label: 'Price', type: 'money', role: 'price', better: 'lower' },
      { key: 'condition', label: 'Condition', type: 'text' },
      { key: 'listing', label: 'Listing', type: 'url', role: 'link' },
    ]);
    const file = (title: string, data: Record<string, unknown>) => s.upsertOption(nb.id, { title, by: 'agent:finder', data, runId: 'r' }).entry.id;
    // The search before: three listings.
    s.recordSearch(nb.id, 'finder', 'r1', 3, '2026-10-20T08:00:00.000Z');
    at('2026-10-20T08:00:01Z');
    const cheaper = file('Silver X100V', { price: 1200, condition: 'Good', listing: 'https://ex.com/1' });
    const relisted = file('Black X100V', { price: 1100, condition: 'Good', listing: 'https://ex.com/2' });
    const vanished = file('X100V kit', { price: 1150, condition: 'Excellent', listing: 'https://ex.com/3' });
    const sold = file('X100V, box', { price: 1180, condition: 'Good', listing: 'https://ex.com/4' });

    // A search in between that found others, not the kit: one miss isn't news yet.
    s.recordSearch(nb.id, 'finder', 'r1b', 3, '2026-10-20T20:00:00.000Z');
    // The latest search: two seen again (one cheaper, one with a new condition), one new; the kit missed again (its second); one's page says it's sold.
    at('2026-10-21T08:00:00Z');
    s.recordSearch(nb.id, 'finder', 'r2', 3, '2026-10-21T08:00:00.000Z');
    at('2026-10-21T08:00:01Z');
    file('Silver X100V', { price: 1090, condition: 'Good', listing: 'https://ex.com/1' });
    file('Black X100V', { price: 1100, condition: 'Like new', listing: 'https://ex.com/2', });
    const fresh = file('X100V with hood', { price: 1199, condition: 'Like new', listing: 'https://ex.com/5' });
    s.ruleOut(nb.id, sold, 'Its page says it is gone (sold, expired or removed).', 'agent:finder', { gone: true });

    const v = notebookViewData(s.get(nb.id)!, s.entries(nb.id), s).notebook;
    const c = notebookChanges(s.get(nb.id)!, v.options, s);
    expect(c).toMatchObject({ since: '2026-10-20T20:00:00.000Z', first: false });
    expect(c.changes.map((x) => [x.kind, x.id, x.field?.key, x.from, x.to])).toEqual([
      ['new', fresh, undefined, undefined, undefined],
      ['price', cheaper, 'price', 1200, 1090],
      ['changed', relisted, 'condition', 'Good', 'Like new'],
      ['gone', sold, undefined, undefined, undefined],
      ['missing', vanished, undefined, undefined, undefined],
    ]);
  });

  it('a first search is a first look, not everything new; before any search, nothing', () => {
    vi.useFakeTimers();
    const s = store();
    at('2026-10-20T08:00:00Z');
    const nb = s.create({ title: 'Watch' });
    expect(notebookChanges(nb, [], s)).toEqual({ first: false, seen: 0, changes: [] });
    s.recordSearch(nb.id, 'finder', 'r1', 1, '2026-10-20T08:00:00.000Z');
    at('2026-10-20T08:00:01Z');
    s.upsertOption(nb.id, { title: 'One', by: 'agent:finder', data: {} });
    const v = notebookViewData(s.get(nb.id)!, s.entries(nb.id), s).notebook;
    expect(notebookChanges(s.get(nb.id)!, v.options, s)).toMatchObject({ first: true, seen: 1, changes: [] });
  });
});
