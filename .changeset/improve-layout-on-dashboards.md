---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Extend the "Improve layout" wizard to named user-dashboards (`/dashboards/<id>`).

The wizard now appears on every named dashboard page alongside the existing Pulse surface. Same flow (suggestion pills → focus textarea → planner → clarifying questions → Apply), scoped to that dashboard's agent pool.

Differences from Pulse:

- **Curation rewrites dashboard config**, not `pulseVisible` flags. Named dashboards have no per-tile hide switch — agent membership is declared in `dashboard.layout.sections[].agentIds[]`. Apply replaces the section list with one derived from the plan's containers. Agents the planner didn't choose are REMOVED from the dashboard config. They stay in `/agents`; the **Add tile** button can re-add them.
- **Agent metadata is filtered to the dashboard's pool.** The planner only sees agents currently in `sections[].agentIds`, not the whole catalog. Ranking and grouping happen within the dashboard's scope.
- **localStorage key is per-dashboard.** Each dashboard's container arrangement persists under `sua-dashboard-layout-<id>`, isolated from Pulse and other dashboards.
- **Copy adjusted.** "Will hide N agents" reads "Will remove N agents" with the recovery hint ("restore via Add tile"). The pre-plan blurb explains that agents not chosen will be removed from this dashboard.

New routes (`packages/dashboard/src/routes/dashboard-layout-plan.ts`):

- `POST /dashboards/:id/layout-plan/suggestions` — pills + dashboard-scoped agent metadata
- `POST /dashboards/:id/layout-plan` — kicks off the layout-planner
- `GET /dashboards/:id/layout-plan/:runId` — poll
- `POST /dashboards/:id/layout-plan/commit` — rewrite `sections[].agentIds`; returns `{ removed, retained }`

The shared `improve-layout-modal.ts` + `improve-layout.js.ts` now take a config (`endpointBase`, `storageKey`, `curateVerb`) so one modal serves both surfaces.
