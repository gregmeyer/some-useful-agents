/**
 * Build-from-goal orchestrator.
 *
 * Replaces the legacy monolithic build-planner with a three-stage flow:
 *   1. goal-surveyor   — classifies intent + decomposes goal into fragments
 *   2. agent-drafter   — drafts ONE agent per fragment, fanned out in parallel
 *   3. dashboard-designer (optional) — designs the dashboard layout from the
 *      finalized agent-id list
 *
 * Sessions are kept in-process (a Map). Lifecycle:
 *   - POST /agents/build creates a session, kicks off the surveyor, returns the
 *     session-id (which the wizard polls as if it were a runId).
 *   - GET /agents/build/:id (in run-now-build.ts) calls advanceSession() to
 *     drive the state machine, then formats the response.
 *
 * /agents/draft-one uses the same machinery with a one-spec, no-surveyor,
 * no-designer fast path.
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import {
  executeAgentDag,
  extractPlanJson,
  extractSurveyJson,
  parseAgent,
  surveySchema,
  draftSchema,
  dashboardDesignSchema,
  buildPlanSchema,
  critiquePlan,
  formatCriticFeedback,
  type Agent,
  type BuildPlan,
  type Draft,
  type Survey,
  type DashboardDesign,
} from '@some-useful-agents/core';
import type { getContext } from '../context.js';

type Ctx = ReturnType<typeof getContext>;

const SURVEYOR_AGENT_ID = 'goal-surveyor';
const DRAFTER_AGENT_ID = 'agent-drafter';
const DESIGNER_AGENT_ID = 'dashboard-designer';

const SESSION_TTL_MS = 60 * 60 * 1000; // 1h
/**
 * How many TIMES each drafter is allowed to run (initial + N-1 retries).
 * On critic failure within budget the orchestrator kicks off a new drafter
 * run with the critic feedback appended to FOCUS. Mirrors the
 * MAX_CRITIC_RETRIES constant the legacy build-planner used.
 */
const MAX_DRAFT_ATTEMPTS = 3;

export type SessionPhase = 'survey' | 'drafting' | 'design' | 'assembling' | 'done' | 'failed';

interface BuildSession {
  id: string;
  goal: string;
  focus: string;
  createdAt: number;

  phase: SessionPhase;
  phaseMessage: string;

  surveyorRunId?: string;
  drafterRunIds: Map<string, string>; // fragmentKey -> runId
  drafterAttempts: Map<string, number>; // fragmentKey -> attempt count (1-indexed)
  designerRunId?: string;

  survey?: Survey;
  drafts: Map<string, Draft>;
  dashboard?: DashboardDesign;
  plan?: BuildPlan;
  error?: string;

  /** When true, this is a single-drafter /agents/draft-one session. Skip surveyor + designer. */
  draftOnly: boolean;
  /** Cached for /agents/draft-one — the spec the user requested. */
  draftOnlySpec?: { purpose: string; suggestedName?: string };
}

const sessions = new Map<string, BuildSession>();

function newSessionId(prefix = 'build'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Best-effort GC: drop sessions older than TTL on each create. Cheap because
 * we expect <100 concurrent sessions.
 */
function gcSessions(now: number = Date.now()): void {
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

// ── Agent kickoff helpers ──────────────────────────────────────────────

/**
 * Auto-import an example agent into the store on first use, then return it.
 * Mirrors the pattern in pulse-layout-plan.ts / dashboard-layout-plan.ts so
 * fresh installs work without the user running `sua agent install` manually.
 */
function loadExampleAgent(ctx: Ctx, agentId: string): Agent | null {
  try {
    const yamlPath = join(resolve('agents/examples'), `${agentId}.yaml`);
    const yamlText = readFileSync(yamlPath, 'utf-8');
    const parsed = parseAgent(yamlText);
    ctx.agentStore.upsertAgent(parsed, 'import', `Auto-imported for build orchestrator (${agentId})`);
  } catch { /* fall through — agent may already be installed */ }
  return ctx.agentStore.getAgent(agentId);
}

async function kickoffAgentRun(args: {
  ctx: Ctx;
  agent: Agent;
  inputs: Record<string, string>;
}): Promise<string | null> {
  const { ctx, agent, inputs } = args;
  // Pre-generate the run-id. Eliminates the race in the old code path
  // (which queried runStore for "most-recent run by agentName" — when
  // N parallel kickoffs target the same agent, the query returns the
  // same row for all N callers, so all N orchestrator sessions end up
  // polling the same drafter run). Passing runId in via DagExecuteOptions
  // means we know the id without ever needing the query.
  const runId = randomUUID();
  // Fire-and-forget: don't await the run completion here; callers poll
  // runStore later. Swallow errors so a startup failure doesn't reject
  // the kickoff promise — the polling path surfaces the failed run.
  executeAgentDag(
    agent,
    {
      triggeredBy: 'dashboard',
      inputs,
      runId,
    },
    {
      runStore: ctx.runStore,
      secretsStore: ctx.secretsStore,
      variablesStore: ctx.variablesStore,
      dataRoot: ctx.agentStore.dataRoot,
    },
  ).catch(() => { /* failure surfaces via runStore.getRun(runId).status */ });
  return runId;
}

// ── Catalog helpers ────────────────────────────────────────────────────

import {
  buildDiscoveryCatalog,
  listBuiltinTools,
  type ToolDefinition,
} from '@some-useful-agents/core';
import { TEMPLATE_REGISTRY } from '../views/pulse-templates.js';
import { formatToolCatalog, autoFixYaml } from './run-now-build.js';

function buildCatalogs(ctx: Ctx): { tools: string; discovery: string } {
  const builtins = listBuiltinTools();
  let userTools: ToolDefinition[] = [];
  try {
    if (ctx.toolStore) userTools = ctx.toolStore.listTools();
  } catch { /* tool store unavailable */ }
  return {
    tools: formatToolCatalog([...builtins, ...userTools]),
    discovery: buildDiscoveryCatalog({
      agents: ctx.agentStore.listAgents(),
      tools: [...builtins, ...userTools],
      templateRegistry: TEMPLATE_REGISTRY,
      dashboards: ctx.dashboardsStore?.listDashboards(),
      packs: ctx.packsStore?.listPacks(),
    }),
  };
}

function existingAgentIds(ctx: Ctx): Set<string> {
  try {
    return new Set(ctx.agentStore.listAgents().map((a) => a.id));
  } catch {
    return new Set();
  }
}

/**
 * Look up the original fragment spec ({ purpose, suggestedName? }) for a
 * given fragmentKey. Reads from session.survey.fragments for build sessions
 * or session.draftOnlySpec for /agents/draft-one sessions. Used during
 * critic-retry to re-kick a drafter with the same intent + fresh feedback.
 */
function resolveFragment(session: BuildSession, key: string): { purpose: string; suggestedName?: string } | null {
  if (session.draftOnly) {
    return session.draftOnlySpec ?? null;
  }
  if (!session.survey) return null;
  const match = /^fragment-(\d+)$/.exec(key);
  if (!match) return null;
  const idx = Number(match[1]);
  const fragment = session.survey.fragments[idx];
  if (!fragment) return null;
  return {
    purpose: fragment.purpose,
    ...(fragment.suggestedName ? { suggestedName: fragment.suggestedName } : {}),
  };
}

function appendFeedback(focus: string, feedback: string): string {
  return focus ? `${focus}\n\n${feedback}` : feedback;
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Start a build session from a free-form goal. Kicks off the goal-surveyor
 * and returns the session id (which the wizard polls as the runId).
 *
 * Returns null when the surveyor agent can't be loaded.
 */
export async function startBuildSession(args: {
  ctx: Ctx;
  goal: string;
  focus: string;
}): Promise<string | null> {
  const { ctx, goal, focus } = args;
  gcSessions();

  const surveyor = loadExampleAgent(ctx, SURVEYOR_AGENT_ID);
  if (!surveyor) return null;

  const { discovery } = buildCatalogs(ctx);
  const runId = await kickoffAgentRun({
    ctx,
    agent: surveyor,
    inputs: {
      GOAL: goal,
      FOCUS: focus,
      DISCOVERY_CATALOG: discovery,
    },
  });
  if (!runId) return null;

  const sessionId = newSessionId('build');
  sessions.set(sessionId, {
    id: sessionId,
    goal,
    focus,
    createdAt: Date.now(),
    phase: 'survey',
    phaseMessage: 'Surveying your goal...',
    surveyorRunId: runId,
    drafterRunIds: new Map(),
    drafterAttempts: new Map(),
    drafts: new Map(),
    draftOnly: false,
  });
  return sessionId;
}

/**
 * Start a single-drafter session from one spec. Used by /agents/draft-one
 * for the Improve-layout Path B inline-drafting flow. Skips surveyor and
 * designer — assembles a single-agent BuildPlan when the drafter finishes.
 */
export async function startDraftOneSession(args: {
  ctx: Ctx;
  purpose: string;
  suggestedName?: string;
  focus: string;
}): Promise<string | null> {
  const { ctx, purpose, suggestedName, focus } = args;
  gcSessions();

  const drafter = loadExampleAgent(ctx, DRAFTER_AGENT_ID);
  if (!drafter) return null;

  const { tools, discovery } = buildCatalogs(ctx);
  const existingIds = Array.from(existingAgentIds(ctx)).join(', ');

  const runId = await kickoffAgentRun({
    ctx,
    agent: drafter,
    inputs: {
      PURPOSE: purpose,
      SUGGESTED_NAME: suggestedName ?? '',
      FOCUS: focus,
      EXISTING_AGENT_IDS: existingIds,
      AVAILABLE_TOOLS: tools,
      DISCOVERY_CATALOG: discovery,
    },
  });
  if (!runId) return null;

  const sessionId = newSessionId('draft');
  const drafterRunIds = new Map<string, string>();
  drafterRunIds.set('fragment-0', runId);
  const drafterAttempts = new Map<string, number>();
  drafterAttempts.set('fragment-0', 1);
  sessions.set(sessionId, {
    id: sessionId,
    goal: purpose,
    focus,
    createdAt: Date.now(),
    phase: 'drafting',
    phaseMessage: 'Drafting agent...',
    drafterRunIds,
    drafterAttempts,
    drafts: new Map(),
    draftOnly: true,
    draftOnlySpec: { purpose, ...(suggestedName ? { suggestedName } : {}) },
  });
  return sessionId;
}

export function getSession(sessionId: string): BuildSession | undefined {
  return sessions.get(sessionId);
}

/**
 * Drive the session state machine. Called on each GET /agents/build/:id poll.
 * Idempotent — calling twice while in the same phase is a no-op.
 */
export async function advanceSession(ctx: Ctx, session: BuildSession): Promise<void> {
  if (session.phase === 'done' || session.phase === 'failed') return;

  if (session.phase === 'survey') return advanceSurvey(ctx, session);
  if (session.phase === 'drafting') return advanceDrafting(ctx, session);
  if (session.phase === 'design') return advanceDesign(ctx, session);
  if (session.phase === 'assembling') return advanceAssembling(session);
}

async function advanceSurvey(ctx: Ctx, session: BuildSession): Promise<void> {
  if (!session.surveyorRunId) {
    fail(session, 'Surveyor run was never started.');
    return;
  }
  const run = ctx.runStore.getRun(session.surveyorRunId);
  if (!run) {
    fail(session, 'Surveyor run record missing.');
    return;
  }
  if (run.status === 'running' || run.status === 'pending') return;
  if (run.status !== 'completed' || !run.result) {
    fail(session, run.error ?? `Surveyor failed (${run.status}).`);
    return;
  }

  const surveyJson = extractSurveyJson(run.result);
  if (!surveyJson) {
    fail(session, 'Surveyor did not produce a <survey>...</survey> block.');
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(surveyJson);
  } catch (e) {
    fail(session, `Survey JSON did not parse: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  const validated = surveySchema.safeParse(parsed);
  if (!validated.success) {
    const issues = validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    fail(session, `Survey failed validation: ${issues}`);
    return;
  }
  session.survey = validated.data;

  // No fragments → skip drafting. If intent is dashboard-existing, jump to
  // designer; if it's somehow "agent" with zero fragments, fail.
  if (session.survey.fragments.length === 0) {
    if (session.survey.intent === 'dashboard-existing') {
      await startDesignerStage(ctx, session);
    } else {
      fail(session, `Survey returned intent=${session.survey.intent} with no fragments to draft.`);
    }
    return;
  }

  // Fan out drafters in parallel.
  const knownIds = new Set<string>([...existingAgentIds(ctx)]);
  session.survey.matchedAgents.forEach((m) => knownIds.add(m.id));
  // Also reserve any suggestedName up front so drafters don't race on the same id.
  const reservedSuggestions = new Set<string>();
  session.survey.fragments.forEach((f) => {
    if (f.suggestedName && !knownIds.has(f.suggestedName)) {
      reservedSuggestions.add(f.suggestedName);
    }
  });

  const drafter = loadExampleAgent(ctx, DRAFTER_AGENT_ID);
  if (!drafter) {
    fail(session, 'Agent-drafter not found. Ensure agent-drafter.yaml exists in agents/examples/.');
    return;
  }

  const { tools, discovery } = buildCatalogs(ctx);

  // Kickoffs run in parallel. kickoffAgentRun now pre-generates the
  // run-id via randomUUID() + passes it to executeAgentDag, so each
  // caller gets a unique id without any runStore round-trip race.
  const kickoffs = session.survey.fragments.map(async (fragment, i) => {
    const own = fragment.suggestedName;
    const blocked = new Set(knownIds);
    reservedSuggestions.forEach((s) => {
      if (s !== own) blocked.add(s);
    });
    const runId = await kickoffAgentRun({
      ctx,
      agent: drafter,
      inputs: {
        PURPOSE: fragment.purpose,
        SUGGESTED_NAME: fragment.suggestedName ?? '',
        FOCUS: session.focus,
        EXISTING_AGENT_IDS: Array.from(blocked).join(', '),
        AVAILABLE_TOOLS: tools,
        DISCOVERY_CATALOG: discovery,
      },
    });
    return [`fragment-${i}`, runId] as const;
  });
  const results = await Promise.all(kickoffs);
  for (const [key, runId] of results) {
    if (!runId) {
      fail(session, `Failed to kick off drafter for ${key}.`);
      return;
    }
    session.drafterRunIds.set(key, runId);
    session.drafterAttempts.set(key, 1);
  }
  session.phase = 'drafting';
  session.phaseMessage = `Drafting ${session.drafterRunIds.size} agents in parallel...`;
}

async function advanceDrafting(ctx: Ctx, session: BuildSession): Promise<void> {
  let stillRunning = 0;
  const failedFragments: string[] = [];
  // Drafts that failed the critic AND still have retry budget. Queued so
  // we can fire fresh drafter kickoffs at the end of the pass.
  const retries: Array<{ key: string; feedback: string }> = [];

  for (const [key, runId] of session.drafterRunIds) {
    if (session.drafts.has(key)) continue; // already collected

    const run = ctx.runStore.getRun(runId);
    if (!run) {
      failedFragments.push(`${key}: run record missing`);
      continue;
    }
    if (run.status === 'running' || run.status === 'pending') {
      stillRunning += 1;
      continue;
    }
    if (run.status !== 'completed' || !run.result) {
      failedFragments.push(`${key}: ${run.error ?? run.status}`);
      continue;
    }

    const planJson = extractPlanJson(run.result);
    if (!planJson) {
      failedFragments.push(`${key}: no <plan>…</plan> block`);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(planJson);
    } catch (e) {
      failedFragments.push(`${key}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const validated = draftSchema.safeParse(parsed);
    if (!validated.success) {
      const issues = validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      failedFragments.push(`${key}: schema — ${issues}`);
      continue;
    }
    // Sanity: yaml parses + id matches. Run autoFixYaml first to absorb
    // common LLM mistakes (camelCase outputs, double-braces in shell nodes,
    // etc.) — same pre-processing the commit endpoint uses.
    const fixedYaml = autoFixYaml(validated.data.yaml);
    try {
      const a = parseAgent(fixedYaml);
      if (a.id !== validated.data.id) {
        // Treat id mismatch as a retry-able critique-style issue so the
        // drafter gets a chance to fix it (same retry budget as critic
        // failures). Common when the LLM drifts on its own SUGGESTED_NAME.
        const attempts = session.drafterAttempts.get(key) ?? 1;
        if (attempts < MAX_DRAFT_ATTEMPTS) {
          retries.push({
            key,
            feedback: `Critic feedback:\n- newAgents[0].yaml: declared id="${validated.data.id}" but the YAML's id field is "${a.id}". They MUST match exactly. Emit the id "${validated.data.id}" in both places.`,
          });
          continue;
        }
        failedFragments.push(`${key}: parsed YAML id "${a.id}" ≠ plan id "${validated.data.id}" (after ${attempts} attempts)`);
        continue;
      }
    } catch (e) {
      // YAML parse failure: the LLM produced text that doesn't even parse
      // as YAML (typically a multi-line shell command without `|` block
      // scalar, or unbalanced quotes inside an inline python -c). Feed
      // the parser's exact error back as critic-style feedback so the
      // retry has a concrete target.
      const parseError = e instanceof Error ? e.message : String(e);
      const attempts = session.drafterAttempts.get(key) ?? 1;
      if (attempts < MAX_DRAFT_ATTEMPTS) {
        retries.push({
          key,
          feedback: `Critic feedback:\n- newAgents[0].yaml: failed to parse as YAML — ${parseError}\n  Common cause: a multi-line shell command body (e.g. inline \`python3 -c "..."\`) without the YAML literal block scalar. Wrap the body in \`command: |\` with the script indented uniformly underneath. NEVER put a multi-line string after \`command:\` on the same line.`,
        });
        continue;
      }
      failedFragments.push(`${key}: YAML parse (after ${attempts} attempts) — ${parseError}`);
      continue;
    }

    // Structural critic pass. We wrap this drafter's output in a synthetic
    // single-agent BuildPlan so critiquePlan can apply its newAgent walk
    // (cross-refs + ai-template path checks). When the critic finds issues
    // AND we still have retry budget, queue a fresh drafter kickoff with
    // criticFeedback appended to FOCUS instead of accepting the draft.
    const candidateDraft = { ...validated.data, yaml: fixedYaml };
    const synthetic = buildPlanSchema.safeParse({
      intent: 'agent' as const,
      summary: candidateDraft.purpose,
      survey: { matchedAgents: [], missingFor: [candidateDraft.purpose], existingDashboards: [] },
      newAgents: [candidateDraft],
      dashboard: null,
      questions: [],
    });
    if (synthetic.success) {
      const critique = critiquePlan(synthetic.data, { existingAgentIds: existingAgentIds(ctx) });
      if (!critique.ok) {
        const attempts = session.drafterAttempts.get(key) ?? 1;
        if (attempts < MAX_DRAFT_ATTEMPTS) {
          retries.push({ key, feedback: formatCriticFeedback(critique.errors) });
          continue;
        }
        // Exhausted budget — surface the critic errors as the failure.
        failedFragments.push(`${key}: critic (after ${attempts} attempts) — ${critique.errors.map((e) => e.message).join(' | ')}`);
        continue;
      }
    }

    // Persist the autofixed YAML so the commit endpoint doesn't re-fix
    // (or, worse, accept a draft we already fixed and stored as-is).
    session.drafts.set(key, candidateDraft);
  }

  // Fire retries (parallel — kickoffAgentRun uses caller-supplied runIds
  // now so the old race is gone).
  if (retries.length > 0) {
    const drafter = loadExampleAgent(ctx, DRAFTER_AGENT_ID);
    if (!drafter) {
      fail(session, 'Agent-drafter not found while attempting retry.');
      return;
    }
    const { tools, discovery } = buildCatalogs(ctx);
    const knownIds = existingAgentIds(ctx);
    // Reserve sibling drafted ids so the retry doesn't collide.
    for (const d of session.drafts.values()) knownIds.add(d.id);

    const retryKickoffs = retries.map(async ({ key, feedback }) => {
      const spec = resolveFragment(session, key);
      if (!spec) return [key, null] as const;
      const blocked = new Set(knownIds);
      const newRunId = await kickoffAgentRun({
        ctx,
        agent: drafter,
        inputs: {
          PURPOSE: spec.purpose,
          SUGGESTED_NAME: spec.suggestedName ?? '',
          FOCUS: appendFeedback(session.focus, feedback),
          EXISTING_AGENT_IDS: Array.from(blocked).join(', '),
          AVAILABLE_TOOLS: tools,
          DISCOVERY_CATALOG: discovery,
        },
      });
      return [key, newRunId] as const;
    });
    const retryResults = await Promise.all(retryKickoffs);
    for (const [key, newRunId] of retryResults) {
      if (!newRunId) {
        failedFragments.push(`${key}: failed to start retry`);
        continue;
      }
      session.drafterRunIds.set(key, newRunId);
      session.drafterAttempts.set(key, (session.drafterAttempts.get(key) ?? 1) + 1);
    }
  }

  session.phaseMessage = retries.length > 0
    ? `Retrying ${retries.length} drafter${retries.length === 1 ? '' : 's'} with critic feedback...`
    : `Drafting agents... (${session.drafts.size}/${session.drafterRunIds.size} done)`;

  if (stillRunning > 0 || retries.length > 0) return;

  if (failedFragments.length > 0) {
    fail(session, `Drafter(s) failed: ${failedFragments.join(' | ')}`);
    return;
  }

  // All drafters done. Decide next stage.
  if (session.draftOnly) {
    assembleAgentOnlyPlan(session);
    return;
  }
  if (!session.survey) {
    fail(session, 'Drafting completed without a survey — invariant violation.');
    return;
  }
  if (session.survey.intent === 'agent') {
    assembleAgentOnlyPlan(session);
    return;
  }
  // dashboard-* → designer.
  await startDesignerStage(ctx, session);
}

async function startDesignerStage(ctx: Ctx, session: BuildSession): Promise<void> {
  if (!session.survey) {
    fail(session, 'Designer stage entered without a survey — invariant violation.');
    return;
  }
  const designer = loadExampleAgent(ctx, DESIGNER_AGENT_ID);
  if (!designer) {
    fail(session, 'Dashboard-designer not found. Ensure dashboard-designer.yaml exists in agents/examples/.');
    return;
  }
  const allAgentIds = [
    ...session.survey.matchedAgents.map((a) => a.id),
    ...Array.from(session.drafts.values()).map((d) => d.id),
  ];
  const descriptions = [
    ...session.survey.matchedAgents.map((a) => ({ id: a.id, purpose: a.matchedFor })),
    ...Array.from(session.drafts.values()).map((d) => ({ id: d.id, purpose: d.purpose })),
  ];
  const runId = await kickoffAgentRun({
    ctx,
    agent: designer,
    inputs: {
      INTENT: session.survey.intent,
      GOAL: session.goal,
      AGENT_IDS: allAgentIds.join(', '),
      AGENT_DESCRIPTIONS: JSON.stringify(descriptions),
    },
  });
  if (!runId) {
    fail(session, 'Failed to kick off dashboard-designer.');
    return;
  }
  session.designerRunId = runId;
  session.phase = 'design';
  session.phaseMessage = 'Designing dashboard layout...';
}

async function advanceDesign(ctx: Ctx, session: BuildSession): Promise<void> {
  if (!session.designerRunId) {
    fail(session, 'Designer stage entered without a runId — invariant violation.');
    return;
  }
  const run = ctx.runStore.getRun(session.designerRunId);
  if (!run) {
    fail(session, 'Designer run record missing.');
    return;
  }
  if (run.status === 'running' || run.status === 'pending') return;
  if (run.status !== 'completed' || !run.result) {
    fail(session, run.error ?? `Designer failed (${run.status}).`);
    return;
  }
  const planJson = extractPlanJson(run.result);
  if (!planJson) {
    fail(session, 'Designer did not produce a <plan>...</plan> block.');
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(planJson);
  } catch (e) {
    fail(session, `Designer JSON did not parse: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  const validated = dashboardDesignSchema.safeParse(parsed);
  if (!validated.success) {
    const issues = validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    fail(session, `Dashboard design failed validation: ${issues}`);
    return;
  }
  session.dashboard = validated.data;
  session.phase = 'assembling';
  session.phaseMessage = 'Assembling plan...';
  advanceAssembling(session);
}

function advanceAssembling(session: BuildSession): void {
  if (!session.survey) {
    fail(session, 'Assembling without a survey — invariant violation.');
    return;
  }
  const plan: BuildPlan = {
    intent: session.survey.intent,
    summary: session.survey.summary,
    survey: {
      matchedAgents: session.survey.matchedAgents,
      missingFor: session.survey.fragments.map((f) => f.purpose),
      existingDashboards: session.survey.existingDashboards,
    },
    newAgents: Array.from(session.drafts.values()),
    dashboard: session.dashboard
      ? {
          id: session.dashboard.id,
          name: session.dashboard.name,
          sections: session.dashboard.sections,
        }
      : null,
    questions: session.survey.questions,
  };
  const validated = buildPlanSchema.safeParse(plan);
  if (!validated.success) {
    const issues = validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    fail(session, `Assembled BuildPlan failed validation: ${issues}`);
    return;
  }
  session.plan = validated.data;
  session.phase = 'done';
  session.phaseMessage = 'Done.';
}

function assembleAgentOnlyPlan(session: BuildSession): void {
  const drafts = Array.from(session.drafts.values());
  if (drafts.length === 0) {
    fail(session, 'No drafted agents to assemble.');
    return;
  }
  const plan: BuildPlan = {
    intent: 'agent',
    summary: session.draftOnly
      ? `Drafted ${drafts[0].id}: ${drafts[0].purpose}`
      : `Drafted ${drafts.length} agent${drafts.length === 1 ? '' : 's'}.`,
    survey: {
      matchedAgents: session.survey?.matchedAgents ?? [],
      missingFor: drafts.map((d) => d.purpose),
      existingDashboards: session.survey?.existingDashboards ?? [],
    },
    newAgents: drafts,
    dashboard: null,
    questions: session.survey?.questions ?? [],
  };
  const validated = buildPlanSchema.safeParse(plan);
  if (!validated.success) {
    const issues = validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    fail(session, `Assembled single-agent BuildPlan failed validation: ${issues}`);
    return;
  }
  session.plan = validated.data;
  session.phase = 'done';
  session.phaseMessage = 'Done.';
}

function fail(session: BuildSession, error: string): void {
  session.phase = 'failed';
  session.error = error;
  session.phaseMessage = error;
}

/**
 * Per-drafter progress for the wizard UI. Returns null when the session has
 * no drafters yet (still in survey).
 */
export function drafterProgress(ctx: Ctx, session: BuildSession): Array<{
  key: string;
  status: 'running' | 'done' | 'failed';
  id?: string;
  purpose?: string;
}> | null {
  if (session.drafterRunIds.size === 0) return null;
  const rows: Array<{ key: string; status: 'running' | 'done' | 'failed'; id?: string; purpose?: string }> = [];
  for (const [key, runId] of session.drafterRunIds) {
    const draft = session.drafts.get(key);
    if (draft) {
      rows.push({ key, status: 'done', id: draft.id, purpose: draft.purpose });
      continue;
    }
    const run = ctx.runStore.getRun(runId);
    if (!run) {
      rows.push({ key, status: 'failed' });
      continue;
    }
    if (run.status === 'running' || run.status === 'pending') {
      rows.push({ key, status: 'running' });
    } else if (run.status === 'completed') {
      // Completed but not yet parsed into drafts map (advanceDrafting hasn't run)
      rows.push({ key, status: 'running' });
    } else {
      rows.push({ key, status: 'failed' });
    }
  }
  return rows;
}
