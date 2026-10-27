---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A template keeps who its profile step learns about, filled in each time.

A template saved from a notebook with a profile step dropped the step's subject, so a notebook started from it looked up its title ("Create a briefing on Ramp") instead of who it's about. The subject is now kept as `{subject}` and filled in when the notebook starts. Writing an answer again now says the answer is replaced, not the talking points.
