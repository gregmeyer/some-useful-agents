import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MemoryStore,
  MEMORY_MAX_PER_AGENT,
  MEMORY_RECALL_BLOCK_MAX_BYTES,
  MEMORY_TEXT_MAX_CHARS,
  formatRecallBlock,
  memorySettings,
  type Memory,
} from './memory-store.js';
import { getBuiltinTool } from './builtin-tools.js';

let dir: string;
let store: MemoryStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-memory-'));
  store = new MemoryStore(join(dir, 'runs.db'));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('MemoryStore', () => {
  it('saves, lists, gets, pins and forgets per agent', () => {
    const a = store.save({ agentId: 'a', text: '  The office is in Lisbon.  ', tags: ['Place', 'place', ' '], sourceRunId: 'run-1' });
    expect(a.text).toBe('The office is in Lisbon.');
    expect(a.tags).toEqual(['place']);
    expect(a.sourceRunId).toBe('run-1');
    expect(store.get('a', a.id)?.text).toBe('The office is in Lisbon.');

    const b = store.save({ agentId: 'a', text: 'Prefers metric units.' });
    expect(store.setPinned('a', b.id, true)).toBe(true);
    expect(store.list('a').map((m) => m.id)).toEqual([b.id, a.id]);

    expect(store.forget('a', a.id)).toBe(true);
    expect(store.forget('a', a.id)).toBe(false);
    expect(store.list('a').map((m) => m.id)).toEqual([b.id]);
  });

  it("never reads or changes another agent's memory", () => {
    const m = store.save({ agentId: 'a', text: 'secret plan for agent a' });
    expect(store.get('b', m.id)).toBeUndefined();
    expect(store.forget('b', m.id)).toBe(false);
    expect(store.setPinned('b', m.id, true)).toBe(false);
    expect(store.search('b', 'secret plan', 5)).toEqual([]);
    expect(store.forgetAll('b')).toBe(0);
    expect(store.list('a')).toHaveLength(1);
  });

  it('rejects empty text and caps long text', () => {
    expect(() => store.save({ agentId: 'a', text: '   ' })).toThrow(/needs some text/);
    const m = store.save({ agentId: 'a', text: 'x'.repeat(MEMORY_TEXT_MAX_CHARS + 50) });
    expect(m.text.length).toBe(MEMORY_TEXT_MAX_CHARS);
  });

  it('redacts declared secret values and known token shapes before saving', () => {
    const m = store.save({
      agentId: 'a',
      text: 'Logged in with hunter2hunter2 and key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
      secretValues: ['hunter2hunter2', 'abc'],
    });
    expect(m.text).not.toContain('hunter2hunter2');
    expect(m.text).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('prunes the oldest unpinned memories past the per-agent cap, keeping pinned', () => {
    const pinned = store.save({ agentId: 'a', text: 'pinned fact', pinned: true });
    for (let i = 0; i < MEMORY_MAX_PER_AGENT + 3; i++) store.save({ agentId: 'a', text: `fact ${i}` });
    const all = store.list('a', 10_000);
    expect(all.filter((m) => !m.pinned)).toHaveLength(MEMORY_MAX_PER_AGENT);
    expect(all.some((m) => m.id === pinned.id)).toBe(true);
  });

  it('search ranks by overlap with the query and skips unrelated memories', () => {
    store.save({ agentId: 'a', text: 'Lisbon weather is mild in winter' });
    const best = store.save({ agentId: 'a', text: 'Lisbon winter rainfall averages 100mm in December' });
    store.save({ agentId: 'a', text: 'The cat is called Mochi' });
    const found = store.search('a', 'December rainfall in Lisbon', 5);
    expect(found[0].id).toBe(best.id);
    expect(found.map((m) => m.text)).not.toContain('The cat is called Mochi');
  });

  it('recall returns every pinned memory first, then the top-k relevant', () => {
    const pin = store.save({ agentId: 'a', text: 'Always answer in French', pinned: true });
    store.save({ agentId: 'a', text: 'Paris museum hours are 9 to 6' });
    store.save({ agentId: 'a', text: 'Paris museum tickets cost 17 euros' });
    store.save({ agentId: 'a', text: 'Unrelated gardening note' });
    const recalled = store.recall('a', 'paris museum', 1);
    expect(recalled[0].id).toBe(pin.id);
    expect(recalled).toHaveLength(2);
    expect(recalled[1].text).toMatch(/Paris museum/);
  });

  it('shares the run database through fromHandle without closing it', () => {
    const shared = MemoryStore.fromHandle((store as unknown as { db: import('node:sqlite').DatabaseSync }).db);
    shared.save({ agentId: 'a', text: 'via handle' });
    shared.close();
    expect(store.list('a')[0].text).toBe('via handle');
  });
});

describe('formatRecallBlock', () => {
  const mem = (id: string, text: string, pinned = false): Memory =>
    ({ id, agentId: 'a', text, tags: [], pinned, createdAt: '', updatedAt: '' });

  it('is empty when there is nothing to recall', () => {
    expect(formatRecallBlock([])).toEqual({ text: '', ids: [] });
  });

  it('lists memories with ids and a pinned marker', () => {
    const { text, ids } = formatRecallBlock([mem('p1', 'pinned\nfact', true), mem('m2', 'other fact')]);
    expect(text).toMatch(/^WHAT YOU REMEMBER/);
    expect(text).toContain('- [p1] (pinned) pinned fact');
    expect(text).toContain('- [m2] other fact');
    expect(ids).toEqual(['p1', 'm2']);
  });

  it('stays within the byte budget, dropping the least relevant (last) first', () => {
    const many = Array.from({ length: 20 }, (_, i) => mem(`m${i}`, 'y'.repeat(400)));
    const { text, ids } = formatRecallBlock(many);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MEMORY_RECALL_BLOCK_MAX_BYTES + 1);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThan(20);
    expect(ids[0]).toBe('m0');
  });
});

describe('memorySettings', () => {
  it('normalises the agent field', () => {
    expect(memorySettings({})).toEqual({ enabled: false, recall: 0 });
    expect(memorySettings({ memory: false })).toEqual({ enabled: false, recall: 0 });
    expect(memorySettings({ memory: true })).toEqual({ enabled: true, recall: 5 });
    expect(memorySettings({ memory: { recall: 0 } })).toEqual({ enabled: true, recall: 0 });
    expect(memorySettings({ memory: { recall: 99 } })).toEqual({ enabled: true, recall: 20 });
  });
});

describe('memory tools', () => {
  const ctxFor = (agentId: string) => ({ memory: { agentId, store, runId: 'run-9', secretValues: ['tok3n-value'] } });

  it('save / search / forget act only on the calling agent', async () => {
    const saved = await getBuiltinTool('memory-save')!.execute(
      { text: 'Deploys go out on Tuesdays tok3n-value', tags: 'ops, schedule', pinned: true }, ctxFor('a'));
    expect(saved.isError).toBeFalsy();
    const id = saved.id as string;
    const m = store.get('a', id)!;
    expect(m.pinned).toBe(true);
    expect(m.tags).toEqual(['ops', 'schedule']);
    expect(m.sourceRunId).toBe('run-9');
    expect(m.text).not.toContain('tok3n-value');

    const other = await getBuiltinTool('memory-search')!.execute({ query: 'deploys tuesdays' }, ctxFor('b'));
    expect(other.memories).toEqual([]);
    const mine = await getBuiltinTool('memory-search')!.execute({ query: 'deploys tuesdays' }, ctxFor('a'));
    expect((mine.memories as Array<{ id: string }>)[0].id).toBe(id);

    const denied = await getBuiltinTool('memory-forget')!.execute({ id }, ctxFor('b'));
    expect(denied.isError).toBe(true);
    const ok = await getBuiltinTool('memory-forget')!.execute({ id: `[${id}]` }, ctxFor('a'));
    expect(ok.forgotten).toBe(true);
    expect(store.list('a')).toEqual([]);
  });

  it('say memory is off when the agent has no memory', async () => {
    for (const id of ['memory-save', 'memory-search', 'memory-forget']) {
      const out = await getBuiltinTool(id)!.execute({ text: 'x', query: 'x', id: 'x' }, {});
      expect(out.isError).toBe(true);
      expect(String(out.result)).toMatch(/Memory is off/);
    }
  });
});
