---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

The item index: everything that needs you, as typed items (goal surfaces, S1).

A new layer in core reads what sua already stores and returns one item per thing that needs you or matters now. That covers threads waiting on you, questions runs are waiting on, agents that keep failing or missed their declared outcome, draft agents, board builds, and the scheduler's health. Each item has a stable id, a kind, urgency, the actions it supports, and the evidence behind it. Read the items with `GET /api/items` in the dashboard or the new `items-read` MCP tool. Home's surface (coming next) is built on these items. See docs/surfaces.md.

Also fixes a crash when outcome records or agent / planner memories were read through a store opened on a shared database connection (`fromHandle`): the row reader was a class field that this construction skipped.
