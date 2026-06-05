---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Treat contract-violating LLM output as a fallback-worthy failure.

A node can now declare an `outputContract` (`mustMatch` regex / `minChars`). When
a 0-exit LLM result fails it — e.g. a weak fallback model returns no `<plan>`
block — the provider waterfall now classifies it as a new fallback-worthy
category `invalid_output` and escalates to the next (stronger) provider instead
of accepting useless output. If every provider fails the contract, the run fails
honestly instead of being a silent success. Opt-in: nodes without a contract are
unaffected.
