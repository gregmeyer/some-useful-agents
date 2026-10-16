---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A notebook's Edit is now its own page, with the same editor as a new notebook's draft.

The old Edit dropdown cut off its text, asked for lists one per line, agent ids and cron, and couldn't change fields, checks or steps. The page shows the whole setup:
- limits and stages as chips, and done-whens and checks as rows; a met done-when stays ticked;
- steps with their agents; a step you keep keeps how far it got;
- the fields sua notes for each option;
- searches by name, and the schedule in words.

Stop, Save as a template, Archive and Delete are under More. Chips no longer cut their words short, and a long one fits its column on a phone.
