---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox streaming: per-token capture from Claude CLI to SSE bus.

Plan path B, PR 3 of 4. Extends the SSE pipeline so triage replies
stream text chunks live instead of materializing all at once when
the DAG completes. PR 4 will hang the typewriter reveal off these
events.

**Core change.** `claudeSpawner.parseProgress`
(`packages/core/src/node-spawner.ts`) now inspects the `content`
array of every `assistant` event from the `--output-format stream-json`
output. Each text chunk emits an `output_chunk` SpawnProgress with
the actual text in `message`. Tool-use content still produces
`tool_use` events. Empty assistant events fall back to `turn_start`
("Claude is responding…") so the UI keeps an alive signal.

**Decoupling hook.** New optional `DagExecutorDeps.inboxOnProgress`
forwarder. The dag-executor's existing progress collector
synchronously calls it (alongside the DB `progressJson` write)
with `{nodeId, progress}`. Errors swallowed so a misbehaving
adapter can't break a run. Core knows nothing about the bus.

**Dashboard adapter.** `runTriageAgent` passes an `inboxOnProgress`
that filters `output_chunk` and republishes as `triage:token`
SSE events with `{nodeId, chunk, at}` payload.

Live-verified: with claude as the waterfall primary, posting to
/inbox/:id/triage produced a `triage:token` event over the SSE
stream with the assistant's full plan JSON chunk before the
`triage:complete` event fired. Codex still doesn't stream per-token
(parseProgress returns null) — out of scope for this PR; future
work can wire it in the same shape.

8 new parseProgress unit tests covering text deltas, tool-use,
text+tool-use priority, empty assistant events, empty text deltas,
result events, top-level tool_use, unknown event types. 1850 tests
pass (+9).
