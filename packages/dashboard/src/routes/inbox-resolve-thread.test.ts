/**
 * resolve-thread action: triage can CLOSE a thread it has fully handled instead
 * of telling the operator to click Resolve. The parser accepts `resolve-thread`
 * (no agent, no dispatch), and the engine excludes it from the refire trigger so
 * closing a thread never spawns a follow-up turn.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStore, InboxStore, RunStore, type InboxActionMeta } from '@some-useful-agents/core';
import { parseProposedActions, hasMatchingFailedAction, RESOLVE_THREAD_AGENT_ID } from './inbox-plan.js';
import { atLeastOneActionExecuted } from './inbox-engine.js';

let dir: string;
let agentStore: AgentStore;
let inboxStore: InboxStore;
let runStore: RunStore;

function setup() {
  dir = mkdtempSync(join(tmpdir(), 'sua-resolve-thread-'));
  const db = join(dir, 'runs.db');
  agentStore = new AgentStore(db);
  inboxStore = new InboxStore(db);
  runStore = new RunStore(db);
  return { agentStore, inboxStore, runStore } as never as ReturnType<typeof import('../context.js').getContext>;
}

afterEach(() => {
  try { agentStore.close(); } catch { /* ignore */ }
  try { inboxStore.close(); } catch { /* ignore */ }
  try { runStore.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('parseProposedActions — resolve-thread', () => {
  it('accepts a resolve-thread action (no agent, no allowlist gating)', () => {
    const { accepted, rejected } = parseProposedActions(
      [{ type: 'resolve-thread', rationale: 'Operator said thanks; nothing left.' }],
      [], // empty allowlist — resolve runs nothing, so it still parses
    );
    expect(rejected).toHaveLength(0);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].mode).toBe('resolve');
    expect(accepted[0].agentId).toBe(RESOLVE_THREAD_AGENT_ID);
    expect(accepted[0].effect).toBe('write');
    expect(accepted[0].rationale).toContain('nothing left');
  });
});

describe('hasMatchingFailedAction — resolve is never blocked', () => {
  it('returns false for a resolve action even after a prior failed resolve', () => {
    const ctx = setup();
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const failedResolve: InboxActionMeta = {
      kind: 'action', mode: 'resolve', status: 'failed', agentId: RESOLVE_THREAD_AGENT_ID, inputs: {},
    };
    inboxStore.addResponse(msg.id, 'action', 'resolve', JSON.stringify(failedResolve));
    const candidate: InboxActionMeta = {
      kind: 'action', mode: 'resolve', status: 'proposed', agentId: RESOLVE_THREAD_AGENT_ID, inputs: {},
    };
    expect(hasMatchingFailedAction(ctx, msg.id, candidate)).toBe(false);
  });
});

describe('atLeastOneActionExecuted — resolve does not trigger a refire', () => {
  it('excludes a completed resolve action', () => {
    const ctx = setup();
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const resolved: InboxActionMeta = {
      kind: 'action', mode: 'resolve', status: 'completed', agentId: RESOLVE_THREAD_AGENT_ID, inputs: {},
      resultSummary: 'Resolved by triage.',
    };
    inboxStore.addResponse(msg.id, 'action', 'resolve', JSON.stringify(resolved));
    expect(atLeastOneActionExecuted(ctx, msg.id)).toBe(false);
  });

  it('still counts a completed run-agent action', () => {
    const ctx = setup();
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const ran: InboxActionMeta = {
      kind: 'action', status: 'completed', agentId: 'some-agent', inputs: {}, runId: 'r1',
    };
    inboxStore.addResponse(msg.id, 'action', 'run', JSON.stringify(ran));
    expect(atLeastOneActionExecuted(ctx, msg.id)).toBe(true);
  });
});
