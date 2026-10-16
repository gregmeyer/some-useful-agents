---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Pick the Claude model from what Claude offers now, and hear from sua when one is retired.

Settings → LLM's claude row gets the same Model picker as codex, filled from the model catalog the Claude CLI keeps for your account, and agent settings suggest current Claude models instead of Opus 4.6 / Sonnet 4.6 / Haiku 4.5. Claude's "There's an issue with the selected model" now counts as a retired model, so it falls through the waterfall and sua gets one System health thread naming where the model is used.
