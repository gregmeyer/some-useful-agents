# LLM providers

`llm-prompt` nodes (the canonical LLM node type; `claude-code` is a legacy
alias) don't call a hardcoded model. Each run resolves an ordered **provider
waterfall**: the primary provider is tried first, and on a *classified* failure
the runtime walks the rest of the chain until one succeeds. Manage it all at
**Settings → LLM** (`/settings/llm`).

## First run: Connect a model

On a fresh install the dashboard checks whether **any** provider actually
resolves before it shows you the home page. If none does, `GET /` redirects to
**Connect a model** (`/connect-model`), which offers two routes side by side:

1. **Hosted** — paste an API base URL, a model, and a key for any service
   speaking the OpenAI `/v1/chat/completions` API.
2. **Local** — point sua at Ollama / LM Studio / llama.cpp / vLLM. No key
   needed.

Either route saves a custom provider **and promotes it to the front of the
waterfall**, so the next `llm-prompt` run uses it immediately. The endpoint is
probed first (`GET {apiBase}/models`); on a failure the page offers **Save
anyway**, for a server you haven't started yet. **Skip for now** dismisses the
gate (a cookie) — shell agents still run, `llm-prompt` agents will fail until a
model is connected.

The page also lists which built-in CLIs were **detected on this machine** — if
one is installed, sua uses it with no configuration at all, and the gate never
fires.

> **Why a probe and not a config read?** The settings store returns
> `providers: ['claude']` even when no settings file exists, and the runtime
> falls back to the literal `claude` when the chain is empty. A machine with no
> `claude` binary therefore *looks* configured and then fails at spawn time.
> Readiness is only truthful when it's probed.

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

Endpoints are defined in exactly one place: **Connect a model**
(`/connect-model`), reachable any time from **Settings → LLM**.

1. Pick the **Hosted** or **Local** route and fill in the API base URL, model,
   and (for hosted) a key. The provider slug is derived from the model id.
2. The endpoint is probed (`GET {apiBase}/models`) *before* it is written. On a
   failure you get **Save anyway**.
3. It's saved **and promoted to the front of the waterfall**, so the next run
   uses it. Reorder or demote it afterwards on **Settings → LLM**.

Settings → LLM owns the other half of the lifecycle: chain order, enable /
disable, remove, probe-all, and fallback telemetry. Splitting it this way means
"saved" and "usable" are never two different states — the old add-then-add-to-
chain flow could leave a defined endpoint sitting outside the waterfall.

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
