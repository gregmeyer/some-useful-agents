---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

MCP clients can start notebooks (`notebook-create`).

An agent connected to `sua mcp` used to be able only to read notebooks, so it had to send you to the dashboard to start one. New MCP tools fix that:

- `notebook-templates` lists your templates.
- `notebook-create` starts a notebook in one of two ways: from a template plus who or what it's about (e.g. a company briefing on "Acme"), or from an ask that sua drafts ("Tell me about Acme"). It can also start the notebook's first step.
- `notebook-create-status` follows the request until the notebook is ready.

The MCP server queues each request, and the dashboard makes the notebook within seconds, the same way `build-board` works. Every notebook started this way leaves a note in your inbox. Deny `notebook-create` in your tool policy to turn this off.
