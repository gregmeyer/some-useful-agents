import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore, NotebookStore } from '@some-useful-agents/core';
import { notebookOptionData } from './notebook-option.js';

let dir: string;
let runs: RunStore;
afterEach(() => { try { runs?.close(); } catch { /* ignore */ } if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("an option page's facts", () => {
  it('links a fact whose value is a web address, even in a text field', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-nbo-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb0 = s.create({ title: 'Cabinet' });
    s.setFields(nb0.id, [
      { key: 'price', label: 'Price', type: 'money', role: 'price' },
      { key: 'availability', label: 'Availability', type: 'text' },
      { key: 'material', label: 'Material', type: 'text' },
    ]);
    const e = s.upsertOption(nb0.id, { title: 'Example cabinet', by: 'you', data: { price: 89, availability: 'https://shop.example/p/cabinet-1', material: 'MDF' } }).entry;
    const nb = s.get(nb0.id)!;
    const facts = notebookOptionData(nb, s.entries(nb.id), e.id, s)!.option.facts;
    expect(facts.find((f) => f.label === 'Availability')).toEqual({ label: 'Availability', value: 'shop.example/p/cabinet-1', url: 'https://shop.example/p/cabinet-1' });
    // Plain text stays text.
    expect(facts.find((f) => f.label === 'Material')).toEqual({ label: 'Material', value: 'MDF' });
  });
});
