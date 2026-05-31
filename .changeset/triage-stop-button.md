---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

feat(dashboard): stop button on the triage thinking indicator

While triage is in flight, the modal's "Triage agent is thinking…"
indicator now ships with a square stop button on the right edge.
Clicking it aborts the underlying DAG run, kills any spawned LLM
processes, marks the run cancelled, posts a system note ("Triage
stopped by operator."), and re-enables the composer so the operator
can send a new message immediately.

Implementation:

- New `inboxTriageAbortControllers: Map<messageId, { runId, controller }>`
  on `DashboardContext`. `runTriageAgent` now pre-generates the runId
  (via `randomUUID`), creates an `AbortController`, registers in both
  `activeRuns` (by runId) and `inboxTriageAbortControllers` (by
  messageId), and passes the abort signal into `executeAgentDag`.
  Cleared on completion in a `finally` block so even crashes don't
  leave stale entries.
- New `POST /inbox/:id/triage/cancel` route: looks up the controller
  by message id, aborts it, calls `provider.cancelRun` as belt-and-
  suspenders, and force-finalizes the run + node executions if the
  executor didn't get to its own teardown before the response. Idempotent
  — missing entries (run already finished, dashboard restarted)
  return 204 with "Nothing to cancel."
- View update in `inbox-detail.ts`: the thinking indicator now
  contains a `<form data-inbox-modal-form>` posting to the cancel
  route. Reuses the modal's existing submit interceptor so the
  fragment refresh after cancel is the same path tags / star / reply
  already use.
- New `.inbox-thinking__stop` CSS: 28×28 square with a small filled
  square icon, hover state, sits at the end of the thinking row.
- 3 new route tests: abort + cleanup (entries removed, run flipped to
  cancelled, system note inserted), idempotent no-op on a thread
  with no in-flight triage, 404 on unknown id.
