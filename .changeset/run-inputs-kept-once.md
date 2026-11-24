---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Large strings in a run's stored inputs are kept once, and a new `sua db compact` shrinks the run database.

A node's recorded inputs and a run's resume context repeated the same large text run after run. inbox-triage, for example, stored its kernel, the agent catalog and the runnable specs on every turn. Each string of 4 KB or more is now stored once, in a new `run_blobs` table, and referenced from the row. Reading puts the text back, so the run page, replay and resume see exactly what was written, and the retention sweep drops strings no run refers to. `sua db compact` rewrites rows stored before this change and then VACUUMs the file. On a copy of a real install it took `runs.db` from 510 MB to 351 MB in about 4 seconds, and all 8,082 node rows read back identical.
