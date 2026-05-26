---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Foundation for per-agent layout hints (size, tileFit, height).

Adds a new `LayoutHintsStore` (SQLite-backed, decoupled from the
versioned agent schema) and threads `suggestedTileFit` / `suggestedHeight`
into the layout-plan schema. The Pulse renderer now reads hints through
a fallback chain (`hint → signal/outputWidget → default`); no commit
path writes hints yet, so this ships zero visible behaviour change.
Later PRs teach the layout-planner agent to suggest tileFit/height and
wire the Improve-layout wizard's commit endpoint to persist them.
