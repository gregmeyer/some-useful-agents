import { describe, it, expect, vi } from 'vitest';
import type { BuildPlan } from '../build-plan-schema.js';
import type { PlannerTelemetryStore } from '../planner-telemetry-store.js';
import { PlannerLoopRunner } from './runner.js';

/**
 * A minimal valid BuildPlan that the critic will accept (no newAgents,
 * no dashboard → trivially valid). Used by tests that focus on the
 * loop's plumbing rather than critic behaviour.
 */
const TRIVIAL_PLAN: BuildPlan = {
  intent: 'agent',
  summary: 'trivial',
  survey: { matchedAgents: [], missingFor: [], existingDashboards: [] },
  newAgents: [{ id: 'noop', purpose: 'noop', yaml: 'id: noop\nname: noop\nnodes:\n  - id: a\n    type: shell\n    command: echo\n' }],
  questions: [],
  dashboard: null,
};

function wrapInPlan(plan: BuildPlan): string {
  return `<plan>${JSON.stringify(plan)}</plan>`;
}

/** Stub telemetry store — records calls so tests can assert side effects. */
function stubTelemetry(): PlannerTelemetryStore & {
  calls: { extract: unknown[]; retrySpawn: unknown[]; incrementAttempts: string[]; resolve: string[]; smoke: unknown[] };
} {
  const calls = { extract: [] as unknown[], retrySpawn: [] as unknown[], incrementAttempts: [] as string[], resolve: [] as string[], smoke: [] as unknown[] };
  const planAttempts = new Map<string, number>();
  return {
    calls,
    recordExtract: (args: unknown) => { calls.extract.push(args); },
    recordSmoke: (args: unknown) => { calls.smoke.push(args); },
    recordRetrySpawn: (originalRunId: string, retryRunId: string) => { calls.retrySpawn.push({ originalRunId, retryRunId }); },
    incrementAttempts: (runId: string) => {
      calls.incrementAttempts.push(runId);
      planAttempts.set(runId, (planAttempts.get(runId) ?? 1) + 1);
    },
    resolveOriginalRunId: (runId: string) => { calls.resolve.push(runId); return runId; },
    get: (runId: string) => ({
      runId, planAttempts: planAttempts.get(runId) ?? 1, goal: 'fake goal', intent: null, createdAt: new Date().toISOString(),
      planExtractStatus: 'pending', planValidationErrors: 0, planAutofixCount: 0,
      timeToPlanMs: null, timeToCommitMs: null, committedAt: null,
    }),
  } as unknown as PlannerTelemetryStore & typeof calls extends { calls: infer C } ? { calls: C } : never;
}

describe('PlannerLoopRunner', () => {
  function makeRunner(overrides: Partial<{
    kickoff: ReturnType<typeof vi.fn>;
    autofix: ReturnType<typeof vi.fn>;
    existingIds: Set<string>;
    knownToolIds: Set<string>;
    telemetry: ReturnType<typeof stubTelemetry>;
    maxRetries: number;
  }> = {}) {
    const telemetry = overrides.telemetry ?? stubTelemetry();
    const kickoff = overrides.kickoff ?? vi.fn(async () => 'retry-run-123');
    const autofix = overrides.autofix ?? vi.fn((yaml: string) => yaml);
    const runner = new PlannerLoopRunner({
      telemetryStore: telemetry,
      kickoffPlannerRun: kickoff,
      autoFixYaml: autofix,
      loadExistingAgentIds: () => overrides.existingIds ?? new Set<string>(),
      ...(overrides.knownToolIds ? { loadKnownToolIds: () => overrides.knownToolIds! } : {}),
      maxRetries: overrides.maxRetries ?? 2,
    });
    return { runner, telemetry, kickoff, autofix };
  }

  it('returns failed when no <plan> block is present', async () => {
    const { runner, telemetry } = makeRunner();
    const out = await runner.advance({ runId: 'r1', runResult: 'no plan here', planMs: 100 });
    expect(out.kind).toBe('failed');
    if (out.kind === 'failed') {
      expect(out.error).toContain('<plan>');
      // observe step recorded as failed
      expect(out.steps[0]).toMatchObject({ phase: 'observe', primitive: 'observePlan', ok: false });
    }
    expect(telemetry.calls.extract).toHaveLength(1);
    expect(telemetry.calls.extract[0]).toMatchObject({ runId: 'r1', status: 'no-json' });
  });

  it('returns failed with rawPlan when JSON parses but schema fails', async () => {
    const { runner, telemetry } = makeRunner();
    const bogus = '<plan>{"intent": "not-a-real-intent"}</plan>';
    const out = await runner.advance({ runId: 'r2', runResult: bogus, planMs: 50 });
    expect(out.kind).toBe('failed');
    if (out.kind === 'failed') {
      expect(out.error).toContain('Plan validation failed');
      expect(out.rawPlan).toEqual({ intent: 'not-a-real-intent' });
    }
    expect(telemetry.calls.extract[0]).toMatchObject({ runId: 'r2', status: 'schema-invalid' });
  });

  it('returns failed when JSON parse fails inside the <plan> block', async () => {
    const { runner, telemetry } = makeRunner();
    const broken = '<plan>{not json}</plan>';
    const out = await runner.advance({ runId: 'r3', runResult: broken, planMs: 10 });
    expect(out.kind).toBe('failed');
    if (out.kind === 'failed') expect(out.error).toContain('parse failed');
    // recordExtract conflates JSON-parse-error with no-json (mirrors pre-refactor behaviour)
    expect(telemetry.calls.extract[0]).toMatchObject({ runId: 'r3', status: 'no-json' });
  });

  it('falls back to nodeExecResult when the run result lacks <plan>', async () => {
    const { runner } = makeRunner({ existingIds: new Set(['noop']) });
    const out = await runner.advance({
      runId: 'r4',
      runResult: 'no plan here',
      nodeExecResult: wrapInPlan(TRIVIAL_PLAN),
      planMs: 5,
    });
    expect(out.kind).toBe('done');
  });

  it('returns done when critic passes on the first attempt', async () => {
    const { runner, telemetry } = makeRunner({ existingIds: new Set(['noop']) });
    const out = await runner.advance({
      runId: 'r5',
      runResult: wrapInPlan(TRIVIAL_PLAN),
      planMs: 200,
    });
    expect(out.kind).toBe('done');
    if (out.kind === 'done') {
      expect(out.criticErrors).toBeUndefined();
      expect(out.criticWarning).toBeUndefined();
      const phases = out.steps.map((s) => s.phase);
      // observe(extract) + observe(autofix) + evaluate(critic) + evaluate(smoke) + reflect
      expect(phases).toEqual(['observe', 'observe', 'evaluate', 'evaluate', 'reflect']);
    }
    expect(telemetry.calls.extract[0]).toMatchObject({ status: 'ok', validationErrors: 0 });
  });

  it('spawns a retry when critic fails and attempts remain', async () => {
    // Use a plan that the critic WILL reject — newAgent.yaml that won't parse.
    const badPlan: BuildPlan = {
      ...TRIVIAL_PLAN,
      newAgents: [{ id: 'broken', purpose: 'broken', yaml: '!!!not valid yaml at all' }],
    };
    const kickoff = vi.fn(async () => 'retry-run-abc');
    const { runner, telemetry } = makeRunner({ kickoff });
    const out = await runner.advance({
      runId: 'r6',
      runResult: wrapInPlan(badPlan),
      planMs: 100,
    });
    expect(out.kind).toBe('retrying');
    if (out.kind === 'retrying') {
      expect(out.retryRunId).toBe('retry-run-abc');
      expect(out.attempt).toBe(2);
      expect(out.criticErrors.length).toBeGreaterThan(0);
      expect(out.phase).toContain('attempt 2');
    }
    expect(kickoff).toHaveBeenCalledOnce();
    expect(telemetry.calls.incrementAttempts).toEqual(['r6']);
    expect(telemetry.calls.retrySpawn).toEqual([{ originalRunId: 'r6', retryRunId: 'retry-run-abc' }]);
  });

  it('returns done with criticWarning when retry budget is exhausted', async () => {
    const badPlan: BuildPlan = {
      ...TRIVIAL_PLAN,
      newAgents: [{ id: 'broken', purpose: 'broken', yaml: '!!!not valid yaml at all' }],
    };
    // Telemetry that reports planAttempts already at maxRetries+1 (i.e. 3, when maxRetries=2)
    const tele = stubTelemetry();
    tele.incrementAttempts('r7'); // 2
    tele.incrementAttempts('r7'); // 3
    const { runner, telemetry } = makeRunner({ telemetry: tele });
    const out = await runner.advance({ runId: 'r7', runResult: wrapInPlan(badPlan), planMs: 1 });
    expect(out.kind).toBe('done');
    if (out.kind === 'done') {
      expect(out.criticErrors!.length).toBeGreaterThan(0);
      expect(out.criticWarning).toContain('could not produce a clean plan');
    }
    // No retry attempted
    expect(telemetry.calls.retrySpawn).toEqual([]);
  });

  it('returns done with a "retry-could-not-start" warning when kickoff returns null', async () => {
    const badPlan: BuildPlan = {
      ...TRIVIAL_PLAN,
      newAgents: [{ id: 'broken', purpose: 'broken', yaml: '!!!not valid yaml at all' }],
    };
    const kickoff = vi.fn(async () => null);
    const { runner } = makeRunner({ kickoff });
    const out = await runner.advance({ runId: 'r8', runResult: wrapInPlan(badPlan), planMs: 1 });
    expect(out.kind).toBe('done');
    if (out.kind === 'done') {
      expect(out.criticWarning).toContain('retry could not be started');
      expect(out.criticErrors!.length).toBeGreaterThan(0);
    }
  });

  it('runs autoFixYaml on every newAgent and records the modification count', async () => {
    const autofix = vi.fn((yaml: string) => `${yaml}\n# autofixed`);
    const { runner } = makeRunner({ autofix, existingIds: new Set(['noop']) });
    const out = await runner.advance({
      runId: 'r9',
      runResult: wrapInPlan(TRIVIAL_PLAN),
      planMs: 1,
    });
    expect(autofix).toHaveBeenCalledOnce();
    expect(out.kind).toBe('done');
    if (out.kind === 'done') {
      expect(out.plan.newAgents[0].yaml).toContain('# autofixed');
      const autofixStep = out.steps.find((s) => s.primitive === 'autofixPlanYamls');
      expect(autofixStep?.summary).toContain('1 of 1');
    }
  });

  // ── smoke-run integration (PR 2) ───────────────────────────────────
  it('emits a smoke evaluate step and records smoke telemetry on a clean plan', async () => {
    const { runner, telemetry } = makeRunner({ existingIds: new Set(['noop']) });
    const out = await runner.advance({
      runId: 'r10',
      runResult: wrapInPlan(TRIVIAL_PLAN),
      planMs: 1,
    });
    expect(out.kind).toBe('done');
    const smokeStep = out.steps.find((s) => s.primitive === 'smokeRunNewAgents');
    expect(smokeStep).toBeDefined();
    expect(smokeStep!.ok).toBe(true);
    expect(telemetry.calls.smoke).toEqual([{ runId: 'r10', status: 'ok', errors: 0 }]);
  });

  it('triggers retry when critic passes but smoke fails (unknown tool ref)', async () => {
    // Plan: a newAgent with a shell tool the catalog doesn't expose. Schema
    // accepts (tool is a free string), critic passes (no cross-newAgent
    // issues), smoke flags it.
    const planWithUnknownTool: BuildPlan = {
      ...TRIVIAL_PLAN,
      newAgents: [{
        id: 'unknown-tool', purpose: 'p',
        yaml: 'id: unknown-tool\nname: unknown-tool\nnodes:\n  - id: a\n    type: shell\n    tool: not-a-real-tool\n',
      }],
    };
    const kickoff = vi.fn(async () => 'retry-xyz');
    const { runner, telemetry } = makeRunner({
      kickoff,
      existingIds: new Set(['unknown-tool']),
      knownToolIds: new Set(['file-read']),
    });
    const out = await runner.advance({
      runId: 'r11',
      runResult: wrapInPlan(planWithUnknownTool),
      planMs: 1,
    });
    expect(out.kind).toBe('retrying');
    if (out.kind === 'retrying') {
      expect(out.smoke).toBeDefined();
      expect(out.smoke!.ok).toBe(false);
      // No critic errors — smoke is the only thing that flagged.
      expect(out.criticErrors).toEqual([]);
    }
    expect(kickoff).toHaveBeenCalledOnce();
    // Retry feedback combines critic + smoke; with no critic errors, only
    // the smoke feedback block ends up in the call.
    const feedbackArg = (kickoff.mock.calls[0] as unknown as [{ criticFeedback: string }])[0].criticFeedback;
    expect(feedbackArg).toContain('Smoke-run feedback');
    expect(feedbackArg).toContain('not-a-real-tool');
    expect(telemetry.calls.smoke[0]).toMatchObject({ status: 'failed', errors: 1 });
  });

  it('records an understand step + retrieves prior plans before retrying', async () => {
    // Use a memory store seeded with a similar prior plan; the runner's
    // compose phase should retrieve it and pass it through to kickoff.
    const { PlannerMemoryStore } = await import('./memory-store.js');
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'runner-mem-'));
    const memoryStore = new PlannerMemoryStore(join(dir, 'mem.db'));
    try {
      memoryStore.recordCommit({
        runId: 'prior-1',
        goal: 'broken yaml agent',
        intent: 'agent',
        plan: { ...TRIVIAL_PLAN, newAgents: [] },
        attempts: 1,
      });
      const planWithBadYaml: BuildPlan = {
        ...TRIVIAL_PLAN,
        newAgents: [{ id: 'broken', purpose: 'p', yaml: '!!!not valid yaml at all' }],
      };
      // Telemetry returns a goal that overlaps with the prior memory entry.
      const tele = stubTelemetry();
      // Seed telemetry's get() to surface 'broken yaml agent' as the goal.
      tele.get = ((runId: string) => ({
        runId, planAttempts: 1, goal: 'broken yaml agent', intent: 'agent',
        createdAt: new Date().toISOString(),
        planExtractStatus: 'pending', planValidationErrors: 0, planAutofixCount: 0,
        timeToPlanMs: null, timeToCommitMs: null, committedAt: null,
      })) as typeof tele.get;
      const kickoff = vi.fn(async () => 'retry-mem');
      const runner = new PlannerLoopRunner({
        telemetryStore: tele,
        kickoffPlannerRun: kickoff,
        autoFixYaml: (yaml: string) => yaml,
        loadExistingAgentIds: () => new Set(),
        memoryStore,
        maxRetries: 2,
      });
      const out = await runner.advance({
        runId: 'r-mem-1',
        runResult: wrapInPlan(planWithBadYaml),
        planMs: 1,
      });
      expect(out.kind).toBe('retrying');
      const understandStep = out.steps.find((s) => s.phase === 'understand');
      expect(understandStep).toBeDefined();
      expect(understandStep!.summary).toContain('retrieved 1 prior plan');
      // Kickoff received the priorPlans candidates.
      const arg = (kickoff.mock.calls[0] as unknown as [{ priorPlans?: unknown[] }])[0];
      expect(Array.isArray(arg.priorPlans)).toBe(true);
      expect(arg.priorPlans).toHaveLength(1);
    } finally {
      memoryStore.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('combines critic + smoke feedback when both fail', async () => {
    // Plan: newAgent YAML doesn't parse (critic catches via parseAgent) AND
    // we'd flag a tool issue — but since parse fails, smoke's tool check
    // doesn't run. Still expect retry with both feedback blocks aggregated
    // by the runner (only critic since smoke fell back to parse error).
    const planWithBadYaml: BuildPlan = {
      ...TRIVIAL_PLAN,
      newAgents: [{ id: 'broken', purpose: 'p', yaml: '!!!not valid yaml at all' }],
    };
    const kickoff = vi.fn(async () => 'retry-abc');
    const { runner } = makeRunner({ kickoff });
    const out = await runner.advance({
      runId: 'r12',
      runResult: wrapInPlan(planWithBadYaml),
      planMs: 1,
    });
    expect(out.kind).toBe('retrying');
    const feedbackArg = (kickoff.mock.calls[0] as unknown as [{ criticFeedback: string }])[0].criticFeedback;
    expect(feedbackArg).toContain('Critic feedback');
    // Smoke also catches parse errors via its own path, so feedback block present.
    expect(feedbackArg).toContain('Smoke-run feedback');
  });
});
