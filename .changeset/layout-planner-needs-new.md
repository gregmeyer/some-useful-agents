---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Layout planner can now suggest brand-new agents to draft (Path B-lite), and the wizard stops calling installed agents "new".

Two changes:

- **Prompt vocabulary** — the planner used to call already-installed agents "new" when surfacing them via `toAdd`, which implied fresh code. It now says "from your catalog" / "already installed" and reserves "new" for agents that don't exist yet.
- **`needsNew[]`** — a new optional field on `LayoutPlan` for brand-new agent specs (`purpose` + optional `suggestedName`). When FOCUS asks for an agent that doesn't exist anywhere, the planner emits the spec here instead of inventing an id. The wizard renders a "Draft N new agents" section with a link to Build from goal; drafting happens out-of-band, and the user re-runs Improve layout afterward to surface the new agent. Schema validates that needsNew names don't collide with container tiles or `toAdd[]`.

Full inline build-planner orchestration (Path B proper) is still deferred.
