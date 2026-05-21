---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Refine-this-plan UX fix: when the user has typed into the refine textarea (or answered a clarifying question), "Update plan" promotes to primary styling and "Apply layout" demotes to ghost. Matches actual intent — if you're typing feedback, you mean to iterate, not commit. Repeated mis-clicks on Apply during refinement triggered this. The refine block is also now boxed (subtle surface-raised background, border) and sits with more breathing room above the Cancel/Apply action row so the two regions are visually distinct.
