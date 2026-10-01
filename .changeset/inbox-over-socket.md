---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox threads run over the chat WebSocket.

Replies you post in an inbox thread now go over the dashboard's WebSocket, and the triage agent's answer, action cards and status changes arrive on it, the same connection agent chat uses. The thread's server-sent-events stream and plain posts remain as the fallback when there's no socket.
