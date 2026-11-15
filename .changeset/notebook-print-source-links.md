---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A notebook page saved as a PDF links to sources, not to the dashboard.

Printing a notebook's page from the browser (or saving it as a PDF) carried the page's links to each finding's own page in the dashboard, which nobody else can open. While the page prints, those links now go to where each finding came from; a finding with no source has no link. The page is as it was afterwards.
