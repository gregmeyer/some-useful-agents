---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A link in an option's text no longer wipes its facts.

A notebook checks each option's facts against its own text to catch a model mixing up two options. A link the text cited (a source, the job post a quote came from) counted as a mix-up, so opening the notebook replaced every fact with just that link. Now only a number the text states (price, year, the main measure) counts, and a cited link fills in the option's link only when it has none.
