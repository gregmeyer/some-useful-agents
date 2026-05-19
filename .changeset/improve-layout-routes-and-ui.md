---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Wire the "Improve layout" wizard on `/pulse` — routes + modal UI + button.

A new ✨ Improve layout button sits next to Edit layout on the Pulse page. Clicking it opens a modal that:

1. Fetches state-derived suggestion pills (from PR #307's `computeLayoutSuggestions`) plus pre-computed agent metadata.
2. Renders pills above a free-form FOCUS textarea — clicking a pill prefills the textarea so the user can edit before submitting.
3. Submits to the new `layout-planner` agent (from PR #306), polls the run, then renders the structured `LayoutPlan` (from PR #305) inline: top agents with rationales, proposed containers, and optional clarifying questions.
4. Lets the user answer questions to refine the plan ("Update plan" re-runs with appended context), or click **Apply layout** to write the proposed containers to `localStorage` and reload `/pulse`.

Four new endpoints under `/pulse/layout-plan/`:
- `POST /suggestions` — pills + agent metadata for the modal.
- `POST /` — kicks off the layout-planner agent with `focus`, `currentLayout`, optional `agentMetadata`. Returns `{ runId }`.
- `GET /:runId` — polls the run; extracts `<plan>{...}</plan>`, validates against `layoutPlanSchema`, returns the typed plan or validation errors.
- `POST /commit` — telemetry no-op for parity with `/agents/build/commit`. Reserved for future server-side layout persistence.

No critic-retry loop in v1 (PlannerLoopRunner is build-plan-shaped); if the planner emits invalid YAML the modal shows validation issues and the user re-submits.

Closes the dashboard-layout-improvement plan at `~/.claude/plans/how-would-you-improve-joyful-wadler.md` (PR 4 of 4).
