import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStore, InboxStore, type Agent, type InboxMessage } from '@some-useful-agents/core';
import type { DashboardContext } from '../context.js';
import {
  buildHomeFeedData,
  classifyThreadNature,
  formatNatureMeta,
  startOfDay,
  startOfWeek,
} from './home-feed.js';

let dir: string;
let inboxStore: InboxStore;
let agentStore: AgentStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-home-feed-'));
  const dbPath = join(dir, 'runs.db');
  inboxStore = new InboxStore(dbPath);
  agentStore = new AgentStore(dbPath);
});

afterEach(() => {
  try { inboxStore.close(); } catch { /* ignore */ }
  try { agentStore.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const ctx = () => ({ inboxStore, agentStore }) as unknown as DashboardContext;

function msg(over: Partial<InboxMessage> = {}): InboxMessage {
  return { source: 'manual', ...over } as unknown as InboxMessage;
}

describe('classifyThreadNature (task 2×2)', () => {
  it('agentless / manual thread is non-deterministic + ad-hoc', () => {
    const n = classifyThreadNature(msg({ source: 'manual' }), null);
    expect(n).toEqual({ scheduled: false, deterministic: false });
  });

  it('all-shell agent is deterministic; a cron makes it scheduled', () => {
    const agent = {
      id: 'etl', schedule: '0 3 * * *',
      nodes: [{ id: 'a', type: 'shell' }, { id: 'b', type: 'file-write' }],
    } as unknown as Agent;
    expect(classifyThreadNature(msg({ agentId: 'etl' }), agent)).toEqual({ scheduled: true, deterministic: true });
  });

  it('an LLM node makes an agent non-deterministic', () => {
    const agent = { id: 'brief', nodes: [{ id: 'a', type: 'shell' }, { id: 'b', type: 'llm-prompt' }] } as unknown as Agent;
    expect(classifyThreadNature(msg({ agentId: 'brief' }), agent).deterministic).toBe(false);
  });

  it('an agent-invoke node counts as non-deterministic', () => {
    const agent = { id: 'orch', nodes: [{ id: 'a', type: 'agent-invoke' }] } as unknown as Agent;
    expect(classifyThreadNature(msg({ agentId: 'orch' }), agent).deterministic).toBe(false);
  });

  it("source 'cadence' marks scheduled even without an agent", () => {
    expect(classifyThreadNature(msg({ source: 'cadence' }), null).scheduled).toBe(true);
  });
});

describe('formatNatureMeta (mono micro-label, no emoji)', () => {
  it('renders sched·shell / adhoc·shell / sched·llm and blanks the default quadrant', () => {
    expect(formatNatureMeta({ scheduled: true, deterministic: true })).toBe('sched·shell');
    expect(formatNatureMeta({ scheduled: false, deterministic: true })).toBe('adhoc·shell');
    expect(formatNatureMeta({ scheduled: true, deterministic: false })).toBe('sched·llm');
    // adhoc·llm (a plain manual chat) carries no signal worth the ink.
    expect(formatNatureMeta({ scheduled: false, deterministic: false })).toBe('');
  });
});

describe('startOfDay / startOfWeek', () => {
  it('startOfDay is midnight-aligned and ≤ now', () => {
    const now = Date.now();
    const sod = startOfDay(now);
    expect(sod).toBeLessThanOrEqual(now);
    const d = new Date(sod);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });
  it('startOfWeek ≤ startOfDay ≤ now', () => {
    const now = Date.now();
    expect(startOfWeek(now)).toBeLessThanOrEqual(startOfDay(now));
    expect(new Date(startOfWeek(now)).getDay()).toBe(1); // Monday
  });
});

describe('buildHomeFeedData bucketing', () => {
  it('separates needs-you, buckets the rest by activity, and tags nature', () => {
    agentStore.createAgent({
      id: 'etl', name: 'etl', status: 'active', source: 'local', mcp: false, schedule: '0 3 * * *',
      nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }],
    }, 'cli');
    const awaiting = inboxStore.add({ priority: 'high', source: 'run-failure', title: 'awaiting', body: 'b', agentId: 'etl' });
    inboxStore.updateStatus(awaiting.id, 'awaiting_user');
    inboxStore.add({ priority: 'medium', source: 'run-failure', title: 'today-thread', body: 'b', agentId: 'etl' });
    // Auto-resolved → closed ticker.
    const closed = inboxStore.add({ priority: 'low', source: 'run-failure', title: 'sua-closed', body: 'b' });
    inboxStore.updateStatus(closed.id, 'resolved', { autoResolved: true });

    const now = Date.now();
    const feed = buildHomeFeedData(ctx(), now);
    // awaiting_user is pinned to needsYou regardless of time.
    expect(feed.needsYou.map((i) => i.message.title)).toEqual(['awaiting']);
    // its nature tag comes from the scheduled all-shell agent.
    expect(feed.needsYou[0].nature).toEqual({ scheduled: true, deterministic: true });
    // the other active thread lands in today (created ~now).
    expect(feed.today.map((i) => i.message.title)).toContain('today-thread');
    // the auto-resolved thread is in the closed ticker, not the active buckets.
    expect(feed.closed.map((m) => m.title)).toEqual(['sua-closed']);
  });

  it('threads older than this week fall to the earlier bucket', () => {
    inboxStore.add({ priority: 'medium', source: 'manual', title: 'old-thread', body: 'b' });
    // Evaluate the feed as if "now" were 8 days after the thread was created.
    const future = Date.now() + 8 * 24 * 60 * 60 * 1000;
    const feed = buildHomeFeedData(ctx(), future);
    expect(feed.today).toHaveLength(0);
    expect(feed.earlier.map((i) => i.message.title)).toContain('old-thread');
  });

  it('attaches a preview from the latest reply', () => {
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 'has-reply', body: 'b' });
    inboxStore.addResponse(m.id, 'triage', 'Latest triage line');
    const feed = buildHomeFeedData(ctx(), Date.now());
    const item = feed.today.find((i) => i.message.title === 'has-reply');
    expect(item?.preview.latestResponse?.role).toBe('triage');
    expect(item?.preview.latestResponse?.body).toBe('Latest triage line');
  });

  it('suppresses empty "New conversation" stubs but keeps real threads', () => {
    inboxStore.add({ priority: 'medium', source: 'manual', title: 'New conversation', body: '(empty)' });
    inboxStore.add({ priority: 'medium', source: 'manual', title: 'real', body: 'content' });
    const feed = buildHomeFeedData(ctx(), Date.now());
    const titles = [...feed.needsYou, ...feed.today, ...feed.week, ...feed.earlier].map((i) => i.message.title);
    expect(titles).toContain('real');
    expect(titles).not.toContain('New conversation');
  });
});
