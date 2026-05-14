---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Wire `integrationsStore` / `variablesStore` / `toolStore` into the `sua workflow run` CLI so one-shot CLI runs can resolve csv/postgres/sqlite generated tools, user MCP tools, and `{{vars.*}}` references.

Previously only the daemon's schedule path and the dashboard run-now path opened these stores; the CLI runner skipped them and any v2 agent that referenced a generated tool failed setup with "Shell node 'X' has no command" (the executor falls through to legacy shell dispatch when the tool can't be resolved). Mirrors the existing wiring in `cli/src/commands/schedule.ts`. Each store opens best-effort — absence just means that feature doesn't resolve, same as the schedule path.
