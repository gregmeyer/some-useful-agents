import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotebookStore, type Notebook, type NotebookEntry } from './notebooks.js';
import { findNotebook, notebookReadoutJson, notebookReadoutText } from './notebook-readout.js';
import { getBuiltinTool } from './builtin-tools.js';
import { policyResource } from './policy-store.js';

// A shopping notebook with someone it's about, what it wrote, three options (one picked, one ruled out) and a note.
const nb = {
  id: 'mixer', title: 'Buy a stand mixer', statement: 'A mixer for bread', params: ['under $400'], checks: ['Under $400', 'Bowl of 5 qt or more'],
  criteria: [{ text: 'One picked', met: true }], status: 'active', pipeline: [], stages: [], cadence: '',
  fields: [{ key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'bowl', label: 'Bowl', type: 'text' }],
  about: { company: { name: 'KitchenAid', summary: 'Makes mixers.', facts: [{ key: 'hq', label: 'Headquarters', value: 'Benton Harbor', at: 'x', source: 'https://example.com/about' }], competitors: [{ name: 'Bosch', how: 'compact mixers' }], updatedAt: 'x' } },
  answer: { question: 'Which mixer?', text: 'The Artisan.', confidence: 'medium', findings: [{ text: 'The Artisan is $350', from: ['a'] }, { text: 'Struck one', from: [] }], open: ['Colour'], at: 'x', by: 'notebook-writer', struck: ['Struck one'] },
  createdAt: 'x', updatedAt: 'x',
} as unknown as Notebook;
const option = (id: string, title: string, extra: Partial<NotebookEntry>) => ({ id, notebookId: 'mixer', kind: 'option', title, body: '', by: 'agent:x', createdAt: '2026-10-01T00:00:00Z', ...extra }) as NotebookEntry;
const entries = [
  option('b', 'Classic', { data: { price: 280 }, failedChecks: { 'Bowl of 5 qt or more': '4.5 qt bowl' } }),
  option('a', 'Artisan', { data: { price: 350, bowl: '5 qt' }, factMeta: { price: { source: 'https://target.example/a' } }, checked: ['under $400'], chosenAt: 'x' }),
  option('c', 'Mini', { data: { price: 420 }, ruledOut: { reason: 'Over $400', at: 'x', by: 'agent:notebook-checker' } }),
  { id: 'n1', notebookId: 'mixer', kind: 'note', title: 'Wants it for sourdough', body: '', by: 'you', createdAt: '2026-10-02T00:00:00Z' } as NotebookEntry,
];

describe('notebook readout', () => {
  it('reads what it knows: who, what it wrote (not what you struck), options best first with sources, notes', () => {
    const j = notebookReadoutJson(nb, entries);
    expect(j).toMatchObject({ id: 'mixer', archived: false, link: '/notebooks/mixer', doneWhen: [{ text: 'One picked', met: true }] });
    expect(j.about?.company).toMatchObject({ name: 'KitchenAid', facts: [{ label: 'Headquarters', value: 'Benton Harbor', source: 'https://example.com/about' }], competitors: [{ name: 'Bosch', how: 'compact mixers' }] });
    expect(j.answer?.findings).toEqual(['The Artisan is $350']);
    // The pick first, then cheapest.
    expect(j.options?.inTheRunning.map((o) => o.title)).toEqual(['Artisan', 'Classic']);
    expect(j.options?.inTheRunning[0]).toMatchObject({ facts: { Price: '$350', Bowl: '5 qt' }, sources: { Price: 'https://target.example/a' }, passed: ['Under $400'], picked: true });
    expect(j.options?.ruledOut).toEqual([{ id: 'c', title: 'Mini', reason: 'Over $400' }]);
    expect(j.notes?.items).toEqual([{ kind: 'note', title: 'Wants it for sourdough', by: 'you', at: '2026-10-02T00:00:00Z' }]);

    const text = notebookReadoutText(nb, entries);
    expect(text).toContain('# Buy a stand mixer');
    expect(text).toContain('- Headquarters: Benton Harbor (https://example.com/about)');
    expect(text).toContain('- [picked] Artisan — Price: $350; Bowl: 5 qt (id a)');
    expect(text).toContain('  Failed: Bowl of 5 qt or more (4.5 qt bowl)');
    expect(text).toContain('- Mini: Over $400');
    expect(text).not.toContain('Struck one');
  });

  it('reads one part, and says when it is archived', () => {
    const j = notebookReadoutJson({ ...nb, archivedAt: 'x' }, entries, 'about');
    expect(j.archived).toBe(true);
    expect(j.about).toBeDefined();
    expect(j.options).toBeUndefined();
    expect(j.answer).toBeUndefined();
    expect(notebookReadoutText({ ...nb, archivedAt: 'x' }, entries, 'options')).toMatch(/\(active, archived\)/);
  });
});

describe('notebook-read tool', () => {
  const read = getBuiltinTool('notebook-read')!;
  function setup() {
    const store = new NotebookStore(join(mkdtempSync(join(tmpdir(), 'sua-notebook-read-')), 'runs.db'));
    const briefing = store.create({ title: 'Brief: northwind.example', statement: 'Meet the Northwind team' });
    store.addEntry(briefing.id, { kind: 'note', title: 'They raised a Series B', by: 'you' });
    store.archive(briefing.id);
    store.create({ title: 'Buy a used car' });
    store.create({ title: 'Buy a stand mixer' });
    return { store, id: briefing.id };
  }

  it('lists notebooks, archived too, and reads one by id, link or name', async () => {
    const { store, id } = setup();
    const list = await read.execute({}, { notebooks: store });
    expect(list.result).toContain(`${id} — Brief: northwind.example (active, archived)`);
    for (const ask of [id, `http://127.0.0.1:3000/notebooks/${id}?tab=page`, 'northwind']) {
      const out = await read.execute({ notebook: ask }, { notebooks: store });
      expect(out.isError).toBeFalsy();
      expect(out.result).toContain('They raised a Series B');
    }
    const json = await read.execute({ notebook: id, format: 'json', part: 'notes' }, { notebooks: store });
    expect((json.notebook as { archived: boolean }).archived).toBe(true);
    store.close();
  });

  it('lists the matches when a name fits several, and says so when none fits', async () => {
    const { store } = setup();
    const several = await read.execute({ notebook: 'buy' }, { notebooks: store });
    expect(several.result).toMatch(/^Several notebooks match "buy"/);
    expect(several.notebooks).toHaveLength(2);
    expect(findNotebook(store, 'buy a used car')).toHaveProperty('notebook');
    expect((await read.execute({ notebook: 'nothing like it' }, { notebooks: store })).isError).toBe(true);
    expect((await read.execute({ notebook: 'northwind', part: 'everything' }, { notebooks: store })).isError).toBe(true);
    expect((await read.execute({ notebook: 'x' }, {})).result).toBe('Notebooks are not available in this run.');
    store.close();
  });

  it('policy sees the notebook id, from a link too', () => {
    expect(policyResource('notebook-read', { notebook: 'http://127.0.0.1:3000/notebooks/brief-northwind-example' })).toBe('brief-northwind-example');
    expect(policyResource('notebook-read', { notebook: 'northwind' })).toBe('northwind');
  });
});
