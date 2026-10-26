---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

One shared web search for agents, and job-board discovery that finds boards.

A new example agent, `web-search-links`, runs a live web search and returns the result links as JSON. Agents that need search results now call it instead of scraping DuckDuckGo in a shell node. DuckDuckGo blocks those scrapers, so they often found nothing.

- `ashby-discover` and `greenhouse-discover` now use it, and the new `lever-discover` does too. Each finds its job board's pages, takes the company board slugs from the links and keeps the ones the board's public API answers for. In test runs each found 14–15 boards per topic.
- `lever-job-agent` (now an example) finds boards with `lever-discover` when `COMPANIES` is blank. `COMPANIES` also takes jobs.lever.co links. When no board turns up or none answers, the run finishes with an empty result that says why, instead of failing on the first node. A ranking answer in a code fence and results over 32 KB no longer break it.
- On codex, whose live search returns nothing for `site:` queries, a site search that finds nothing searches again with the site's name as an ordinary term and keeps only links on that site.
- sua's agent builder now uses `web-search-links` for nodes that need search results. When an input it could find itself is left blank, it adds a node that finds it instead of failing.
