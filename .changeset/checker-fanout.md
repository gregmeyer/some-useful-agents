---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/dashboard": patch
"@some-useful-agents/temporal-provider": patch
---

sua's checker settles checks from an option's own facts first, and researches the rest three at a time.

A notebook's check step used one long model step to check every option, searching the web as it went, and on a long list it could time out. Now a quick step with no web settles what each option's own facts and notes show. Only the checks still open go to the web, through research-fanout: one small run per option, three at a time. A check step installs research-fanout and research-one along with the checker. Every quote is still confirmed word for word before anything is ticked or ruled out.
