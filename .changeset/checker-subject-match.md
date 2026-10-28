---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A notebook's check step keeps what the web research found for every option.

The check step matched each web answer back to its option by name. A name with an em dash ("Arrive Android app — …"), or one long enough for the research to cut short, didn't match, so those options' answers were thrown away and their checks stayed open however often you ran the step. Now every answer finds its option, and subjects stay within what the research keeps.
