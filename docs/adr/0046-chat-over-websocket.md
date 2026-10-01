# ADR-0046: Chat over a WebSocket, with streamed replies

- Status: accepted
- Date: 2026-10-01
- Deciders: Greg Meyer

## Context

The agent Chat tab (ADR-0039) posted a form, redirected, and reloaded every 3 s until the run
ended: no streaming at all. The inbox thread streams triage tokens over SSE, one-way, with sends
as separate POSTs. Inline A2UI widgets in chat (plan: `pulse-a2ui-canvas.md`, WS2/WS3) need a
two-way channel: the browser sends messages and widget actions, the server streams text, tool
calls and UI updates.

## Decision

- One WebSocket per tab at `/ws` on the dashboard's own port (`ws` package; Node has no
  built-in WebSocket server). JSON frames: `subscribe`/`unsubscribe` a channel
  (`session:<id>`), `chat.send`, `chat.cancel`, `ping`; the server sends `event` frames
  (`turn-start`, `token`, `tool`, `turn-end`), `chat.started`, `error`.
- Events go through the existing per-channel ring-buffer bus (the inbox's `InboxEventBus`
  class, a separate instance with a 400-event ring). Each event carries an id; a reconnecting
  client re-subscribes `since` its last id and misses nothing still buffered. Every event
  carries its `runId`, so a replay can be filtered to the turn in progress.
- `chat.send` subscribes the connection to the conversation **before** the turn publishes
  anything (a hook in `startChatTurn`), so a new conversation's first events can't be lost; the
  client holds events for channels it hasn't claimed yet.
- The finished reply is re-rendered from the stored transcript (`?fragment=transcript`), not
  assembled from streamed pieces, so live and reloaded views can't drift.
- Claude runs with `--include-partial-messages`; its `text_delta`s become `output_delta`
  progress, which the executor forwards to live listeners but does not store (hundreds per
  reply would rewrite `progressJson` hundreds of times). The full message still arrives as
  `output_chunk`, which the relay skips for nodes that already streamed.
- Security: same session cookie and Host allowlist as HTTP, plus a **required** allowed
  `Origin` (browsers always send one on WebSocket handshakes; this blocks cross-site WebSocket
  hijacking). 64 KB frames, 120 messages/min, 25 s heartbeat. CSP `connect-src` names the
  dashboard's own `ws://` origins.

## Consequences

- One new runtime dependency (`ws`).
- The form path stays as the no-JS / no-socket fallback.
- Codex and OpenAI-compatible endpoints stream per message, not per token, until their spawners
  emit deltas.
- Durable (Temporal) runs don't relay progress; the client polls for them.
- Inbox threads (WS1b) ride the same socket: `inbox:<messageId>` channels backed by the inbox
  bus, and `inbox.send` (the same `addInboxReply` path as POST /respond). The thread modal's
  handlers are unchanged; an EventSource-shaped adapter feeds them socket events, and the
  per-thread SSE endpoint stays as the fallback. The page-wide `/inbox/events` feed (badge,
  list) stays on SSE for now.
- Next: inline A2UI surfaces and actions ride the same frames (WS2).
