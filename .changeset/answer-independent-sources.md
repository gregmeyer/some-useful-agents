---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

An answer's Find step looks for sources from outside what it's about.

An answer notebook's Find step now counts publishers, not pages ("4 of 8 publishers"), so several pages of one project's docs count as one voice. When the question names what it's about (A2UI, AG-UI, CopilotKit), the step also wants at least two publishers from outside them. sua's finder is told who the sources are from so far and, when too few are from outside, runs an independent search for third-party comparisons, analyses and press that leaves out the subjects' own sites; code adds that search if the finder's plan didn't.
