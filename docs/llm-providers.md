# LLM providers

`llm-prompt` nodes (the canonical LLM node type; `claude-code` is a legacy
alias) don't call a hardcoded model. Each run resolves an ordered **provider
waterfall**: the primary provider is tried first, and on a *classified* failure
the runtime walks the rest of the chain until one succeeds. Manage it all at
**Settings → LLM** (`/settings/llm`).

## Providers

Two kinds of provider can sit in the waterfall:

**Built-in CLI providers** — spawn a local CLI binary:

| id | binary | notes |
|---|---|---|
| `claude` | `claude` | Claude Code CLI (default primary) |
| `codex` | `codex` | OpenAI Codex CLI |
| `apple-foundation-models` | on-device | Apple Foundation Models via a Swift runner compiled on first use; macOS only |

**Custom OpenAI-compatible providers** — POST to a `/v1/chat/completions`
endpoint. This is how you run a **local or self-hosted model** (llama.cpp,
LM Studio, Ollama, vLLM, a gateway, …) as a first-class provider. Each one is a
named entry with an `apiBase`, an optional `apiKey`, and a `model`.

## The waterfall

- `providers[0]` is the **primary** — every `llm-prompt` node calls it by
  default.
- On a **recognized** failure the runtime falls through to the next provider:
  binary missing / endpoint unreachable, timeout, quota or credit exhausted,
  auth required (401), or rate limited (429). Unclassified errors stay on the
  same provider so real bugs surface instead of being masked.
- A custom endpoint participates identically — a down endpoint classifies as
  unreachable and falls through; a 401/429 maps to auth/rate-limited.

## Add a custom endpoint

At **Settings → LLM → Custom OpenAI-compatible endpoints**:

1. Fill in **Name** (a slug, e.g. `local-qwen-8b`), **API base URL** (e.g.
   `http://127.0.0.1:8181/v1`), **Model** (e.g.
   `unsloth/Qwen3-8B-GGUF:UD-Q4_K_XL`), and an optional **API key** (leave blank
   for a local server).
2. **Probe** does a reachability check (`GET {apiBase}/models`).
3. Add it to the waterfall from the **Add provider** dropdown, and reorder with
   the ↑/↓ controls to make it primary or a fallback.

The endpoint is stored in your local LLM settings; the API key is masked in the
UI and never re-rendered into a form field.

## Enable / disable a provider

Each waterfall row has a **Disable** switch. Disabling keeps the provider in the
chain (slot + config preserved) but **skips it at runtime** — flip `claude` and
`codex` off to run **local-only**, then flip them back on any time. The store
keeps at least one provider enabled, and "Primary" is always the first *enabled*
provider.

Disabling is global: a disabled provider is off **everywhere**, including for a
node that pins it (see below) — the pin falls through to the first enabled
provider rather than forcing the disabled one to run.

## Per-node / per-agent pins

Set `provider:` on an agent (default for all its LLM nodes) or on an individual
node (overrides the agent default):

```yaml
nodes:
  - id: format
    type: llm-prompt
    provider: local-qwen-8b   # a builtin id OR a custom provider name
    model: unsloth/Qwen3-8B-GGUF:UD-Q4_K_XL   # optional; overrides the provider's default model
    prompt: |
      Summarise the upstream JSON as one sentence.
```

A pinned provider runs **first**, and the remaining providers in the global
order still apply as fallbacks — a pin no longer disables fallback. (Exception:
a pin to a *globally disabled* provider is neutralized, as above.)

## Where it's stored

Provider settings live in your local LLM settings file (not the repo). Custom
providers, the waterfall order, and the disabled set all persist there and take
effect on the next run — no daemon restart needed. There's no CLI for LLM
settings today; manage them from **Settings → LLM**.

## Fallback telemetry

When a hop fires, `/settings/llm` records the last fallback (`from → to`,
reason, agent/node). Each run's node execution also stores `usedProvider` (which
provider actually produced the output) and the full `attemptedProviders` trail,
visible on the run-detail page.

## Tool-calling (OpenAI-compatible providers)

Under a **custom OpenAI-compatible provider** (a local model like Qwen behind a
`/v1/chat/completions` endpoint), an `llm-prompt` / `claude-code` node can let the
model **call builtin tools mid-generation** — so a prompt like "search the web and
return the top results" actually works instead of the model pretending.

List the registry tool ids the model may call in the node's `tools` field. Builtin,
generated integration (csv/postgres/sqlite), and MCP tools are all supported (builtin
ids in `allowedTools` are also honored for back-compat):

```yaml
- id: research
  type: llm-prompt
  provider: my-qwen          # a custom OpenAI-compatible provider
  tools:
    - web-scrape             # builtin
    - csv.read.sales         # generated integration tool
    - notion.search          # MCP tool (from a registered, enabled server)
  maxTurns: 6                # cap on tool-call turns (default 5)
  prompt: |
    Look up this quarter's sales in the CSV, cross-reference the roadmap in
    Notion, and summarize. Use the tools — don't guess.
```

How it works: the harness sends the tools as OpenAI function schemas (tool ids with
dots — generated + MCP — are given safe function names and mapped back on the way in),
runs each tool call the model requests (output size-capped, and gated by the tool
policy), feeds the results back, and loops until the model returns a final answer or
`maxTurns` is hit. MCP tools are invoked through the same pooled client and
server-enable gate as MCP tool *nodes*; a disabled server surfaces as an in-loop error
the model can read, not a crash.

**Provider support:** this works on the **OpenAI-compatible HTTP path only** — any
`kind:'openai'` custom provider (local llama.cpp/Ollama, or a hosted OpenAI-compatible
API). The `claude` and `codex` CLIs run their own tool loops with their own tools;
the `tools` field does not apply to them. Apple Foundation Models has no tool support.

**Not yet exposed:** shell / claude-code *user* tools (they are spawn-based), and
per-action schemas for multi-action tools (the tool is exposed with its shared input
schema). Resource-scoped policy enforcement for generated/MCP tools is pending — the
policy gate is wired but currently evaluates to allow.
