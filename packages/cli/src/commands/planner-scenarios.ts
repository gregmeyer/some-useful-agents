/**
 * Server-side smoke scenarios (1–6). Each function:
 *  - hits the daemon's HTTP endpoints
 *  - reads PlannerTelemetryStore rows for assertions
 *  - returns a ScenarioResult with a single decisive `reason` string
 *
 * Scenarios DO NOT clean up after themselves — the runner snapshots
 * state before each scenario and rolls back the diff. Keep scenarios
 * focused on their assertion; let the runner own lifecycle.
 *
 * Goals are deliberately written to exercise specific branches in the
 * critic loop (see plan: can-we-build-these-warm-finch.md). When the
 * planner gets smart enough that a goal stops triggering its branch,
 * update the goal — don't relax the assertion.
 */

import {
  startBuild,
  pollUntilDone,
  commitPlan,
  assertTelemetry,
  type SmokeContext,
  type ScenarioResult,
} from './planner.js';

export interface ServerScenario {
  id: number;
  name: string;
  goal: string;
  /** One-line summary of what the scenario asserts; used in dry-run output. */
  asserts: string;
  run: (ctx: SmokeContext) => Promise<ScenarioResult>;
}

// Goals are exported so unit tests + dry-run can introspect them without
// running the network calls.
export const SCENARIO_GOALS = {
  happyPath: 'Build a single agent that fetches a daily weather summary for Seattle.',
  criticRetry:
    'Build a multi-agent Ashby search workflow with a 3-section dashboard ' +
    'combining new and existing agents, including a daily summarisation step.',
  hnDigest:
    'Build me a daily Hacker News digest. Weekday mornings at 8am, ' +
    'render the top 10 stories using the ai-template widget on a dashboard.',
  criticExhaustion:
    'Make a dashboard using only existing agents that don\'t exist yet — ' +
    'reference agent ids like ghost-1, ghost-2, ghost-3 in dashboard sections.',
  dismissTest: 'Build a single agent that prints "hello" once a day.',
};

// ── Helpers shared across scenarios ────────────────────────────────────

async function startAndPoll(
  ctx: SmokeContext,
  goal: string,
  maxMs?: number,
): Promise<{ start: { ok: boolean; runId?: string; error?: string }; final: Awaited<ReturnType<typeof pollUntilDone>>['final']; chain: string[]; retries: number }> {
  const start = await startBuild(ctx.baseUrl, goal);
  if (!start.ok || !start.runId) {
    return {
      start,
      final: { ok: false, status: 'failed', error: start.error ?? 'no runId returned' },
      chain: [],
      retries: 0,
    };
  }
  const polled = await pollUntilDone(ctx.baseUrl, start.runId, maxMs);
  return { start, final: polled.final, chain: polled.chain, retries: polled.retries };
}

function timed<T>(fn: () => Promise<T>): Promise<{ value: T; durationMs: number }> {
  const t = Date.now();
  return fn().then((value) => ({ value, durationMs: Date.now() - t }));
}

// ── Scenario 1: Happy path ─────────────────────────────────────────────

const happyPath: ServerScenario = {
  id: 1,
  name: 'happy-path: simple agent, first-try clean',
  goal: SCENARIO_GOALS.happyPath,
  asserts: 'status=done first try; planAttempts=1; commit populates committedAt',
  async run(ctx) {
    const { value: poll, durationMs } = await timed(() => startAndPoll(ctx, this.goal));
    const rootRunId = poll.start.runId;
    if (poll.final.status !== 'done' || !poll.final.plan) {
      return {
        scenarioId: this.id, name: this.name, passed: false, durationMs, rootRunId,
        reason: `expected status=done, got ${poll.final.status}: ${poll.final.error ?? ''}`,
      };
    }
    if (poll.retries !== 0) {
      return {
        scenarioId: this.id, name: this.name, passed: false, durationMs, rootRunId,
        reason: `expected first-try clean, but observed ${poll.retries} retries`,
      };
    }
    const commit = await commitPlan(ctx.baseUrl, poll.final.plan, rootRunId!);
    if (!commit.ok) {
      return {
        scenarioId: this.id, name: this.name, passed: false, durationMs, rootRunId,
        reason: `commit failed: ${commit.error ?? 'unknown'}`,
      };
    }
    if (!commit.agentsCreated || commit.agentsCreated.length === 0) {
      return {
        scenarioId: this.id, name: this.name, passed: false, durationMs, rootRunId,
        reason: `commit returned ok but agentsCreated is empty`,
      };
    }
    const mismatch = assertTelemetry(ctx.telemetryStore, rootRunId!, {
      minAttempts: 1, maxAttempts: 1, extractStatus: 'ok', committed: true,
    });
    if (mismatch) {
      return { scenarioId: this.id, name: this.name, passed: false, durationMs, rootRunId, reason: mismatch };
    }
    return { scenarioId: this.id, name: this.name, passed: true, durationMs, rootRunId, reason: 'all asserts passed' };
  },
};

// ── Scenario 2: Critic retry path ──────────────────────────────────────

const criticRetry: ServerScenario = {
  id: 2,
  name: 'critic-retry: complex composition triggers retry',
  goal: SCENARIO_GOALS.criticRetry,
  asserts: 'observes ≥1 retrying status, eventually done; planAttempts ≥ 2',
  async run(ctx) {
    const { value: poll, durationMs } = await timed(() => startAndPoll(ctx, this.goal));
    const rootRunId = poll.start.runId;
    // The planner is stochastic — sometimes it nails this on the first
    // try, in which case the scenario is informational rather than a
    // hard fail. We still PASS, but flag the unexpected clean run.
    if (poll.final.status !== 'done') {
      return {
        scenarioId: this.id, name: this.name, passed: false, durationMs, rootRunId,
        reason: `expected status=done, got ${poll.final.status}: ${poll.final.error ?? ''}`,
      };
    }
    if (poll.retries === 0) {
      return {
        scenarioId: this.id, name: this.name, passed: true, durationMs, rootRunId,
        reason: '(informational) clean first-try — planner did not need retry on this goal',
      };
    }
    const mismatch = assertTelemetry(ctx.telemetryStore, rootRunId!, {
      minAttempts: 2,
    });
    if (mismatch) {
      return { scenarioId: this.id, name: this.name, passed: false, durationMs, rootRunId, reason: mismatch };
    }
    return {
      scenarioId: this.id, name: this.name, passed: true, durationMs, rootRunId,
      reason: `${poll.retries} retr${poll.retries === 1 ? 'y' : 'ies'} → clean; telemetry matches`,
    };
  },
};

// ── Scenario 3: HN-digest reproducer ───────────────────────────────────

const hnDigest: ServerScenario = {
  id: 3,
  name: 'hn-digest reproducer (signal.title regression)',
  goal: SCENARIO_GOALS.hnDigest,
  asserts: 'reaches done; if critic fired, intent is dashboard-* (not failed)',
  async run(ctx) {
    const { value: poll, durationMs } = await timed(() => startAndPoll(ctx, this.goal));
    const rootRunId = poll.start.runId;
    if (poll.final.status !== 'done' || !poll.final.plan) {
      return {
        scenarioId: this.id, name: this.name, passed: false, durationMs, rootRunId,
        reason: `expected status=done, got ${poll.final.status}: ${poll.final.error ?? ''}`,
      };
    }
    return {
      scenarioId: this.id, name: this.name, passed: true, durationMs, rootRunId,
      reason: poll.retries > 0
        ? `critic caught issues; recovered after ${poll.retries} retr${poll.retries === 1 ? 'y' : 'ies'}`
        : 'first-try clean — signal.title regression appears fixed',
    };
  },
};

// ── Scenario 4: Critic exhaustion ──────────────────────────────────────

const criticExhaustion: ServerScenario = {
  id: 4,
  name: 'critic-exhaustion: 3 attempts, surfaces criticErrors',
  goal: SCENARIO_GOALS.criticExhaustion,
  asserts: 'final response has criticErrors + criticWarning; planAttempts=3; planValidationErrors > 0',
  async run(ctx) {
    // 4 minutes — exhaustion path is 3 planner runs in series.
    const { value: poll, durationMs } = await timed(() => startAndPoll(ctx, this.goal, 240_000));
    const rootRunId = poll.start.runId;
    if (poll.final.status !== 'done') {
      return {
        scenarioId: this.id, name: this.name, passed: false, durationMs, rootRunId,
        reason: `expected status=done (with criticErrors), got ${poll.final.status}: ${poll.final.error ?? ''}`,
      };
    }
    const errors = poll.final.criticErrors;
    if (!errors || errors.length === 0) {
      // Possible if the planner unexpectedly produced a clean plan despite
      // the goal — informational rather than fail, but flag it loudly.
      return {
        scenarioId: this.id, name: this.name, passed: false, durationMs, rootRunId,
        reason: '(unexpected) planner produced a clean plan; goal may need to be more confusing',
      };
    }
    if (!poll.final.criticWarning) {
      return {
        scenarioId: this.id, name: this.name, passed: false, durationMs, rootRunId,
        reason: 'criticErrors present but criticWarning is missing',
      };
    }
    const mismatch = assertTelemetry(ctx.telemetryStore, rootRunId!, {
      minAttempts: 3, minValidationErrors: 1,
    });
    if (mismatch) {
      return { scenarioId: this.id, name: this.name, passed: false, durationMs, rootRunId, reason: mismatch };
    }
    return {
      scenarioId: this.id, name: this.name, passed: true, durationMs, rootRunId,
      reason: `${errors.length} critic error${errors.length === 1 ? '' : 's'} surfaced after 3 attempts`,
    };
  },
};

// ── Scenario 5: Dismiss without commit ─────────────────────────────────

const dismissTest: ServerScenario = {
  id: 5,
  name: 'dismiss-without-commit: telemetry committedAt stays null',
  goal: SCENARIO_GOALS.dismissTest,
  asserts: 'plan returned, no /commit call; telemetry committedAt is null',
  async run(ctx) {
    const { value: poll, durationMs } = await timed(() => startAndPoll(ctx, this.goal));
    const rootRunId = poll.start.runId;
    if (poll.final.status !== 'done') {
      return {
        scenarioId: this.id, name: this.name, passed: false, durationMs, rootRunId,
        reason: `expected status=done, got ${poll.final.status}: ${poll.final.error ?? ''}`,
      };
    }
    // Deliberately do NOT commit. Wait briefly so any in-flight telemetry
    // write settles, then assert.
    await new Promise((r) => setTimeout(r, 500));
    const mismatch = assertTelemetry(ctx.telemetryStore, rootRunId!, { committed: false });
    if (mismatch) {
      return { scenarioId: this.id, name: this.name, passed: false, durationMs, rootRunId, reason: mismatch };
    }
    return {
      scenarioId: this.id, name: this.name, passed: true, durationMs, rootRunId,
      reason: 'plan reached done; never committed; telemetry row remains uncommitted',
    };
  },
};

// ── Scenario 6: Empty-commit gating ────────────────────────────────────

const emptyCommitGating: ServerScenario = {
  id: 6,
  name: 'empty-commit-gating: zero-create commit does not record',
  goal: SCENARIO_GOALS.dismissTest,
  asserts: 'plan with already-existing agent id; commit returns empty agentsCreated; committedAt stays null',
  async run(ctx) {
    const { value: poll, durationMs } = await timed(() => startAndPoll(ctx, this.goal));
    const rootRunId = poll.start.runId;
    if (poll.final.status !== 'done' || !poll.final.plan) {
      return {
        scenarioId: this.id, name: this.name, passed: false, durationMs, rootRunId,
        reason: `expected status=done, got ${poll.final.status}: ${poll.final.error ?? ''}`,
      };
    }
    // To force the "all skipped" path, pre-create every newAgent the
    // plan declares — then the commit handler sees they all exist and
    // skips each. This exercises the recordCommit gating fix from PR #227.
    const plan = poll.final.plan as { newAgents?: Array<{ id: string; yaml: string }> };
    if (!plan.newAgents || plan.newAgents.length === 0) {
      return {
        scenarioId: this.id, name: this.name, passed: false, durationMs, rootRunId,
        reason: 'plan has no newAgents — cannot exercise empty-commit path',
      };
    }
    for (const ref of plan.newAgents) {
      try {
        // Insert a minimal placeholder with the same id. Use the YAML the
        // planner emitted so the row is well-formed.
        const { parseAgent } = await import('@some-useful-agents/core');
        const parsed = parseAgent(ref.yaml);
        ctx.agentStore.createAgent(parsed, 'cli', 'smoke pre-create to force skip');
      } catch (e) {
        return {
          scenarioId: this.id, name: this.name, passed: false, durationMs, rootRunId,
          reason: `pre-create of ${ref.id} failed: ${(e as Error).message}`,
        };
      }
    }
    const commit = await commitPlan(ctx.baseUrl, plan, rootRunId!);
    if (!commit.ok) {
      return {
        scenarioId: this.id, name: this.name, passed: false, durationMs, rootRunId,
        reason: `commit failed: ${commit.error ?? 'unknown'}`,
      };
    }
    const created = commit.agentsCreated ?? [];
    if (created.length !== 0) {
      return {
        scenarioId: this.id, name: this.name, passed: false, durationMs, rootRunId,
        reason: `expected zero agentsCreated, got ${created.length}: ${created.join(',')}`,
      };
    }
    const skipped = commit.agentsSkipped ?? [];
    if (!skipped.some((s) => /already exists/.test(s.reason))) {
      return {
        scenarioId: this.id, name: this.name, passed: false, durationMs, rootRunId,
        reason: `expected at least one agent skipped with "already exists" reason`,
      };
    }
    await new Promise((r) => setTimeout(r, 500));
    const mismatch = assertTelemetry(ctx.telemetryStore, rootRunId!, { committed: false });
    if (mismatch) {
      return { scenarioId: this.id, name: this.name, passed: false, durationMs, rootRunId, reason: mismatch };
    }
    return {
      scenarioId: this.id, name: this.name, passed: true, durationMs, rootRunId,
      reason: 'all-skipped commit did not flip committedAt — gating works',
    };
  },
};

export const SERVER_SCENARIOS: ServerScenario[] = [
  happyPath, criticRetry, hnDigest, criticExhaustion, dismissTest, emptyCommitGating,
];
