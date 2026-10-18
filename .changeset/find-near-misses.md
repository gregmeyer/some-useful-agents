---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A notebook's find step keeps near misses, ruled out with the limit they miss.

sua's finder used to drop anything just outside a notebook's limits (a car 62 miles away when the limit is 50), so a thin market showed "0 found" with no sign of what was close. Up to 3 near misses per search are now filed ruled out, with the reason ("Just outside the limits: 62 miles away; the limit is 50"), so you can see them and reinstate one.
