---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/dashboard": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
---

sua's keeper no longer writes "Ruled out: …" about options a notebook already has.

Filing an enrichment run left timeline entries like "Ruled out: Vena, founded 2011…" for options that were never ruled out (some were chosen). The keeper is now told never to rule out an option already listed (that's yours), and a new option that breaks the notebook's limits is added as ruled out for real. A "Ruled out: <name>" entry naming an option the notebook has is left out in code too.
