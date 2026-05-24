---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Widen dashboard content cap so wide screens stop showing a large dead gutter.

The global content max-width was hard-capped at 1200px (1400px for wide pages), so on large monitors the centered layout left big non-flexing gutters on either side and clipped wide content rows. Raised `--content-max` to 1600px and `--content-max-wide` to 1760px so pages use more horizontal space while keeping a readable cap.
