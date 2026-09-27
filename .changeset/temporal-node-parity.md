---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Temporal and scheduled runs now use the same providers and tools as a run from the dashboard.

Under `provider: temporal`, the worker received only provider names. A custom provider such as a local model wasn't known on the worker, so the name fell through to claude and claude answered under the local model's name. Only builtin tools resolved, because the worker had no tool, integration or variables stores. The worker now reads custom providers and the disabled list from its own `llm-settings.json` (API keys never enter workflow history) and opens those stores from same-host paths. Both the per-node and durable whole-agent paths are covered.

Scheduled runs passed no LLM settings at all, so they ignored the provider chain and used claude alone. They also had no tool store, so MCP and user tools didn't resolve. The scheduler now reads the chain at each fire, so edits in Settings → LLM apply without a restart, and it has a tool store.

Any provider name that isn't a known CLI or configured custom provider now fails that provider, and the chain moves on, instead of silently running claude.
