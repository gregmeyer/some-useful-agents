/**
 * The per-thread action cap is a runaway-fan-out guard. countActionsSinceLastUser
 * counts actions only since the operator's last message, so a long thread where
 * the operator keeps replying isn't blocked — each reply resets the budget —
 * while an autonomous refire chain still can't fan out unbounded between replies.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InboxStore, type InboxActionMeta } from '@some-useful-agents/core';
import { countActionsSinceLastUser } from './inbox-engine.js';

let dir: string;
let inboxStore: InboxStore;

function setup() {
  dir = mkdtempSync(join(tmpdir(), 'sua-cap-'));
  inboxStore = new InboxStore(join(dir, 'runs.db'));
  return { inboxStore } as never as ReturnType<typeof import('../context.js').getContext>;
}

afterEach(() => {
  try { inboxStore.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const action = (i: number): string =>
  JSON.stringify({ kind: 'action', status: 'completed', agentId: `a${i}`, inputs: {} } satisfies InboxActionMeta);

describe('countActionsSinceLastUser', () => {
  it('counts actions after the last user message, not lifetime', () => {
    const ctx = setup();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    inboxStore.addResponse(m.id, 'user', 'first ask');
    for (let i = 0; i < 6; i++) inboxStore.addResponse(m.id, 'action', 'a', action(i));
    inboxStore.addResponse(m.id, 'user', 'second ask'); // resets the burst
    for (let i = 0; i < 2; i++) inboxStore.addResponse(m.id, 'action', 'a', action(i));
    // 8 actions lifetime, but only 2 since the last user message.
    expect(countActionsSinceLastUser(ctx, m.id)).toBe(2);
  });

  it('counts all actions when there is no user message yet', () => {
    const ctx = setup();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    for (let i = 0; i < 3; i++) inboxStore.addResponse(m.id, 'action', 'a', action(i));
    expect(countActionsSinceLastUser(ctx, m.id)).toBe(3);
  });

  it('is zero right after a fresh user reply', () => {
    const ctx = setup();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    for (let i = 0; i < 5; i++) inboxStore.addResponse(m.id, 'action', 'a', action(i));
    inboxStore.addResponse(m.id, 'user', 'keep going');
    expect(countActionsSinceLastUser(ctx, m.id)).toBe(0);
  });
});
