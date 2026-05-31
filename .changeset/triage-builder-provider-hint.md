---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

feat(dashboard,examples): inbox triage honors a provider hint when dispatching agent-builder

When the operator says "build it on apple" (or names any provider in
the conversation), the inbox-triage prompt now emits an optional
`PROVIDER` field in the action's `inputs` map. The route extracts it
as a provider pin, strips it from the agent inputs (so input-
resolution doesn't reject an undeclared key), and applies the pin to
every llm-prompt node in the agent-builder agent via the
`applyProviderPin` helper exported from build-orchestrator.

Mirrors PR #422's "Build from goal" provider picker but driven from
the conversation instead of a UI control. The global fallback chain
in `/settings/llm` still applies on classified failures — the pin
says "try this first," not "use only this."

Triage prompt updates:
- Maps loose phrasings: "apple" / "on-device" / "foundation models"
  → `apple-foundation-models`; "claude" → `claude`; "codex" /
  "openai" → `codex`.
- Hard rule: omit `PROVIDER` entirely when the operator didn't name
  a provider. Never invent the hint.
- New OUTPUT FORMAT example shows the shape.

The validator drops PROVIDER if the operator didn't supply one or if
the value isn't in `LLM_PROVIDERS`, so a malformed hint silently
falls back to the system default chain.
