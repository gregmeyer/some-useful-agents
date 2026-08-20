---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Backfill routing metadata across the shipped example agents so search and triage find the right one.

Every non-exempt agent under `agents/examples/` now declares `tags`, `entryConditions`, `nonEntryConditions`, and `sampleQuestions`. Previously 8 of 43 had any routing metadata and none had `tags` — which meant the relevance ranker (used by the `/agents` search box, inbox triage, the build-from-goal surveyor, and the MCP `list-agents` payload) had almost nothing to match a newcomer's request against.

Measured against a labeled set of newcomer phrasings run over the real shipped catalog, top-1 accuracy went from 15/27 to 27/27, and the triage reuse hint now fires on 22 of 27 requests instead of 6 — with no wrong hints and no spurious hints on deliberately ambiguous queries.

Two gaps that let the coverage rot are closed as well. The routing eval was entirely synthetic, so it scored perfectly on invented agents while the real catalog went unmeasured; there is now a real-catalog eval alongside it. And CI's "validate all agent YAML files" step called the v1 loader, which silently skips every v2 agent, so it had been reporting `0 agent(s) validated successfully` in green — it now parses the v2 files and fails if it ever validates nothing. A new coverage gate keeps the metadata from thinning out again, and `docs/agents.md` documents `tags` and how the fields are scored.
