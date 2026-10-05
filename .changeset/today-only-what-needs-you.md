---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Home's Today shows only what needs you, and says what that is.

**Left out of Today:**
- sua's own agents;
- one-off failures (a failing agent shows when it's failed twice in a row, or a scheduled run just failed);
- failures from over a week ago on agents that don't run on a schedule;
- failure conversations whose agent has since run fine;
- drafts untouched for two weeks.

**Needs you** now opens with a one-line breakdown of what's in it. Making a draft active in its pane clears the pane's buttons and says it's off Today.
