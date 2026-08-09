---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox triage prefers reusing an existing agent over recommending a new one.

Triage no longer jumps to "build a new agent" when one already fits. A new
deterministic `STRONG_CANDIDATE` hint — the single installed agent that clearly
matches the request, computed from the same relevance ranker as the catalog — is
injected into the triage turn, and the kernel now enforces a REUSE-BEFORE-BUILD
gate: reuse the strong candidate when present, run `agent-catalog-search` before
ever proposing a build, and name why the closest existing agents don't fit before
recommending a new one. Applies to any task request, not just "build me an agent"
phrasings.
