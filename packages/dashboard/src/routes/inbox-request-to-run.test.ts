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

describe('parseProposedActions — side-effect sequencing', () => {
  it('defaults a missing effect to read and batches reads', () => {
    const { accepted, deferred } = parseProposedActions(
      [
        { type: 'run-agent', agentId: 'a' },
        { type: 'run-agent', agentId: 'b', effect: 'read' },
      ],
      ['a', 'b'],
    );
    expect(accepted).toHaveLength(2);
    expect(accepted[0].effect).toBe('read');
    expect(deferred).toHaveLength(0);
  });

  it('keeps only the first write and defers the rest', () => {
    const { accepted, deferred } = parseProposedActions(
      [
        { type: 'run-agent', agentId: 'make-note', effect: 'write' },
        { type: 'run-agent', agentId: 'make-reminder', effect: 'write' },
      ],
      ['make-note', 'make-reminder'],
    );
    expect(accepted.map((a) => a.agentId)).toEqual(['make-note']);
    expect(accepted[0].effect).toBe('write');
    expect(deferred).toEqual([{ agentId: 'make-reminder' }]);
  });

  it('pairs one write with reads, deferring only extra writes', () => {
    const { accepted, deferred } = parseProposedActions(
      [
        { type: 'run-agent', agentId: 'search', effect: 'read' },
        { type: 'run-agent', agentId: 'write-1', effect: 'write' },
        { type: 'run-agent', agentId: 'write-2', effect: 'write' },
      ],
      ['search', 'write-1', 'write-2'],
    );
    expect(accepted.map((a) => a.agentId)).toEqual(['search', 'write-1']);
    expect(deferred).toEqual([{ agentId: 'write-2' }]);
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
