import { describe, it, expect } from 'vitest';
import type { InboxStore, Run, AddMessageInput } from '@some-useful-agents/core';
import { buildRunFailureMessage, raiseRunFailureInbox } from './run-failure-inbox.js';

const run = (overrides: Partial<Run> = {}): Run => ({
  id: 'run-abc12345-xyz',
  agentName: 'news-digest',
  status: 'failed',
  startedAt: '2026-01-01T00:00:00Z',
  triggeredBy: 'dashboard',
  ...overrides,
});

/** Minimal InboxStore stand-in that records add() calls. */
function fakeStore(): { store: InboxStore; added: AddMessageInput[] } {
  const added: AddMessageInput[] = [];
  const store = { add: (input: AddMessageInput) => { added.push(input); return {} as unknown; } } as unknown as InboxStore;
  return { store, added };
}

describe('buildRunFailureMessage', () => {
  it('produces a high-priority run-failure message with the documented dedupeKey', () => {
    const msg = buildRunFailureMessage(
      { run: run({ error: 'boom' }), failedNodeId: 'fetch', errorCategory: 'exit_nonzero' },
      'http://127.0.0.1:3000/',
    );
    expect(msg.priority).toBe('high');
    expect(msg.source).toBe('run-failure');
    expect(msg.title).toContain('news-digest');
    expect(msg.dedupeKey).toBe('run-failure:run-abc12345-xyz');
    expect(msg.runId).toBe('run-abc12345-xyz');
    expect(msg.body).toContain('fetch');
    expect(msg.body).toContain('boom');
    expect(msg.body).toContain('/runs/run-abc12345-xyz'); // trailing slash on base url normalized
  });

  it('omits the Temporal mention + UI link for a setup failure (no temporalRunId)', () => {
    const msg = buildRunFailureMessage(
      { run: run({ usedWorkflowProvider: 'temporal', error: 'gate rejected' }) },
      'http://127.0.0.1:3000',
    );
    expect(msg.title).toBe('Run failed: news-digest');
    expect(msg.title).not.toContain('Temporal');
    expect(msg.body).not.toContain('Temporal');
    expect(msg.body).not.toContain('localhost:8233');
    expect(msg.body).toContain('/runs/run-abc12345-xyz'); // run page still linked
  });

  it('mentions Temporal + deep-links the workflow when temporalRunId is present', () => {
    const msg = buildRunFailureMessage(
      { run: run({ usedWorkflowProvider: 'temporal', temporalRunId: 'exec-99' }) },
      'http://127.0.0.1:3000',
    );
    expect(msg.title).toBe('Temporal run failed: news-digest');
    expect(msg.body).toContain('Temporal worker');
    // Real deep link to the sua-run-<id> workflow history in the Temporal UI.
    expect(msg.body).toContain('localhost:8233');
    expect(msg.body).toContain('sua-run-run-abc12345-xyz');
    expect(msg.body).toContain('exec-99');
  });
});

describe('raiseRunFailureInbox', () => {
  it('creates a message for a Temporal run', () => {
    const { store, added } = fakeStore();
    raiseRunFailureInbox(store, { run: run({ usedWorkflowProvider: 'temporal' }) });
    expect(added).toHaveLength(1);
    expect(added[0].dedupeKey).toBe('run-failure:run-abc12345-xyz');
  });

  it('no-ops for a local run (local failures are already visible)', () => {
    const { store, added } = fakeStore();
    raiseRunFailureInbox(store, { run: run({ usedWorkflowProvider: 'local' }) });
    raiseRunFailureInbox(store, { run: run({ usedWorkflowProvider: undefined }) });
    expect(added).toHaveLength(0);
  });

  it('no-ops when there is no inbox store', () => {
    expect(() => raiseRunFailureInbox(undefined, { run: run({ usedWorkflowProvider: 'temporal' }) })).not.toThrow();
  });
});
