---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix the "Open it" link when a board is built.

The inbox message for a newly built board linked to the wrong place and showed a garbled id (`user%3Amorning-dashboard`). It now links to the board by name, and any dashboard link in the inbox with an encoded id is linked whole and labelled with its readable name.
