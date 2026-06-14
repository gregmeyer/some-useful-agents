---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Triage can now resolve relative times into concrete due dates.

The inbox triage agent gets the operator's current wall-clock time as a new
`NOW` input (ISO 8601 with the local UTC offset). The prompt instructs it to
turn relative phrasing — "before 4:30pm today", "tomorrow 9am", "in 2 hours" —
into an absolute ISO 8601 timestamp it can hand to an agent that takes a due
date (e.g. a reminder's `DUE_DATE`), instead of passing a vague phrase or
guessing the date. Pairs with reminder agents that expose a due-date input.
