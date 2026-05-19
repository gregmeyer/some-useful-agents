---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Layout planner can now surface installed agents that aren't on the current dashboard.

The Improve-layout wizard previously only rearranged agents already on the surface (curation-only). It now also sees the rest of your installed catalog as `available` agents and can bring them onto Pulse or a named dashboard. The `LayoutPlan` schema gains an optional `toAdd[]` field; the wizard shows a "Will add N agents" details panel alongside the existing "Will hide/remove N agents" panel. Drafting brand-new agents that don't exist yet is still the job of build-planner / "Build from goal".
