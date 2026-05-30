---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

fix(core): LLM waterfall now falls back on auth_required and rate_limited

Pre-fix, the waterfall in `node-spawner.ts` only swapped providers on
`binary_missing`, `timeout`, `quota_exceeded`, and `credit_exhausted`.
A node pinned to claude with an expired session (`auth_required`) or a
429 (`rate_limited`) returned a hard failure even when the operator
had wired a multi-provider chain in `/settings/llm` — defeating the
whole point of the waterfall.

`shouldFallback` is now exported and returns true for those two
additional categories. `other` stays excluded so unclassified errors
still surface as real bugs instead of being silently masked by a
provider swap. Five new unit tests cover the expanded policy.
