---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Pick the Codex model from what Codex offers now, and hear from sua when a model is retired.

Settings → LLM's codex row has a Model picker filled from the list the Codex CLI keeps for your account (`~/.codex/models_cache.json`), so retired models like `gpt-5.5` and the old o4-mini/GPT-4.1 suggestions drop out on their own. The pick applies to every codex attempt whose agent or step doesn't name a model. When a Codex model in use is no longer offered (or a run is refused it), the row warns and sua gets one System health thread naming where it's used and what to pick instead; it resolves itself once nothing uses it.
