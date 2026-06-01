---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Record which execution backend ran each run.

Runs and node executions now carry a `usedWorkflowProvider` field
(`local` | `temporal`) so you can tell where work actually ran. This is a
distinct axis from the LLM provider (`usedProvider`, claude/codex/apple). The
local and Temporal providers stamp it at submit time; v2 DAG runs record
`local`. The runs list shows a `temporal` chip for Temporal runs and the run
detail page shows a Backend row. Legacy rows read back as local.
