import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InboxStore, normalizeTags, type InboxMessage } from './inbox-store.js';

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

describe('InboxStore.list — sortable queue (PR row UX pass)', () => {
  // The dashboard's queue UX exposes click-to-sort on every column.
  // Verify the store honors each sort key + direction, that the
  // derived last-activity timestamp drives both the default
  // priority-then-activity ordering and the `?sort=age` explicit
  // case, and that an unknown key defaults to priority semantics.

  it('lastActivityAt = MAX(response.created_at) when responses exist', async () => {
    const a = addMinimal({ title: 'a' });
    // Add one response, then read back via list() and confirm
    // lastActivityAt > createdAt.
    await new Promise((r) => setTimeout(r, 5));
    store.addResponse(a.id, 'user', 'hello');
    const [row] = store.list();
    expect(row.lastActivityAt).toBeDefined();
    expect(row.lastActivityAt!).toBeGreaterThan(row.createdAt);
  });

  it('lastActivityAt falls back to createdAt when no responses exist', () => {
    const a = addMinimal({ title: 'a' });
    const [row] = store.list();
    expect(row.lastActivityAt).toBe(row.createdAt);
    expect(a.createdAt).toBe(row.createdAt);
  });

  it('default sort = priority asc + last-activity desc, with replies bumping the row', async () => {
    addMinimal({ priority: 'low', title: 'L1' });
    await new Promise((r) => setTimeout(r, 5));
    const h1 = addMinimal({ priority: 'high', title: 'H1' });
    await new Promise((r) => setTimeout(r, 5));
    addMinimal({ priority: 'high', title: 'H2' });
    // Reply on H1 — it should now lead H2 within the high-priority bucket.
    await new Promise((r) => setTimeout(r, 5));
    store.addResponse(h1.id, 'triage', 'updated');
    const titles = store.list().map((m) => m.title);
    expect(titles).toEqual(['H1', 'H2', 'L1']);
  });

  it('sort=age desc orders by last-activity DESC (newest activity first)', async () => {
    const oldHigh = addMinimal({ priority: 'high', title: 'old-but-high' });
    await new Promise((r) => setTimeout(r, 5));
    const recentLow = addMinimal({ priority: 'low', title: 'recent-but-low' });
    // Bump oldHigh after recentLow so its last-activity wins.
    await new Promise((r) => setTimeout(r, 5));
    store.addResponse(oldHigh.id, 'user', 'nudge');
    const titles = store.list({ sort: 'age', dir: 'desc' }).map((m) => m.title);
    expect(titles).toEqual(['old-but-high', 'recent-but-low']);
    expect(recentLow.id).toBeTruthy();
  });

  it('sort=age asc reverses the order (oldest activity first)', async () => {
    addMinimal({ title: 'oldest' });
    await new Promise((r) => setTimeout(r, 5));
    addMinimal({ title: 'newest' });
    const titles = store.list({ sort: 'age', dir: 'asc' }).map((m) => m.title);
    expect(titles).toEqual(['oldest', 'newest']);
  });

  it('sort=status asc puts awaiting_user first', () => {
    const a = addMinimal({ title: 'await' });
    const b = addMinimal({ title: 'open' });
    const c = addMinimal({ title: 'triaged' });
    store.updateStatus(a.id, 'awaiting_user');
    store.updateStatus(c.id, 'triaged');
    expect(b.id).toBeTruthy();
    const titles = store.list({ sort: 'status', dir: 'asc' }).map((m) => m.title);
    expect(titles.indexOf('await')).toBeLessThan(titles.indexOf('triaged'));
    expect(titles.indexOf('triaged')).toBeLessThan(titles.indexOf('open'));
  });

  it('sort=title is alphabetical (case-insensitive)', () => {
    addMinimal({ title: 'banana' });
    addMinimal({ title: 'Apple' });
    addMinimal({ title: 'cherry' });
    const titles = store.list({ sort: 'title', dir: 'asc' }).map((m) => m.title);
    expect(titles).toEqual(['Apple', 'banana', 'cherry']);
    const reversed = store.list({ sort: 'title', dir: 'desc' }).map((m) => m.title);
    expect(reversed).toEqual(['cherry', 'banana', 'Apple']);
  });

  it('sort=agent puts unagented rows last regardless of direction', () => {
    addMinimal({ title: 'beta-agent', agentId: 'beta' });
    addMinimal({ title: 'alpha-agent', agentId: 'alpha' });
    addMinimal({ title: 'no-agent' });
    const asc = store.list({ sort: 'agent', dir: 'asc' }).map((m) => m.title);
    expect(asc).toEqual(['alpha-agent', 'beta-agent', 'no-agent']);
    const desc = store.list({ sort: 'agent', dir: 'desc' }).map((m) => m.title);
    // Unagented still last; named agents flip order.
    expect(desc).toEqual(['beta-agent', 'alpha-agent', 'no-agent']);
  });

  it('starred messages float to the top regardless of sort', () => {
    const a = addMinimal({ priority: 'low', title: 'starred-low' });
    addMinimal({ priority: 'high', title: 'normal-high' });
    store.setStarred(a.id, true);
    const titles = store.list({ sort: 'priority', dir: 'asc' }).map((m) => m.title);
    expect(titles[0]).toBe('starred-low');
  });

  it('unknown sort key falls back to priority semantics', () => {
    addMinimal({ priority: 'low', title: 'L' });
    addMinimal({ priority: 'high', title: 'H' });
    // `as never` to bypass the TypeScript guardrail at the test seam.
    const titles = store.list({ sort: 'wat' as never }).map((m) => m.title);
    expect(titles).toEqual(['H', 'L']);
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

  it('accepts the `action` role for sub-agent proposals', () => {
    const m = addMinimal();
    const meta = JSON.stringify({
      kind: 'action', status: 'proposed', agentId: 'agent-analyzer',
      inputs: { TOPIC: 't' }, rationale: 'try it',
    });
    const r = store.addResponse(m.id, 'action', 'Run agent-analyzer.', meta);
    expect(r.role).toBe('action');
    const fetched = store.getResponse(r.id);
    expect(fetched?.role).toBe('action');
    expect(fetched?.metaJson).toBe(meta);
  });
});

describe('InboxStore.getResponse + updateResponse', () => {
  it('getResponse returns null for unknown ids', () => {
    expect(store.getResponse('nope')).toBeNull();
  });

  it('updateResponse patches body and/or metaJson, leaves untouched fields alone', () => {
    const m = addMinimal();
    const r = store.addResponse(m.id, 'action', 'initial', JSON.stringify({ kind: 'action', status: 'proposed', agentId: 'x', inputs: {} }));
    store.updateResponse(r.id, { metaJson: JSON.stringify({ kind: 'action', status: 'running', agentId: 'x', inputs: {}, startedAt: 1 }) });
    const after = store.getResponse(r.id);
    expect(after?.body).toBe('initial');
    expect(JSON.parse(after!.metaJson!).status).toBe('running');
    store.updateResponse(r.id, { body: 'updated body' });
    expect(store.getResponse(r.id)?.body).toBe('updated body');
  });

  it('updateResponse with metaJson=null clears the meta', () => {
    const m = addMinimal();
    const r = store.addResponse(m.id, 'action', 'b', JSON.stringify({ kind: 'action', status: 'proposed', agentId: 'x', inputs: {} }));
    store.updateResponse(r.id, { metaJson: null });
    expect(store.getResponse(r.id)?.metaJson).toBeUndefined();
  });

  it('updateResponse throws on unknown id', () => {
    expect(() => store.updateResponse('nope', { body: 'x' })).toThrow(/no response with id/);
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

describe('normalizeTags', () => {
  it('lowercases, trims, dedupes, sorts, drops invalid', () => {
    expect(normalizeTags(['Foo', ' bar ', 'foo', 'BAR', '', 'has space', '😀', 'baz-1'])).toEqual([
      'bar', 'baz-1', 'foo',
    ]);
  });

  it('drops entries that are too long', () => {
    const long = 'a'.repeat(33);
    expect(normalizeTags([long, 'ok'])).toEqual(['ok']);
  });
});

describe('InboxStore star + tags', () => {
  it('messages default to starred=false + tags=[]', () => {
    const m = addMinimal();
    const got = store.get(m.id)!;
    expect(got.starred).toBe(false);
    expect(got.tags).toEqual([]);
  });

  it('setStarred toggles + persists', () => {
    const m = addMinimal();
    store.setStarred(m.id, true);
    expect(store.get(m.id)!.starred).toBe(true);
    store.setStarred(m.id, false);
    expect(store.get(m.id)!.starred).toBe(false);
  });

  it('setTags normalizes (lowercase, dedupe, sort, drop invalid)', () => {
    const m = addMinimal();
    store.setTags(m.id, ['Auth', 'auth', 'NETWORK', 'invalid tag with space', '😀']);
    expect(store.get(m.id)!.tags).toEqual(['auth', 'network']);
  });

  it('setTags([]) clears + listAllTags reflects current state', () => {
    const a = addMinimal({ title: 'A' });
    const b = addMinimal({ title: 'B' });
    store.setTags(a.id, ['network', 'auth']);
    store.setTags(b.id, ['network', 'db']);
    expect(store.listAllTags()).toEqual(['auth', 'db', 'network']);
    store.setTags(a.id, []);
    expect(store.get(a.id)!.tags).toEqual([]);
    expect(store.listAllTags()).toEqual(['db', 'network']);
  });

  it('throws on unknown id', () => {
    expect(() => store.setStarred('nope', true)).toThrow(/no message with id/);
    expect(() => store.setTags('nope', ['x'])).toThrow(/no message with id/);
  });
});

describe('InboxStore.list filters (q, starred, tag)', () => {
  it('starred=true returns only starred messages', () => {
    const a = addMinimal({ title: 'starred-one' });
    addMinimal({ title: 'plain' });
    store.setStarred(a.id, true);
    const out = store.list({ starred: true });
    expect(out.map((r) => r.title)).toEqual(['starred-one']);
  });

  it('sorts starred messages above non-starred at the same priority', () => {
    const plain = addMinimal({ priority: 'high', title: 'high-plain' });
    const starred = addMinimal({ priority: 'high', title: 'high-starred' });
    store.setStarred(starred.id, true);
    const out = store.list();
    expect(out.map((r) => r.title)).toEqual(['high-starred', 'high-plain']);
    void plain;
  });

  it('tag filter matches exact lowercase tag, not substring', () => {
    const a = addMinimal({ title: 'A' });
    const b = addMinimal({ title: 'B' });
    store.setTags(a.id, ['auth']);
    store.setTags(b.id, ['authentication']);
    const out = store.list({ tag: 'auth' });
    expect(out.map((r) => r.title)).toEqual(['A']);
  });

  it('q matches title, body, agent, and conversation entries', () => {
    const a = addMinimal({ title: 'apple', body: 'has fruit' });
    const b = addMinimal({ title: 'banana', body: 'plain text', agentId: 'apple-watcher' });
    const c = addMinimal({ title: 'cherry', body: 'pie' });
    store.addResponse(c.id, 'triage', 'mentioned apple in the thread');

    const out = store.list({ q: 'apple' }).map((r) => r.title).sort();
    expect(out).toEqual(['apple', 'banana', 'cherry']);
    void a;
    void b;
  });

  it('q is case-insensitive and trims', () => {
    addMinimal({ title: 'NASA Astronomy' });
    addMinimal({ title: 'weather' });
    expect(store.list({ q: '  nasa  ' }).map((r) => r.title)).toEqual(['NASA Astronomy']);
  });

  it('combines filters (starred + tag + q)', () => {
    const a = addMinimal({ title: 'auth issue' });
    const b = addMinimal({ title: 'auth issue starred' });
    addMinimal({ title: 'other' });
    store.setStarred(b.id, true);
    store.setTags(a.id, ['network']);
    store.setTags(b.id, ['auth']);
    const out = store.list({ starred: true, tag: 'auth', q: 'auth' });
    expect(out.map((r) => r.title)).toEqual(['auth issue starred']);
  });
});
