---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Boards built from a request draft the missing agents, behind one approval.

When none of your agents covers part of a board request, sua now drafts an agent for it (Build from goal's drafter and critic) and saves it as a draft that doesn't run. One inbox item, also shown on the board, asks to approve them: **Approve** makes them active, adds them to the board in a "New agents" section and runs them once; **Decline** deletes the drafts.
