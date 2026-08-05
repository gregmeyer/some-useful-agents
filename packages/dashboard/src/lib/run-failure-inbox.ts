import { explainNodeFailure, isLocalRunFailureInboxEnabled, type AddMessageInput, type InboxMessage, type InboxResponse, type InboxStore, type Run } from '@some-useful-agents/core';
import { temporalWorkflowLink } from './temporal-link.js';

export interface RunFailureInfo {
  run: Run;
  failedNodeId?: string;
  errorCategory?: string;
  /** Exit code of the failed node (shell nodes) — feeds the humanized explanation. */
  exitCode?: number | null;
  /** stderr / error text of the failed node — its last line names the cause. */
  error?: string;
}

/**
 * Build the inbox message for a failed run. Pure + exported so it can be
 * unit-tested without a store. `dedupeKey` follows the documented
 * `run-failure:<runId>` convention so a run only ever opens one conversation,
 * even if the failure path fires more than once.
 *
 * The `/runs/<id>` dashboard page is ALWAYS the primary link — it works for
 * every failure. We only mention Temporal (and offer a Temporal UI deep link)
 * when the run actually reached a durable workflow, i.e. `run.temporalRunId` is
 * set. A setup failure (gate rejected, worker never dispatched the workflow)
 * has `usedWorkflowProvider === 'temporal'` but NO `temporalRunId`, so sending
 * the operator to the Temporal UI to hunt for a `sua-node-…` workflow that was
 * never created is a dead end — for those we stop at the run page.
 */
export function buildRunFailureMessage(
  info: RunFailureInfo,
  dashboardBaseUrl?: string,
  namespace = 'default',
): AddMessageInput {
  const { run } = info;
  const runLink = dashboardBaseUrl ? `${dashboardBaseUrl.replace(/\/$/, '')}/runs/${run.id}` : `/runs/${run.id}`;
  // A real durable workflow exists only when we persisted its execution runId.
  const temporalLink = run.temporalRunId ? temporalWorkflowLink(run, namespace) : undefined;
  // Humanized one-line explanation when we know which node failed. run.error is
  // itself humanized at the source now, so only keep the raw `- Error:` line
  // when it adds something the explanation doesn't (no node info, or it differs).
  const explanation = info.failedNodeId
    ? explainNodeFailure({ nodeId: info.failedNodeId, category: info.errorCategory, exitCode: info.exitCode, error: info.error })
    : undefined;
  const lines = [
    temporalLink
      ? `Agent **${run.agentName}** failed a run on the Temporal worker.`
      : `Agent **${run.agentName}** failed a run.`,
    '',
    `- Run: [${run.id.slice(0, 8)}](${runLink})`,
    ...(explanation ? [`- ${explanation}`] : []),
    ...(run.error && run.error !== explanation ? [`- Error: ${run.error}`] : []),
    '',
    temporalLink
      ? `Open the [run page](${runLink}) for details, or [view the workflow in the Temporal UI](${temporalLink}).`
      : `Open the [run page](${runLink}) for details.`,
  ];
  return {
    priority: 'high',
    source: 'run-failure',
    title: temporalLink ? `Temporal run failed: ${run.agentName}` : `Run failed: ${run.agentName}`,
    body: lines.join('\n'),
    agentId: run.agentName,
    runId: run.id,
    dedupeKey: `run-failure:${run.id}`,
  };
}

/**
 * Result of raising a run failure into the inbox.
 * `coalesced: false` — a new thread was opened (or the per-run dedupe key
 * matched an existing one); callers may kick auto-first-touch triage on it.
 * `coalesced: true` — an existing active thread for the same agent absorbed
 * this failure as a system note (`response`); callers should publish the
 * `message:created` event on that thread rather than kicking triage — the
 * note is new conversation input, not a new thread.
 */
export interface RaisedRunFailure {
  message: InboxMessage;
  coalesced: boolean;
  response?: InboxResponse;
}

/** One-line system note appended when an active thread absorbs a repeat failure. */
export function buildCoalescedFailureNote(info: RunFailureInfo, dashboardBaseUrl?: string): string {
  const { run } = info;
  const runLink = dashboardBaseUrl ? `${dashboardBaseUrl.replace(/\/$/, '')}/runs/${run.id}` : `/runs/${run.id}`;
  const explanation = info.failedNodeId
    ? explainNodeFailure({ nodeId: info.failedNodeId, category: info.errorCategory, exitCode: info.exitCode, error: info.error })
    : run.error;
  return `Another run of **${run.agentName}** failed: [${run.id.slice(0, 8)}](${runLink})${explanation ? ` — ${explanation}` : ''}`;
}

/**
 * Raise (or no-op) an inbox conversation for a failed run. Historically
 * scoped to Temporal-worker runs; local in-process failures now raise too
 * (a scheduled agent failing at 3am is exactly what the inbox exists for) —
 * `SUA_INBOX_LOCAL_RUN_FAILURES=0` restores the old Temporal-only behavior.
 * Operator-cancelled runs never reach here (the executor only fires its
 * failure hook on `failed`, not `cancelled`).
 *
 * Noise control: when an ACTIVE (non-terminal) `run-failure` thread already
 * exists for the same agent, the failure is appended to that thread as a
 * system note instead of opening a new one — a crash-looping agent yields
 * one conversation with a visible failure frequency, not N threads and N
 * auto-triage turns. The per-run `dedupeKey` remains the second layer
 * (double-fired hooks for the same run never duplicate anything).
 *
 * Returns what happened (see RaisedRunFailure) or `undefined` when nothing
 * was raised (no store, gated off, or store failure).
 */
export function raiseRunFailureInbox(
  inboxStore: InboxStore | undefined,
  info: RunFailureInfo,
  dashboardBaseUrl?: string,
  namespace = 'default',
): RaisedRunFailure | undefined {
  if (!inboxStore) return undefined;
  // Internal one-shot helpers (the dashboard's inline `_yaml-fixer`, and the
  // build planner/surveyor/drafter agents) run under synthetic `_`-prefixed
  // ids. They are not user agents: a failure means "the helper couldn't run"
  // (e.g. its claude-code node hit `binary_missing` at setup), not "an agent
  // you own is broken." Raising a run-failure thread for them produces
  // un-actionable inbox noise and misleads triage into "install _yaml-fixer".
  // The originating build/fix UI surfaces helper failures inline instead.
  if (info.run.agentName.startsWith('_')) return undefined;
  if (info.run.usedWorkflowProvider !== 'temporal' && !isLocalRunFailureInboxEnabled()) return undefined;
  try {
    const active = inboxStore.findActiveByAgentAndSource(info.run.agentName, 'run-failure');
    if (active) {
      // Same run already recorded (hook double-fire, e.g. in-band raise then
      // boot re-raise) — no-op rather than duplicating. Covers all three
      // forms: this thread IS the run's thread, a dedupe-key thread exists
      // elsewhere, or the run was already absorbed as a coalesced note.
      const dedupeKey = `run-failure:${info.run.id}`;
      if (active.runId === info.run.id || inboxStore.findByDedupeKey(dedupeKey)) {
        return { message: active, coalesced: true };
      }
      const shortId = info.run.id.slice(0, 8);
      if (inboxStore.listResponses(active.id).some((r) => r.role === 'system' && r.body.includes(shortId))) {
        return { message: active, coalesced: true };
      }
      const response = inboxStore.addResponse(
        active.id,
        'system',
        buildCoalescedFailureNote(info, dashboardBaseUrl),
      );
      return { message: active, coalesced: true, response };
    }
    const message = inboxStore.add(buildRunFailureMessage(info, dashboardBaseUrl, namespace));
    return { message, coalesced: false };
  } catch {
    // Inbox creation is best-effort; never let it bubble into the run path.
    return undefined;
  }
}
