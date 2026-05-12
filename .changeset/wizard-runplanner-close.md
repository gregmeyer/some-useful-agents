---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

dashboard: fix wizard JS bundle parse error from #254

The runPlanner refactor in #254 left the trailing `});` from the
addEventListener it replaced — that produced an unbalanced `)` in the
inlined script and broke parse for the entire build-from-goal bundle
(`Uncaught SyntaxError: Unexpected token ')'`). Wizard didn't open at
all on any page. Closes runPlanner with `}` and the IIFE with `})()`.
