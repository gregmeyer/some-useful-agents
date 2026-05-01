---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Dashboard: split `routes/agents.ts` and `views/agent-detail-v2.ts` into per-feature files.

Internal refactor with no behaviour change. The 441-line agents router becomes a 22-line composition over six per-action modules under `routes/agents/`. The 466-line agent-detail view becomes a barrel over six per-tab renderers under `views/agent-detail/`. Adding new agent surfaces no longer requires scrolling through unrelated code.
