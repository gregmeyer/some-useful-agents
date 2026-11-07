---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A meeting notebook's "In their words" shows what they said at each source, even with no quote field; a quotes panel with nothing to quote no longer stands empty while a step runs; a correction's recheck counts the checks it reopened.

A meeting notebook of topics (topic, why it matters, question, source) has no quote field, so "In their words" was always empty, and it showed as a blank box while a step ran. Now a notebook about a person takes each option's source words (the quote the finder keeps), so the section and the cover's pull quote show what they wrote. A notebook with nothing to quote leaves the panel out instead of holding it open. And after a correction, "Checked what you corrected" counts the checks the correction reopened, not ones that were open before, so it no longer says "0 of 3 checked" when all of them were.
