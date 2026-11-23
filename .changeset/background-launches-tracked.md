---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

The dashboard tracks the work it starts without waiting for it.

Triage turns, notebook steps, page decisions, webhook runs and the other launches the dashboard doesn't wait for now go through one registry instead of a bare `void promise`. A failure nobody caught is logged with what it was (`[background] runTriageAgent failed: …`) instead of an anonymous unhandled rejection, and tests wait for these launches at teardown, so they no longer write to a closed test database. This is the first step towards a dashboard shutdown that lets running work finish.
