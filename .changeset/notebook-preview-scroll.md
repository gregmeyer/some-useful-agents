---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/dashboard": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
---

The Edit page's preview scrolls itself, not the page behind it.

The preview's scrolling box was inert (so the page in it can't be clicked), which also passed the mouse wheel to the page behind. Only the page inside is inert now, and the page behind stays put while the preview is open.
