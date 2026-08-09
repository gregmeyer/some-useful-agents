---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Add a deterministic ablation eval for the agent routing metadata.

A new test measures whether `entryConditions` / `sampleQuestions` actually improve
triage routing: it runs a labeled set of request→agent pairs through the pure
`selectTriageCatalog` ranker with and without the routing fields, and asserts
recall@cap strictly improves with them. Locks the benefit in as a regression guard
(no LLM cost). Measured on the fixture: recall@10 rises from 0.08 to 1.00.
