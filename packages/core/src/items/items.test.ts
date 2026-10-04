/**
 * The item index (ADR-0049, S1): the projection rules on plain data, then the
 * whole index read from a real database.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStore } from '../agent-store.js';
import { RunStore } from '../run-store.js';
import { writeHeartbeat } from '../scheduler-heartbeat.js';
import type { InboxMessage, InboxResponse } from '../inbox-store.js';
import type { Run } from '../types.js';
import type { OutcomeRow } from '../outcome/outcome-store.js';
import type { BoardBuild } from '../board-build.js';
import {
  threadAttention, threadItem, failingAgentItem, outcomeItem, boardBuildItem, schedulerItem,
} from './projections.js';
import { collectItems, itemSourcesFromHandle, sortItems } from './collect.js';
import type { Item } from './types.js';

const msg = (over: Partial<InboxMessage> = {}): InboxMessage => ({
  id: 'm1', createdAt: 1_000, priority: 'medium', source: 'manual', title: 'A thread', body: 'b',
  status: 'awaiting_user', starred: false, paused: false, autoResolved: false, tags: [], ...over,
} as InboxMessage);
const card = (id: string, status = 'proposed'): InboxResponse => ({
  id, messageId: 'm1', createdAt: 2_000, role: 'action', body: 'card',
  metaJson: JSON.stringify({ kind: 'action', status, agentId: 'agent-editor', inputs: {} }),
});
const run = (id: string, status: Run['status'], at: string, error?: string): Run =>
  ({ id, agentName: 'a', status, startedAt: at, completedAt: at, triggeredBy: 'schedule', ...(error ? { error } : {}) });

describe('projections', () => {
  it('threadAttention: fail before approve before answer; closed threads need nothing', () => {
    expect(threadAttention({ status: 'resolved', source: 'run-failure' }, 2)).toBeUndefined();
    expect(threadAttention({ status: 'open', source: 'run-failure' }, 2)).toBe('fail');
    expect(threadAttention({ status: 'open', source: 'manual' }, 1)).toBe('approve');
    expect(threadAttention({ status: 'awaiting_user', source: 'board' }, 0)).toBe('approve');
    expect(threadAttention({ status: 'open', source: 'question' }, 0)).toBe('answer');
    expect(threadAttention({ status: 'awaiting_user', source: 'manual' }, 0)).toBe('answer');
    expect(threadAttention({ status: 'open', source: 'manual' }, 0)).toBeUndefined();
  });

  it('a thread with a proposed card is a decision you can approve or skip', () => {
    const item = threadItem(msg({ status: 'open' }), [card('r0', 'completed'), card('r1')])!;
    expect(item).toMatchObject({ id: 'thread:m1', kind: 'decision', urgency: 'high', state: 'open', href: '/inbox/m1' });
    expect(item.actions.map((a) => a.type)).toEqual(['approve', 'skip', 'reply']);
    expect(item.actions[0]).toMatchObject({ label: 'Apply fix', responseId: 'r1' });
    expect(threadItem(msg({ status: 'open' }), [])).toBeUndefined();
  });

  it('a failing agent counts failures in a row and gets urgent at 3', () => {
    const runs = [run('r4', 'running', '2026-10-03T05:00:00Z'), run('r3', 'failed', '2026-10-03T04:00:00Z', 'boom'),
      run('r2', 'failed', '2026-10-03T03:00:00Z'), run('r1', 'failed', '2026-10-03T02:00:00Z'), run('r0', 'completed', '2026-10-03T01:00:00Z')];
    const item = failingAgentItem({ id: 'a', name: 'A' }, runs, 't9')!;
    expect(item).toMatchObject({ id: 'agent:a:failing', kind: 'alert', urgency: 'high', value: 3, subject: { agentId: 'a', runId: 'r3', threadId: 't9' } });
    expect(item.summary).toBe('3 runs in a row failed: boom');
    expect(item.evidence.map((e) => e.id)).toEqual(['r3', 'r2', 'r1']);
    expect(item.actions.map((a) => a.type)).toEqual(['retry', 'reply', 'open']);
    expect(failingAgentItem({ id: 'a', name: 'A' }, [run('r5', 'completed', 'x'), ...runs])).toBeUndefined();
  });

  it('a missed outcome is an alert; a met one is nothing', () => {
    const row = { runId: 'run12345678', agentId: 'a', satisfied: 'no', detectedAt: '2026-10-03T00:00:00Z' } as OutcomeRow;
    expect(outcomeItem({ id: 'a', name: 'A' }, row)).toMatchObject({ id: 'agent:a:outcome', title: 'A missed its outcome', urgency: 'high' });
    expect(outcomeItem({ id: 'a', name: 'A' }, { ...row, satisfied: 'yes' })).toBeUndefined();
  });

  it('board builds: in progress, failed, done', () => {
    const b = { id: 'b1', boardId: 'user:x', request: 'a morning board', phase: 'running', detail: 'Running 4 tiles', placed: [], failed: [], missing: [], drafts: [], createdAt: 1, updatedAt: 2 } as BoardBuild;
    expect(boardBuildItem(b)).toMatchObject({ kind: 'progress', state: 'in-progress', summary: 'Running 4 tiles', href: '/dashboards/user%3Ax' });
    expect(boardBuildItem({ ...b, phase: 'failed', error: 'no agents' })).toMatchObject({ kind: 'alert', state: 'open' });
    expect(boardBuildItem({ ...b, phase: 'done' })).toBeUndefined();
  });

  it('the scheduler is a problem only when agents are scheduled', () => {
    expect(schedulerItem('stopped', 2, 'x')).toMatchObject({ urgency: 'high', state: 'open', title: 'The scheduler is not running' });
    expect(schedulerItem('idle', 2, 'x')).toMatchObject({ urgency: 'normal', state: 'open' });
    expect(schedulerItem('stopped', 0, 'x')).toMatchObject({ urgency: 'low', state: 'ok', summary: 'No agents are on a schedule' });
    expect(schedulerItem('running', 3, 'x')).toMatchObject({ state: 'ok', summary: 'Running 3 scheduled agents' });
  });

  it('sorts by urgency, then waiting-on-you, then newest', () => {
    const it = (id: string, urgency: 'high' | 'low', state: 'open' | 'ok', at: string): Item =>
      ({ kind: 'alert', title: 't', subject: {}, actions: [], evidence: [], href: '/', id, urgency, state, provenance: { source: 'runs', producedBy: 'system', at } });
    expect(sortItems([it('a', 'low', 'open', '3'), it('b', 'high', 'ok', '1'), it('c', 'high', 'open', '1'), it('d', 'high', 'open', '2')]).map((i) => i.id))
      .toEqual(['d', 'c', 'b', 'a']);
  });
});

describe('collectItems', () => {
  let dir: string;
  let agents: AgentStore;
  let runs: RunStore;
  afterEach(() => {
    try { runs?.close(); } catch { /* ignore */ }
    try { agents?.close(); } catch { /* ignore */ }
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('reads every source, folds mirror threads into their items, keeps ids stable, and filters', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-items-'));
    const dbPath = join(dir, 'runs.db');
    runs = new RunStore(dbPath);
    agents = new AgentStore(dbPath);
    const node = [{ id: 'n', type: 'shell' as const, command: 'echo hi', dependsOn: [] }];
    agents.createAgent({ id: 'flaky', name: 'Flaky', status: 'active', source: 'local', mcp: false, schedule: '0 8 * * *', nodes: node }, 'cli');
    agents.createAgent({ id: 'fine', name: 'Fine', status: 'active', source: 'local', mcp: false, nodes: node }, 'cli');
    agents.createAgent({ id: 'sketch', name: 'Sketch', status: 'draft', source: 'local', mcp: false, nodes: node }, 'cli');
    agents.createAgent({ id: 'old', name: 'Old', status: 'archived', source: 'local', mcp: false, nodes: node }, 'cli');
    for (const [i, s] of (['completed', 'failed', 'failed'] as const).entries()) {
      runs.createRun({ id: `f${String(i)}`, agentName: 'flaky', status: s, startedAt: `2026-10-03T0${String(i)}:00:00Z`, completedAt: `2026-10-03T0${String(i)}:00:30Z`, triggeredBy: 'schedule', ...(s === 'failed' ? { error: 'exit 1' } : {}) });
    }
    runs.createRun({ id: 'ok1', agentName: 'fine', status: 'completed', startedAt: '2026-10-03T01:00:00Z', triggeredBy: 'schedule' });
    runs.createRun({ id: 'oldfail', agentName: 'old', status: 'failed', startedAt: '2026-10-03T01:00:00Z', triggeredBy: 'schedule' });

    const src = itemSourcesFromHandle(runs.databaseHandle(), agents, runs, dir);
    const failThread = src.inbox!.add({ priority: 'high', source: 'run-failure', agentId: 'flaky', runId: 'f2', title: 'Run failed: flaky', body: 'x' });
    const ask = src.inbox!.add({ priority: 'medium', source: 'manual', title: 'Fix it?', body: 'x' });
    src.inbox!.addResponse(ask.id, 'action', 'card', JSON.stringify({ kind: 'action', status: 'proposed', agentId: 'agent-editor', inputs: {} }));
    const q = src.questions!.ask({ runId: 'f2', nodeId: 'n', agentId: 'flaky', question: 'Which city?', choices: ['Seattle', 'Portland'] });
    writeHeartbeat(dir, { pid: process.pid, startedAt: new Date().toISOString(), agents: ['flaky'], nextFires: {} });

    const items = collectItems(src);
    const ids = items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining([`question:${q.id}`, 'agent:flaky:failing', `thread:${ask.id}`, 'agent:sketch:draft', 'system:scheduler']));
    // The failure thread is the failing item's "Ask sua", not a second item; archived agents say nothing.
    expect(ids).not.toContain(`thread:${failThread.id}`);
    expect(ids.some((id) => id.startsWith('agent:old'))).toBe(false);
    expect(items.find((i) => i.id === 'agent:flaky:failing')).toMatchObject({ value: 2, subject: { threadId: failThread.id } });
    expect(items.find((i) => i.id === 'system:scheduler')).toMatchObject({ state: 'ok', value: 'running' });
    // Most urgent first.
    expect(items[items.length - 1].urgency).toBe('low');

    // Stable ids across reads, and the filters.
    expect(collectItems(src).map((i) => i.id)).toEqual(ids);
    expect(collectItems(src, { kinds: ['question'] }).map((i) => i.id)).toEqual([`question:${q.id}`]);
    expect(collectItems(src, { agentId: 'flaky' }).every((i) => i.subject.agentId === 'flaky')).toBe(true);
    expect(collectItems(src, { includeOk: false }).some((i) => i.state === 'ok')).toBe(false);
    expect(collectItems(src, { limit: 2 })).toHaveLength(2);
  });
});
