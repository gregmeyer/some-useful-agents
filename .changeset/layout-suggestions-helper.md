---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Add `computeLayoutSuggestions()` helper for the Pulse "Improve layout" wizard.

Pure heuristic — no LLM. Takes agent metadata + the current layout JSON and returns up to 5 suggestion pills for the modal's pill row. Three dynamic (state-derived) pills come first when triggered:

- **Surface failing agents** — when one or more agents have `successRate < 0.5` and have run in the last 30 days.
- **Group ungrouped agents** — when two or more agents aren't in any container.
- **Hide stale agents** — when one or more agents haven't run in 30+ days.
- **Combine monitoring agents** — when two or more agents match `monitor|health|uptime|watch|alert|status|ping|check` in their id or title.

Dynamic pills are capped at 3 (ordered by signal strength); static fillers (Group by topic, Rank by reliability, Surface daily-run, Pin top 5 reliable) fill the remaining slots up to a 5-pill cap. Each pill has a short `label` for the chip and a longer `prompt` that fills the FOCUS textarea on click — dynamic pills include the affected agent ids inline so the downstream layout-planner can act directly.

Routes and modal UI come in the next PR; this commit is unit-test-only.
