---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Dashboard: control the outbound MCP server from `/settings/mcp`.

A new Settings tab between Variables and MCP Servers shows the live state of the MCP server (the one Claude Desktop talks to): running/stopped status with PID, endpoint URL, bearer-token fingerprint with a link to rotate, list of `mcp: true` agents with run counts, and a pre-filled Claude Desktop config snippet you can copy directly into `claude_desktop_config.json`. Start and Stop buttons spawn or signal the MCP service via the same daemon supervisor `sua daemon start` uses, so the dashboard and the CLI agree on the PID file at `<dataDir>/daemon/mcp.pid`. The supervisor moved from the `cli` package to `core` so the dashboard can use it directly.
