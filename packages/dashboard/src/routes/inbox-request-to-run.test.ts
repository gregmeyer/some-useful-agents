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
import { parseProposedActions } from './inbox-plan.js';
import { getRunnableCandidates } from './inbox-catalog.js';

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

describe('parseProposedActions — show-widget', () => {
  it('accepts show-widget for any agent (not gated on the run allowlist)', () => {
    const { accepted, rejected } = parseProposedActions(
      [{ type: 'show-widget', agentId: 'weather-dashboard', rationale: 'show the latest weather' }],
      [], // empty allowlist — show-widget is read-only, still accepted
      [],
    );
    expect(rejected).toHaveLength(0);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].mode).toBe('show-widget');
    expect(accepted[0].agentId).toBe('weather-dashboard');
    expect(accepted[0].effect).toBe('read');           // never deferred by the write-sequencer
    expect(accepted[0].ctaLabel).toBe('Show widget');
    expect(accepted[0].inputs).toEqual({});
    expect(accepted[0].rationale).toBe('show the latest weather');
  });

  it('rejects a show-widget with no agentId', () => {
    const { accepted, rejected } = parseProposedActions(
      [{ type: 'show-widget' }],
      ['x'],
    );
    expect(accepted).toHaveLength(0);
    expect(rejected[0].reason).toContain('show-widget');
  });

  it('a show-widget never counts as a write (read effect) so it is not deferred', () => {
    const { accepted, deferred } = parseProposedActions(
      [
        { type: 'show-widget', agentId: 'a' },
        { type: 'show-widget', agentId: 'b' },
      ],
      [],
    );
    expect(accepted).toHaveLength(2);
    expect(deferred).toHaveLength(0);
  });
});

describe('parseProposedActions — dashboard-editor', () => {
  it('accepts add-tile with op/DASHBOARD/AGENT_ID, marks it a write', () => {
    const { accepted, rejected } = parseProposedActions(
      [{ type: 'dashboard-editor', rationale: 'pin weather', inputs: { op: 'add-tile', DASHBOARD: 'Markets', AGENT_ID: 'weather', SECTION: 'Widgets' } }],
      [], // route-handled, not allowlist-gated
      [],
    );
    expect(rejected).toHaveLength(0);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].agentId).toBe('dashboard-editor');
    expect(accepted[0].effect).toBe('write');
    expect(accepted[0].ctaLabel).toBe('Add tile');
    expect(accepted[0].inputs).toEqual({ op: 'add-tile', DASHBOARD: 'Markets', AGENT_ID: 'weather', SECTION: 'Widgets' });
  });

  it('accepts create with just op/DASHBOARD', () => {
    const { accepted } = parseProposedActions(
      [{ type: 'dashboard-editor', inputs: { op: 'create', DASHBOARD: 'Markets' } }],
      [],
    );
    expect(accepted).toHaveLength(1);
    expect(accepted[0].ctaLabel).toBe('Create dashboard');
    expect(accepted[0].effect).toBe('write');
  });

  it('rejects unknown / missing op', () => {
    const { accepted, rejected } = parseProposedActions(
      [{ type: 'dashboard-editor', inputs: { op: 'nuke', DASHBOARD: 'x' } }],
      [],
    );
    expect(accepted).toHaveLength(0);
    expect(rejected[0].reason).toContain('add-tile | create');
  });

  it('rejects missing DASHBOARD', () => {
    const { rejected } = parseProposedActions(
      [{ type: 'dashboard-editor', inputs: { op: 'create' } }],
      [],
    );
    expect(rejected[0].reason).toContain('DASHBOARD');
  });

  it('rejects add-tile missing AGENT_ID', () => {
    const { rejected } = parseProposedActions(
      [{ type: 'dashboard-editor', inputs: { op: 'add-tile', DASHBOARD: 'x' } }],
      [],
    );
    expect(rejected[0].reason).toContain('AGENT_ID');
  });

  it('defers a second write when a dashboard-editor write is already in the plan', () => {
    const { accepted, deferred } = parseProposedActions(
      [
        { type: 'dashboard-editor', inputs: { op: 'create', DASHBOARD: 'a' } },
        { type: 'run-agent', agentId: 'make-note', effect: 'write' },
      ],
      ['make-note'],
    );
    expect(accepted.map((a) => a.agentId)).toEqual(['dashboard-editor']);
    expect(deferred).toEqual([{ agentId: 'make-note' }]);
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
