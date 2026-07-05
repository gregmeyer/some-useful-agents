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

Add one from **Settings → LLM**: a "Custom OpenAI-compatible endpoints" form
(name, API base, model, optional key) saves the provider, a Probe button checks
it's reachable, and it then appears in the provider-waterfall dropdown. The
stored `CustomLlmProvider` (waterfall entries widened to plain names, v2→v3
settings migration) is resolved on every run path, and node `provider` pins now
accept a custom provider name. The API key is masked in the UI and never echoed
back into the form.

Each provider in the waterfall also gets a **Disable** switch: it keeps its slot
and config but is skipped at runtime — flip claude/codex off to run local-only,
then flip them back on any time (the store keeps at least one enabled).
