---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/dashboard": patch
"@some-useful-agents/temporal-provider": patch
---

A template's subject given with its website is split into name and site.

Starting a notebook from a template with "Duolingo, duolingo.com" used the whole string as the company's name everywhere. Now the name ("Duolingo") goes into its texts and steps, and the site becomes the organization's own site, which its profile step uses. A notebook started from a template with no title of its own is named after the template and its subject ("Company briefing: Duolingo") rather than the template's name alone.
