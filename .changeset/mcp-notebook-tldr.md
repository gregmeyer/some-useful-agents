---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

New MCP tool: `notebook-tldr` redraws a notebook's TL;DR picture.

An MCP client can now do what Redraw… does in the dashboard: show how a notebook's TL;DR picture is drawn, set its size, tone, layout, parts (drop the numbers strip, say), headline and takeaway, undo, or go back to the standard picture. Fields not given stay as they are. The picture is still drawn from the notebook's own data, and a headline or takeaway with a number the notebook doesn't have is refused. Core gains `strayTldrNumbers` for that check.
