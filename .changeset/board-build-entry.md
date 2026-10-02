---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Build a board from Ask sua or MCP, and run failed tiles again.

Ask sua for a board ("build me a board for my evenings: Hacker News, tomorrow's weather and a cocktail idea") and the inbox triage agent starts the build and links it. MCP clients get `build-board` and `board-build-status`: the build is queued in the shared database and the dashboard picks it up within seconds. When tiles didn't run cleanly, the board's banner offers to run them again.
