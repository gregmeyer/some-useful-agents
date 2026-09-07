/**
 * The smoke gate on the build orchestrator's drafting loop.
 *
 * `smokeRunNewAgents` re-parses a drafted agent and cross-references it
 * against the LIVE catalog — a shell node naming a tool the dispatcher can't
 * resolve, a `signal.mapping` slot or widget field naming an output the agent
 * never declares. The structural critic cannot see any of that: it works off
 * the plan's own fields, so an agent calling a nonexistent tool critiques
 * clean and then fails the first time anyone runs it.
 *
 * The legacy PlannerLoopRunner ran smoke on every plan. #326 moved `/build`
 * onto this orchestrator and left it behind — `smokeRunNewAgents` was called
 * only from `planner-loop/runner.ts` and `build-orchestrator.ts` had zero
 * references — so from then until now every generated agent reached the user
 * unchecked against the catalog it has to run against.
 *
 * These tests drive `advanceSession` over a real drafting-phase session with
 * a stubbed run store, so they exercise the shipped decision path rather than
 * re-asserting what `smokeRunNewAgents` returns (that has its own unit tests
 * in core). No LLM is spent: the drafter "results" are canned strings.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlannerTelemetryStore } from '@some-useful-agents/core';
import { advanceSession } from './build-orchestrator.js';

let dir: string;
let store: PlannerTelemetryStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-build-smoke-'));
  store = new PlannerTelemetryStore(join(dir, 'runs.db'));
});
afterEach(() => {
  try { store.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/**
 * An agent that PASSES the structural critic and fails smoke: the shell node
 * calls a tool that is in no catalog, and signal.mapping names an output key
 * the agent never declares. Both are runtime failures, not shape errors.
 */
const BAD_TOOL_YAML = `id: hn-top
name: HN top
description: Fetches the top stories.
status: active
outputs:
  result:
    type: string
    description: The formatted list.
signal:
  title: HN top
  format: text
  mapping:
    headline: not_a_declared_output
nodes:
  - id: fetch
    type: shell
    tool: totally-not-a-real-tool
    command: echo hi
`;

const CLEAN_YAML = `id: hn-top
name: HN top
description: Fetches the top stories.
status: active
outputs:
  result:
    type: string
    description: The formatted list.
signal:
  title: HN top
  format: text
  mapping:
    headline: result
nodes:
  - id: fetch
    type: shell
    command: echo hi
`;

function drafterResult(yaml: string): string {
  return `<plan>${JSON.stringify({ id: 'hn-top', purpose: 'fetch the top HN stories', yaml })}</plan>`;
}

/**
 * Minimal ctx: a run store that hands back one completed drafter run, an
 * agent store with nothing in it, and a tool store the smoke check reads.
 * `getAgent` returning undefined means a queued retry cannot spawn an LLM
 * run — it fails with a known message instead, which is what lets these
 * tests observe the retry decision without spending a build.
 */
function ctx(yaml: string, over: { tools?: string[] } = {}) {
  return {
    plannerTelemetryStore: store,
    runStore: {
      getRun: (id: string) => ({
        id,
        status: 'completed',
        result: drafterResult(yaml),
      }),
      listNodeExecutions: () => [],
    },
    agentStore: {
      listAgents: () => [],
      getAgent: () => undefined,
      upsertAgent: () => undefined,
    },
    toolStore: {
      listTools: () => (over.tools ?? ['http-fetch']).map((id) => ({ id, description: '', inputs: {} })),
    },
  } as unknown as Parameters<typeof advanceSession>[0];
}

/** A drafting-phase session with one fragment awaiting collection. */
function session(id: string, attempts: number): Parameters<typeof advanceSession>[1] {
  return {
    id,
    goal: 'fetch the top HN stories',
    focus: '',
    createdAt: Date.now() - 5_000,
    phase: 'drafting',
    phaseMessage: '',
    drafterRunIds: new Map([['fragment-0', 'run-1']]),
    drafterAttempts: new Map([['fragment-0', attempts]]),
    drafts: new Map(),
    smokeErrors: 0,
    smokeFailed: false,
    draftOnly: true,
    draftOnlySpec: { purpose: 'fetch the top HN stories' },
  } as unknown as Parameters<typeof advanceSession>[1];
}

describe('orchestrator smoke gate', () => {
  it('rejects a draft that calls a tool no catalog can resolve', async () => {
    const s = session('build-smoke-1', 3); // budget exhausted — fails instead of retrying
    await advanceSession(ctx(BAD_TOOL_YAML), s);

    expect(s.drafts.has('fragment-0')).toBe(false);
    expect(s.phase).toBe('failed');
    expect(s.error).toContain('totally-not-a-real-tool');
    expect(s.error).toContain('not_a_declared_output');
  });

  it('retries the one failing fragment rather than accepting or aborting the rest', async () => {
    const s = session('build-smoke-2', 1); // budget remains — queues a retry
    await advanceSession(ctx(BAD_TOOL_YAML), s);

    expect(s.drafts.has('fragment-0')).toBe(false);
    // The retry was queued and then could not spawn, because this ctx has no
    // agent-drafter. Reaching THAT failure is the signal a retry was queued.
    expect(s.error).toContain('Agent-drafter not found while attempting retry');
  });

  it('accepts a draft whose tool IS in the catalog', async () => {
    const fixed = BAD_TOOL_YAML
      .replace('totally-not-a-real-tool', 'http-fetch')
      .replace('not_a_declared_output', 'result');
    const s = session('build-smoke-3', 1);
    await advanceSession(ctx(fixed, { tools: ['http-fetch'] }), s);

    expect(s.drafts.has('fragment-0')).toBe(true);
    expect(s.smokeFailed).toBe(false);
  });

  it('does not flag a clean draft', async () => {
    const s = session('build-smoke-4', 1);
    await advanceSession(ctx(CLEAN_YAML), s);

    expect(s.drafts.has('fragment-0')).toBe(true);
    expect(s.smokeErrors).toBe(0);
  });
});

describe('orchestrator smoke telemetry', () => {
  it('records smoke coverage on the row recordStart opened', async () => {
    store.recordStart('build-smoke-5', 'fetch the top HN stories');
    const s = session('build-smoke-5', 3);
    await advanceSession(ctx(BAD_TOOL_YAML), s);

    const row = store.get('build-smoke-5')!;
    expect(row.smokeStatus).toBe('failed');
    expect(row.smokeErrors).toBeGreaterThan(0);
  });

  it('records a session that never reached a draft as skipped, not ok', async () => {
    // Inflating the pass rate with sessions that were never checked is the
    // artifact class #654 had to unpick; 'skipped' keeps the metric honest.
    store.recordStart('build-smoke-6', 'fetch the top HN stories');
    const s = session('build-smoke-6', 1);
    (s as unknown as { phase: string }).phase = 'assembling';
    await advanceSession(ctx(CLEAN_YAML), s);

    expect(store.get('build-smoke-6')!.smokeStatus).toBe('skipped');
  });
});
