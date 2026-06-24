/**
 * Inbox triage / actions / extraction ENGINE.
 *
 * Extracted from inbox.ts: the triage agent spawner, the proposed-action
 * executor, the auto-propose / auto-commit helpers, and the learning
 * extractor. The D↔E call cycle (runTriageAgent ↔ runProposedAction /
 * maybeRefireTriage) lives entirely in this one file so no cross-file
 * import cycle is created — the route handlers in inbox.ts call into the
 * exported entry points only.
 */

import { randomUUID } from 'node:crypto';
import {
  executeAgentDag,
  extractPlanJson,
  extractTaggedJson,
  exportAgent,
  isAppleIntegrationEnabled,
  isTriageLearningsEnabled,
  parseAgent,
  slugifyDashboardName,
  allocateUserDashboardId,
  mutateSections,
  LEARNING_CATEGORIES,
  LEARNING_SCOPES,
  type Agent,
  type Run,
  type RunStatus,
  type InboxActionMeta,
  type InboxActionStatus,
  type InboxResponse,
  type LearningCategory,
  type LearningScope,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { maybeKickoffFirstRun } from './dashboard-first-run.js';
import { buildLlmSettingsSnapshot } from '../lib/llm-settings-snapshot.js';
import { autoFixYaml } from './run-now-build.js';
import { applyProviderPin } from './build-orchestrator.js';
import { loadTriageKernel, loadTriagePlaybook } from './triage-prompt.js';
import { resolveRunBackend } from '../lib/run-backend.js';
import {
  publishInboxEvent,
  addSystemMessage,
  latestUserRequest,
  localIsoNow,
  parseActionMeta,
  formatLearnings,
  formatConversationSnapshot,
  TRIAGE_REJECTION_RECOVERY_NOTE,
  PENDING_USER_REPLY_WINDOW_MS,
  TRIAGE_AGENT_ID,
  SYSTEM_AGENT_IDS,
} from './inbox-shared.js';
import {
  getSubAgentAllowlist,
  getRunnableCandidates,
  ensureSystemAgentCurrent,
  buildTriageCatalogJson,
  buildRunnableAgentSpecsJson,
  enrichAgentAnalyzerInputs,
  enrichAgentCatalogSearchInputs,
  enrichAgentBuilderInputs,
  extractAgentBuilderProviderPin,
  deriveRunFailureReason,
  collectRunSummary,
} from './inbox-catalog.js';
import {
  parseProposedActions,
  parseTriageLinks,
  hasRecoveryRefireSinceLastUser,
  postTriageFailureFallback,
  planTriageCrashRecovery,
  hasMatchingFailedAction,
} from './inbox-plan.js';
import { canRenderInlineInboxWidget } from './inbox-widgets.js';

/** Experimental learnings extractor — route-dispatched on thread resolve. */
const LEARNING_EXTRACTOR_AGENT_ID = 'inbox-learning-extractor';
/** Sources rich enough to learn from (agentId reliably present). */
const LEARNING_SOURCES: ReadonlySet<string> = new Set(['run-failure', 'permission-request']);
/** Cap a stored lesson; the extractor is told ~280, this is the hard limit. */
const LEARNING_MAX_CHARS = 600;

/**
 * Agent IDs that the inbox-triage agent is allowed to propose running
 * on the operator's behalf. Each entry that resolves to an installed
 * (or auto-importable) agent becomes available to triage. v1 keeps
 * this hardcoded — a future PR can move it to a per-area config.
 *
 * `agent-analyzer` is the agent behind the "Suggest improvements"
 * button on the agent detail page. When triage proposes it, the route
 * auto-injects AGENT_YAML (from the inbox message's agentId) +
 * LAST_RUN_OUTPUT, mirroring the analyze route at
 * `run-now-build.ts:415`.
 */
/**
 * Agents whose proposed-action cards are auto-approved when triage
 * emits them — they kick straight to `running` without waiting for an
 * operator click. The set is the proven safe chain: analyzer (read-only
 * diagnosis), editor (writes only the YAML diff already shown in the
 * card), catalog-search (read-only catalog probe). Anything outside
 * this set still requires manual Run.
 *
 * Operator can still skip an in-flight action via the standard
 * action-card controls, and the chevron/dismiss flows are unaffected.
 *
 * v1 keeps this hardcoded. A future PR can move it to a per-thread or
 * global override (`data/.sua/inbox-settings.json`) once a non-trivial
 * subset of operators want different defaults.
 */
const TRIAGE_AUTO_APPROVE_AGENTS: ReadonlySet<string> = new Set([
  'agent-analyzer',
  'agent-editor',
  'agent-catalog-search',
  'agent-builder',
  'dashboard-editor',
]);

/**
 * Agent IDs handled by the route directly rather than dispatched as a
 * sub-agent run. The "agent" entry here exists so the allowlist + UI
 * affordances behave consistently, but the actual side effect (e.g.
 * committing a YAML change via `agentStore.upsertAgent`) is performed
 * synchronously inside `runProposedAction`.
 */
const ROUTE_HANDLED_AGENTS: ReadonlySet<string> = new Set(['agent-editor', 'dashboard-editor']);

/**
 * Hard cap on `action`-role responses per inbox message. Triage gets a
 * follow-up turn after each action resolves; without a cap, a bad
 * prompt could fan out indefinitely. 10 is enough room for a few rounds
 * of "run X, summarize, run Y on the result" without going wild.
 */
const MAX_ACTIONS_PER_MESSAGE = 10;

/** Truncate the sub-agent run output that's stored in action meta. */
const ACTION_RESULT_PREVIEW_LIMIT = 500;

/**
 * Triage is "pending" — and the modal should keep polling — if any of:
 *   (a) the message has a triageRunId whose run is in flight,
 *   (b) the most recent response is from the user, posted in the
 *       last 30 seconds, with no later triage / system / action reply
 *       (covers the race between POST /respond returning 204 and the
 *       dag-executor inserting its run-store row), or
 *   (c) any `action`-role response on this message is in `running`
 *       state (the sub-agent is mid-flight; updates land via
 *       updateResponse and the modal should re-render).
 */
export function isTriagePending(
  ctx: ReturnType<typeof getContext>,
  message: { triageRunId?: string },
  responses: InboxResponse[],
): boolean {
  if (message.triageRunId) {
    try {
      const run = ctx.runStore.getRun(message.triageRunId);
      if (run && (run.status === 'pending' || run.status === 'running')) return true;
    } catch { /* ignore */ }
  }
  for (const r of responses) {
    if (r.role !== 'action') continue;
    const meta = parseActionMeta(r);
    if (meta?.status === 'running') return true;
  }
  if (responses.length === 0) return false;
  const last = responses[responses.length - 1];
  if (last.role !== 'user') return false;
  return Date.now() - last.createdAt < PENDING_USER_REPLY_WINDOW_MS;
}

/** Poll the shared run row until it reaches a terminal status (the worker
 * activity owns the lifecycle for durable runs). Returns the last-seen run on
 * timeout so a long build isn't mis-reported as failed prematurely. */
async function awaitRunTerminal(
  ctx: ReturnType<typeof getContext>,
  runId: string,
  capMs = 600_000,
): Promise<Run | null> {
  const terminal = new Set<RunStatus>(['completed', 'failed', 'cancelled']);
  const deadline = Date.now() + capMs;
  for (;;) {
    let run: Run | null;
    try { run = ctx.runStore.getRun(runId); } catch { run = null; }
    if (run && terminal.has(run.status)) return run;
    if (Date.now() >= deadline) return run;
    await new Promise((r) => setTimeout(r, 750));
  }
}

/**
 * Run a dispatched sub-agent to completion via the right backend.
 *
 * Temporal: submit the WHOLE DAG to the worker (submitDagRun) and poll the run
 * row to terminal — NOT per-node orchestration from the dashboard. Integration
 * tools (apple, csv, sqlite, postgres) only resolve where an IntegrationsStore
 * exists (the worker activity builds one), and the apple runner needs the GUI
 * worker's TCC grants; orchestrating here would fail to resolve or execute in
 * the grant-less dashboard. Local: no worker, so run in-process WITH the
 * integration/tool/agent stores. Either way the experimental Apple gate is
 * read from this (reliable) process and threaded to wherever the run lands.
 */
async function runDispatchedAgentToTerminal(
  ctx: ReturnType<typeof getContext>,
  agent: Agent,
  inputs: Record<string, string>,
): Promise<{ id: string; status: RunStatus; result?: string; error?: string }> {
  if (resolveRunBackend(ctx.provider, agent) === 'temporal' && ctx.provider.submitDagRun) {
    const submitted = await ctx.provider.submitDagRun(agent, {
      inputs,
      triggeredBy: 'dashboard',
      variablesPath: ctx.variablesPath,
      dataRoot: ctx.agentStore.dataRoot,
      llmProviders: buildLlmSettingsSnapshot(ctx)?.providers,
      allowUntrustedShell: ctx.allowUntrustedShell ? [...ctx.allowUntrustedShell] : undefined,
      experimentalApple: isAppleIntegrationEnabled(),
    });
    const final = await awaitRunTerminal(ctx, submitted.id);
    return {
      id: submitted.id,
      status: final?.status ?? 'failed',
      result: typeof final?.result === 'string' ? final.result : undefined,
      error: final?.error ?? (final ? undefined : 'Run did not finish within the dispatch window.'),
    };
  }
  const run = await executeAgentDag(
    agent,
    { triggeredBy: 'dashboard', inputs },
    {
      runStore: ctx.runStore,
      secretsStore: ctx.secretsStore,
      variablesStore: ctx.variablesStore,
      integrationsStore: ctx.integrationsStore,
      toolStore: ctx.toolStore,
      agentStore: ctx.agentStore,
      dataRoot: ctx.agentStore.dataRoot,
      llmSettings: buildLlmSettingsSnapshot(ctx),
      onRunFailure: ctx.onRunFailure,
      experimentalApple: isAppleIntegrationEnabled(),
    },
  );
  return {
    id: run.id,
    status: run.status,
    result: typeof run.result === 'string' ? run.result : undefined,
    error: run.error,
  };
}

/**
 * Execute a single proposed action: walks meta through `running`,
 * dispatches the sub-agent (on the Temporal worker when that's the backend),
 * then patches meta to `completed | failed` with run lineage + a short result
 * preview. When all proposed actions on the parent message have resolved (any
 * non-`proposed` state) AND at least one ran, re-fire triage so it can
 * summarize the outcome in the conversation.
 */
export async function runProposedAction(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
  response: InboxResponse,
  meta: InboxActionMeta,
): Promise<void> {
  if (!ctx.inboxStore) return;

  // The route handler already transitioned proposed → running
  // atomically (see /actions/:rid/run); meta passed in already
  // carries status='running' + startedAt.
  const startedAt = meta.startedAt ?? Date.now();

  // Route-handled agents (e.g. agent-editor) perform their side
  // effect synchronously inside the route — no DAG dispatch. The
  // YAML on disk for these agents is a stub that documents the
  // contract; the actual write happens here.
  if (ROUTE_HANDLED_AGENTS.has(meta.agentId)) {
    const result = await executeRouteHandledAgent(ctx, messageId, meta);
    const endedAt = Date.now();
    ctx.inboxStore.updateResponse(response.id, {
      metaJson: JSON.stringify({
        ...meta,
        status: result.status,
        startedAt,
        endedAt,
        resultSummary: result.summary,
        refusalReason: result.refusalReason,
      }),
    });
    publishInboxEvent(ctx, messageId, 'action:status', {
      responseId: response.id,
      status: result.status,
      agentId: meta.agentId,
      startedAt,
      endedAt,
      resultSummary: result.summary,
      refusalReason: result.refusalReason,
    });
    maybeRefireTriage(ctx, messageId);
    return;
  }

  const subAgent = ctx.agentStore.getAgent(meta.agentId);
  if (!subAgent) {
    const endedAt = Date.now();
    const refusalReason = `Agent "${meta.agentId}" is not installed.`;
    ctx.inboxStore.updateResponse(response.id, {
      metaJson: JSON.stringify({
        ...meta,
        status: 'failed',
        endedAt,
        refusalReason,
      }),
    });
    publishInboxEvent(ctx, messageId, 'action:status', {
      responseId: response.id,
      status: 'failed',
      agentId: meta.agentId,
      endedAt,
      refusalReason,
    });
    return;
  }

  // "Enable & run": the operator approved running an agent that hadn't
  // been granted inbox-run permission. The approval IS the grant — flip
  // permissions.inboxRunnable durably, then fall through to the normal
  // run. Idempotent if it's somehow already set. Revocable from the
  // agent's Config tab. Never auto-runs without this explicit approval.
  if (meta.grantsInboxRunnable && !subAgent.permissions?.inboxRunnable) {
    try {
      ctx.agentStore.upsertAgent(
        { ...subAgent, permissions: { ...subAgent.permissions, inboxRunnable: true } },
        'dashboard',
        'Granted inboxRunnable via inbox approve-to-run',
      );
      // Past-tense + no "running it now…": the grant note's created_at is
      // later than the action card (proposed earlier), so it renders BELOW
      // the run result. "Running it now…" then reads as if the run hasn't
      // happened — confusing the operator AND the follow-up triage turn into
      // "wait for the result" when it already finished. State only the durable
      // fact; the action card itself shows the run's outcome.
      const note = `Enabled **${subAgent.name}** to run from inbox threads — revoke any time in its Config tab.`;
      const sysReply = ctx.inboxStore.addResponse(messageId, 'system', note);
      publishInboxEvent(ctx, messageId, 'message:created', {
        responseId: sysReply.id, role: 'system', body: note, createdAt: sysReply.createdAt,
      });
    } catch { /* grant is best-effort — fall through and let the run proceed */ }
  }

  // Per-agent input enrichment. Triage's prompt context can't carry
  // heavyweight inputs (full agent YAMLs, catalog snapshots), so we
  // inject them here at action-run time based on agentId.
  //
  // Pre-flight the analyzer dispatch: if the inbox message's
  // referenced agent isn't installed locally, enrichment will leave
  // AGENT_YAML empty and the analyzer dies at input resolution with a
  // generic "Missing required input" — confusing for the operator
  // because it looks like a triage / analyzer bug rather than the
  // real cause (target agent not in the catalog). Refuse the dispatch
  // up front with a clear conversation message instead.
  let effectiveInputs = meta.inputs;
  if (meta.agentId === 'agent-analyzer') {
    const parentMessage = ctx.inboxStore.get(messageId);
    // The agent to analyze: an explicit AGENT_ID from triage (so it can analyze
    // ANY agent, e.g. one it just built, or on a manual thread) wins; otherwise
    // fall back to the thread's own target agent. Without this, the analyzer's
    // preflight node hard-fails (exit 1, "requires AGENT_YAML") whenever the
    // thread has no agentId — the bug that made every analyzer run on a manual
    // thread fail.
    const targetAgentId = meta.inputs.AGENT_ID?.trim() || parentMessage?.agentId;
    if (!targetAgentId) {
      const reason = `Can't run agent-analyzer — there's no agent to analyze on this thread. Tell me which installed agent to look at (or run it from its /agents/<id> page).`;
      const endedAt = Date.now();
      ctx.inboxStore.updateResponse(response.id, {
        metaJson: JSON.stringify({ ...meta, status: 'failed', startedAt, endedAt, refusalReason: reason }),
      });
      publishInboxEvent(ctx, messageId, 'action:status', {
        responseId: response.id, status: 'failed', agentId: meta.agentId, startedAt, endedAt, refusalReason: reason,
      });
      const sysReply = ctx.inboxStore.addResponse(messageId, 'system', reason);
      publishInboxEvent(ctx, messageId, 'message:created', {
        responseId: sysReply.id, role: 'system', body: reason, createdAt: sysReply.createdAt,
      });
      maybeRefireTriage(ctx, messageId);
      return;
    }
    if (!ctx.agentStore.getAgent(targetAgentId)) {
      const reason = `Can't dispatch agent-analyzer — the target agent "${targetAgentId}" is not installed in this catalog. Install it (e.g. from agents/examples or via the Agents → Import page) and try again.`;
      const endedAt = Date.now();
      ctx.inboxStore.updateResponse(response.id, {
        metaJson: JSON.stringify({
          ...meta,
          status: 'failed',
          startedAt,
          endedAt,
          refusalReason: reason,
        }),
      });
      publishInboxEvent(ctx, messageId, 'action:status', {
        responseId: response.id,
        status: 'failed',
        agentId: meta.agentId,
        startedAt,
        endedAt,
        refusalReason: reason,
      });
      const sysReply = ctx.inboxStore.addResponse(messageId, 'system', reason);
      publishInboxEvent(ctx, messageId, 'message:created', {
        responseId: sysReply.id,
        role: 'system',
        body: reason,
        createdAt: sysReply.createdAt,
      });
      maybeRefireTriage(ctx, messageId);
      return;
    }
    effectiveInputs = enrichAgentAnalyzerInputs(ctx, targetAgentId, meta.inputs);
  } else if (meta.agentId === 'agent-catalog-search') {
    effectiveInputs = enrichAgentCatalogSearchInputs(ctx, meta.inputs);
  } else if (meta.agentId === 'agent-builder') {
    effectiveInputs = enrichAgentBuilderInputs(ctx, meta.inputs);
  }

  // Provider pin from triage's action inputs. agent-builder is the
  // only consumer today — operator says "build it on apple" and triage
  // emits PROVIDER=apple-foundation-models. The pin runs first in the
  // waterfall; the global fallback chain still applies on classified
  // failures. Strip is already handled inside enrichAgentBuilderInputs.
  let dispatchAgent = subAgent;
  if (meta.agentId === 'agent-builder') {
    const providerPin = extractAgentBuilderProviderPin(meta.inputs);
    if (providerPin) dispatchAgent = applyProviderPin(subAgent, providerPin);
  }

  let runId: string | undefined;
  let nextStatus: InboxActionStatus = 'failed';
  let resultSummary: string | undefined;
  let refusalReason: string | undefined;
  let fullResult = '';
  try {
    const run = await runDispatchedAgentToTerminal(ctx, dispatchAgent, effectiveInputs);
    runId = run.id;
    if (run.status === 'completed') {
      nextStatus = 'completed';
      fullResult = run.result ?? '';
      resultSummary = fullResult.length > ACTION_RESULT_PREVIEW_LIMIT
        ? fullResult.slice(0, ACTION_RESULT_PREVIEW_LIMIT) + '…'
        : fullResult;
    } else {
      nextStatus = 'failed';
      refusalReason = deriveRunFailureReason(ctx, run.id, run.error ?? `Run ended in status ${run.status}.`);
    }
  } catch (err) {
    nextStatus = 'failed';
    refusalReason = err instanceof Error ? err.message : String(err);
  }
  const endedAt = Date.now();
  ctx.inboxStore.updateResponse(response.id, {
    metaJson: JSON.stringify({
      ...meta,
      status: nextStatus,
      startedAt,
      endedAt,
      runId,
      resultSummary,
      refusalReason,
    }),
  });
  publishInboxEvent(ctx, messageId, 'action:status', {
    responseId: response.id,
    status: nextStatus,
    agentId: meta.agentId,
    startedAt,
    endedAt,
    runId,
    resultSummary,
    refusalReason,
  });

  // After agent-analyzer completes successfully, look for a
  // `<yaml>...</yaml>` block in the `analyze` (or `fix`) node output —
  // NOT the run-level result, which is the trailing `validate` shell
  // node's `{valid:true}` JSON. If present + valid + targeting the
  // inbox message's agent, auto-propose an agent-editor action card
  // with the parsed YAML.
  if (meta.agentId === 'agent-analyzer' && nextStatus === 'completed' && runId) {
    maybeAutoProposeEditorAction(ctx, messageId, runId);
  } else if (meta.agentId === 'agent-builder' && nextStatus === 'completed' && runId) {
    maybeAutoProposeBuilderInstallAction(ctx, messageId, runId);
  }

  // After agent-builder completes, the designed agent only exists as a
  // `<yaml>` block in the run output — agent-builder validates but never
  // commits. Persist it (as a draft) so `/agents/<id>` actually resolves
  // and triage can propose running it. Without this the agent is a ghost:
  // triage reports success on a build that produced text, not a catalog
  // entry.
  if (meta.agentId === 'agent-builder' && nextStatus === 'completed' && runId) {
    maybeCommitBuiltAgent(ctx, messageId, runId);
  }

  maybeRefireTriage(ctx, messageId);
}

/**
 * Maximum number of consecutive auto-fired triage turns between
 * operator interventions. Each completed sub-agent action triggers a
 * triage refire (so triage can summarize what came back); if triage
 * then proposes another auto-approved action that completes, that's
 * another refire, etc. The cap prevents a runaway loop when triage
 * keeps proposing actions on its own. Reset when the operator posts
 * a user response.
 *
 * 5 is a comfortable headroom for analyzer → editor → catalog-search
 * chains while still catching pathological loops within a few turns.
 */
const MAX_AUTO_TRIAGE_TURNS = 5;

/** Delay before an auto-retry so a transient backend has a moment to recover. */
const TRIAGE_CRASH_RETRY_DELAY_MS = 2000;

/** Lazily-initialized per-message crash-retry counter (see DashboardContext). */
function triageCrashRetries(ctx: ReturnType<typeof getContext>): Map<string, number> {
  return (ctx.inboxTriageCrashRetries ??= new Map());
}

/** Clear a thread's crash-retry budget (a fresh user turn or a success). */
export function resetTriageCrashRetries(ctx: ReturnType<typeof getContext>, messageId: string): void {
  triageCrashRetries(ctx).delete(messageId);
}

/**
 * Count the number of `triage` responses since the most recent `user`
 * response (or message creation if no user reply yet). Drives the
 * auto-refire cap — the operator hitting Reply resets the counter so
 * fresh user input always gets a fresh budget.
 */
function countConsecutiveTriageTurns(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
): number {
  if (!ctx.inboxStore) return 0;
  const responses = ctx.inboxStore.listResponses(messageId);
  let count = 0;
  for (let i = responses.length - 1; i >= 0; i -= 1) {
    const r = responses[i];
    if (r.role === 'user') break;
    if (r.role === 'triage') count += 1;
  }
  return count;
}

/**
 * Commit the agent that agent-builder just designed. The build DAG
 * (design → validate → fix) emits a validated `<yaml>` block in the
 * `design` (or `fix`) node output but never writes to the catalog — the
 * dashboard wizard commits separately via `/agents/build/commit`. When a
 * build runs as an inbox action there's no such step, so the agent is a
 * ghost: `/agents/<id>` 404s and triage can't run it.
 *
 * This closes that gap: parse the YAML and upsert the agent as a DRAFT
 * (visible + runnable on demand, but not live/scheduled until the operator
 * reviews it). Emits a system note with a REAL link so the operator — and
 * triage's follow-up turn — see an agent that actually exists.
 *
 * Guards: never clobber an existing non-draft agent (a real user agent
 * sharing the id wins); skip silently when no parseable YAML is present.
 */
export function maybeCommitBuiltAgent(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
  builderRunId: string,
): void {
  if (!ctx.inboxStore) return;
  const execs = ctx.runStore.listNodeExecutions(builderRunId);
  // Prefer `fix` (runs only when validate found issues) over `design`.
  const fix = execs.find((e) => e.nodeId === 'fix' && e.status === 'completed');
  const design = execs.find((e) => e.nodeId === 'design' && e.status === 'completed');
  const source = (fix?.result ?? design?.result ?? '').toString();
  const match = source.match(/<yaml>\s*\n?([\s\S]*?)<\/yaml>/);
  if (!match) return;
  // Run the same repair the dashboard wizard applies before committing an
  // LLM-built agent. Most important here: autoFixYaml un-escapes `{ {` back to
  // `{{` in outputWidget.template / prompts — the template pipeline escapes
  // `{{` → `{ {` to prevent re-expansion, and without this repair the inbox path
  // persists the escaped form, so the widget renders a literal `{ {outputs.X}}`.
  const builtYaml = autoFixYaml(match[1].trim());
  if (builtYaml.length < 10) return;

  let parsed;
  try { parsed = parseAgent(builtYaml); } catch { return; }

  // Never overwrite a real (non-draft) agent that already owns this id.
  // A draft of the same id is fair game to re-commit (iterating a build).
  const existing = ctx.agentStore.getAgent(parsed.id);
  if (existing && existing.status !== 'draft') {
    const note = `Built **${parsed.name}** but an agent with id \`${parsed.id}\` already exists and is not a draft — not overwriting it. Review the build output and pick a different id if needed.`;
    const sysReply = ctx.inboxStore.addResponse(messageId, 'system', note);
    publishInboxEvent(ctx, messageId, 'message:created', {
      responseId: sysReply.id, role: 'system', body: note, createdAt: sysReply.createdAt,
    });
    return;
  }

  // Commit as a draft regardless of what status the YAML declared — an
  // LLM-designed agent should not go live or scheduled without review.
  // Stamp `permissions.inboxRunnable` so the draft is immediately runnable
  // from this thread via the runnable-agent model (getSubAgentAllowlist),
  // approval-gated — "build me an agent, now run it" in one thread.
  try {
    ctx.agentStore.upsertAgent(
      {
        ...parsed,
        status: 'draft',
        permissions: { ...parsed.permissions, inboxRunnable: true },
      },
      'import',
      `Auto-committed (draft) from inbox build on thread ${messageId}`,
    );
  } catch {
    return; // store rejected it (e.g. constraint) — leave the thread untouched
  }

  const href = `/agents/${parsed.id}`;
  const note = `Created **${parsed.name}** as a draft at ${href}. Review it, then approve a run to see its output here.`;
  const sysReply = ctx.inboxStore.addResponse(
    messageId,
    'system',
    note,
    JSON.stringify({ links: [{ label: `Open ${parsed.name}`, href }] }),
  );
  publishInboxEvent(ctx, messageId, 'message:created', {
    responseId: sysReply.id, role: 'system', body: note, createdAt: sysReply.createdAt,
  });
}

/** Hoisted from the end of `runProposedAction` so route-handled and
 *  DAG-dispatched paths share the same re-fire trigger.
 *
 *  Layer 3 of the triage follow-through plan: when a sub-agent action
 *  completes and resolves all outstanding actions on the thread,
 *  re-invoke triage so it can summarize the result and either propose
 *  the next step, mark `awaiting_user`, or mark resolved. The
 *  CONVERSATION snapshot already includes each action's status +
 *  resultSummary, so triage sees what came back without any new
 *  input plumbing.
 *
 *  The cap (MAX_AUTO_TRIAGE_TURNS) prevents runaway loops. When hit,
 *  we post a system note + mark the thread awaiting_user so the
 *  operator can decide whether to continue. */
function maybeRefireTriage(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
): void {
  if (!ctx.inboxStore) return;
  if (!(allActionsResolved(ctx, messageId) && atLeastOneActionExecuted(ctx, messageId))) return;
  if (countConsecutiveTriageTurns(ctx, messageId) >= MAX_AUTO_TRIAGE_TURNS) {
    const note = `Auto-follow-up paused after ${MAX_AUTO_TRIAGE_TURNS} consecutive triage turns. Reply or dismiss to continue.`;
    const sysReply = ctx.inboxStore.addResponse(messageId, 'system', note);
    publishInboxEvent(ctx, messageId, 'message:created', {
      responseId: sysReply.id, role: 'system', body: sysReply.body, createdAt: sysReply.createdAt,
    });
    try {
      ctx.inboxStore.updateStatus(messageId, 'awaiting_user');
    } catch { /* ignore */ }
    publishInboxEvent(ctx, messageId, 'state', { phase: 'done', since: Date.now() });
    return;
  }
  void runTriageAgent(ctx, messageId).catch(() => { /* swallow */ });
}

/**
 * Synchronous executor for agents listed in `ROUTE_HANDLED_AGENTS`:
 * `agent-editor` commits a YAML change via `agentStore.upsertAgent`, and
 * `dashboard-editor` writes a user dashboard via `dashboardsStore`. Each runs
 * after validation and returns the action's terminal status + a summary line
 * for the conversation thread.
 */
async function executeRouteHandledAgent(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
  meta: InboxActionMeta,
): Promise<{ status: InboxActionStatus; summary?: string; refusalReason?: string }> {
  if (meta.agentId === 'agent-editor') {
    return executeAgentEditor(ctx, messageId, meta);
  }
  if (meta.agentId === 'dashboard-editor') {
    return executeDashboardEditor(ctx, meta);
  }
  return {
    status: 'failed',
    refusalReason: `Route-handled agent "${meta.agentId}" has no executor.`,
  };
}

/**
 * Resolve a dashboard from a `target` that may be an exact id (`user:<slug>`,
 * `<pack>:<id>`) OR a human display name ("Morning Brief"). Tries: exact id,
 * then the user-namespaced slug of the name, then a case-insensitive name
 * match across all dashboards. Returns null when nothing matches (caller
 * creates). This is what prevents add-tile/create-by-name from minting a
 * duplicate of an existing dashboard.
 */
function resolveExistingDashboard(
  store: NonNullable<ReturnType<typeof getContext>['dashboardsStore']>,
  target: string,
) {
  const byId = store.getDashboard(target);
  if (byId) return byId;
  const wantSlugId = `user:${slugifyDashboardName(target)}`;
  const targetLc = target.trim().toLowerCase();
  for (const d of store.listDashboards()) {
    if (d.id === wantSlugId || d.name.trim().toLowerCase() === targetLc) return d;
  }
  return null;
}

/**
 * Execute a `dashboard-editor` action — the WRITE counterpart to `show-widget`.
 * Route-handled and synchronous (mirrors `executeAgentEditor`): mutates a user
 * dashboard via `ctx.dashboardsStore`. Two ops carried in `meta.inputs.op`:
 *
 *   create   — make an empty `user:<slug>` dashboard from a DASHBOARD name.
 *   add-tile — pin AGENT_ID's tile onto DASHBOARD (a name or an existing
 *              `user:<slug>` id), creating the dashboard if it doesn't exist,
 *              in section SECTION (default "Widgets").
 *
 * Dashboards only render tiles for agents that have a Pulse `signal`, so
 * add-tile refuses an agent without one (the kernel pre-filters via the
 * catalog's `hasSignal` flag; this is the backstop). On success the summary
 * embeds `/dashboards/<id>` — the refire turn turns that into a one-click link.
 */
export function executeDashboardEditor(
  ctx: ReturnType<typeof getContext>,
  meta: InboxActionMeta,
): { status: InboxActionStatus; summary?: string; refusalReason?: string } {
  if (!ctx.dashboardsStore) {
    return { status: 'failed', refusalReason: 'Dashboards store unavailable.' };
  }
  const store = ctx.dashboardsStore;
  const op = meta.inputs.op;

  if (op === 'create') {
    const name = (meta.inputs.DASHBOARD ?? '').trim();
    if (!name) return { status: 'failed', refusalReason: 'create requires a DASHBOARD name.' };
    // Idempotent: if a dashboard with this name/slug already exists, return it
    // rather than minting a near-duplicate `user:<slug>-<ts>`.
    const existing = resolveExistingDashboard(store, name);
    if (existing) {
      return { status: 'completed', summary: `Dashboard "${existing.name}" already exists — /dashboards/${existing.id}` };
    }
    const id = allocateUserDashboardId(name, (c) => Boolean(store.getDashboard(c)));
    store.upsertDashboard({ id, packId: null, name, layout: { sections: [] } });
    return { status: 'completed', summary: `Created dashboard "${name}" — /dashboards/${id}` };
  }

  if (op === 'add-tile') {
    const agentId = (meta.inputs.AGENT_ID ?? '').trim();
    const target = (meta.inputs.DASHBOARD ?? '').trim();
    const sectionTitle = (meta.inputs.SECTION ?? '').trim() || 'Widgets';
    if (!agentId || !target) {
      return { status: 'failed', refusalReason: 'add-tile requires AGENT_ID and DASHBOARD.' };
    }
    const agent = ctx.agentStore.getAgent(agentId);
    if (!agent) return { status: 'failed', refusalReason: `Agent "${agentId}" is not installed.` };
    if (!agent.signal) {
      return {
        status: 'failed',
        refusalReason: `${agent.name || agentId} has no Pulse signal, so it can't show as a dashboard tile. Dashboards display signal tiles only.`,
      };
    }

    // Resolve-or-create: target may be an existing dashboard id (`user:<slug>`,
    // `<pack>:<id>`) OR a display name like "Morning Brief". Resolving by name
    // is what keeps "add X to Morning Brief" from minting a duplicate when the
    // dashboard already exists under id `user:morning-brief`.
    let dash = resolveExistingDashboard(store, target);
    let id = dash?.id ?? target;
    let created = false;
    if (!dash) {
      id = allocateUserDashboardId(target, (c) => Boolean(store.getDashboard(c)));
      store.upsertDashboard({ id, packId: null, name: target, layout: { sections: [] } });
      dash = store.getDashboard(id)!;
      created = true;
    }

    // Dedupe: already on this dashboard (any section) → no-op success.
    if (dash.layout.sections.some((s) => s.agentIds.includes(agentId))) {
      return {
        status: 'completed',
        summary: `${agent.name || agentId} is already on "${dash.name}" — /dashboards/${id}`,
      };
    }

    const sections = mutateSections(dash.layout, (arr) => {
      let sec = arr.find((s) => s.title === sectionTitle);
      if (!sec) {
        sec = { title: sectionTitle, agentIds: [] };
        arr.push(sec);
      }
      sec.agentIds = [...sec.agentIds, agentId];
    });
    store.updateLayout(id, { sections });
    maybeKickoffFirstRun(ctx, agentId); // populate the freshly added blank tile

    return {
      status: 'completed',
      summary: `Added ${agent.name || agentId} to ${created ? 'new dashboard' : 'dashboard'} "${dash.name}" — /dashboards/${id}`,
    };
  }

  return { status: 'failed', refusalReason: `Unknown dashboard-editor op "${op}".` };
}

/**
 * Resolve a `show-widget` action: point it at the target agent's LATEST
 * COMPLETED run so the existing inline-widget render path
 * (`buildInlineActionWidgets`) displays that run's output widget. Pure lookup —
 * no dispatch, no run cost. Returns the resolved runId on success, or a clear
 * reason when there's nothing to show.
 */
export function resolveShowWidgetAction(
  ctx: ReturnType<typeof getContext>,
  meta: InboxActionMeta,
): { status: InboxActionStatus; runId?: string; summary?: string; refusalReason?: string } {
  const agent = ctx.agentStore.getAgent(meta.agentId);
  if (!agent) {
    return { status: 'failed', refusalReason: `Agent "${meta.agentId}" is not installed.` };
  }
  if (!canRenderInlineInboxWidget(agent)) {
    return { status: 'failed', refusalReason: `${agent.name || meta.agentId} has no inline output widget.` };
  }
  let latest;
  try {
    latest = ctx.runStore.listRuns({ agentName: meta.agentId, status: 'completed', limit: 1 })[0];
  } catch {
    latest = undefined;
  }
  if (!latest) {
    return { status: 'failed', refusalReason: `No completed run yet for ${agent.name || meta.agentId} — run it first.` };
  }
  return {
    status: 'completed',
    runId: latest.id,
    summary: `Latest output from ${agent.name || meta.agentId} · run ${latest.id.slice(0, 8)}.`,
  };
}

/**
 * True when a `show-widget` for `agentId` would re-render a run that is ALREADY
 * displayed inline in this thread. Triage tends to propose a show-widget right
 * after a run-agent action completes — but the run action's own completed
 * widget is already on screen, so the show-widget would draw the same run's
 * widget a second time. We resolve to the same "latest completed run" the
 * action would point at and check whether an earlier completed action
 * (run-agent OR a prior show-widget) on this thread already renders it inline.
 * Used to decline the redundant proposal before a duplicate card is created.
 */
export function showWidgetWouldDuplicate(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
  agentId: string,
): boolean {
  if (!ctx.inboxStore) return false;
  const agent = ctx.agentStore.getAgent(agentId);
  if (!agent || !canRenderInlineInboxWidget(agent)) return false;
  let latest;
  try {
    latest = ctx.runStore.listRuns({ agentName: agentId, status: 'completed', limit: 1 })[0];
  } catch {
    latest = undefined;
  }
  if (!latest) return false;
  for (const r of ctx.inboxStore.listResponses(messageId)) {
    if (r.role !== 'action') continue;
    const m = parseActionMeta(r);
    // Mirror buildInlineActionWidgets' render predicate: a completed action
    // pointing at this run renders its widget inline.
    if (m && m.status === 'completed' && m.runId === latest.id) return true;
  }
  return false;
}

/**
 * Apply a YAML change to an existing agent. Validates:
 *   - `AGENT_ID` input is present
 *   - `NEW_YAML` parses cleanly via `parseAgent`
 *   - parsed `id` matches `AGENT_ID` (prevents accidentally targeting
 *     the wrong agent if triage hallucinates an id mismatch)
 *
 * On success commits via `agentStore.upsertAgent` (creates a new
 * version — undo via the agent detail page). On failure leaves the
 * agent untouched and surfaces the reason in the action card.
 */
function executeAgentEditor(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
  meta: InboxActionMeta,
): { status: InboxActionStatus; summary?: string; refusalReason?: string } {
  const agentId = meta.inputs.AGENT_ID;
  const newYaml = meta.inputs.NEW_YAML;
  if (!agentId || !newYaml) {
    return {
      status: 'failed',
      refusalReason: 'agent-editor requires both AGENT_ID and NEW_YAML inputs.',
    };
  }
  let parsed;
  try {
    parsed = parseAgent(newYaml);
  } catch (err) {
    return {
      status: 'failed',
      refusalReason: `NEW_YAML failed validation: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (parsed.id !== agentId) {
    return {
      status: 'failed',
      refusalReason: `NEW_YAML parsed id "${parsed.id}" does not match AGENT_ID "${agentId}". Refusing the edit.`,
    };
  }
  try {
    ctx.agentStore.upsertAgent(parsed, 'dashboard', 'Inbox triage applied YAML fix');
  } catch (err) {
    return {
      status: 'failed',
      refusalReason: `upsertAgent failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const after = ctx.agentStore.getAgent(agentId);
  const version = after?.version ?? '?';
  const message = ctx.inboxStore?.get(messageId);
  const installed = !message?.agentId || message.agentId !== agentId;
  return {
    status: 'completed',
    summary: installed
      ? `Installed agent \`${agentId}\` at v${version}.`
      : `Updated agent \`${agentId}\` to v${version}.`,
  };
}

function extractYamlBlockFromRunNodes(
  ctx: ReturnType<typeof getContext>,
  runId: string,
  preferredNodeIds: readonly string[],
): string | undefined {
  const execs = ctx.runStore.listNodeExecutions(runId);
  for (const nodeId of preferredNodeIds) {
    const exec = execs.find((entry) => entry.nodeId === nodeId && entry.status === 'completed');
    const source = (exec?.result ?? '').toString();
    const match = source.match(/<yaml>\s*\n?([\s\S]*?)<\/yaml>/);
    if (!match) continue;
    const yaml = match[1].trim();
    if (yaml.length >= 10) return yaml;
  }
  return undefined;
}

/**
 * Extract a `<yaml>...</yaml>` block from agent-analyzer's run result, validate
 * it, and (if its id is an installed agent) auto-insert a proposed
 * `agent-editor` action card — the "approve the fix" button. Targets the YAML's
 * own agent id (the agent the analyzer corrected), so it works on manual
 * threads and when analyzing any agent, not just the thread's. Silently no-ops
 * if no yaml block is present, if it doesn't parse, if its agent isn't
 * installed, or if the per-message action cap has been hit.
 */
export function maybeAutoProposeEditorAction(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
  analyzerRunId: string,
): void {
  if (!ctx.inboxStore) return;
  const proposedYaml = extractYamlBlockFromRunNodes(ctx, analyzerRunId, ['fix', 'analyze']);
  if (!proposedYaml) return;
  let parsed;
  try { parsed = parseAgent(proposedYaml); } catch { return; }

  // The analyzer produces a corrected version of the agent it analyzed, so the
  // fix target is the YAML's own id. Resolve from there — NOT from
  // message.agentId, which is empty on a manual thread and wrong when analyzing
  // an agent other than the thread's (the #524 class of bug: it dropped the
  // approve card entirely). Only require that agent to be installed.
  if (!parsed.id || !ctx.agentStore.getAgent(parsed.id)) return;

  // Respect the cap so a chatty analyzer can't fan out unbounded edits.
  if (countActionsSinceLastUser(ctx, messageId) >= MAX_ACTIONS_PER_MESSAGE) return;

  // Avoid duplicate proposals if the same YAML was already proposed
  // and is still pending — operator might be mid-decision.
  for (const r of ctx.inboxStore.listResponses(messageId)) {
    if (r.role !== 'action') continue;
    const m = parseActionMeta(r);
    if (m && m.agentId === 'agent-editor'
      && (m.status === 'proposed' || m.status === 'running')
      && m.inputs.NEW_YAML === proposedYaml) return;
  }

  const action: InboxActionMeta = {
    kind: 'action',
    status: 'proposed',
    agentId: 'agent-editor',
    inputs: { AGENT_ID: parsed.id, NEW_YAML: proposedYaml },
    rationale: `Apply the YAML fix that agent-analyzer produced.`,
  };
  const editorResp = ctx.inboxStore.addResponse(
    messageId,
    'action',
    action.rationale!,
    JSON.stringify(action),
  );
  publishInboxEvent(ctx, messageId, 'action:created', {
    responseId: editorResp.id,
    agentId: action.agentId,
    rationale: action.rationale,
    inputs: action.inputs,
    createdAt: editorResp.createdAt,
  });
}

function maybeAutoProposeBuilderInstallAction(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
  builderRunId: string,
): void {
  if (!ctx.inboxStore) return;
  const rawYaml = extractYamlBlockFromRunNodes(ctx, builderRunId, ['fix', 'design']);
  if (!rawYaml) return;
  let parsed;
  try { parsed = parseAgent(rawYaml); } catch { return; }
  parsed = {
    ...parsed,
    permissions: {
      ...(parsed.permissions ?? {}),
      inboxRunnable: true,
    },
  };
  const proposedYaml = exportAgent(parsed);

  if (countActionsSinceLastUser(ctx, messageId) >= MAX_ACTIONS_PER_MESSAGE) return;

  for (const r of ctx.inboxStore.listResponses(messageId)) {
    if (r.role !== 'action') continue;
    const m = parseActionMeta(r);
    if (m && m.agentId === 'agent-editor'
      && (m.status === 'proposed' || m.status === 'running' || m.status === 'completed')
      && m.inputs.NEW_YAML === proposedYaml) return;
  }

  const alreadyInstalled = ctx.agentStore.getAgent(parsed.id);
  const rationale = alreadyInstalled
    ? `Apply the drafted update for \`${parsed.id}\`.`
    : `Install the drafted agent \`${parsed.id}\` into this catalog.`;
  const action: InboxActionMeta = {
    kind: 'action',
    status: 'proposed',
    agentId: 'agent-editor',
    inputs: { AGENT_ID: parsed.id, NEW_YAML: proposedYaml },
    rationale,
    ctaLabel: alreadyInstalled ? 'Apply draft' : 'Install draft',
  };
  const editorResp = ctx.inboxStore.addResponse(
    messageId,
    'action',
    rationale,
    JSON.stringify(action),
  );
  publishInboxEvent(ctx, messageId, 'action:created', {
    responseId: editorResp.id,
    agentId: action.agentId,
    rationale: action.rationale,
    inputs: action.inputs,
    createdAt: editorResp.createdAt,
  });
}

function allActionsResolved(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
): boolean {
  if (!ctx.inboxStore) return false;
  const responses = ctx.inboxStore.listResponses(messageId);
  for (const r of responses) {
    if (r.role !== 'action') continue;
    const m = parseActionMeta(r);
    if (m && (m.status === 'proposed' || m.status === 'running')) return false;
  }
  return true;
}

export function atLeastOneActionExecuted(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
): boolean {
  if (!ctx.inboxStore) return false;
  const responses = ctx.inboxStore.listResponses(messageId);
  for (const r of responses) {
    if (r.role !== 'action') continue;
    const m = parseActionMeta(r);
    // show-widget is a read-only snapshot, not an execution — it must not
    // count as "something ran" (else it would trigger a follow-up triage turn,
    // risking a show→refire→show loop).
    if (m?.mode === 'show-widget') continue;
    if (m && (m.status === 'completed' || m.status === 'failed')) return true;
  }
  return false;
}

/**
 * Count `action`-role responses SINCE the operator's last message. The cap
 * (MAX_ACTIONS_PER_MESSAGE) is a runaway-fan-out guard: it bounds how many
 * actions an AUTONOMOUS refire chain can produce without operator input. A fresh
 * user reply is genuine engagement, not runaway, so it resets the budget — a
 * long, actively-driven debugging thread isn't blocked, but triage still can't
 * silently fan out unbounded actions between replies.
 */
export function countActionsSinceLastUser(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
): number {
  if (!ctx.inboxStore) return 0;
  const responses = ctx.inboxStore.listResponses(messageId);
  let lastUserIdx = -1;
  for (let i = responses.length - 1; i >= 0; i--) {
    if (responses[i].role === 'user') { lastUserIdx = i; break; }
  }
  let n = 0;
  for (let i = lastUserIdx + 1; i < responses.length; i++) {
    if (responses[i].role === 'action') n++;
  }
  return n;
}

/**
 * After a thread is RESOLVED, distill a durable lesson via the
 * inbox-learning-extractor sub-agent and store it as a `pending` learning for
 * the operator to approve. Experimental + flag-gated. Cheapest-first gates keep
 * the common case free; only run-failure / permission-request threads with real
 * triage activity ever reach the (one) LLM call. Best-effort — never throws
 * into the resolve route.
 */
export async function maybeExtractLearning(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
): Promise<void> {
  if (!isTriageLearningsEnabled()) return;                 // global kill switch
  if (!ctx.inboxStore) return;
  const message = ctx.inboxStore.get(messageId);
  if (!message) return;
  if (!LEARNING_SOURCES.has(message.source)) return;       // only lesson-rich sources
  const responses = ctx.inboxStore.listResponses(messageId);
  if (!responses.some((r) => r.role === 'triage')) return; // nothing was triaged
  if (!ensureSystemAgentCurrent(ctx, LEARNING_EXTRACTOR_AGENT_ID, 'inbox learning extraction')) return;
  const extractor = ctx.agentStore.getAgent(LEARNING_EXTRACTOR_AGENT_ID);
  if (!extractor) return;

  try {
    const run = await runDispatchedAgentToTerminal(ctx, extractor, {
      MESSAGE_SOURCE: message.source,
      AGENT_ID: message.agentId ?? '',
      TERMINAL_STATE: 'resolved',
      CONVERSATION: formatConversationSnapshot(responses),
      CONTEXT_JSON: message.contextJson ?? '',
    });
    if (run.status !== 'completed' || !run.result) return;
    const json = extractTaggedJson(run.result, 'learning');
    if (!json) return;
    let parsed: { lesson?: unknown; category?: unknown; scope?: unknown };
    try { parsed = JSON.parse(json); } catch { return; }
    const lesson = typeof parsed.lesson === 'string' ? parsed.lesson.trim() : '';
    if (!lesson) return;                                    // null/empty ⇒ no durable lesson
    const category = (LEARNING_CATEGORIES as readonly string[]).includes(parsed.category as string)
      ? (parsed.category as LearningCategory) : undefined;
    const scope = (LEARNING_SCOPES as readonly string[]).includes(parsed.scope as string)
      ? (parsed.scope as LearningScope) : 'agent';
    const created = ctx.inboxStore.addLearning({
      source: message.source,
      agentId: message.agentId,
      scope,
      category,
      lesson: lesson.slice(0, LEARNING_MAX_CHARS),
      sourceMessageId: messageId,
      sourceRunId: message.triageRunId,
    });
    if (created) {
      publishInboxEvent(ctx, messageId, 'learning:created', {
        learningId: created.id, lesson: created.lesson, category: created.category,
      });
    }
  } catch (err) {
    process.stderr.write(`[inbox-learning] extraction failed for ${messageId}: ${(err as Error)?.message ?? err}\n`);
  }
}

/**
 * The agent a thread is ABOUT — for injecting run-awareness into triage.
 * Prefers the message's own target. On a manual thread (no target), walks the
 * actions newest-first and returns the real agent the latest one touched: for a
 * system/route-handled action (agent-analyzer/agent-editor/dashboard-editor)
 * that's `inputs.AGENT_ID`; for a `run-agent` action it's the action's agentId.
 * System pseudo-agents are skipped, and the candidate must be installed.
 */
export function resolveFocusAgentId(
  ctx: ReturnType<typeof getContext>,
  messageAgentId: string | undefined,
  responses: readonly InboxResponse[],
): string | undefined {
  if (messageAgentId) return messageAgentId;
  for (let i = responses.length - 1; i >= 0; i--) {
    if (responses[i].role !== 'action') continue;
    const m = parseActionMeta(responses[i]);
    if (!m) continue;
    const cand = (SYSTEM_AGENT_IDS.has(m.agentId) ? m.inputs.AGENT_ID : m.agentId)?.trim();
    if (cand && !SYSTEM_AGENT_IDS.has(cand) && ctx.agentStore.getAgent(cand)) return cand;
  }
  return undefined;
}

/**
 * Spawn the inbox-triage system agent for a message. Lazy-installs the
 * YAML on first call (mirrors layout-planner). After the run
 * completes, parses the `<plan>{...}</plan>` block and appends a
 * `triage`-role response to the conversation. Sets the message
 * status to `awaiting_user` so subsequent renders carry the
 * recommendation context.
 */
export async function runTriageAgent(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
): Promise<void> {
  if (!ctx.inboxStore) return;
  const message = ctx.inboxStore.get(messageId);
  if (!message) return;

  // Concurrent-triage guard. PR #425 added an in-flight controller
  // registry; if one already exists, an earlier triage run is mid-
  // flight and a second concurrent run would race against the
  // first's response + the message-status updates. The deferred
  // call lands in `inboxTriagePendingRefires`; the in-flight run's
  // `finally` block schedules a fresh triage turn after it clears
  // its own controller, so any reply the operator posted while
  // triage was thinking still gets a response. Operator can hit the
  // stop button to abandon the prior run if they want fresh.
  if (ctx.inboxTriageAbortControllers.has(messageId)) {
    ctx.inboxTriagePendingRefires.add(messageId);
    return;
  }

  // Auto-install + auto-refresh inbox-triage from the bundled YAML.
  // Pre-PR #399 this only handled the install case — operators who
  // installed inbox-triage before PR #395's VOICE-section update kept
  // emitting stage directions ("Reply with X: ...") in every triage
  // turn because the older prompt was still cached in the store.
  // Reuses the same diff-and-refresh helper that
  // getSubAgentAllowlist uses for the sub-agent allowlist.
  if (!ensureSystemAgentCurrent(ctx, TRIAGE_AGENT_ID, 'inbox triage')) {
    process.stderr.write(
      `[inbox-triage] could not load agent yaml from agents/examples/${TRIAGE_AGENT_ID}.yaml\n`,
    );
    return;
  }
  const triage = ctx.agentStore.getAgent(TRIAGE_AGENT_ID);
  if (!triage) return;

  // SSE: announce the thinking phase so connected clients can show
  // the witty waiting label immediately, without waiting for the
  // 1.5s poll heuristic to flip the indicator on.
  publishInboxEvent(ctx, messageId, 'triage:started', {});
  publishInboxEvent(ctx, messageId, 'state', { phase: 'thinking', since: Date.now() });

  // Build conversation snapshot for the prompt. For action-role rows,
  // include the structured status so the model can see what already
  // ran rather than just the rationale body.
  const responsesSnapshot = ctx.inboxStore.listResponses(messageId);
  const conversation = formatConversationSnapshot(responsesSnapshot);

  // The operator's latest real ask is the authoritative current intent.
  // MESSAGE_BODY is frozen at thread creation, so on a mid-thread pivot
  // (or an auto-follow-up turn after a pivot) it would otherwise pull
  // triage back to the original request. Falls back to the message body
  // when the operator hasn't replied yet (triage is first responder).
  const currentRequest = latestUserRequest(responsesSnapshot) ?? message.body;

  // Run-awareness: the agent this thread is ABOUT (the message's target, or the
  // most-recent agent a thread action touched). Inject its latest run output —
  // including a "MOST RECENT RUN FAILED" block — so triage can REPORT a failure
  // (node + error) directly instead of telling the operator to "run it and see".
  const focusAgentId = resolveFocusAgentId(ctx, message.agentId, responsesSnapshot);
  const focusAgentRun = focusAgentId ? collectRunSummary(ctx, focusAgentId) : '';

  const allowlist = getSubAgentAllowlist(ctx);
  const runnableAgentSpecs = buildRunnableAgentSpecsJson(ctx, allowlist);
  // Installed agents triage may propose running even though they aren't
  // granted yet — proposing one yields an approval-gated "Enable & run".
  const candidates = getRunnableCandidates(ctx);
  const candidateAgentSpecs = buildRunnableAgentSpecsJson(ctx, candidates);
  // Approved cross-thread lessons relevant to this thread (experimental).
  // Empty string when the flag is off → the kernel section degrades to a no-op.
  const relevantLearnings = isTriageLearningsEnabled()
    ? formatLearnings(ctx.inboxStore.listApprovedLearningsForTriage({ agentId: message.agentId, source: message.source }))
    : '';

  // Pre-generate the runId + AbortController so the cancel route
  // (/inbox/:id/triage/cancel) can find and abort the in-flight run
  // without scanning the runs table. Replace any prior in-flight
  // triage controller for this message — last writer wins, the
  // older run's abort will run to completion safely.
  const runId: string = randomUUID();
  const abortController = new AbortController();
  ctx.activeRuns.set(runId, abortController);
  ctx.inboxTriageAbortControllers.set(messageId, { runId, controller: abortController });
  // Set the triageRunId on the message immediately so the
  // run-detail page and the inbox modal can both point at the
  // in-flight run. We refresh the status post-run anyway.
  try {
    ctx.inboxStore.updateStatus(
      messageId,
      message.status === 'open' ? 'triaged' : message.status,
      { triageRunId: runId },
    );
  } catch { /* ignore — message may have been dismissed mid-flight */ }

  try {
    const runPromise = executeAgentDag(
      triage,
      {
        triggeredBy: 'dashboard',
        inputs: {
          MESSAGE_ID: message.id,
          MESSAGE_TITLE: message.title,
          MESSAGE_BODY: message.body,
          CURRENT_REQUEST: currentRequest,
          NOW: localIsoNow(),
          MESSAGE_PRIORITY: message.priority,
          MESSAGE_SOURCE: message.source,
          CONTEXT_JSON: message.contextJson ?? '',
          RELEVANT_LEARNINGS: relevantLearnings,
          CONVERSATION: conversation,
          FOCUS_AGENT: focusAgentId ?? '',
          FOCUS_AGENT_RUN: focusAgentRun,
          ALLOWED_SUB_AGENTS: allowlist.join(', '),
          RUNNABLE_AGENT_SPECS: runnableAgentSpecs,
          RUNNABLE_CANDIDATES: candidates.join(', '),
          RUNNABLE_CANDIDATE_SPECS: candidateAgentSpecs,
          // Trimmed installed-agent catalog (newest first) so triage can answer
          // recency / "what does agent X do" directly, with a link, instead of
          // dispatching agent-catalog-search for a simple lookup.
          AGENT_CATALOG: buildTriageCatalogJson(ctx, currentRequest),
          // Compose the prompt from fragments on disk: the shared kernel
          // (voice, action mechanics, <plan> schema) + the one playbook that
          // matches this thread's source. Deterministic — no classifier LLM.
          TRIAGE_KERNEL: loadTriageKernel(),
          SOURCE_PLAYBOOK: loadTriagePlaybook(message.source),
        },
        runId,
        signal: abortController.signal,
      },
      {
        runStore: ctx.runStore,
        secretsStore: ctx.secretsStore,
        variablesStore: ctx.variablesStore,
        dataRoot: ctx.agentStore.dataRoot,
        llmSettings: buildLlmSettingsSnapshot(ctx),
        spawnNode: ctx.workflowSpawnNode,
        onRunFailure: ctx.onRunFailure,
        // Forward token-level progress from the triage LLM node to
        // the SSE bus. Filtered to output_chunk so we don't spam
        // clients with turn_start / tool_use markers (those still
        // land in progressJson via the DB path). Other progress
        // types remain DB-only.
        inboxOnProgress: ({ nodeId, progress }) => {
          if (progress.type !== 'output_chunk') return;
          if (!progress.message) return;
          publishInboxEvent(ctx, messageId, 'triage:token', {
            nodeId,
            chunk: progress.message,
            at: Date.now(),
          });
        },
      },
    );
    const finished = await runPromise;
    void finished;

    // Operator-cancelled via the stop button? Bail without adding the
    // unfriendly "did not complete" continuation — the cancel route
    // already posted "Triage stopped by operator." and finalized the
    // run. Hits BOTH races: the executor returning 'failed' before
    // the cancel route force-updates to 'cancelled', and the executor
    // returning 'cancelled' cleanly. Either way, the signal-aborted
    // bit is the load-bearing operator-intent signal.
    if (abortController.signal.aborted) return;

    const run = runId ? ctx.runStore.getRun(runId) : null;
    // Also catch the case where the run row itself ended up cancelled
    // (e.g. /runs/:id/cancel hit by a sibling tab while we were
    // waiting) — same friendly silence.
    if (run?.status === 'cancelled') return;
    if (!run || run.status !== 'completed' || !run.result) {
      addSystemMessage(
        ctx,
        messageId,
        `Triage agent did not complete (${run?.status ?? 'unknown'}). ${run?.error ?? ''}`.trim(),
      );
      postTriageFailureFallback(ctx, message, ctx.inboxStore.listResponses(messageId));
      return;
    }
    const planJson = extractPlanJson(run.result);
    if (!planJson) {
      addSystemMessage(
        ctx,
        messageId,
        'Triage agent returned no <plan>…</plan> block; raw response was discarded.',
      );
      postTriageFailureFallback(ctx, message, ctx.inboxStore.listResponses(messageId));
      return;
    }
    let parsed: { recommendation?: unknown; verifyHint?: unknown; actions?: unknown; commitmentSummary?: unknown; links?: unknown };
    try {
      parsed = JSON.parse(planJson);
    } catch {
      addSystemMessage(ctx, messageId, 'Triage agent returned malformed JSON.');
      postTriageFailureFallback(ctx, message, ctx.inboxStore.listResponses(messageId));
      return;
    }
    const rec = typeof parsed.recommendation === 'string' ? parsed.recommendation.trim() : '';
    if (!rec || rec.length < 10 || rec.length > 2000) {
      const sysReply = ctx.inboxStore.addResponse(messageId, 'system', 'Triage agent recommendation failed validation.');
      publishInboxEvent(ctx, messageId, 'message:created', {
        responseId: sysReply.id, role: 'system', body: sysReply.body, createdAt: sysReply.createdAt,
      });
      postTriageFailureFallback(ctx, message, ctx.inboxStore.listResponses(messageId));
      return;
    }
    const verifyHint = typeof parsed.verifyHint === 'string' && parsed.verifyHint.trim()
      ? parsed.verifyHint.trim()
      : undefined;
    // Pending-work chip text. Only honored when this turn also
    // proposes at least one action (enforced post-action-parse below)
    // — a commitment with no job behind it is the prose-only failure
    // mode the chip exists to prevent.
    const commitmentRaw = typeof parsed.commitmentSummary === 'string'
      ? parsed.commitmentSummary.trim()
      : '';
    const commitmentSummary = commitmentRaw.length >= 3 && commitmentRaw.length <= 60
      ? commitmentRaw
      : undefined;
    const links = parseTriageLinks(parsed.links, (id) => Boolean(ctx.agentStore.getAgent(id)));
    const triageMeta: Record<string, string> = {};
    if (verifyHint) triageMeta.verifyHint = verifyHint;
    if (commitmentSummary) triageMeta.commitmentSummary = commitmentSummary;
    if (links.length > 0) triageMeta.links = JSON.stringify(links);
    const triageReply = ctx.inboxStore.addResponse(
      messageId,
      'triage',
      rec,
      Object.keys(triageMeta).length > 0 ? JSON.stringify(triageMeta) : undefined,
    );
    // The canonical "triage finished" signal. Clients use this to
    // replace any in-progress typewriter bubble (PR 4) with the
    // persisted entry.
    publishInboxEvent(ctx, messageId, 'triage:complete', {
      responseId: triageReply.id,
      role: 'triage',
      body: rec,
      verifyHint,
      commitmentSummary,
      createdAt: triageReply.createdAt,
    });

    // Parse + persist any proposed actions (only when allowlist is
    // non-empty). Refusals (out-of-allowlist or malformed) get a
    // single grouped `system` note so the operator can see what was
    // declined and why.
    // Enter when there are runnable sub-agents OR the plan summons a widget
    // (show-widget is read-only and isn't gated on the run allowlist, so it
    // works on threads with no runnable agents, e.g. a manual "show me X").
    const rawActionList = Array.isArray(parsed.actions) ? parsed.actions : [];
    const planHasShowWidget = rawActionList.some(
      (a) => a && typeof a === 'object' && (a as { type?: unknown }).type === 'show-widget',
    );
    // dashboard-editor is route-handled (not allowlist-gated), like show-widget,
    // so a "create me a dashboard" plan on a thread with no runnable agents must
    // still enter the action block.
    const planHasDashboardEditor = rawActionList.some(
      (a) => a && typeof a === 'object' && (a as { type?: unknown }).type === 'dashboard-editor',
    );
    if (allowlist.length > 0 || planHasShowWidget || planHasDashboardEditor) {
      const { accepted, rejected, deferred } = parseProposedActions(parsed.actions, allowlist, candidates);
      const dedupedAccepted: InboxActionMeta[] = [];
      for (const action of accepted) {
        if (action.mode === 'show-widget' && !ctx.agentStore.getAgent(action.agentId)) {
          rejected.push({ agentId: action.agentId, reason: 'agent is not installed' });
          continue;
        }
        if (action.mode === 'show-widget' && showWidgetWouldDuplicate(ctx, messageId, action.agentId)) {
          rejected.push({
            agentId: action.agentId,
            reason: 'its latest output is already shown in this thread',
          });
          continue;
        }
        if (hasMatchingFailedAction(ctx, messageId, action)) {
          rejected.push({
            agentId: action.agentId,
            reason: 'same action already failed on this thread; revise the inputs or choose a different next step',
          });
          continue;
        }
        dedupedAccepted.push(action);
      }
      const existing = countActionsSinceLastUser(ctx, messageId);
      const budget = Math.max(0, MAX_ACTIONS_PER_MESSAGE - existing);
      const toInsert = dedupedAccepted.slice(0, budget);
      const overflow = dedupedAccepted.length - toInsert.length;
      for (const action of toInsert) {
        const body = action.rationale
          ?? (action.mode === 'show-widget'
            ? `Show the latest output from \`${action.agentId}\`.`
            : `Run agent \`${action.agentId}\`.`);
        const actionResp = ctx.inboxStore.addResponse(messageId, 'action', body, JSON.stringify(action));
        publishInboxEvent(ctx, messageId, 'action:created', {
          responseId: actionResp.id,
          agentId: action.agentId,
          rationale: action.rationale,
          inputs: action.inputs,
          createdAt: actionResp.createdAt,
        });
        // show-widget resolves synchronously to the agent's latest completed
        // run (read-only, no dispatch) → proposed → completed/failed in one
        // step. No `running` phase (a zero-latency lookup), and NO refire (it's
        // a snapshot, not an outcome to summarize). The existing
        // buildInlineActionWidgets then renders the widget on the next fragment.
        if (action.mode === 'show-widget') {
          const resolved = resolveShowWidgetAction(ctx, action);
          const now = Date.now();
          const resolvedMeta: InboxActionMeta = {
            ...action,
            status: resolved.status,
            runId: resolved.runId,
            resultSummary: resolved.summary,
            refusalReason: resolved.refusalReason,
            startedAt: now,
            endedAt: now,
          };
          if (ctx.inboxStore.transitionActionStatus(actionResp.id, 'proposed', JSON.stringify(resolvedMeta))) {
            publishInboxEvent(ctx, messageId, 'action:status', {
              responseId: actionResp.id,
              status: resolved.status,
              agentId: action.agentId,
              runId: resolved.runId,
              resultSummary: resolved.summary,
              refusalReason: resolved.refusalReason,
              endedAt: now,
            });
          }
          continue;
        }
        // Auto-approve trusted system agents. The proposed -> running
        // transition is atomic via transitionActionStatus, so a
        // concurrent operator click on /run no-ops idempotently. The
        // chip Layer 1 added stays pulsing through the run; on
        // completion runProposedAction publishes the terminal
        // action:status event and (when all actions resolve) fires
        // the follow-up triage turn.
        if (TRIAGE_AUTO_APPROVE_AGENTS.has(action.agentId)) {
          const startedAt = Date.now();
          const runningMeta: InboxActionMeta = { ...action, status: 'running', startedAt };
          const claimed = ctx.inboxStore.transitionActionStatus(
            actionResp.id,
            'proposed',
            JSON.stringify(runningMeta),
          );
          if (claimed) {
            publishInboxEvent(ctx, messageId, 'action:status', {
              responseId: actionResp.id,
              status: 'running',
              agentId: action.agentId,
              startedAt,
            });
            const claimedResponse = ctx.inboxStore.getResponse(actionResp.id) ?? actionResp;
            void runProposedAction(ctx, messageId, claimedResponse, runningMeta).catch((err) => {
              process.stderr.write(`[inbox-triage] auto-approved action ${actionResp.id} crashed: ${(err as Error)?.message ?? err}\n`);
            });
          }
        }
      }
      const notes: string[] = [];
      for (const r of rejected) {
        notes.push(`Refused action on \`${r.agentId}\`: ${r.reason}.`);
      }
      if (overflow > 0) {
        notes.push(`Skipped ${overflow} additional proposed action${overflow === 1 ? '' : 's'} — ${MAX_ACTIONS_PER_MESSAGE} actions already ran since your last message. Reply to continue and the next steps can be proposed.`);
      }
      if (deferred.length > 0) {
        notes.push(`Holding ${deferred.length} more side-effecting action${deferred.length === 1 ? '' : 's'} until the one above completes — I'll propose the next once it's done.`);
      }
      if (notes.length > 0) {
        const sysReply = ctx.inboxStore.addResponse(messageId, 'system', notes.join('\n'));
        publishInboxEvent(ctx, messageId, 'message:created', {
          responseId: sysReply.id, role: 'system', body: sysReply.body, createdAt: sysReply.createdAt,
        });
      }
      if (rejected.length > 0
        && toInsert.length === 0
        && !hasRecoveryRefireSinceLastUser(ctx, messageId)
        && countConsecutiveTriageTurns(ctx, messageId) < MAX_AUTO_TRIAGE_TURNS) {
        addSystemMessage(ctx, messageId, TRIAGE_REJECTION_RECOVERY_NOTE);
        void runTriageAgent(ctx, messageId).catch(() => { /* swallow */ });
      }
    }

    try {
      ctx.inboxStore.updateStatus(messageId, 'awaiting_user', { recommendation: rec, triageRunId: runId });
    } catch { /* ignore */ }
    // A turn completed cleanly — the thread isn't in a crash loop, so refund
    // the auto-retry budget for any future transient failure.
    resetTriageCrashRetries(ctx, messageId);
    publishInboxEvent(ctx, messageId, 'state', { phase: 'done', since: Date.now() });
  } catch (err) {
    // Operator-cancelled exceptions look like crashes here (the
    // abort signal surfaces as a thrown error inside the executor).
    // Skip the "Triage agent crashed" system note — the cancel route
    // already posted "Triage stopped by operator." and the state:done
    // event below still fires so the modal clears its pending UI.
    if (!abortController.signal.aborted) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[inbox-triage] run failed: ${msg}\n${(err as Error)?.stack ?? ''}\n`);
      // A triage crash is almost always a transient infra failure (provider
      // hiccup, worker dispatch race, network). Don't strand the thread on the
      // first blip: auto-retry a bounded number of times with a short backoff,
      // and only post a terminal "crashed" note once the budget is spent. The
      // thread is left `awaiting_user` either way so it stays actionable (the
      // operator can reply or hit "ask triage" even if the retry never lands).
      const retries = triageCrashRetries(ctx);
      const used = retries.get(messageId) ?? 0;
      const { willRetry, noteBody } = planTriageCrashRecovery(used, msg);
      try {
        const sysReply = ctx.inboxStore.addResponse(messageId, 'system', noteBody);
        publishInboxEvent(ctx, messageId, 'message:created', {
          responseId: sysReply.id, role: 'system', body: sysReply.body, createdAt: sysReply.createdAt,
        });
      } catch { /* ignore */ }
      try { ctx.inboxStore.updateStatus(messageId, 'awaiting_user'); } catch { /* ignore */ }
      if (willRetry) {
        retries.set(messageId, used + 1);
        // Fire AFTER this run's `finally` clears the abort-controller guard
        // (the delay comfortably outlasts the synchronous teardown), so the
        // retry isn't deferred as a concurrent run.
        setTimeout(() => {
          void runTriageAgent(ctx, messageId).catch(() => { /* swallow — terminal note posts on final failure */ });
        }, TRIAGE_CRASH_RETRY_DELAY_MS);
      } else {
        retries.delete(messageId);
      }
    }
    publishInboxEvent(ctx, messageId, 'state', { phase: 'done', since: Date.now() });
  } finally {
    // Clear the abort-controller registry entries for this run.
    // Cancel-route already deletes activeRuns when it fires; this
    // covers the normal-completion path. Use ?-checks because a
    // re-entry would have already replaced the entry with a fresh
    // controller pointing at a newer runId.
    ctx.activeRuns.delete(runId);
    const existing = ctx.inboxTriageAbortControllers.get(messageId);
    if (existing && existing.runId === runId) {
      ctx.inboxTriageAbortControllers.delete(messageId);
    }
    // Drain a pending re-fire (queued while this run was holding the
    // guard). Use setImmediate so the new run starts AFTER the
    // current frame's state mutations settle and any SSE listeners
    // see this run's `state:done` before the next one's
    // `triage:started`. The cancel-aborted path skips the drain —
    // operator-cancelled means "stop responding," not "queue up the
    // next turn."
    if (!abortController.signal.aborted && ctx.inboxTriagePendingRefires.delete(messageId)) {
      setImmediate(() => {
        runTriageAgent(ctx, messageId).catch(() => { /* swallow */ });
      });
    }
  }
}
