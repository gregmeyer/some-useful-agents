---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Agents expose a created-at timestamp; the catalog can answer "what's the newest agent?".

`Agent.createdAt` is now populated from the `agents` table on read. The inbox
agent-catalog snapshot includes `createdAt`, sorted newest-first, so
`agent-catalog-search` can answer recency questions ("newest / most recently
added agent") definitively instead of guessing at list order. Inbox triage now
routes those questions to the catalog search.
