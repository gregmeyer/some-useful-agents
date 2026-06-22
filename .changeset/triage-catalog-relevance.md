---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox triage: reach the agent you mean, even with many installed.

The triage AGENT_CATALOG used to be just the 40 newest agents by creation date, so an agent the
operator named — but which was old and beyond the cap — was invisible to triage (it couldn't be
targeted or summoned). The catalog is now selected by blending relevance to the operator's current
request (keyword match on id/name/tags/description) + recency-of-use (a new
`RunStore.latestRunAtByAgent()` aggregate) + a reserve of newest-created agents, capped at 40.
Named/used agents reliably surface; the kernel now compares createdAt across entries for "newest"
(not list position) and falls back to agent-catalog-search (full catalog) when an agent is elided.
