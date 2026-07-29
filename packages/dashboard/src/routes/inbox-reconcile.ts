/**
 * Boot-time inbox reconciliation — the durable-recovery half of the inbox
 * autonomy loop (A2 of the series; A1 added the first-touch sweeper).
 *
 * All triage follow-through state is in-memory on ctx (abort controllers,
 * pending refires, crash budgets), so a dashboard restart mid-chain used to
 * strand threads: action cards stuck `running` forever, completed Temporal
 * runs whose results never landed, triage turns that died with the process.
 *
 * `reconcileInboxOnBoot` runs once, right after ctx creation (and after the
 * boot run-reaper, which it depends on — the reaper finalizes dead local
 * runs so actions can be settled against run-store truth). Per non-terminal
 * message:
 *
 *  1. Every `action`-role response stuck `running` is settled against its
 *     run row: terminal run → finalized through the same
 *     `finalizeActionFromOutcome` path as a live dispatch (post-processing
 *     hooks included); run missing / never recorded → failed with a
 *     restart-explaining reason; run genuinely in flight (Temporal worker
 *     owns it) → a resume waiter re-attaches and finalizes on completion.
 *  2. A thread whose triage turn died with the process (triageRunId
 *     non-terminal per the run store, last word is the operator's) gets a
 *     system note; when auto-triage is enabled, one bounded re-fire per
 *     message per boot re-runs triage. When it isn't, the thread is set
 *     `awaiting_user` so it surfaces in "Needs you" instead of sitting
 *     silently `open`/`triaged`.
 *
 * In-memory refire/crash-budget maps are deliberately NOT persisted or
 * reconstructed: refires are re-derivable from response state (step 2), and
 * resetting the crash budget at boot is safe — a restart is itself a
 * recovery. Paused threads are never re-fired (the persisted `paused`
 * column is exactly the restart-surviving form of Stop).
 *
 * Every per-message step is wrapped so one corrupt thread can't take down
 * boot. LLM spend is bounded: at most one triage re-fire per stranded
 * message, only when the auto-triage flag is on.
 */
import { isInboxAutoTriageEnabled, type InboxMessage, type Run } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { parseActionMeta, addSystemMessage, publishInboxEvent } from './inbox-shared.js';
import {
  awaitRunTerminal,
  finalizeActionFromOutcome,
  runTriageAgent,
  type ActionRunOutcome,
} from './inbox-engine.js';

type Ctx = ReturnType<typeof getContext>;

/** How many non-terminal threads one boot pass will look at. Far above any
 *  realistic active-inbox size; exists so a pathological store can't stall
 *  boot. */
const RECONCILE_SCAN_LIMIT = 1000;

const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export interface ReconcileResult {
  /** Actions settled from a terminal/missing run. */
  finalized: number;
  /** Resume waiters attached to genuinely in-flight (Temporal) runs. */
  resumed: number;
  /** Triage turns re-fired for threads stranded mid-triage. */
  refired: number;
}

/**
 * Reconcile inbox follow-through state against run-store truth after a
 * restart. Synchronous except for the detached resume waiters; never
 * throws.
 */
export function reconcileInboxOnBoot(ctx: Ctx): ReconcileResult {
  const result: ReconcileResult = { finalized: 0, resumed: 0, refired: 0 };
  if (!ctx.inboxStore) return result;
  let messages: InboxMessage[];
  try {
    // list() default filter = non-terminal (open/triaged/awaiting_user/verifying).
    messages = ctx.inboxStore.list({ limit: RECONCILE_SCAN_LIMIT });
  } catch {
    return result;
  }
  for (const message of messages) {
    try {
      reconcileMessage(ctx, message, result);
    } catch (err) {
      // One corrupt thread must not take down boot — log and move on.
      console.warn(
        `[inbox-reconcile] thread ${message.id} failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  if (result.finalized + result.resumed + result.refired > 0) {
    console.warn(
      `[inbox-reconcile] settled ${result.finalized} stranded action(s), ` +
      `re-attached ${result.resumed} in-flight run(s), re-fired triage on ${result.refired} thread(s).`,
    );
  }
  return result;
}

function reconcileMessage(ctx: Ctx, message: InboxMessage, result: ReconcileResult): void {
  const responses = ctx.inboxStore!.listResponses(message.id);
  let settledHere = 0;
  let resumedHere = 0;

  for (const response of responses) {
    const meta = parseActionMeta(response);
    if (!meta || meta.status !== 'running') continue;

    if (!meta.runId) {
      // Claimed running but the dispatch never recorded a run — the process
      // died between the claim and the run insert. Nothing to wait for.
      finalizeActionFromOutcome(ctx, message.id, response.id, meta, {
        status: 'failed',
        error: 'The dashboard restarted before this action’s run was recorded.',
      }, { refire: false });
      result.finalized += 1;
      settledHere += 1;
      continue;
    }

    let run: Run | null = null;
    try { run = ctx.runStore.getRun(meta.runId); } catch { /* treat as missing */ }

    if (run && !TERMINAL_RUN_STATUSES.has(run.status)) {
      // Genuinely still executing (a Temporal worker owns the lifecycle; the
      // boot reaper only finalizes dead LOCAL runs). Re-attach the same
      // await-then-finalize tail a live dispatch would have run.
      result.resumed += 1;
      resumedHere += 1;
      const runId = meta.runId;
      void (async () => {
        const final = await awaitRunTerminal(ctx, runId);
        const outcome: ActionRunOutcome = final
          ? { id: final.id, status: final.status, result: typeof final.result === 'string' ? final.result : undefined, error: final.error }
          : { id: runId, status: 'failed', error: 'Run did not finish within the dispatch window.' };
        finalizeActionFromOutcome(ctx, message.id, response.id, meta, outcome);
      })().catch((err) => {
        console.warn(`[inbox-reconcile] resume waiter for run ${runId} crashed:`, err instanceof Error ? err.message : String(err));
      });
      continue;
    }

    // Terminal run (boot reaper may have just finalized it) or no run row at
    // all — settle the card now. No refire: boot decides refires below,
    // gated on the auto-triage flag.
    const outcome: ActionRunOutcome = run
      ? { id: run.id, status: run.status, result: typeof run.result === 'string' ? run.result : undefined, error: run.error }
      : { id: meta.runId, status: 'failed', error: 'The dashboard restarted mid-action and the run record is gone.' };
    finalizeActionFromOutcome(ctx, message.id, response.id, meta, outcome, { refire: false });
    result.finalized += 1;
    settledHere += 1;
  }

  // Stranded triage turn: the thread's triage run died with the process
  // (non-terminal or missing per the run store) and the last word in the
  // conversation is the operator's — they asked, triage never answered.
  const strandedTriage = triageDiedMidTurn(ctx, message)
    && (responses.length === 0 || responses[responses.length - 1].role === 'user');

  // A thread with a resume waiter attached gets its refire from that
  // waiter's finalize when the run lands — a boot refire now would run
  // triage against a still-`running` action card.
  if ((strandedTriage || settledHere > 0) && resumedHere === 0 && !message.paused) {
    if (isInboxAutoTriageEnabled()) {
      // One bounded re-fire per message per boot. Enters through the normal
      // runTriageAgent, so every engine guard (turn cap, action cap,
      // one-write-per-turn) applies.
      addSystemMessage(ctx, message.id, 'The dashboard restarted mid-conversation — picking this back up.');
      void runTriageAgent(ctx, message.id).catch(() => { /* engine logs */ });
      result.refired += 1;
    } else if (strandedTriage) {
      // Without auto-triage, don't spend LLM turns at boot — but don't let
      // the thread sit silently either: surface it as "Your turn".
      addSystemMessage(ctx, message.id, 'The dashboard restarted while triage was thinking. Reply or Ask triage to continue.');
      try { ctx.inboxStore!.updateStatus(message.id, 'awaiting_user'); } catch { /* ignore */ }
      publishInboxEvent(ctx, message.id, 'state', { phase: 'done', since: Date.now() });
    }
  }
}

/** Did this thread's most recent triage turn die with the old process?
 *  True when triageRunId exists but its run is non-terminal (the poller
 *  died with the process; nothing will ever finalize it) or missing. */
function triageDiedMidTurn(ctx: Ctx, message: InboxMessage): boolean {
  if (!message.triageRunId) return false;
  try {
    const run = ctx.runStore.getRun(message.triageRunId);
    if (!run) return true;
    return !TERMINAL_RUN_STATUSES.has(run.status);
  } catch {
    return false;
  }
}
