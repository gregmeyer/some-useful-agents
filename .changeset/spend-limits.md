---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Spend limits: stop a run, or an agent's day, at a dollar amount.

New `spendLimit: { perRunUsd, perDayUsd }` on an agent, and defaults for every agent in Settings → Usage (USD at list price). A run stops once it reaches its per-run limit — claude via `--max-budget-usd`, OpenAI-compatible models between tool-loop turns, and before each node — and an agent that has reached its daily limit has new runs refused until midnight, with one inbox item. A limit stop (`budget_exhausted`) never falls back to another provider and is never retried. The agent Overview shows the limits in force and today's spend; providers with no price are named, since their runs can't count. See docs/cost.md.
