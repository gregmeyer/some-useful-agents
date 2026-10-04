/** Notebooks (G1): the store, entries as items on the notebook's surface, and its item on Home. */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from './run-store.js';
import { AgentStore } from './agent-store.js';
import { NotebookStore, notebookEntryItems, notebookProgress, notebookSlug } from './notebooks.js';
import { compileSurface } from './surfaces/compile.js';
import { defaultSurface } from './surfaces/defaults.js';
import { collectItems, itemSourcesFromHandle } from './items/collect.js';

let dir: string;
let runs: RunStore;
afterEach(() => { try { runs?.close(); } catch { /* ignore */ } if (dir) rmSync(dir, { recursive: true, force: true }); });

describe('NotebookStore', () => {
  it('starts, fills, ticks, decides and reopens a notebook', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    expect(notebookSlug('Buy a used car!')).toBe('buy-a-used-car');
    const nb = s.create({ title: '  Buy a used car ', statement: 'Find a reliable SUV', params: ['AWD', ' ', 'under $26k'], criteria: ['One fits', 'Clean history'], pipeline: ['listings-search', 'Bad Id!'] });
    expect(nb).toMatchObject({ id: 'buy-a-used-car', title: 'Buy a used car', params: ['AWD', 'under $26k'], pipeline: ['listings-search'], status: 'active' });
    expect(s.create({ title: 'Buy a used car' }).id).toBe('buy-a-used-car-2');
    expect(() => s.create({ title: '  ' })).toThrow('needs a title');

    const e1 = s.addEntry(nb.id, { kind: 'option', title: '2019 RAV4 XLE', body: '54k mi', by: 'you' });
    s.addEntry(nb.id, { kind: 'note', title: 'Prefer AWD', by: 'agent:notes-keeper' });
    expect(() => s.addEntry(nb.id, { kind: 'gossip' as never, title: 'x', by: 'you' })).toThrow('Not an entry kind');
    expect(s.entries(nb.id).map((e) => e.title)).toEqual(['Prefer AWD', '2019 RAV4 XLE']);

    s.markCriterion(nb.id, 0, true);
    expect(notebookProgress(s.get(nb.id)!)).toEqual({ met: 1, total: 2 });
    // Editing criteria keeps "met" for unchanged text.
    expect(s.setCriteria(nb.id, ['One fits', 'Decided by Oct 15']).criteria).toEqual([{ text: 'One fits', met: true }, { text: 'Decided by Oct 15', met: false }]);

    const decided = s.decide(nb.id, 'Buy the RAV4');
    expect(decided).toMatchObject({ status: 'decided', decision: 'Buy the RAV4' });
    expect(s.entries(nb.id)[0]).toMatchObject({ kind: 'decision', body: 'Buy the RAV4' });
    expect(s.list().map((n) => n.id)).toEqual(['buy-a-used-car-2', 'buy-a-used-car']);
    expect(s.setStatus(nb.id, 'active').status).toBe('active');
    expect(s.removeEntry(nb.id, e1.id)).toBe(true);
    expect(s.removeEntry(nb.id, e1.id)).toBe(false);
  });

  it('entries land in the notebook surface\'s regions (decisions first); an active notebook is on Home', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-notebooks-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const agents = new AgentStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.create({ title: 'Car', criteria: ['a', 'b'] });
    s.addEntry(nb.id, { kind: 'note', title: 'n1', by: 'you' });
    s.addEntry(nb.id, { kind: 'decision', title: 'Ruled out the Outback', by: 'you' });
    s.addEntry(nb.id, { kind: 'option', title: 'RAV4', by: 'you' });
    s.addEntry(nb.id, { kind: 'evidence', title: 'Carfax clean', by: 'agent:history-check' });
    const out = compileSurface(defaultSurface(`notebook:${nb.id}`), notebookEntryItems(nb, s.entries(nb.id)));
    expect(out.regions.map((r) => [r.id, r.entries.map((e) => e.item.title)])).toEqual([
      ['options', ['RAV4']], ['notes', ['Ruled out the Outback', 'n1']], ['evidence', ['Carfax clean']],
    ]);
    const items = collectItems(itemSourcesFromHandle(runs.databaseHandle(), agents, runs));
    expect(items.find((i) => i.id === 'notebook:car')).toMatchObject({ kind: 'progress', state: 'in-progress', summary: '0 of 2 criteria met · 4 entries', href: '/notebooks/car' });
    s.decide(nb.id, 'RAV4');
    expect(collectItems(itemSourcesFromHandle(runs.databaseHandle(), agents, runs)).some((i) => i.id === 'notebook:car')).toBe(false);
    agents.close();
  });
});
