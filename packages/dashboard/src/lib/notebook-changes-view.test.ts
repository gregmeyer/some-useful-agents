import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore, NotebookStore } from '@some-useful-agents/core';
import { notebookWidgetData } from './notebook-widgets.js';

let dir: string | undefined;
let runs: RunStore | undefined;
afterEach(() => { vi.useRealTimers(); runs?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; runs = undefined; });

describe("a watch notebook's page says what changed", () => {
  it('in a line, then each change: prices as money, cheaper marked better, each linking to its page', () => {
    vi.useFakeTimers();
    dir = mkdtempSync(join(tmpdir(), 'sua-nb-changes-view-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const at = (iso: string) => vi.setSystemTime(new Date(iso));
    at('2026-10-20T08:00:00Z');
    const nb = s.create({ title: 'Watch for an X100V' });
    s.setFields(nb.id, [{ key: 'price', label: 'Price', type: 'money', role: 'price', better: 'lower' }, { key: 'listing', label: 'Listing', type: 'url', role: 'link' }]);
    const file = (title: string, price: number, n: number) => s.upsertOption(nb.id, { title, by: 'agent:finder', data: { price, listing: `https://ex.com/${String(n)}` } }).entry.id;
    // Before any search: where it stands.
    expect(notebookWidgetData(s.get(nb.id)!, s.entries(nb.id), s).notebook.changesIntro.label).toBe('Where it stands');
    s.recordSearch(nb.id, 'finder', 'r1', 1, '2026-10-20T08:00:00.000Z');
    at('2026-10-20T08:00:01Z');
    const a = file('Silver X100V', 1200, 1);
    let d = notebookWidgetData(s.get(nb.id)!, s.entries(nb.id), s).notebook;
    expect(d.changesIntro).toEqual({ label: 'First look · Oct 20', text: 'The first search found 1. Next time, this says what changed since.' });
    at('2026-10-21T08:00:00Z');
    s.recordSearch(nb.id, 'finder', 'r2', 2, '2026-10-21T08:00:00.000Z');
    at('2026-10-21T08:00:01Z');
    file('Silver X100V', 1090, 1);
    const b = file('Black X100V', 1100, 2);
    d = notebookWidgetData(s.get(nb.id)!, s.entries(nb.id), s).notebook;
    expect(d.changesIntro).toEqual({ label: 'Since Oct 20 · checked Oct 21', text: '**1** new, **1** price change.' });
    expect(d.changes).toEqual([
      { kind: 'new', title: 'Black X100V', href: `/notebooks/${nb.id}/entries/${b}`, tone: 'ok' },
      { kind: 'price', title: 'Silver X100V', detail: 'Price: $1,200 → $1,090', href: `/notebooks/${nb.id}/entries/${a}`, tone: 'ok' },
    ]);
  });
});
