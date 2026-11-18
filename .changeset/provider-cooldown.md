---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A provider that's down is skipped for a while instead of being tried on every node.

When a provider fails in a way that will keep failing (out of quota or credit, its CLI missing or its endpoint unreachable, signed out, rate limited), the waterfall skips it on the following nodes until a cooldown ends. The cooldown lasts until the reset time the error states ("try again at … 12:28 PM"), or a default for the category (30 minutes for quota or credit, 5 for a missing CLI or sign-in, 1 for a rate limit). The node's trail says it was skipped and why. A success clears it, and when every provider is cooling down the chain is tried as configured. On the live install, an out-of-quota codex and a local model that wasn't running were costing every LLM node about 16 seconds, a quarter of all LLM node time.
