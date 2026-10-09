---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

The research starter still writes a brief when one of its two research angles fails.

Both research steps are optional now, so one that fails or times out no longer sinks the run: the brief is written from the side that finished and says which side is missing. The steps search the web before opening pages, the plan step has more time to start, and the example takes in the prompt fixes made to it in use (a plan that says what to look for rather than naming answers, a URL topic read first, sourced candidates for shopping questions).
