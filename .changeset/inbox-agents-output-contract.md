---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Require a structured output block from triage + catalog-search.

The `inbox-triage` and `agent-catalog-search` system agents now declare an
`outputContract` (`<plan>` / `<matches>`). If a provider returns 0-exit output
without the required block — e.g. a weak fallback model that ignores the
format — the waterfall escalates to a stronger provider instead of accepting it,
and only fails the run if every provider whiffs.
