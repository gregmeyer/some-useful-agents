---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

web-search-links finds results on codex too.

codex's live search returns nothing for `site:` queries, so the discover agents found no boards whenever codex answered. When a `site:` search finds nothing, web-search-links now searches again with the site's name as an ordinary search term, and still keeps only links on that site. In a test with codex, a search that had returned 0 links returned 15.
