---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

See what every run costs.

Each LLM call now records its tokens and cost in USD at list price, across every provider attempt: claude's reported cost, codex and OpenAI-compatible endpoints estimated from prices you set in Settings → LLM → Pricing (local endpoints are free). Run pages show the run's cost (including agents it called) and a cost per node; runs lists get a Cost column; the agent overview shows 7-day spend; the new Settings → Usage tab and `sua usage` break spend down by agent and by provider. See docs/cost.md.
