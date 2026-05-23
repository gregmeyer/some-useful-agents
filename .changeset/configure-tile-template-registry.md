---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix blank TEMPLATE picker in the Configure-tile modal on dashboard pages.

The Configure-tile modal builds its template grid from a `#pulse-template-registry`
JSON island that was only emitted on `/pulse`. Named dashboards (`/dashboards/:id`)
reuse the same modal but never rendered the island, so opening Configure tile there
showed an empty Template section. The island is now emitted on dashboard pages too.
