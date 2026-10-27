---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A company's competitors get their own list and panel.

A profile step now keeps a company's competitors as their own list (up to 5 a page names as competitors or alternatives), each with its site, a line on how it competes and the page that names it, instead of a single "Competitors" fact. The meeting briefing shows them under **Their competitors**, and any drawn page can bind `/notebook/competitors` (with a new `competitors` flag). `firmographic-research` also asks for each company's industry and competitors: a `competitors` CSV cell ("A; B; C") plus a `competitor_list` with sources.
