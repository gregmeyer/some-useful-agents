---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Notebook facts you can trust: sources, quotes and one option per thing.

- **Facts carry their source and the quote that backs them,** and say which are estimates. A notebook only keeps numbers the search actually stated, and never copies example values from its instructions.
- **Agents can file into a notebook directly** with a `<notebook>` block, and can rule options out. A new account-research agent fills a notebook of companies from public job posts.
- **One option per thing:** a company found by different agents stays one option, the same address (or a car's VIN, however it's written) is the same option, and **Merge with…** merges the rest. A run that names an option the notebook already has fills in that option's facts, instead of writing a new entry or a text-only "Ruled out".
- **Each option's own page, not a search page:** results pages (including CarGurus listings) don't count as an option's link, and a web-address fact becomes a link and a source for the option's photo.
- A notebook's searches hear what it already has and which facts are missing. Long facts get short filter labels, and a filter that would pick out only one option isn't offered.
- A newer price beats the price in an option's title, and a link in an option's text no longer wipes its facts.
