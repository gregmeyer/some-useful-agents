---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A notebook's brief and PDF print what its page now shows.

The brief and its PDF print a notebook's page without the A2UI renderer, so the page's newer parts printed nothing there. They now do: words worked out by functions (counts, ranges, joined lists, "3 days ago"), a search table's rows, values bound in A2UI 1.0's form, and a VegaChart, printed as a table of its data under its title.
