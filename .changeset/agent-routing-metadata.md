---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Agents can declare routing metadata: entry conditions, non-entry conditions, and sample questions.

New optional agent fields — `entryConditions`, `nonEntryConditions`, and
`sampleQuestions` (each a list of strings) — let an agent describe when it should
and shouldn't handle a request and what questions it answers. They round-trip
through YAML and the versioned agent store like `tags`. Subsequent changes wire
these into the routers (inbox triage, the build surveyor, and MCP `list-agents`)
so requests reach the right agent more reliably.
