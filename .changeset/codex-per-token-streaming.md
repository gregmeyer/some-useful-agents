---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Codex spawner: per-event streaming parallel to Claude (PR 4.5).

Parallel to PR #404 — extends `codexSpawner` to opt into
`codex exec --json` and forward the structured event stream into
the inbox SSE pipeline. Triage replies running on codex now stream
into the typewriter bubble shipped in PR #405 instead of arriving
all at once after `addResponse`.

**Changes** in `packages/core/src/node-spawner.ts`:

- `buildArgs` adds `--json` so codex emits a JSONL event stream
  instead of raw prose.
- `parseProgress` handles the codex shape (sampled live):
  - `turn.started` → `turn_start`
  - `item.completed` with `item.type=agent_message` → `output_chunk`
    carrying the full `item.text`
  - `turn.completed` → `turn_complete` with `usage.output_tokens`
    as the turn-count proxy
  - Other event types (thread.started, future tool_use, reasoning,
    etc.) are silently skipped.
- `extractResult` walks back to the last `agent_message` item and
  returns its text — `--json` makes stdout JSONL, so the previous
  identity passthrough would have stored the raw event stream as
  the run's `result`. Falls back to raw stdout if no
  agent_message line is found (defensive for future event shapes).

**Caveat (same as PR #404 plan).** Codex emits the full assistant
text in a single `agent_message` item, not token-by-token deltas
like claude's `--output-format stream-json`. So the typewriter
reveal with codex feels like "whole reply arrives ~RTT before
turn.completed" rather than ChatGPT-style streaming — still a
visible win over the prior "reply lands at addResponse time"
behavior, just less dramatic.

**Live-verified end-to-end** with codex as waterfall primary:
posted a reply, observed `triage:token` event over the SSE stream
carrying the full plan JSON before `triage:complete`. The dashboard
typewriter bubble renders the chunk live.

13 new codex unit tests covering buildArgs flags, all parseProgress
branches, agent_message preference in extractResult, raw-stdout
fallback. 1863 tests pass (+13).
