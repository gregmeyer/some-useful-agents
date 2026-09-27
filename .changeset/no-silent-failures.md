---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Stop three silent failures: tool-less "successes", unnamed providers, and a dead scheduler nobody hears about.

A node's declared `tools:` are now honoured on every provider or the provider is skipped. Claude gets `web-fetch` / `web-scrape` as its own `WebFetch` (previously it was granted nothing, so the `starter-watch`, `starter-research` and `starter-draft` fetch steps "completed" with "permission has not been granted"); codex and Apple Foundation Models are skipped with a new fallback-worthy `tool_unavailable` category, and a node whose whole chain is skipped fails saying what to enable. A tool call claude refuses mid-run now shows as a warning on the node. Apple Foundation Models' inline "unavailable" status now actually falls through the waterfall (it was checked against the extracted text, not the raw JSON, so it returned an empty success).

The run page names the provider on every llm node, not only when a fallback fired.

A new `system-health` inbox source gets its first producer: when the scheduler crashes (stale heartbeat, dead pid, agents scheduled) the inbox opens one high-priority thread naming the agents that aren't firing and how to restart it, and resolves it once the scheduler is back.
