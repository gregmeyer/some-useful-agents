---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Named dashboards: per-placement layout overrides.

`DashboardSection` gains an optional `placements` map keyed by agent id —
`{ size?, tileFit?, height? }`. The dashboard Improve-layout commit
endpoint reads the planner's `topAgents` entries and writes per-section
placements on the new layout, so two dashboards can size the same agent
differently. The renderer applies placement on top of the agent-global
`LayoutHintsStore` entry; any undefined placement field falls through to
the hint, then to the agent's `signal.size` / `outputWidget.tileFit`,
then to the renderer defaults.

Backwards-compatible: existing dashboards without `placements` render
exactly as before. Round-trips through the dashboard store.
