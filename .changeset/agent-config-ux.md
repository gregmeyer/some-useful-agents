---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Dashboard: Agent Config tab UX cleanup.

The per-agent Config tab (`/agents/<id>/config`) was a 7-card vertical stack ~2500px tall with seven competing primary buttons. This refactor cuts the page in half (~1400px), reorders sections by decision sequence (Variables → LLM → MCP → Secrets), promotes Variables to a full-width row above a two-column grid, collapses the heavyweight Output Widget and Notify editors when configured (with one-line "Set up" CTAs when not), and demotes gateway buttons so "Run now" is the only primary action above the fold. The agent Status dropdown moves to the page header next to "Run now" so lifecycle decisions live where runs are triggered. Persistence paths and form actions are unchanged.
