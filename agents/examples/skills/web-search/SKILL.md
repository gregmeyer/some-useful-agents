---
name: web-search
description: How an agent searches the web — the web-search-links agent for search results, the web-search tool when a model searches and reads; never scraping a search engine.
---

When a step needs search results (which companies have a job board, which pages
mention something), use `type: agent-invoke` with
`agentInvokeConfig.agentId: web-search-links` (inputMapping `QUERY`, optional
`SITE` such as "lever.co", `MAX_RESULTS`) and read its JSON `results`
(`[{url, title, snippet}]`) in the next node.

An llm-prompt that searches AND reads pages to judge them uses
`tools: [web-search, web-fetch]`, and gives every answer with the page it came
from.

Never scrape a search engine (DuckDuckGo, Google, Bing) with curl in a shell
node: they block it and the step finds nothing, looking like "no results".

Fixing an agent: a shell node that curls a search engine, or a step that found
nothing where results were expected, is replaced with web-search-links.
