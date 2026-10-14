---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A decided notebook's shortlist draws again.

A decided notebook showed "This widget couldn't be drawn: … Unrecognized key(s) in object: 'onlyChosen'" where its shortlist should be. The browser's copy of the shortlist's settings was missing the "show only the chosen ones" setting the server sends for decided notebooks. A test now checks that the browser accepts every setting the server's catalog does, for every component.
