/**
 * Experimental-feature gates.
 *
 * Some capabilities ship in the published package but stay dormant until
 * the owner opts in — so the code rides along through CI on `main` without
 * being live by default. The Apple Reminders/Notes integration is the first
 * of these: macOS-only, side-effecting on the owner's personal data, and
 * gated until they explicitly enable it.
 *
 * The canonical runtime switch is the `SUA_EXPERIMENTAL_APPLE` env var. The
 * CLI's `loadConfig()` bridges the persistent `experimental.apple` config
 * field onto that env var at process start, so core can gate on a single
 * source of truth without threading config through every call site.
 */

function envTrue(name: string): boolean {
  const v = process.env[name];
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * True when the owner has enabled the experimental Apple (Reminders/Notes)
 * integration — via `experimental.apple: true` in `sua.config.json` (bridged
 * to the env var on load) or `SUA_EXPERIMENTAL_APPLE=1` directly. Default off.
 */
export function isAppleIntegrationEnabled(): boolean {
  return envTrue('SUA_EXPERIMENTAL_APPLE');
}

/**
 * True when the owner has enabled experimental cross-thread triage learnings —
 * via `experimental.triageLearnings: true` in `sua.config.json` (bridged to the
 * env var on load) or `SUA_EXPERIMENTAL_TRIAGE_LEARNINGS=1` directly. Default
 * off. When off: no lessons are extracted on resolve and none are injected into
 * triage prompts (the global kill switch).
 */
export function isTriageLearningsEnabled(): boolean {
  return envTrue('SUA_EXPERIMENTAL_TRIAGE_LEARNINGS');
}

/**
 * Autonomous first-touch triage: new inbox items (run failures, etc. —
 * never `manual` threads) get a triage turn without an operator poke, via
 * the insert-hook kick + the periodic inbox sweeper. Default ON — this is
 * the inbox's autonomy loop; the staged rollout (opt-in behind
 * `SUA_INBOX_AUTO_TRIAGE=1` while durable recovery and the local-failure
 * producer landed) is complete. Opt out with `SUA_INBOX_AUTO_TRIAGE=0`
 * or `experimental.inboxAutoTriage: false` in `sua.config.json`.
 */
export function isInboxAutoTriageEnabled(): boolean {
  const v = process.env.SUA_INBOX_AUTO_TRIAGE;
  return !(v === '0' || v === 'false' || v === 'no');
}

/**
 * Local (in-process) run failures raise inbox items by default — this is the
 * escape hatch. `SUA_INBOX_LOCAL_RUN_FAILURES=0` restores the old
 * Temporal-only behavior for operators whose dev loop generates too much
 * failure noise even with per-agent coalescing.
 */
export function isLocalRunFailureInboxEnabled(): boolean {
  const v = process.env.SUA_INBOX_LOCAL_RUN_FAILURES;
  return !(v === '0' || v === 'false' || v === 'no');
}
