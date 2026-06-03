---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Polish inbox links and modal scrollbar.

Auto-linked `/agents/<id>` and `/runs/<id>` references now show the id as the
link label (not the raw path), and all links in inbox messages and triage CTAs
open in a new tab so following one keeps the inbox open. The modal's scroll
container gets a thin, muted scrollbar instead of the heavy default slab.
