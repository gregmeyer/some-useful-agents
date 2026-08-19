---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

The new-agent form tidies the Id instead of rejecting it.

Typing `what-do-I-wear` used to fail with "Id must be lowercase letters,
digits, or hyphens" and make you retype it — a wall on the first field of the
first thing a newcomer creates. Capitals, spaces and punctuation are all
fixable, so the server now slugifies (`What Do I Wear?` -> `what-do-i-wear`)
and only errors when there's nothing left to build an id from.

When the id changes, the arrival flash says so: *Created as "what-do-i-wear".
Run it to see what it does.*

The form also fills the Id in from the Name as you type, stopping the moment
you edit the Id yourself. The `pattern` attribute is gone from the input — it
blocked submit client-side, so a capital letter never reached the server to be
normalized in the first place.
