---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

The Two-step digest example draws its headlines.

Its summarise step printed the first five lines of the raw source file, so its board tile and run page showed JSON fragments instead of stories. The step now prints the digest as JSON (headlines with title, source and category; count; the count line; last run's note), and the example has a view: a table of headlines and the count line. The outcome block is unchanged.
