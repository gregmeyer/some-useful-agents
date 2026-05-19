---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Add the `LayoutPlan` zod schema for the upcoming layout-planner agent.

Parallel to `BuildPlan` from `build-plan-schema.ts`. Defines the structured output the layout-planner emits in a `<plan>…</plan>` wrapper: a `summary`, a ranked `topAgents[]` with one-line rationales and optional `suggestedSize`, proposed `containers[]` (label + tiles) that mirror the `sua-pulse-layout` localStorage shape, and post-plan clarifying `questions[]`.

Strict-mode validation catches the common LLM mistakes: duplicate tiles across containers, duplicate container labels (case-insensitive), duplicate topAgent ids. Loose enough that container tiles can reference any agent (not just topAgents) so lower-ranked agents can be placed without promotion.

This PR is schema-only — no agent or UI yet. Part 1 of 4 in the dashboard-layout-improvement plan at `~/.claude/plans/how-would-you-improve-joyful-wadler.md`.
