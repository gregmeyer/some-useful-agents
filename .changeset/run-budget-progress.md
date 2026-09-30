---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

See a goal node's budget on the run page, and nested sub-runs as a tree.

Goal and llm nodes show turns, tool calls and time used against their budget (e.g. "turn 6 of 15 · 4 tool calls · 2:10 of 10:00"). A node that runs out of budget says which limit it hit and links to the fix: Raise the budget (the goal form), Edit the goal, or the spend limits. Sub-runs from agents called as tools are indented as a tree. Providers now report turns as they go (OpenAI-compatible loops number them; claude events carry the message id), and codex's MCP tool calls show as progress.
