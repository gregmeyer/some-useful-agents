---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Dashboard: toggle MCP exposure from the agent Config tab.

A new card on `/agents/<id>/config` flips `mcp: true/false` without editing YAML. Off → "Expose via MCP" button; on → "exposed" badge + "Stop exposing" button. The flip rewrites the agent record but does not restart the running MCP server — the form copy points at Settings → MCP for that.
