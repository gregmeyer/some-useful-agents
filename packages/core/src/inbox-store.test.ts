import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InboxStore, type InboxMessage } from './inbox-store.js';

let dir: string;
let store: InboxStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-inbox-store-'));
  store = new InboxStore(join(dir, 'runs.db'));
});

afterEach(() => {
  try { store.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function addMinimal(overrides: Partial<Parameters<InboxStore['add']>[0]> = {}): InboxMessage {
  return store.add({
    priority: 'medium',
    source: 'manual',
    title: 'Hello',
    body: 'World',
    ...overrides,
  });
}

describe('InboxStore.add + get', () => {
  it('writes a row, get round-trips it, default status is open', () => {
    const msg = addMinimal();
    expect(msg.id).toBeTruthy();
    expect(msg.status).toBe('open');
    expect(msg.createdAt).toBeGreaterThan(0);
    expect(msg.resolvedAt).toBeUndefined();

    const got = store.get(msg.id);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(msg.id);
    expect(got!.title).toBe('Hello');
    expect(got!.body).toBe('World');
  });

  it('persists optional fields', () => {
    const msg = addMinimal({
      priority: 'high',
      source: 'run-failure',
      agentId: 'astro',
      runId: 'run-123',
      contextJson: JSON.stringify({ exit: 1 }),
    });
    const got = store.get(msg.id)!;
    expect(got.priority).toBe('high');
    expect(got.source).toBe('run-failure');
    expect(got.agentId).toBe('astro');
    expect(got.runId).toBe('run-123');
    expect(got.contextJson).toBe('{"exit":1}');
  });

  it('add with same dedupeKey is idempotent — returns existing row', () => {
    const first = addMinimal({ dedupeKey: 'run-failure:abc' });
    const second = addMinimal({ dedupeKey: 'run-failure:abc', title: 'Different' });
    expect(second.id).toBe(first.id);
    expect(second.title).toBe('Hello'); // original preserved
    expect(store.list({ status: 'open' })).toHaveLength(1);
  });

  it('add without dedupeKey always creates a new row even with identical content', () => {
    const a = addMinimal();
    const b = addMinimal();
    expect(a.id).not.toBe(b.id);
  });
});

describe('InboxStore.list', () => {
  it('orders by priority (high → low) then created_at DESC within each priority', async () => {
    addMinimal({ priority: 'low', title: 'L1' });
    await new Promise((r) => setTimeout(r, 3));
    addMinimal({ priority: 'high', title: 'H1' });
    await new Promise((r) => setTimeout(r, 3));
    addMinimal({ priority: 'medium', title: 'M1' });
    await new Promise((r) => setTimeout(r, 3));
    addMinimal({ priority: 'high', title: 'H2' });
    const titles = store.list().map((m) => m.title);
    expect(titles).toEqual(['H2', 'H1', 'M1', 'L1']);
  });

  it('default filter excludes dismissed and resolved', () => {
    const a = addMinimal({ title: 'keep' });
    const b = addMinimal({ title: 'dismiss-me' });
    const c = addMinimal({ title: 'resolve-me' });
    store.dismiss(b.id);
    store.updateStatus(c.id, 'resolved');
    expect(store.list().map((m) => m.title)).toEqual(['keep']);
    expect(a.id).toBeTruthy();
  });

  it('status filter overrides the default exclusion', () => {
    const a = addMinimal({ title: 'dismissed-one' });
    store.dismiss(a.id);
    expect(store.list({ status: 'dismissed' }).map((m) => m.title)).toEqual(['dismissed-one']);
  });

  it('priority filter narrows the result', () => {
    addMinimal({ priority: 'high', title: 'h' });
    addMinimal({ priority: 'low', title: 'l' });
    expect(store.list({ priority: 'high' }).map((m) => m.title)).toEqual(['h']);
  });

  it('respects limit', () => {
    for (let i = 0; i < 5; i++) addMinimal({ title: `m${i}` });
    expect(store.list({ limit: 2 })).toHaveLength(2);
  });
});

describe('InboxStore.updateStatus / dismiss', () => {
  it('transitions open → triaged → resolved and sets resolved_at on resolve', () => {
    const m = addMinimal();
    store.updateStatus(m.id, 'triaged', { triageRunId: 'run-xyz', recommendation: 'check log' });
    let got = store.get(m.id)!;
    expect(got.status).toBe('triaged');
    expect(got.triageRunId).toBe('run-xyz');
    expect(got.recommendation).toBe('check log');
    expect(got.resolvedAt).toBeUndefined();

    store.updateStatus(m.id, 'resolved');
    got = store.get(m.id)!;
    expect(got.status).toBe('resolved');
    expect(got.resolvedAt).toBeGreaterThan(0);
  });

  it('dismiss sets status + resolved_at', () => {
    const m = addMinimal();
    store.dismiss(m.id);
    const got = store.get(m.id)!;
    expect(got.status).toBe('dismissed');
    expect(got.resolvedAt).toBeGreaterThan(0);
  });

  it('throws when updating a missing id', () => {
    expect(() => store.updateStatus('nope', 'resolved')).toThrow(/no message with id/);
  });
});

describe('InboxStore.addResponse + listResponses', () => {
  it('round-trips responses in chronological order', async () => {
    const m = addMinimal();
    store.addResponse(m.id, 'user', 'first reply');
    await new Promise((r) => setTimeout(r, 3));
    store.addResponse(m.id, 'triage', 'recommendation');
    await new Promise((r) => setTimeout(r, 3));
    store.addResponse(m.id, 'system', 'state change');
    const responses = store.listResponses(m.id);
    expect(responses.map((r) => r.role)).toEqual(['user', 'triage', 'system']);
    expect(responses.map((r) => r.body)).toEqual(['first reply', 'recommendation', 'state change']);
  });

  it('rejects responses for unknown messages', () => {
    expect(() => store.addResponse('nope', 'user', 'x')).toThrow(/no message with id/);
  });

  it('persists metaJson', () => {
    const m = addMinimal();
    store.addResponse(m.id, 'system', 'allowed apod.nasa.gov', JSON.stringify({ host: 'apod.nasa.gov' }));
    const responses = store.listResponses(m.id);
    expect(responses[0].metaJson).toBe('{"host":"apod.nasa.gov"}');
  });
});

describe('InboxStore.findByDedupeKey', () => {
  it('returns the matching row', () => {
    const m = addMinimal({ dedupeKey: 'csp-block:astro:apod.nasa.gov' });
    expect(store.findByDedupeKey('csp-block:astro:apod.nasa.gov')?.id).toBe(m.id);
  });
  it('returns null for unknown keys', () => {
    expect(store.findByDedupeKey('nope')).toBeNull();
  });
});

describe('InboxStore.clear', () => {
  it('empties both tables', () => {
    const m = addMinimal();
    store.addResponse(m.id, 'user', 'x');
    store.clear();
    expect(store.list()).toEqual([]);
    expect(store.listResponses(m.id)).toEqual([]);
  });
});

describe('InboxStore validation', () => {
  it('rejects invalid priority', () => {
    expect(() => addMinimal({ priority: 'urgent' as never })).toThrow(/invalid priority/);
  });
  it('rejects invalid source', () => {
    expect(() => addMinimal({ source: 'mystery' as never })).toThrow(/invalid source/);
  });
  it('rejects invalid status on updateStatus', () => {
    const m = addMinimal();
    expect(() => store.updateStatus(m.id, 'snoozed' as never)).toThrow(/invalid status/);
  });
  it('rejects invalid response role', () => {
    const m = addMinimal();
    expect(() => store.addResponse(m.id, 'admin' as never, 'x')).toThrow(/invalid response role/);
  });
  it('requires title and body on add', () => {
    expect(() => store.add({ priority: 'low', source: 'manual', title: '', body: 'x' })).toThrow(/title/);
    expect(() => store.add({ priority: 'low', source: 'manual', title: 'x', body: '' })).toThrow(/body/);
  });
});
