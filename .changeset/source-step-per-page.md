---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A notebook's source step reads each option's own page when its agent reads one page a run.

A source step used to run its agent once for the whole notebook. An agent that reads one page per run (like listing-page-facts) ran with no page, answered "blocked", and no option was read. Now such an agent runs once per option still missing facts (at most 8 a press), with that option's page and the facts it lacks.
- What each page says is filed on that option, sourced to the page.
- A gone item is ruled out.
- A page that blocks the reader is named in the step's note.
- An option with no page of its own is skipped, never run with an empty address.
