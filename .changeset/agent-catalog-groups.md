---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

The agents catalog groups agents by what they do, sorted by sua.

A new `agent-catalog-sorter` system agent puts each agent in a group ("Jobs & companies", "News & digests", "Fun"…) and writes one plain line on what to use it for. /agents shows a shelf per group (three cards and "All N →", or `?group=` for the whole group), cards and rows show the "use it for" line, and the ask box searches it. Sorting runs in the background for new or changed agents and never touches an agent's version; the groups are kept in a new `agent_catalog` table (core `AgentCatalogStore`).
