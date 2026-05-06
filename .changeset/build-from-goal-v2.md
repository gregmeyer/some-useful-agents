---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Build from goal v2 — agents, dashboards, or both, with a survey-and-plan
review screen.

The wizard previously only built single agents. It now auto-classifies
intent across four flavors: `agent`, `dashboard-existing`,
`dashboard-new`, `dashboard-mixed`. The user's goal hits the new
`build-planner` agent, which surveys what's already installed
(matched agents, missing fragments, overlapping dashboards) and emits
a structured `BuildPlan` JSON with:
- the proposed dashboard (when applicable)
- new agents to create (each with full YAML — editable in the review)
- clarifying questions for ambiguous parts of the goal

The review screen surfaces all four blocks; the user edits YAMLs
inline, then commits via `POST /agents/build/commit` which walks the
plan creating agents + the dashboard atomically (with partial-success
reporting). Redirect lands on the new dashboard for dashboard intents,
or the new agent's page for agent intents.

**New plumbing:**

- `packages/core/src/build-plan-schema.ts` — Zod schema for `BuildPlan`
  with cross-field validation (intent="agent" can't have a dashboard;
  dashboard agentIds must reference matched or new agents; etc.) plus
  `extractPlanJson()` for unwrapping `<plan>…</plan>` / fenced JSON.
- `packages/core/src/discovery-catalog.ts` — accepts optional
  `dashboards` + `packs` args and renders them as new catalog sections
  so the planner LLM can see installed-state.
- `agents/examples/build-planner.yaml` — the multi-flavor planner.
  Single claude-code node, structured output to `<plan>…</plan>`.
- `POST /agents/build/commit` (new) + `GET /agents/build/:runId`
  (extended to return `BuildPlan` instead of raw YAML) +
  `POST /agents/build` (now invokes the planner instead of agent-builder).
- `POST /agents/build/create` kept as a thin compat shim.
- Wizard JS + modal copy updated to surface the plan-review stage and
  hint at the dashboard flavors.

19 new unit + supertest cases; full suite 1066/1066 green. Live smoke
on three goals (agent / dashboard-existing / dashboard-mixed)
produces sensible plans.
