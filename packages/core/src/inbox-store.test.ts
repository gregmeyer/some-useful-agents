import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InboxStore, normalizeTags, normalizeLesson, type InboxMessage } from './inbox-store.js';

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

describe('InboxStore.countNeedsYou + listNeedsYou', () => {
  it('counts and lists only awaiting_user threads', () => {
    expect(store.countNeedsYou()).toBe(0);
    expect(store.listNeedsYou()).toEqual([]);

    const a = addMinimal({ title: 'needs reply a' });
    const b = addMinimal({ title: 'needs reply b' });
    addMinimal({ title: 'still open' });            // stays 'open'
    const resolved = addMinimal({ title: 'done' });

    store.updateStatus(a.id, 'awaiting_user');
    store.updateStatus(b.id, 'awaiting_user');
    store.updateStatus(resolved.id, 'resolved');

    expect(store.countNeedsYou()).toBe(2);
    const needs = store.listNeedsYou();
    expect(needs.every((m) => m.status === 'awaiting_user')).toBe(true);
    expect(needs.map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('listNeedsYou honors the limit', () => {
    for (let i = 0; i < 6; i++) {
      const m = addMinimal({ title: `t${i}` });
      store.updateStatus(m.id, 'awaiting_user');
    }
    expect(store.countNeedsYou()).toBe(6);
    expect(store.listNeedsYou(4)).toHaveLength(4);
  });
});

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

describe('InboxStore.updateMessage', () => {
  it('retargets the agent link and records provenance contextJson', () => {
    const m = addMinimal({ agentId: 'old-agent' });
    store.updateMessage(m.id, { agentId: 'new-agent', contextJson: '{"forkedFrom":"x"}' });
    const got = store.get(m.id)!;
    expect(got.agentId).toBe('new-agent');
    expect(got.contextJson).toBe('{"forkedFrom":"x"}');
  });

  it('clears a column when passed null', () => {
    const m = addMinimal({ agentId: 'old-agent' });
    store.updateMessage(m.id, { agentId: null });
    expect(store.get(m.id)!.agentId).toBeUndefined();
  });

  it('no-ops on an empty patch', () => {
    const m = addMinimal({ agentId: 'keep' });
    store.updateMessage(m.id, {});
    expect(store.get(m.id)!.agentId).toBe('keep');
  });

  it('throws when the id does not exist', () => {
    expect(() => store.updateMessage('nope', { agentId: 'x' })).toThrow(/no message with id/);
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

  it('q matches multiple terms across normalized fields', () => {
    addMinimal({ title: 'joke-judge-two', body: 'compares jokes' });
    addMinimal({ title: 'judge only', body: 'plain comparison' });
    expect(store.list({ q: 'joke judge' }).map((r) => r.title)).toEqual(['joke-judge-two']);
  });

  it('q matches message ids and tags', () => {
    const msg = addMinimal({ title: 'tagged thread' });
    store.setTags(msg.id, ['auth']);
    expect(store.list({ q: 'auth' }).map((r) => r.title)).toEqual(['tagged thread']);
    expect(store.list({ q: msg.id.slice(0, 8) }).map((r) => r.title)).toEqual(['tagged thread']);
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

describe('normalizeLesson', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeLesson('Run  `brew install apod`, then retry!'))
      .toBe('run brew install apod then retry');
  });
  it('collapses near-identical lessons to the same key', () => {
    expect(normalizeLesson('Check the host allowlist.'))
      .toBe(normalizeLesson('check the   host allowlist'));
  });
});

describe('InboxStore triage learnings', () => {
  it('addLearning round-trips with defaults + provenance', () => {
    const l = store.addLearning({
      source: 'run-failure',
      agentId: 'news-digest',
      category: 'fix',
      lesson: 'Install the apod CLI before retrying.',
      sourceMessageId: 'msg-1',
      sourceRunId: 'run-1',
    });
    expect(l).not.toBeNull();
    expect(l!.status).toBe('pending');
    expect(l!.scope).toBe('agent');           // default
    expect(l!.agentId).toBe('news-digest');
    expect(l!.category).toBe('fix');
    expect(l!.sourceMessageId).toBe('msg-1');
    expect(l!.sourceRunId).toBe('run-1');
    expect(store.getLearning(l!.id)).toEqual(l);
  });

  it('dedups a near-identical lesson on the same (agentId, source)', () => {
    const a = store.addLearning({ source: 'run-failure', agentId: 'x', lesson: 'Fix the thing.' });
    const dup = store.addLearning({ source: 'run-failure', agentId: 'x', lesson: 'fix   the THING!' });
    expect(a).not.toBeNull();
    expect(dup).toBeNull();
    expect(store.listLearnings()).toHaveLength(1);
  });

  it('does NOT dedup the same lesson under a different agent or source', () => {
    store.addLearning({ source: 'run-failure', agentId: 'x', lesson: 'Fix the thing.' });
    expect(store.addLearning({ source: 'run-failure', agentId: 'y', lesson: 'Fix the thing.' })).not.toBeNull();
    expect(store.addLearning({ source: 'permission-request', agentId: 'x', lesson: 'Fix the thing.' })).not.toBeNull();
    expect(store.listLearnings()).toHaveLength(3);
  });

  it('listLearnings filters by messageId and status', () => {
    store.addLearning({ source: 'run-failure', agentId: 'a', lesson: 'one', sourceMessageId: 'm1' });
    store.addLearning({ source: 'run-failure', agentId: 'b', lesson: 'two', sourceMessageId: 'm2' });
    expect(store.listLearnings({ messageId: 'm1' })).toHaveLength(1);
    expect(store.listLearnings({ status: 'pending' })).toHaveLength(2);
    expect(store.listLearnings({ status: 'approved' })).toHaveLength(0);
  });

  it('updateLearningStatus approves once (stamps approved_at) and is race-safe', () => {
    const l = store.addLearning({ source: 'run-failure', agentId: 'a', lesson: 'lesson' })!;
    expect(store.updateLearningStatus(l.id, 'approved')).toBe(true);
    const approved = store.getLearning(l.id)!;
    expect(approved.status).toBe('approved');
    expect(approved.approvedAt).toBeGreaterThan(0);
    // A second transition loses the race (already decided).
    expect(store.updateLearningStatus(l.id, 'rejected')).toBe(false);
    expect(store.getLearning(l.id)!.status).toBe('approved');
  });

  it('updateLearningStatus returns false for a missing row', () => {
    expect(store.updateLearningStatus('nope', 'approved')).toBe(false);
  });

  it('deleteLearning removes the row', () => {
    const l = store.addLearning({ source: 'run-failure', agentId: 'a', lesson: 'x' })!;
    store.deleteLearning(l.id);
    expect(store.getLearning(l.id)).toBeNull();
  });

  describe('listApprovedLearningsForTriage', () => {
    const approve = (input: Parameters<InboxStore['addLearning']>[0]): void => {
      const l = store.addLearning(input)!;
      store.updateLearningStatus(l.id, 'approved');
    };

    it('matches agent-scoped lessons by agentId', () => {
      approve({ source: 'run-failure', agentId: 'news', scope: 'agent', lesson: 'news lesson' });
      approve({ source: 'run-failure', agentId: 'other', scope: 'agent', lesson: 'other lesson' });
      const out = store.listApprovedLearningsForTriage({ agentId: 'news', source: 'run-failure' });
      expect(out.map((l) => l.lesson)).toEqual(['news lesson']);
    });

    it('matches source-scoped lessons regardless of agent, and global always', () => {
      approve({ source: 'run-failure', agentId: 'a', scope: 'source', lesson: 'src lesson' });
      approve({ source: 'run-failure', agentId: 'b', scope: 'global', lesson: 'global lesson' });
      const out = store.listApprovedLearningsForTriage({ agentId: 'zzz', source: 'run-failure' });
      expect(out.map((l) => l.lesson).sort()).toEqual(['global lesson', 'src lesson']);
    });

    it('excludes pending and rejected lessons', () => {
      store.addLearning({ source: 'run-failure', agentId: 'a', scope: 'agent', lesson: 'still pending' });
      const rej = store.addLearning({ source: 'run-failure', agentId: 'a', scope: 'agent', lesson: 'will reject' })!;
      store.updateLearningStatus(rej.id, 'rejected');
      expect(store.listApprovedLearningsForTriage({ agentId: 'a', source: 'run-failure' })).toEqual([]);
    });

    it('does not match agent-scoped lessons when agentId is absent', () => {
      approve({ source: 'cadence', agentId: 'a', scope: 'agent', lesson: 'agent lesson' });
      approve({ source: 'cadence', scope: 'source', lesson: 'source lesson' });
      const out = store.listApprovedLearningsForTriage({ source: 'cadence' });
      expect(out.map((l) => l.lesson)).toEqual(['source lesson']);
    });

    it('orders newest-approved first and caps at the limit', () => {
      for (let i = 0; i < 7; i += 1) approve({ source: 'run-failure', agentId: 'a', scope: 'agent', lesson: `lesson ${i}` });
      const out = store.listApprovedLearningsForTriage({ agentId: 'a', source: 'run-failure' });
      expect(out).toHaveLength(5);                 // default LIMIT
      const limited = store.listApprovedLearningsForTriage({ agentId: 'a', source: 'run-failure' }, 2);
      expect(limited).toHaveLength(2);
    });
  });

  it('ensureSchema is idempotent across reopen (table + rows survive)', () => {
    const dbPath = join(dir, 'reopen.db');
    const s1 = new InboxStore(dbPath);
    const l = s1.addLearning({ source: 'run-failure', agentId: 'a', lesson: 'persist me' })!;
    s1.close();
    const s2 = new InboxStore(dbPath);   // re-runs ensureSchema
    expect(s2.getLearning(l.id)?.lesson).toBe('persist me');
    s2.close();
  });
});
