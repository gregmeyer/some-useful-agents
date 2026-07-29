/**
 * Autonomous first-touch triage (flag-gated by `SUA_INBOX_AUTO_TRIAGE`).
 *
 * Two entry points close the "items sit `open` until a human pokes" gap:
 *
 * - `maybeAutoFirstTouch` — the low-latency path. Producers (run-failure
 *   raiser, etc.) call it right after inserting a message so triage starts
 *   within seconds. Best-effort and in-process only.
 * - `startInboxSweeper` — the durable path. A periodic sweep (same
 *   setInterval + unref + stop-fn shape as the stuck-run watchdog in
 *   index.ts) picks up anything the kick missed: a crash between insert and
 *   kick, or items created while the dashboard was down. The store query
 *   (`listAutoTriageCandidates`) is the work queue; "open with an empty
 *   conversation" is the eligibility test, so a sweep is idempotent — the
 *   first triage turn adds a response and moves status off `open`.
 *
 * The triage function is injected rather than imported so this lib module
 * doesn't reach into routes/ (and so tests can hand in a spy). All existing
 * engine guards (per-message concurrent-triage dedupe, 5-turn cap, action
 * cap, one-write-per-turn) apply unchanged — both paths enter through the
 * normal `runTriageAgent`.
 */
import { isInboxAutoTriageEnabled } from '@some-useful-agents/core';
import type { getContext } from '../context.js';

type Ctx = ReturnType<typeof getContext>;
export type TriageFn = (ctx: Ctx, messageId: string) => Promise<void>;

/** Sweep cadence. Matches the stuck-run watchdog's 30s heartbeat. */
export const AUTO_TRIAGE_SWEEP_INTERVAL_MS = 30_000;

/**
 * Minimum item age before the sweeper claims it. Gives the producers'
 * insert-hook kick first crack, so the common case starts triage in
 * milliseconds and the sweeper only handles the missed tail.
 */
export const AUTO_TRIAGE_MIN_AGE_MS = 20_000;

/**
 * Max first-touches per sweep. A backlog (boot after long downtime)
 * drains gradually instead of stampeding N concurrent LLM runs.
 */
export const AUTO_TRIAGE_MAX_PER_SWEEP = 3;

/**
 * Global in-flight triage ceiling. When this many triage runs are already
 * live, auto-first-touch stands down entirely (operator-initiated triage is
 * never gated — this only throttles the autonomous paths).
 */
export const AUTO_TRIAGE_MAX_CONCURRENT = 3;

/**
 * Fire-and-forget first-touch triage for a just-created message. Safe to
 * call unconditionally after any `inboxStore.add()` — every skip condition
 * is checked here: flag off, store absent, message gone, not `open`
 * (dedupe-key hit returned an already-touched row), operator-created,
 * operator-stopped, already in flight, already has responses, or too many
 * autonomous runs in flight.
 */
export function maybeAutoFirstTouch(ctx: Ctx, messageId: string, runTriage: TriageFn): boolean {
  if (!isInboxAutoTriageEnabled()) return false;
  if (!ctx.inboxStore) return false;
  if (ctx.inboxTriageAbortControllers.size >= AUTO_TRIAGE_MAX_CONCURRENT) return false;
  const message = ctx.inboxStore.get(messageId);
  if (!message) return false;
  if (message.status !== 'open') return false;
  if (message.source === 'manual') return false;
  if (ctx.inboxTriageStopped?.has(messageId)) return false;
  if (ctx.inboxTriageAbortControllers.has(messageId)) return false;
  if (ctx.inboxStore.listResponses(messageId).length > 0) return false;
  void runTriage(ctx, messageId).catch(() => { /* engine logs its own failures */ });
  return true;
}

/**
 * One sweep of the durable queue. Returns how many first-touches were
 * kicked (telemetry + tests). Never throws — a store hiccup skips the
 * sweep rather than killing the interval. `minAgeMs` is overridable for
 * tests only; production callers take the default.
 */
export function sweepInboxOnce(ctx: Ctx, runTriage: TriageFn, minAgeMs = AUTO_TRIAGE_MIN_AGE_MS): number {
  if (!isInboxAutoTriageEnabled() || !ctx.inboxStore) return 0;
  if (ctx.inboxTriageAbortControllers.size >= AUTO_TRIAGE_MAX_CONCURRENT) return 0;
  let candidates;
  try {
    candidates = ctx.inboxStore.listAutoTriageCandidates({
      olderThanMs: minAgeMs,
      limit: AUTO_TRIAGE_MAX_PER_SWEEP,
    });
  } catch {
    return 0;
  }
  let kicked = 0;
  for (const msg of candidates) {
    // Re-check the ceiling per kick: controller registration inside
    // runTriageAgent is async, so this is approximate — the per-message
    // dedupe guard in the engine is the hard backstop.
    if (ctx.inboxTriageAbortControllers.size + kicked >= AUTO_TRIAGE_MAX_CONCURRENT) break;
    if (ctx.inboxTriageStopped?.has(msg.id)) continue;
    if (ctx.inboxTriageAbortControllers.has(msg.id)) continue;
    void runTriage(ctx, msg.id).catch(() => { /* engine logs its own failures */ });
    kicked += 1;
  }
  return kicked;
}

/**
 * Start the periodic sweeper. Returns a stop function for `close()`.
 * Unref'd so it never keeps the process alive. The flag is checked per
 * sweep (not at start) so flipping the env var doesn't require a restart
 * decision here — with the flag off every sweep is a no-op.
 */
export function startInboxSweeper(ctx: Ctx, runTriage: TriageFn): () => void {
  const timer = setInterval(() => {
    try {
      sweepInboxOnce(ctx, runTriage);
    } catch (err) {
      console.warn('[inbox-sweeper] sweep failed:', err instanceof Error ? err.message : String(err));
    }
  }, AUTO_TRIAGE_SWEEP_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
