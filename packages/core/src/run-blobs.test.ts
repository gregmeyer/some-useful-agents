import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { blobRefs, packLargeStrings, unpackLargeStrings, BLOB_MIN_CHARS } from './run-blobs.js';
import { RunStore } from './run-store.js';

const big = (c: string) => c.repeat(BLOB_MIN_CHARS + 10);

describe('packLargeStrings / unpackLargeStrings', () => {
  it('keeps each large string once and gives the JSON back exactly as written', () => {
    const store = new Map<string, string>();
    const json = JSON.stringify({ TRIAGE_KERNEL: big('k'), TOPIC: 'otters', nested: { list: [big('k'), 'small'] } });
    const packed = packLargeStrings(json, (h, b) => store.set(h, b))!;
    expect(packed.length).toBeLessThan(500);
    expect(store.size).toBe(1); // the same text twice is one blob
    expect(blobRefs(packed)).toHaveLength(2);
    expect(unpackLargeStrings(packed, (h) => store.get(h))).toBe(json);
  });

  it('leaves small or non-JSON values as the same string', () => {
    const small = JSON.stringify({ a: 'b' });
    expect(packLargeStrings(small, () => { throw new Error('no'); })).toBe(small);
    const notJson = `not json ${big('x')}`;
    expect(packLargeStrings(notJson, () => undefined)).toBe(notJson);
    expect(unpackLargeStrings(small, () => undefined)).toBe(small);
  });

  it('reads a reference whose text is gone as a short note, not an error', () => {
    const out = unpackLargeStrings(JSON.stringify({ X: { $sua_blob: 'a'.repeat(64) } }), () => undefined)!;
    expect(JSON.parse(out).X).toMatch(/no longer kept/);
  });
});

describe('RunStore keeps large stored inputs once', () => {
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), 'sua-blobs-'));
    const dbPath = join(dir, 'runs.db');
    return { dir, dbPath, store: new RunStore(dbPath) };
  };
  const run = (id: string, startedAt = new Date().toISOString()) => ({ id, agentName: 'inbox-triage', status: 'completed' as const, startedAt, triggeredBy: 'dashboard' as const });
  const exec = (runId: string, inputsJson: string) => ({ runId, nodeId: 'triage', workflowVersion: 1, status: 'completed' as const, startedAt: new Date().toISOString(), inputsJson, upstreamInputsJson: '{}' });

  it('stores the kernel once across runs, and reads every run back unchanged', () => {
    const { dir, dbPath, store } = setup();
    try {
      const inputs = JSON.stringify({ TRIAGE_KERNEL: big('k'), MESSAGE: 'hi' });
      for (const id of ['r1', 'r2', 'r3']) { store.createRun(run(id)); store.createNodeExecution(exec(id, inputs)); }
      store.updateRun('r1', { resumeContext: { inputs: { TRIAGE_KERNEL: big('k') } } as never });
      for (const id of ['r1', 'r2', 'r3']) expect(store.listNodeExecutions(id)[0].inputsJson).toBe(inputs);
      expect((store.getRun('r1')!.resumeContext as { inputs: { TRIAGE_KERNEL: string } }).inputs.TRIAGE_KERNEL).toBe(big('k'));
      const raw = new DatabaseSync(dbPath);
      expect(raw.prepare('SELECT COUNT(*) AS n FROM run_blobs').get()).toEqual({ n: 1 });
      expect((raw.prepare("SELECT MAX(length(inputsJson)) AS n FROM node_executions").get() as { n: number }).n).toBeLessThan(500);
      raw.close();
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('a store opened on a shared handle packs and unpacks too', () => {
    const { dir, store } = setup();
    try {
      const shared = RunStore.fromHandle(store.databaseHandle());
      const inputs = JSON.stringify({ CATALOG: big('c') });
      shared.createRun(run('h1')); shared.createNodeExecution(exec('h1', inputs));
      expect(store.listNodeExecutions('h1')[0].inputsJson).toBe(inputs);
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('compacts rows written before, and the retention sweep drops strings nothing refers to', () => {
    const { dir, dbPath, store } = setup();
    try {
      const inputs = JSON.stringify({ TRIAGE_KERNEL: big('k') });
      store.createRun(run('old', '2020-01-01T00:00:00.000Z'));
      store.createRun(run('new'));
      // As an older version wrote them: the full text in the row.
      const raw = new DatabaseSync(dbPath);
      for (const id of ['old', 'new']) raw.prepare("INSERT INTO node_executions (runId, nodeId, workflowVersion, status, startedAt, inputsJson) VALUES (?, 'triage', 1, 'completed', ?, ?)").run(id, new Date().toISOString(), inputs);
      const out = store.compactStoredInputs();
      expect(out.rows).toBe(2);
      expect(out.charsSaved).toBeGreaterThan(BLOB_MIN_CHARS);
      expect(store.listNodeExecutions('new')[0].inputsJson).toBe(inputs);
      expect(store.compactStoredInputs().rows).toBe(0); // again: nothing to do
      // The old run goes; the kernel stays while "new" refers to it.
      store.sweepExpired(30);
      expect(raw.prepare('SELECT COUNT(*) AS n FROM run_blobs').get()).toEqual({ n: 1 });
      raw.prepare("DELETE FROM runs WHERE id = 'new'").run();
      expect(store.pruneBlobs()).toBe(1);
      raw.close();
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
