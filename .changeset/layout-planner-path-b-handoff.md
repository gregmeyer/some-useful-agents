---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Layout planner can now draft brand-new agents inline via build-from-goal hand-off (Path B), and stops speculatively adding agents you didn't ask for.

Two changes:

- **Inline drafting** — clicking "Draft these agents" in the Improve-layout wizard no longer dumps you on /agents. It opens the Build-from-goal modal pre-filled with the synthesized goal, you go through the full critic-loop / questions / YAML-edit / commit flow there, and when you commit, you're returned to the layout wizard with the freshly drafted agents merged into the plan in a "Newly drafted" container. One click to Apply layout finishes the job. State is persisted in `sessionStorage` (1h TTL) so the original plan survives the round-trip.
- **Conservative `toAdd`** — the planner used to surface available agents whenever they "fit the layout" or "filled an obvious gap", which caused unwanted additions like `system-health` showing up on dashboards where the user only asked for a couple of new agents. The prompt now requires FOCUS to explicitly name a topic or agent before anything in `toAdd` is allowed. Empty `toAdd` is the default.

The build-from-goal modal is now also rendered (hidden) on `/pulse` so the hand-off works there too.
