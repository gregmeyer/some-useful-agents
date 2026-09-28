---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Talk to an agent and follow up: conversations.

Any agent with a text input can hold a conversation. Each message is a run, and the agent's llm and goal nodes see the conversation so far (the most recent 8 KB). Use the new Chat tab on the agent page, `sua agent chat <agent>` (interactive, or `-m` / `--session` / `--list`), or MCP `run-agent` with `message` and `sessionId`. A new optional `chat: { input: NAME }` field picks which input the message fills. Works on every provider and on Temporal workers. See docs/conversations.md.
