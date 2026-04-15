---
"@some-useful-agents/dashboard": minor
---

**feat: dashboard-native tutorial at `/help/tutorial` (PR 1.5 of v0.15).**

A guided first-run flow that replaces the "open a terminal and run `sua tutorial`" friction for users who're already in the dashboard. Step completion is derived from observable project state (agent count, run count, DAG run presence, declared secrets) — not session cookies — so refreshing re-checks reality.

### Steps

1. **You have a project** — done when any agent is registered. Empty-state pitches `sua init`.
2. **Run your first agent** — done when any run exists. CTA deep-links to the friendliest starting agent (prefers a single-node v2 over a multi-node, v2 over v1).
3. **Inspect the output** — done when a run exists AND a latest-run id is available. CTA links to the latest run.
4. **See a multi-node DAG in action** — done when any run has `workflowId` set. Empty-state explains how to build one.
5. **Wire up a secret** — done when any agent node declares a secret. CTA links to Settings → Secrets.

### Why state-derived, not session-tracked

A cookie-based wizard remembers what you *clicked*, not what's *true*. If a user clicks through to step 3 and then deletes all their runs, the cookie still says "done". Sourcing from the DB + agent store means the tutorial always reflects the current project — and a second visitor to the dashboard (or the same user on a fresh cookie) sees accurate state on first load.

### Files

- New: `packages/dashboard/src/views/tutorial.ts`
- Modified: `packages/dashboard/src/routes/help.ts` (new `/help/tutorial` route handler pulls state from `agentStore` + `runStore` + `loadAgents`); `views/help.ts` (replaces the "Start here: `sua tutorial`" card with a prominent link to the dashboard tutorial, keeps the CLI command as a secondary option)

### Tests

3 new cases in `dashboard.test.ts` (23 → 26):
- `/help` renders with the tutorial CTA + CLI reference
- `/help/tutorial` marks step 1 done when agents exist, surfaces "1 of 5 complete" when no runs yet
- `/help/tutorial` deep-links the Run CTA to the first agent id
