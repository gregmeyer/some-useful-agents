import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InboxStore, type Run } from '@some-useful-agents/core';
import { buildRunFailureMessage, buildCoalescedFailureNote, raiseRunFailureInbox } from './run-failure-inbox.js';

const run = (overrides: Partial<Run> = {}): Run => ({
  id: 'run-abc12345-xyz',
  agentName: 'news-digest',
  status: 'failed',
  startedAt: '2026-01-01T00:00:00Z',
  triggeredBy: 'dashboard',
  ...overrides,
});

let dir: string;
let store: InboxStore;
let prevFlag: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-run-failure-inbox-'));
  store = new InboxStore(join(dir, 'runs.db'));
  prevFlag = process.env.SUA_INBOX_LOCAL_RUN_FAILURES;
  delete process.env.SUA_INBOX_LOCAL_RUN_FAILURES;
});

afterEach(() => {
  if (prevFlag === undefined) delete process.env.SUA_INBOX_LOCAL_RUN_FAILURES;
  else process.env.SUA_INBOX_LOCAL_RUN_FAILURES = prevFlag;
  try { store.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('buildRunFailureMessage', () => {
  it('produces a high-priority run-failure message with the documented dedupeKey', () => {
    const msg = buildRunFailureMessage(
      {
        run: run({ error: 'Node "fetch" exited with code 127 (command not found): curl: command not found' }),
        failedNodeId: 'fetch',
        errorCategory: 'exit_nonzero',
        exitCode: 127,
        error: 'curl: command not found',
      },
      'http://127.0.0.1:3000/',
    );
    expect(msg.priority).toBe('high');
    expect(msg.source).toBe('run-failure');
    expect(msg.title).toContain('news-digest');
    expect(msg.dedupeKey).toBe('run-failure:run-abc12345-xyz');
    expect(msg.runId).toBe('run-abc12345-xyz');
    expect(msg.body).toContain('fetch');
    // Humanized explanation, not the raw enum token.
    expect(msg.body).toContain('exited with code 127 (command not found)');
    expect(msg.body).not.toContain('(exit_nonzero)');
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
    const raised = raiseRunFailureInbox(store, { run: run({ usedWorkflowProvider: 'temporal' }) });
    expect(raised?.coalesced).toBe(false);
    expect(raised?.message.dedupeKey).toBe('run-failure:run-abc12345-xyz');
  });

  it('now raises for a local run too (the loop must see local failures)', () => {
    const raised = raiseRunFailureInbox(store, { run: run({ usedWorkflowProvider: 'local' }) });
    expect(raised?.coalesced).toBe(false);
    expect(raised?.message.source).toBe('run-failure');
    expect(raised?.message.agentId).toBe('news-digest');
  });

  it('suppresses internal `_`-prefixed synthetic helpers (e.g. _yaml-fixer)', () => {
    // A Temporal run that would otherwise raise — the guard is the id, not the
    // provider — so this proves the suppression, not the local-flag path.
    const raised = raiseRunFailureInbox(store, {
      run: run({ agentName: '_yaml-fixer', usedWorkflowProvider: 'temporal' }),
      failedNodeId: 'fix',
      errorCategory: 'setup',
    });
    expect(raised).toBeUndefined();
    expect(store.findActiveByAgentAndSource('_yaml-fixer', 'run-failure')).toBeFalsy();
  });

  it('SUA_INBOX_LOCAL_RUN_FAILURES=0 restores the Temporal-only behavior', () => {
    process.env.SUA_INBOX_LOCAL_RUN_FAILURES = '0';
    expect(raiseRunFailureInbox(store, { run: run({ usedWorkflowProvider: 'local' }) })).toBeUndefined();
    expect(raiseRunFailureInbox(store, { run: run({ usedWorkflowProvider: undefined }) })).toBeUndefined();
    // Temporal runs still raise.
    expect(raiseRunFailureInbox(store, { run: run({ usedWorkflowProvider: 'temporal' }) })?.coalesced).toBe(false);
  });

  it('coalesces a repeat failure of the same agent into the active thread', () => {
    const first = raiseRunFailureInbox(store, { run: run({ id: 'run-1' }) });
    expect(first?.coalesced).toBe(false);
    const second = raiseRunFailureInbox(store, { run: run({ id: 'run-2', error: 'boom again' }), failedNodeId: 'fetch', errorCategory: 'exit_nonzero', exitCode: 1, error: 'boom again' });
    expect(second?.coalesced).toBe(true);
    expect(second?.message.id).toBe(first!.message.id);
    expect(second?.response?.role).toBe('system');
    expect(second?.response?.body).toContain('run-2'.slice(0, 8));
    expect(second?.response?.body).toContain('boom again');
    // Still exactly one thread.
    expect(store.list()).toHaveLength(1);
  });

  it('a resolved thread does not absorb new failures — fresh thread instead', () => {
    const first = raiseRunFailureInbox(store, { run: run({ id: 'run-1' }) });
    store.updateStatus(first!.message.id, 'resolved');
    const second = raiseRunFailureInbox(store, { run: run({ id: 'run-2' }) });
    expect(second?.coalesced).toBe(false);
    expect(second?.message.id).not.toBe(first!.message.id);
  });

  it('double-firing the hook for the same run never duplicates (thread or note)', () => {
    // Same run as the thread itself.
    const first = raiseRunFailureInbox(store, { run: run({ id: 'run-1' }) });
    const again = raiseRunFailureInbox(store, { run: run({ id: 'run-1' }) });
    expect(again?.coalesced).toBe(true);
    expect(again?.response).toBeUndefined();
    expect(store.listResponses(first!.message.id)).toHaveLength(0);
    // Same run as an already-absorbed note.
    raiseRunFailureInbox(store, { run: run({ id: 'run-2' }) });
    raiseRunFailureInbox(store, { run: run({ id: 'run-2' }) });
    expect(store.listResponses(first!.message.id)).toHaveLength(1);
  });

  it('different agents never coalesce with each other', () => {
    raiseRunFailureInbox(store, { run: run({ id: 'run-1', agentName: 'agent-a' }) });
    const other = raiseRunFailureInbox(store, { run: run({ id: 'run-2', agentName: 'agent-b' }) });
    expect(other?.coalesced).toBe(false);
    expect(store.list()).toHaveLength(2);
  });

  it('no-ops when there is no inbox store', () => {
    expect(() => raiseRunFailureInbox(undefined, { run: run() })).not.toThrow();
    expect(raiseRunFailureInbox(undefined, { run: run() })).toBeUndefined();
  });
});

describe('buildCoalescedFailureNote', () => {
  it('links the run and mentions the failed node + error', () => {
    const note = buildCoalescedFailureNote(
      { run: run({ id: 'run-xyz789', error: 'Node "fetch" timed out' }), failedNodeId: 'fetch', errorCategory: 'timeout' },
      'http://127.0.0.1:3000/',
    );
    expect(note).toContain('news-digest');
    expect(note).toContain('run-xyz7');
    expect(note).toContain('/runs/run-xyz789');
    expect(note).toContain('fetch');
    expect(note).toContain('timed out');
  });
});
