import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InboxStore } from '@some-useful-agents/core';
import { settleWaitingThread, waitingStatus } from './inbox-shared.js';

// "13 need your reply" counted every thread sua had answered, even a report that asked nothing.

let dir = '';
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
const setup = () => {
  dir = mkdtempSync(join(tmpdir(), 'sua-waiting-'));
  const store = new InboxStore(join(dir, 'runs.db'));
  const ctx = { inboxStore: store } as unknown as Parameters<typeof settleWaitingThread>[0];
  return { store, ctx };
};

describe('waiting on you means sua asked something', () => {
  it('a turn that reports back settles as answered; one that asks waits on you', () => {
    const { store } = setup();
    const t = store.add({ priority: 'medium', source: 'manual', title: 'Gadgets', body: 'find gadgets' });
    store.updateStatus(t.id, 'triaged');
    store.addResponse(t.id, 'triage', 'Searched again: 5 new options in the notebook.');
    expect(waitingStatus(store, t.id)).toBe('triaged');
    store.addResponse(t.id, 'triage', 'Want me to check prices every morning?');
    expect(waitingStatus(store, t.id)).toBe('awaiting_user');
  });

  it('skipping the last card leaves nothing to wait on', () => {
    const { store, ctx } = setup();
    const t = store.add({ priority: 'medium', source: 'manual', title: 'Roles', body: 'x' });
    store.addResponse(t.id, 'triage', 'I can check these.');
    const card = store.addResponse(t.id, 'action', 'Run it', JSON.stringify({ kind: 'action', status: 'proposed', agentId: 'research-fanout', inputs: {} }));
    store.updateStatus(t.id, 'awaiting_user');
    settleWaitingThread(ctx, t.id);
    expect(store.get(t.id)!.status).toBe('awaiting_user');
    store.transitionActionStatus(card.id, 'proposed', JSON.stringify({ kind: 'action', status: 'skipped', agentId: 'research-fanout', inputs: {} }));
    settleWaitingThread(ctx, t.id);
    expect(store.get(t.id)!.status).toBe('triaged');
  });
});
