---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/dashboard": patch
"@some-useful-agents/temporal-provider": patch
---

The checker confirms quotes of an option's own facts, and a check never rules out an option you chose.

notebook-checker's word-for-word gate compared a quote of an option's facts against a spaced copy of them (`"Employees": 777`), while the model had been shown them compact (`"Employees":777`), so nearly every check settled from the facts was left open and a check step stalled ("2 of 10 checked"). It now matches both forms and `Employees: 777`, and a rule-out reason quotes the facts that way. A check that fails on an option you've chosen leaves a note instead of ruling it out.
