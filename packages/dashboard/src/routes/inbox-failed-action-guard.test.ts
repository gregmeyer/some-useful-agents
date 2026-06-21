/**
 * hasMatchingFailedAction — the thread-level guard that refuses to re-propose
 * an action that already failed here with the same inputs. The fix under test:
 * the block CLEARS once the target agent was edited after the failure (so an
 * operator fixing the agent unblocks the retry, even for an inputs-less agent).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStore, InboxStore, type InboxActionMeta } from '@some-useful-agents/core';
import { hasMatchingFailedAction } from './inbox-plan.js';

let dir: string;
let agentStore: AgentStore;
let inboxStore: InboxStore;

function setup() {
  dir = mkdtempSync(join(tmpdir(), 'sua-guard-'));
  const db = join(dir, 'runs.db');
  agentStore = new AgentStore(db);
  inboxStore = new InboxStore(db);
  agentStore.createAgent({
    id: 'opener', name: 'opener', status: 'draft', source: 'local', mcp: false,
    nodes: [{ id: 'n', type: 'shell', command: 'open -a Notes', dependsOn: [] }],
  }, 'cli');
  const ctx = { inboxStore, agentStore } as never;
  return ctx as ReturnType<typeof import('../context.js').getContext>;
}

afterEach(() => {
  try { agentStore.close(); } catch { /* ignore */ }
  try { inboxStore.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** Seed a failed action row whose failure ended at `endedAt`. */
function seedFailedAction(messageId: string, endedAt: number, inputs: Record<string, string> = {}): void {
  const meta: InboxActionMeta = { kind: 'action', status: 'failed', agentId: 'opener', inputs, endedAt };
  inboxStore.addResponse(messageId, 'action', 'failed run', JSON.stringify(meta));
}

const candidate = (inputs: Record<string, string> = {}): InboxActionMeta =>
  ({ kind: 'action', status: 'proposed', agentId: 'opener', inputs });

describe('hasMatchingFailedAction', () => {
  it('blocks a re-proposal when the agent has NOT been edited since the failure', () => {
    const ctx = setup();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    // Failure ended in the "future" relative to the agent's updatedAt (created now)
    // → the agent predates the failure → still blocked.
    seedFailedAction(m.id, Date.now() + 60_000);
    expect(hasMatchingFailedAction(ctx, m.id, candidate())).toBe(true);
  });

  it('CLEARS the block once the agent was edited after the failure', () => {
    const ctx = setup();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    // Failure ended a minute ago; the agent's updatedAt (now) is later → edited
    // since the failure → no longer the same dead action → not blocked.
    seedFailedAction(m.id, Date.now() - 60_000);
    expect(hasMatchingFailedAction(ctx, m.id, candidate())).toBe(false);
  });

  it('still distinguishes by inputs', () => {
    const ctx = setup();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    seedFailedAction(m.id, Date.now() + 60_000, { A: '1' });
    expect(hasMatchingFailedAction(ctx, m.id, candidate({ A: '2' }))).toBe(false); // different inputs
    expect(hasMatchingFailedAction(ctx, m.id, candidate({ A: '1' }))).toBe(true);  // same inputs
  });

  it('falls back to blocking when the agent no longer exists', () => {
    const ctx = setup();
    agentStore.deleteAgent('opener');
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    seedFailedAction(m.id, Date.now() - 60_000); // would clear IF we could read updatedAt
    expect(hasMatchingFailedAction(ctx, m.id, candidate())).toBe(true);
  });
});
