/**
 * Convergence guard + verify-on-resolve helpers.
 *
 * The guard bounds the non-converging analyze→fix loop: triage keeps applying
 * agent-editor fixes to the same target that never actually works. After
 * MAX_FIX_ATTEMPTS_PER_TARGET completed fixes, a further fix proposal is
 * blocked so the engine escalates to the operator instead of looping. The
 * verify helpers gate a resolve on real run-store evidence rather than triage's
 * say-so. All pure/deterministic — no LLM, no live dashboard.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InboxStore, type InboxActionMeta, type OutcomeRecord, type OutcomeVerdict, type Run } from '@some-useful-agents/core';
import {
  fixTargetOf,
  countAppliedFixes,
  fixLoopExhausted,
  MAX_FIX_ATTEMPTS_PER_TARGET,
} from './inbox-plan.js';
import { writeActionExecuted, verifyResolveEvidence } from './inbox-engine.js';

type Ctx = ReturnType<typeof import('../context.js').getContext>;

let dir: string;
let inboxStore: InboxStore;

function ctxWith(runs: Partial<Run>[] = [], outcomes: Record<string, OutcomeRecord> = {}): Ctx {
  return {
    inboxStore,
    runStore: {
      listRuns: (f?: { agentName?: string; limit?: number }) =>
        runs.filter((r) => !f?.agentName || r.agentName === f.agentName).slice(0, f?.limit ?? 100),
    },
    outcomeStore: Object.keys(outcomes).length > 0
      ? { get: (runId: string) => (outcomes[runId] ? { record: outcomes[runId] } : null) }
      : undefined,
  } as unknown as Ctx;
}

/** Minimal outcome record for the verify tests. */
function outcomeFor(runId: string, satisfied: OutcomeVerdict, failReason = 'regex did not match'): OutcomeRecord {
  return {
    version: 1,
    runId,
    agentId: 'checker',
    agentVersion: 1,
    detectedAt: '2026-01-01T00:00:00Z',
    intent: { expected: 'the check passes', assumptions: [], unobservable: [] },
    execution: {
      actor: { agentId: 'checker', agentVersion: 1, triggeredBy: 'dashboard' },
      runStatus: 'completed',
      startedAt: '2026-01-01T00:00:00Z',
      nodes: [],
    },
    observation: { evidence: [] },
    evaluation: {
      satisfied,
      basis: satisfied === 'undetermined' ? 'undetermined' : 'criteria',
      confidence: satisfied === 'undetermined' ? 'low' : 'high',
      ...(satisfied === 'undetermined' ? {} : {
        criteriaResults: [
          { description: 'shellExitZero(check)', passed: true },
          ...(satisfied === 'yes' ? [] : [{ description: 'regexMatch(check, /ok/)', passed: false, reason: failReason }]),
        ],
      }),
    },
    unknowns: [],
  };
}

function editorFix(target: string, status: InboxActionMeta['status'] = 'completed'): string {
  return JSON.stringify({
    kind: 'action', status, agentId: 'agent-editor', effect: 'write',
    inputs: { AGENT_ID: target, NEW_YAML: 'id: ' + target },
  } satisfies InboxActionMeta);
}

afterEach(() => {
  try { inboxStore.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshStore(): void {
  dir = mkdtempSync(join(tmpdir(), 'sua-converge-'));
  inboxStore = new InboxStore(join(dir, 'runs.db'));
}

describe('fixTargetOf', () => {
  it('extracts the target for editor and analyzer, ignores other agents', () => {
    const base = { kind: 'action', status: 'proposed', inputs: {} } as const;
    expect(fixTargetOf({ ...base, agentId: 'agent-editor', inputs: { AGENT_ID: 'checker', NEW_YAML: 'x' } })).toBe('checker');
    expect(fixTargetOf({ ...base, agentId: 'agent-analyzer', inputs: { AGENT_ID: 'checker' } })).toBe('checker');
    // analyzer falls back to the thread agent when no explicit AGENT_ID
    expect(fixTargetOf({ ...base, agentId: 'agent-analyzer', inputs: {} }, 'thread-agent')).toBe('thread-agent');
    // unrelated agent → not a fix action
    expect(fixTargetOf({ ...base, agentId: 'adr-browser', inputs: {} }, 'thread-agent')).toBeUndefined();
  });
});

describe('countAppliedFixes + fixLoopExhausted', () => {
  it('counts only completed editor fixes for the given target across the whole thread', () => {
    freshStore();
    const m = inboxStore.add({ priority: 'high', source: 'run-failure', title: 't', body: 'b' });
    inboxStore.addResponse(m.id, 'action', 'fix 1', editorFix('checker'));
    inboxStore.addResponse(m.id, 'action', 'fix 2', editorFix('checker'));
    inboxStore.addResponse(m.id, 'action', 'still running', editorFix('checker', 'running')); // not counted
    inboxStore.addResponse(m.id, 'action', 'other target', editorFix('other-agent'));          // different target
    inboxStore.addResponse(m.id, 'user', 'please fix it');                                       // user reply does NOT reset
    const ctx = ctxWith();
    expect(countAppliedFixes(ctx, m.id, 'checker')).toBe(2);
    expect(countAppliedFixes(ctx, m.id, 'other-agent')).toBe(1);
  });

  it('trips exactly at the budget and only for the exhausted target', () => {
    freshStore();
    const m = inboxStore.add({ priority: 'high', source: 'run-failure', title: 't', body: 'b' });
    for (let i = 0; i < MAX_FIX_ATTEMPTS_PER_TARGET; i++) {
      inboxStore.addResponse(m.id, 'action', `fix ${i}`, editorFix('checker'));
    }
    const ctx = ctxWith();
    const analyzer: InboxActionMeta = { kind: 'action', status: 'proposed', agentId: 'agent-analyzer', inputs: { AGENT_ID: 'checker' } };
    const editor: InboxActionMeta = { kind: 'action', status: 'proposed', agentId: 'agent-editor', effect: 'write', inputs: { AGENT_ID: 'checker', NEW_YAML: 'x' } };
    const otherTarget: InboxActionMeta = { kind: 'action', status: 'proposed', agentId: 'agent-analyzer', inputs: { AGENT_ID: 'fresh-agent' } };
    const nonFix: InboxActionMeta = { kind: 'action', status: 'proposed', agentId: 'adr-browser', inputs: {} };
    expect(fixLoopExhausted(ctx, m.id, analyzer)).toBe(true);   // another analyze of the exhausted target
    expect(fixLoopExhausted(ctx, m.id, editor)).toBe(true);     // another fix of the exhausted target
    expect(fixLoopExhausted(ctx, m.id, otherTarget)).toBe(false); // a different target is fine
    expect(fixLoopExhausted(ctx, m.id, nonFix)).toBe(false);    // non-fix action never gated
  });

  it('does not trip below the budget', () => {
    freshStore();
    const m = inboxStore.add({ priority: 'high', source: 'run-failure', title: 't', body: 'b' });
    inboxStore.addResponse(m.id, 'action', 'fix', editorFix('checker'));
    const ctx = ctxWith();
    const editor: InboxActionMeta = { kind: 'action', status: 'proposed', agentId: 'agent-editor', effect: 'write', inputs: { AGENT_ID: 'checker', NEW_YAML: 'x' } };
    expect(fixLoopExhausted(ctx, m.id, editor)).toBe(false);
  });
});

describe('writeActionExecuted', () => {
  it('is true only when a write-effect action completed', () => {
    freshStore();
    const m = inboxStore.add({ priority: 'high', source: 'run-failure', title: 't', body: 'b' });
    const ctx = ctxWith();
    // read-only completed action → false
    inboxStore.addResponse(m.id, 'action', 'analyze', JSON.stringify({ kind: 'action', status: 'completed', agentId: 'agent-analyzer', effect: 'read', inputs: {} } satisfies InboxActionMeta));
    expect(writeActionExecuted(ctx, m.id)).toBe(false);
    // write action still running → false
    inboxStore.addResponse(m.id, 'action', 'editing', editorFix('checker', 'running'));
    expect(writeActionExecuted(ctx, m.id)).toBe(false);
    // write action completed → true
    inboxStore.addResponse(m.id, 'action', 'edited', editorFix('checker'));
    expect(writeActionExecuted(ctx, m.id)).toBe(true);
  });
});

describe('verifyResolveEvidence', () => {
  const run = (status: Run['status']): Partial<Run> => ({ id: 'run-' + status + '-123456', agentName: 'checker', status });

  it('ok when the focus agent’s latest run completed', () => {
    freshStore();
    expect(verifyResolveEvidence(ctxWith([run('completed')]), 'checker').verdict).toBe('ok');
  });
  it('not_ok when the latest run failed', () => {
    freshStore();
    expect(verifyResolveEvidence(ctxWith([run('failed')]), 'checker').verdict).toBe('not_ok');
  });
  it('pending when there is no run to judge', () => {
    freshStore();
    expect(verifyResolveEvidence(ctxWith([]), 'checker').verdict).toBe('pending');
  });
  it('pending when there is no focus agent at all', () => {
    freshStore();
    expect(verifyResolveEvidence(ctxWith([run('completed')]), undefined).verdict).toBe('pending');
  });
});

/**
 * The reason OutcomeDetection exists. Before this, `verifyResolveEvidence`
 * answered `ok` for ANY run that reached `completed` — so a thread auto-resolved
 * as "fixed" for an agent that ran perfectly and produced nothing. A digest
 * emitting zero headlines exits 0 every time.
 */
describe('verifyResolveEvidence — outcome records override exit codes', () => {
  const completed = (id: string): Partial<Run> => ({ id, agentName: 'checker', status: 'completed' });

  it('ok when the run achieved its declared outcome', () => {
    freshStore();
    const v = verifyResolveEvidence(ctxWith([completed('run-1')], { 'run-1': outcomeFor('run-1', 'yes') }), 'checker');
    expect(v.verdict).toBe('ok');
    expect(v.evidence).toContain('achieved its declared outcome');
  });

  it('not_ok when the run completed cleanly but MISSED its outcome', () => {
    freshStore();
    const v = verifyResolveEvidence(ctxWith([completed('run-1')], { 'run-1': outcomeFor('run-1', 'no') }), 'checker');
    expect(v.verdict).toBe('not_ok');
    // Names why, and makes clear the execution itself was fine.
    expect(v.evidence).toContain('completed but did not achieve');
    expect(v.evidence).toContain('regex did not match');
  });

  it('not_ok, described as partial, when only some checks passed', () => {
    freshStore();
    const v = verifyResolveEvidence(ctxWith([completed('run-1')], { 'run-1': outcomeFor('run-1', 'partial') }), 'checker');
    expect(v.verdict).toBe('not_ok');
    expect(v.evidence).toContain('only partly achieved');
  });

  // Not knowing whether something worked is not the same as it having worked,
  // and this verdict closes threads.
  it('pending — never ok — when the outcome is undetermined', () => {
    freshStore();
    const v = verifyResolveEvidence(ctxWith([completed('run-1')], { 'run-1': outcomeFor('run-1', 'undetermined') }), 'checker');
    expect(v.verdict).toBe('pending');
    expect(v.evidence).toContain("isn't enough evidence");
  });

  it('falls back to run status for agents that declared no outcome', () => {
    freshStore();
    // Record exists for a DIFFERENT run — this run has none.
    const ctx = ctxWith([completed('run-2')], { 'run-1': outcomeFor('run-1', 'no') });
    const v = verifyResolveEvidence(ctx, 'checker');
    expect(v.verdict).toBe('ok');
    expect(v.evidence).toContain('completed cleanly');
  });

  it('degrades to run status when the outcome store throws', () => {
    freshStore();
    const ctx = {
      inboxStore,
      runStore: { listRuns: () => [completed('run-1')] },
      outcomeStore: { get: () => { throw new Error('db locked'); } },
    } as unknown as Ctx;
    expect(verifyResolveEvidence(ctx, 'checker').verdict).toBe('ok');
  });
});
