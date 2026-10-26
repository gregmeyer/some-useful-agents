---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/dashboard": patch
"@some-useful-agents/temporal-provider": patch
---

sua's checker settles checks from an option's own facts first, researches the rest three at a time, and finishes when options you chose fail a check.

A notebook's check step used one long model node to check every option, searching the web as it went, and on a long list it could time out. Now a quick node with no web settles what each option's own facts and notes show (quotes of its facts are matched however they're spaced, so checks settled from facts aren't left open). Only the checks still open go to the web, through research-fanout: one small run per option, three at a time. Every quote is still confirmed word for word before anything is ticked or ruled out. A check that fails on an option you chose doesn't rule it out: it counts as checked and shows as ✗ "fails; you kept it", so the step can finish. A check step installs research-fanout and research-one along with the checker.
