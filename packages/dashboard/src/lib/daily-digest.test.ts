import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InboxStore, RunStore, type Run } from '@some-useful-agents/core';
import {
  buildDailyDigestMessage,
  firstLineSnippet,
  runDailyDigestOnce,
  type DailyDigestInput,
} from './daily-digest.js';

describe('firstLineSnippet', () => {
  it('takes the first non-empty line and truncates', () => {
    expect(firstLineSnippet('\n  hello world  \nsecond')).toBe('hello world');
    expect(firstLineSnippet(undefined)).toBeUndefined();
    expect(firstLineSnippet('')).toBeUndefined();
    const long = 'x'.repeat(300);
    const out = firstLineSnippet(long)!;
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThan(long.length);
  });

  it('skips code fences and structural-only lines for JSON/fenced output', () => {
    expect(firstLineSnippet('```json\n{\n"headline": "Usage up 12%"\n}')).toBe('"headline": "Usage up 12%"');
    expect(firstLineSnippet('{\n  "x": 1\n}')).toBe('"x": 1');
    // Single-line JSON with content is kept as-is.
    expect(firstLineSnippet('{"headline":"hi"}')).toBe('{"headline":"hi"}');
  });
});

describe('buildDailyDigestMessage', () => {
  it('returns null on an empty day', () => {
    expect(buildDailyDigestMessage({ date: '2026-08-05', agents: [] })).toBeNull();
    expect(buildDailyDigestMessage({ date: '2026-08-05', agents: [
      { agentName: 'x', total: 0, completed: 0, failed: 0, other: 0 },
    ] })).toBeNull();
  });

  it('renders counts + per-agent lines with cadence source + dated dedupeKey', () => {
    const input: DailyDigestInput = {
      date: '2026-08-05',
      agents: [
        { agentName: 'news', total: 3, completed: 3, failed: 0, other: 0, snippet: 'Top story: Fed holds' },
        { agentName: 'shoes', total: 2, completed: 0, failed: 2, other: 0, failureThreadId: 'inbox-42' },
      ],
    };
    const msg = buildDailyDigestMessage(input)!;
    expect(msg.source).toBe('cadence');
    expect(msg.priority).toBe('low');
    expect(msg.dedupeKey).toBe('cadence:daily-digest:2026-08-05');
    expect(msg.title).toContain('5 runs');
    expect(msg.title).toContain('2 agents');
    // Header rollup.
    expect(msg.body).toContain('5 runs · 3 ok · 2 failed · 2 agents');
    // Success line carries the snippet; failure line links the existing thread
    // and does NOT restate the error.
    expect(msg.body).toContain('✓ **news** (3) — "Top story: Fed holds"');
    expect(msg.body).toContain('✗ **shoes** (2 failed) → [open thread](/inbox/inbox-42)');
    // Failures sort first.
    expect(msg.body.indexOf('shoes')).toBeLessThan(msg.body.indexOf('news'));
  });

  it('counts "other" statuses in the header only', () => {
    const msg = buildDailyDigestMessage({
      date: '2026-08-05',
      agents: [{ agentName: 'stuck', total: 1, completed: 0, failed: 0, other: 1 }],
    })!;
    expect(msg.body).toContain('1 other');
    expect(msg.body).toContain('• **stuck** (1 run)');
  });
});

describe('runDailyDigestOnce', () => {
  let dir: string;
  let inboxStore: InboxStore;
  let runStore: RunStore;
  let ctx: any;
  // Fixed clock: 2026-08-06 09:00 local → summarizes 2026-08-05.
  const now = new Date(2026, 7, 6, 9, 0, 0);
  const yesterdayAt = (h: number) => new Date(2026, 7, 5, h, 0, 0).toISOString();

  const seedRun = (o: Partial<Run>) => runStore.createRun({
    id: `r-${Math.random().toString(36).slice(2)}`,
    agentName: 'a', status: 'completed', triggeredBy: 'schedule',
    startedAt: yesterdayAt(14), ...o,
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sua-digest-'));
    inboxStore = new InboxStore(join(dir, 'inbox.db'));
    runStore = new RunStore(join(dir, 'runs.db'));
    ctx = { inboxStore, runStore };
    delete process.env.SUA_DAILY_DIGEST;
  });
  afterEach(() => {
    try { inboxStore.close(); } catch { /* noop */ }
    try { runStore.close(); } catch { /* noop */ }
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not post before the post hour', () => {
    seedRun({ agentName: 'news', result: 'hello' });
    const early = new Date(2026, 7, 6, 6, 0, 0); // 6am < 8am
    expect(runDailyDigestOnce(ctx, { now: early })).toBe('skipped-early');
    expect(inboxStore.list()).toHaveLength(0);
  });

  it('skips empty days', () => {
    expect(runDailyDigestOnce(ctx, { now })).toBe('skipped-empty');
    expect(inboxStore.list()).toHaveLength(0);
  });

  it('posts one cadence digest and is idempotent', () => {
    seedRun({ agentName: 'news', status: 'completed', result: 'Top story: Fed holds' });
    seedRun({ agentName: 'shoes', status: 'failed' });

    let posted = 0;
    const r1 = runDailyDigestOnce(ctx, { now, onPosted: () => { posted++; } });
    expect(r1).toBe('posted');
    expect(posted).toBe(1);

    const threads = inboxStore.list().filter((m) => m.source === 'cadence');
    expect(threads).toHaveLength(1);
    expect(threads[0].dedupeKey).toBe('cadence:daily-digest:2026-08-05');
    expect(threads[0].body).toContain('✓ **news** (1) — "Top story: Fed holds"');
    expect(threads[0].body).toContain('✗ **shoes** (1 failed)');

    // Second call same day: no duplicate, no re-publish.
    const r2 = runDailyDigestOnce(ctx, { now, onPosted: () => { posted++; } });
    expect(r2).toBe('skipped-exists');
    expect(posted).toBe(1);
    expect(inboxStore.list().filter((m) => m.source === 'cadence')).toHaveLength(1);
  });

  it('links an existing run-failure thread for failed agents', () => {
    seedRun({ agentName: 'shoes', status: 'failed' });
    // Pre-existing coalesced failure thread for the agent.
    const failThread = inboxStore.add({
      priority: 'high', source: 'run-failure', title: 'Run failed: shoes',
      body: 'boom', agentId: 'shoes', dedupeKey: 'run-failure:some-run',
    });
    const outcome = runDailyDigestOnce(ctx, { now });
    expect(outcome).toBe('posted');
    const digest = inboxStore.list().find((m) => m.source === 'cadence')!;
    expect(digest.body).toContain(`→ [open thread](/inbox/${failThread.id})`);
  });

  it('respects the SUA_DAILY_DIGEST=0 opt-out', () => {
    process.env.SUA_DAILY_DIGEST = '0';
    seedRun({ agentName: 'news' });
    expect(runDailyDigestOnce(ctx, { now })).toBe('skipped-disabled');
    expect(inboxStore.list()).toHaveLength(0);
  });
});
