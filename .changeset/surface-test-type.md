---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

The build compiles again.

A test added with the shortlist fix didn't type-check, which stopped the full build (`npm run build`) from finishing. No change in behavior.
