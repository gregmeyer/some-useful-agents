---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Record and surface WHY each LLM provider was skipped in the fallback waterfall.

When the LLM provider waterfall falls back (e.g. codex → apple-foundation-models),
the per-attempt failure reason used to be discarded once a later provider
succeeded. Each failed attempt is now captured (`{provider, category, error}`),
persisted on the node execution (`provider_failures_json`), and logged to stderr
(`[llm-fallback] agent/node: codex failed (timeout): …`). The run-detail node
card now reads "ran on apple-foundation-models · codex (timeout) failed" with the
full error in the hover, instead of a bare "codex failed".
