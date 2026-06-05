/**
 * Request-to-run: triage can propose running an installed agent that hasn't
 * been granted inbox-run permission. parseProposedActions turns that into an
 * approval-gated "Enable & run" (grantsInboxRunnable). getRunnableCandidates
 * surfaces which agents qualify.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStore } from '@some-useful-agents/core';
import { parseProposedActions, getRunnableCandidates } from './inbox.js';

describe('parseProposedActions — candidates', () => {
  it('runs an allowlisted agent directly (no grant flag)', () => {
    const { accepted } = parseProposedActions(
      [{ type: 'run-agent', agentId: 'already-runnable' }],
      ['already-runnable'],
      [],
    );
    expect(accepted).toHaveLength(1);
    expect(accepted[0].grantsInboxRunnable).toBeUndefined();
  });

  it('accepts a candidate as an Enable & run with grantsInboxRunnable', () => {
    const { accepted, rejected } = parseProposedActions(
      [{ type: 'run-agent', agentId: 'xkcd-random-comic' }],
      [],
      ['xkcd-random-comic'],
    );
    expect(rejected).toHaveLength(0);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].grantsInboxRunnable).toBe(true);
    expect(accepted[0].ctaLabel).toBe('Enable & run');
  });

  it('prefers allowlist over candidate when an id is in both', () => {
    const { accepted } = parseProposedActions(
      [{ type: 'run-agent', agentId: 'dual' }],
      ['dual'],
      ['dual'],
    );
    expect(accepted[0].grantsInboxRunnable).toBeUndefined();
  });

  it('still rejects an agent in neither list', () => {
    const { accepted, rejected } = parseProposedActions(
      [{ type: 'run-agent', agentId: 'stranger' }],
      ['allowed'],
      ['candidate'],
    );
    expect(accepted).toHaveLength(0);
    expect(rejected[0].reason).toContain('RUNNABLE_CANDIDATES');
  });

  it('keeps a triage-provided ctaLabel for a candidate when present', () => {
    const { accepted } = parseProposedActions(
      [{ type: 'run-agent', agentId: 'c', ctaLabel: 'Show me a comic' }],
      [],
      ['c'],
    );
    expect(accepted[0].ctaLabel).toBe('Show me a comic');
    expect(accepted[0].grantsInboxRunnable).toBe(true);
  });
});

describe('getRunnableCandidates', () => {
  let dir: string;
  let agentStore: AgentStore;

  function setup(): void {
    dir = mkdtempSync(join(tmpdir(), 'sua-r2r-'));
    agentStore = new AgentStore(join(dir, 'runs.db'));
  }
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const mk = (id: string, perms?: { inboxRunnable?: boolean }, source: 'local' | 'community' = 'local'): void => {
    agentStore.createAgent({
      id, name: id, status: 'draft', source, mcp: false,
      nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }],
      ...(perms ? { permissions: perms } : {}),
    }, 'cli');
  };

  it('returns installed non-runnable agents, excludes already-runnable ones', () => {
    setup();
    mk('candidate-a');
    mk('candidate-b', undefined, 'community');
    mk('already-on', { inboxRunnable: true });
    const ctx = { agentStore } as never;
    const candidates = getRunnableCandidates(ctx);
    expect(candidates.sort()).toEqual(['candidate-a', 'candidate-b']);
    expect(candidates).not.toContain('already-on');
  });

  it('returns empty when there are no installed user agents', () => {
    setup();
    const ctx = { agentStore } as never;
    expect(getRunnableCandidates(ctx)).toEqual([]);
  });
});
