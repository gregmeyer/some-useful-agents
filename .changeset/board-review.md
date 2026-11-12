---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

"Improve this board": sua reviews a board against its goal and suggests agents to add or leave out.

New system agent `board-reviewer`. It reads the board's goal (or proposes one), what each agent on the board returns, and up to 25 of your other agents, and suggests what to add or leave out, each with a reason. Suggestions appear on the board with their own buttons; applying one is a new board version you can undo, and sua redraws the board's own page with the goal. "Look again" runs another round and remembers what you skipped.
