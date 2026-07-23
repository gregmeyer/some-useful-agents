---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A healthy run no longer reads as a failure, and the analyzer can see what each node produced.

**End-node default.** An `end` node reached in the normal course wrote "Flow
ended early." as the run's terminal result — which reads as a premature failure
and repeatedly convinced operators, inbox triage, and agent-analyzer that a
`completed` run had failed. The default is now the neutral "Flow complete."
(authors who want custom wording still set `endMessage`).

**Analyzer sees node-level output.** agent-analyzer was fed only a run's terminal
result, so for any agent ending on an `end` node the substantive work (e.g. a
query node returning `match_count: 0`) was invisible — and it looped on "run it
again". The analyzer's LAST_RUN_OUTPUT now appends a per-node output digest of
the latest completed run, and its prompt is updated to treat a completed run as
success, read the per-node output to distinguish an empty-data/misconfig issue
from a code bug, and never recommend re-running a run whose outcome it already
has.
