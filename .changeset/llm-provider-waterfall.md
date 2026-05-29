---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

LLM provider waterfall + pinned-provider fallback fix.

The previous one-primary + one-fallback model bricked runs in two
common scenarios: (a) an agent or node pinned to a single provider
(e.g. `provider: claude`) silently disabled fallback so any CLI
outage took the run down with it; (b) the chain stopped after one
hop even when more providers were available.

Replaces both with an ordered waterfall.

**Schema.** `LlmSettings.providers: LlmProvider[]` (ordered;
`providers[0]` is the primary). The old `{ primary, fallback? }`
shape is auto-migrated on first read. Empty chains are rejected — at
least one provider must remain so every llm-prompt node has
something to dispatch to.

**Waterfall.** `spawnNodeReal` now builds a chain via the new
`buildProviderChain(pinnedProvider, configuredOrder)` helper: the
node's pinned provider (if any) goes first, then the configured
global order follows, deduplicated. The loop walks the chain in
order; on classified failures (credit / quota / binary-missing /
hard-timeout) it advances to the next provider, fires per-hop
telemetry, and continues. Rate-limit / auth / other errors still
short-circuit the chain.

**Telemetry.** `NodeExecutionRecord` gains `usedProvider` (the
provider that actually produced the result) and `attemptedProviders`
(CSV trail in order). The run detail page surfaces a "ran on codex ·
claude failed" chip on node rows whenever the trail has more than
one entry. `LlmSettingsSnapshot.onFallback` now fires once per hop
with `from`/`to` instead of a single primary/fallback callback.

**Dashboard `/settings/llm`.** Replaces the primary + fallback
dropdowns with an ordered chain UI: rank, provider id + label,
Primary/Fallback chip, Up/Down/Remove per row, plus an "Add
provider" dropdown when not all known providers are in the chain.
Routes split into `POST /settings/llm/add`, `/remove`, `/move`.

**Tests.** New unit tests for `buildProviderChain` (5 cases
covering: configured order with no pin, pin biases head, dedup, no
config defaults to claude, pin survives empty config, three-provider
order). Store tests rewritten for the new API plus three migration
cases (v1 → v2, v1-without-fallback, v1 lastFallback preservation)
and two defensive-parse cases for hand-edited v2 files.
