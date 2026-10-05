---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

sua builds multi-source agents as one step per source, plus a merge.

When you ask sua to build an agent that gathers from several sources ("sweep Craigslist, AutoTrader, CarGurus and Facebook Marketplace"), the builder now drafts one step per source and a merge step that combines, dedupes and ranks.
- **Sources:** it reuses an installed agent for a source when it has one (e.g. a Craigslist search). Each source step has its own time limit, and returns an empty list with a note instead of failing. Source steps never depend on each other, so one dead site can't sink the rest.
- **Reliability:** the builder's design step no longer uses tools itself, and has more room to finish. It was running out of turns.
