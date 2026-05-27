---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Improve-layout: wireframe preview + layout-quality pills.

The plan view now renders a 4-column wireframe mockup above the Top
agents list. Each cell shows the agent title, the planner's chosen
size, tileFit indicator (↕ grow / ⇵ scroll), and pinned height when
set. System tiles get a dashed border to distinguish them. The
preview is a `<details open>` so users can collapse it.

Suggestion pills gain three layout-quality intents — **Remove gaps**,
**Make tables scrollable**, **Compact everything** — that drive the
planner to use `suggestedSize` / `suggestedTileFit` /
`suggestedHeight` aggressively. They appear ahead of the existing
agent-curation pills (Group by topic, Rank by reliability, etc.).
Max suggestions bumped from 5 to 6 so the new pills don't crowd out
the popular ones.
