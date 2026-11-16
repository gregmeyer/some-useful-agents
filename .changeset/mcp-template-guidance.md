---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

MCP clients are steered to the right notebook template.

`notebook-templates` now shows each template's goal, its steps, the page it opens on and what it asks for, so a client can tell a Meeting briefing from a Company briefing. When an `ask` given to `notebook-create` looks like one of your templates, nothing is started: the reply names the template and how to use it. Pass `fresh: true` to draft the ask regardless.
