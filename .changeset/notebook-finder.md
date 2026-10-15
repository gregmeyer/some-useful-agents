---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A find step with no agent of its own uses sua's finder.

sua's finder (`notebook-finder`, built in) splits a find into 3 to 5 narrow searches, one per site or source (for jobs, one per job board plus the open web), and runs them 3 at a time. Each is its own small run with its own turn limit. Code then files what they found: one option per page, facts by the notebook's fields, nothing it already has, plus a note on where it looked and what each search found. The notebook drafter and sua leave a find step's agent empty unless one of yours is made for that kind of search, and no longer give find steps to a general research agent. On the job notebook, where one big search came back empty, it found 6 new roles in about 3 minutes.
