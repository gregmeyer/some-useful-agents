import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InboxStore, type SchedulerHeartbeat } from '@some-useful-agents/core';
import {
  buildSchedulerDownMessage,
  checkSchedulerHealthOnce,
  DOWN_AFTER_MS,
  SCHEDULER_DOWN_DEDUPE_PREFIX,
} from './scheduler-health-inbox.js';

const NOW = Date.parse('2026-09-26T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function heartbeat(partial: Partial<SchedulerHeartbeat> = {}): SchedulerHeartbeat {
  return {
    pid: 62998,
    startedAt: '2026-09-01T00:00:00.000Z',
    lastHeartbeat: new Date(NOW - 12 * DAY).toISOString(),
    agents: ['starter-watch', 'churn-watcher'],
    nextFires: {},
    ...partial,
  };
}

describe('buildSchedulerDownMessage', () => {
  it('is a high-priority system-health thread naming the silence, the agents, and the fix', () => {
    const msg = buildSchedulerDownMessage(heartbeat(), NOW);
    expect(msg.priority).toBe('high');
    expect(msg.source).toBe('system-health');
    expect(msg.body).toContain('12 days ago');
    expect(msg.body).toContain('`churn-watcher`, `starter-watch`');
    expect(msg.body).toContain('sua daemon start --service schedule');
    expect(msg.dedupeKey).toBe(`${SCHEDULER_DOWN_DEDUPE_PREFIX}2026-09-01T00:00:00.000Z`);
  });
});

describe('checkSchedulerHealthOnce', () => {
  let dir: string;
  let inbox: InboxStore;
  const writeHb = (hb: SchedulerHeartbeat) =>
    writeFileSync(join(dir, 'scheduler-heartbeat.json'), JSON.stringify(hb));
  const dead = () => false;
  const alive = () => true;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sua-sched-health-'));
    inbox = new InboxStore(join(dir, 'inbox.db'));
  });
  afterEach(() => {
    try { inbox.close(); } catch { /* noop */ }
    rmSync(dir, { recursive: true, force: true });
  });

  it('posts once for a crashed scheduler (stale heartbeat, dead pid)', () => {
    writeHb(heartbeat());
    expect(checkSchedulerHealthOnce(inbox, dir, { now: NOW, isAlive: dead })).toBe('posted');
    expect(checkSchedulerHealthOnce(inbox, dir, { now: NOW, isAlive: dead })).toBe('none');
    expect(inbox.list({ source: 'system-health' })).toHaveLength(1);
  });

  it('stays quiet on a clean stop (no heartbeat file)', () => {
    expect(checkSchedulerHealthOnce(inbox, dir, { now: NOW, isAlive: dead })).toBe('none');
    expect(inbox.list({ source: 'system-health' })).toHaveLength(0);
  });

  it('stays quiet while the pid is alive (laptop asleep / busy, not crashed)', () => {
    writeHb(heartbeat());
    expect(checkSchedulerHealthOnce(inbox, dir, { now: NOW, isAlive: alive })).toBe('none');
  });

  it('stays quiet for a short silence, and for a scheduler with nothing scheduled', () => {
    writeHb(heartbeat({ lastHeartbeat: new Date(NOW - DOWN_AFTER_MS + 1000).toISOString() }));
    expect(checkSchedulerHealthOnce(inbox, dir, { now: NOW, isAlive: dead })).toBe('none');
    writeHb(heartbeat({ agents: [] }));
    expect(checkSchedulerHealthOnce(inbox, dir, { now: NOW, isAlive: dead })).toBe('none');
  });

  it('resolves the open thread with a note once a scheduler heartbeats again', () => {
    writeHb(heartbeat());
    checkSchedulerHealthOnce(inbox, dir, { now: NOW, isAlive: dead });
    // New scheduler instance, fresh heartbeat (getSchedulerStatus reads the real clock).
    writeHb(heartbeat({ pid: 34867, startedAt: new Date().toISOString(), lastHeartbeat: new Date().toISOString() }));
    expect(checkSchedulerHealthOnce(inbox, dir, { isAlive: alive })).toBe('resolved');
    const msg = inbox.findByDedupeKey(`${SCHEDULER_DOWN_DEDUPE_PREFIX}2026-09-01T00:00:00.000Z`)!;
    expect(msg.status).toBe('resolved');
    expect(inbox.listResponses(msg.id).at(-1)?.body).toContain('running again (pid 34867)');
    expect(checkSchedulerHealthOnce(inbox, dir, { isAlive: alive })).toBe('none');
  });

  it('is never picked up by auto-triage (deterministic message, nothing for an LLM to do)', () => {
    writeHb(heartbeat());
    checkSchedulerHealthOnce(inbox, dir, { now: NOW, isAlive: dead });
    expect(inbox.listAutoTriageCandidates({ olderThanMs: 0, limit: 10 })).toHaveLength(0);
  });
});
