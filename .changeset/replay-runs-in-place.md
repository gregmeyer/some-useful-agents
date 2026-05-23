---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Run "Run again" in place on Pulse / dashboard widget tiles.

Clicking a widget tile's "Run again" button used to start the run and then
redirect to the run detail page, dropping you off the dashboard. It now
re-runs the agent and refreshes the tile in place — the same in-place flow
interactive widgets already use. Without JS the button still falls back to
the run detail page, so nothing breaks.
