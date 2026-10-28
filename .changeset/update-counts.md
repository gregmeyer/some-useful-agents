---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Updating a shortlist counts and says what's new correctly.

The update told the new options apart by their short name, so a new "Staff PM" role was mixed up with older roles of the same name and counted as still open after it was checked; it goes by id now. A notebook whose earlier searches ran before passes kept their step now gets "What's new" after an update, against its last search. And the update's message keeps the new options' names on the search's line.
