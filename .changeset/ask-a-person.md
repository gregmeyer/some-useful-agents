---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Agents can stop and ask you something: the `ask` node.

A new `type: ask` node (`question`, optional `choices`, `timeoutHours`) pauses the run in a new `waiting` status, holding no process, and puts the question in the inbox with the choices as buttons. Answering resumes the run from that node, on its usual backend (including Temporal), with your answer as the node's result and `choice` for branching with `onlyIf`. Unanswered questions expire (default 72 hours); cancelling a waiting run withdraws its question. The run page shows a waiting banner; chat turns and MCP `run-agent` report waiting instead of failing. See docs/ask-a-person.md.
