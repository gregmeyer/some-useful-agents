---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Split the monolithic build-planner into three focused agents orchestrated at the route layer. Per-agent drafting now runs as its own LLM call, so each draft has its own timeout and the Improve-layout Path B hand-off can run 3 drafters in parallel instead of one timeout-prone megacall.

**New agents:**
- `goal-surveyor` — classifies intent, decomposes goal into fragments, matches against installed agents.
- `agent-drafter` — drafts ONE agent from ONE fragment.
- `dashboard-designer` — designs the dashboard section layout from a finalized agent-id list.

**New endpoint:** `POST /agents/draft-one { purpose, suggestedName?, focus? }` — fast path used by the Improve-layout wizard. Skips the surveyor and designer, runs one drafter, returns a single-agent BuildPlan when complete. Polling reuses `GET /agents/build/:runId`.

**`POST /agents/build` rewrite:** now kicks off a session-based orchestrator that runs surveyor → fans out drafters in parallel → optionally runs designer → assembles the BuildPlan. External contract unchanged; the wizard still polls one runId and gets the same BuildPlan shape back, with per-drafter progress surfaced during the running phase.

**Improve-layout wizard:** the "Draft N agents + apply" button no longer hands off to Build-from-goal. It drives N parallel `/agents/draft-one` calls inline, shows a card per draft with independent progress, then commits the drafted agents + the layout in one flow. The sessionStorage hand-off (`sua-layout-handoff-v1`) is removed. The Build-from-goal modal is no longer rendered on `/pulse`.

**Build-from-goal wizard:** unchanged externally except the spinner stage now renders per-drafter progress pills when the orchestrator is in its drafting phase.

`build-planner.yaml` remains in `agents/examples/` for now but the orchestrator never invokes it.
