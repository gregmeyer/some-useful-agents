---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A notebook search never runs on something it wasn't given, and codex runs can't reach your own apps.

A notebook asked for jobs "matched to my LinkedIn profile" had no profile in it. Its search plan carried blanks like "[profile target role]", and the searches filled them from the operator's own Notion, reached through codex's connected apps, then reported the results as profile matches. Now the finder's plan says what is missing and plans nothing, code refuses any plan with blanks before a search runs, and the step stops with what it needs ("Nothing was searched: it needs your LinkedIn profile or résumé"). The checker leaves a check it can't judge for the same reason as "not given", never ticked. Every codex run sua starts has the operator's own MCP servers, apps, plugins, browser, computer use and memories switched off.
