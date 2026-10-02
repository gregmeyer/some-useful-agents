---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Agent conversations now live in the inbox store.

A conversation with an agent is now an inbox thread (source `conversation`), and its turns are replies on that thread, so there is one conversation model for the coming side panel and inbox split view. Nothing changes in the Chat tab, `sua agent chat` or MCP `run-agent`. Existing conversations are copied over the first time sua opens the database, with the same ids; the old tables are kept as `sessions_legacy` and `session_turns_legacy`. Conversations aren't listed in the inbox yet.
