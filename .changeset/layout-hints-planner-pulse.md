---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Improve-layout now persists per-tile size, tileFit, and height.

The layout-planner agent is taught to emit `suggestedTileFit`
(`grow` / `scroll`) and `suggestedHeight` (CSS pixels) alongside the
existing `suggestedSize`. The Pulse "Apply" button forwards the
planner's `topAgents` entries to the commit endpoint, which writes
them into `LayoutHintsStore`. Pulse and named-dashboard renderers
load hints in one batched lookup per page and let them override the
agent's declared `signal.size` / `outputWidget.tileFit` defaults.
Re-running Improve layout only overwrites fields the planner actually
emitted — other hints are preserved.

Named-dashboard per-placement overrides (so two dashboards can size the
same agent differently) ship in a follow-up.
