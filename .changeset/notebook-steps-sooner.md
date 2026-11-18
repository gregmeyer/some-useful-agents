---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Notebook steps say how they went sooner.

A source step that reads each option's own page now reads up to 3 sites at once (each site's pages still one at a time), where it read every page one after another, about 12 seconds each. Stop cancels every page being read. Photos for what a step found are now fetched after the step reports, in the background, instead of holding up its card while other sites' pages load.
