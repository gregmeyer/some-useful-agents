---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix services crashing on start after an upgrade: "duplicate column name".

When `sua daemon` started several services at once on a database that needed new columns, two could race to add the same one, and the loser (seen: the dashboard) exited with "duplicate column name: recalled_memories_json". Adding a column that already exists is now treated as done.
