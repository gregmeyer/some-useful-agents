---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Custom OpenAI-compatible LLM providers (local / self-hosted models over HTTP).

Until now every LLM provider was a CLI transport (claude, codex, apple). This
adds the first HTTP provider path: an operator can define a custom
OpenAI-compatible provider — a name, an `apiBase` (e.g. a local
`http://127.0.0.1:8181/v1`), an optional `apiKey`, and a `model` — and reference
it in the provider waterfall or pin a node to it. Requests POST to
`/v1/chat/completions`; the result flows through the exact same fallback
machinery as a CLI provider (a down endpoint classifies as unreachable and falls
through to the next provider; 401 → auth, 429 → rate-limited, timeout → timeout).

This core release makes such a provider runnable once defined in the LLM settings
store (`CustomLlmProvider`, waterfall entries widened to plain names, v2→v3
settings migration). The `/settings/llm` UI to add one from the dashboard lands
next. Node `provider` pins now accept a custom provider name.
