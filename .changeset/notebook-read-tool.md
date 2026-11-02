---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A notebook's knowledge can be read from anywhere: the `notebook-read` tool.

Agents (with `tools: [notebook-read]`) and MCP clients (Claude Desktop, Codex, through `sua mcp`) can read what a notebook knows, by id, link or title words, archived notebooks included. That's what it's for, the facts about who it's about with their sources, the answer, talking points or plan it wrote, its options with their facts and check results, and its notes. It only reads, and tool policy applies, with the notebook's id as the resource.
