---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox triage routes on agent entry conditions and sample questions.

The inbox triage router now uses the new agent routing metadata. An agent's
`entryConditions` and `sampleQuestions` count as strong relevance signals when
ranking which agents triage sees, and all three fields (including
`nonEntryConditions`) are handed to the triage LLM so it prefers agents whose
entry conditions / sample questions match the request and avoids agents whose
non-entry conditions match. `nonEntryConditions` is a veto the LLM applies, not
a deterministic filter, so a valid agent is never dropped from the catalog
before the LLM sees it.
