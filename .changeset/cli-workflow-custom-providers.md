---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix: `sua workflow run` / `replay` now respect custom LLM providers.

The CLI executor never loaded the operator's LLM settings, so `llmSettings`
(the provider waterfall + `kind:'openai'` custom providers) never reached the
DAG executor. A node pinned to a custom provider (e.g. a local model on a
`/v1/chat/completions` endpoint) couldn't be resolved and silently fell through
to the default `claude` spawner — so CLI runs answered from Claude instead of the
local model, and any exposed tools were the wrong set. The `run` and `replay`
commands now build an `LlmSettingsSnapshot` from the settings file (same shape the
dashboard uses) and pass it through, so custom providers work identically from the
CLI. The dashboard was already correct.
