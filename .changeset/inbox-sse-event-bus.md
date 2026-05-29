---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox conversation SSE: structured event bus + EventSource client.

Plan path B, PR 2 of 4. Replaces the 1.5s fragment poll for active
conversations with a server-sent-events stream so action card
transitions and triage replies land at network RTT instead of poll
cadence. The fragment poll stays as a fallback when SSE is
unavailable or disconnects.

**Event bus.** `packages/dashboard/src/lib/inbox-event-bus.ts` —
in-memory pub/sub keyed by `messageId`. Each channel keeps a
50-event ring buffer for `Last-Event-ID` replay; a 5-minute idle GC
drops abandoned channels. Listener errors are swallowed so one bad
subscriber can't starve the rest.

**SSE endpoint.** `GET /inbox/:id/events` in
`packages/dashboard/src/routes/inbox-events.ts`. Standard SSE
headers (`text/event-stream`, `Cache-Control: no-cache, no-transform`,
`X-Accel-Buffering: no`), 2KB initial padding to defeat proxy
buffering, 15s heartbeat. Honors `Last-Event-ID` for reconnect
catch-up. Cookie auth (EventSource sends same-origin cookies
automatically).

**Publish hooks** in `routes/inbox.ts` at every lifecycle sync point:
user reply persisted → `message:created`; `runTriageAgent` start →
`triage:started` + `state(thinking)`; triage reply persisted →
`triage:complete` + `state(done)`; each proposed action card →
`action:created`; every action status transition (running, skipped,
completed, failed, refused) → `action:status`.

**Client.** `inbox-modal.js.ts` opens an `EventSource` per modal,
listens to all event types, and schedules a single `refresh()` per
animation frame on any event (the SSE notification is the wake-up
signal; canonical state still comes from `/fragment`). A 20s
watchdog forces a fragment refresh if no events or heartbeats
arrive, keeping the UI consistent even when SSE proxies misbehave.

PR 3 will start emitting per-token `triage:token` events from the
claude CLI; PR 4 will start patching DOM incrementally for those.

Tests: 14 new bus tests covering publish/subscribe semantics, ring
buffer overflow, Last-Event-ID replay, idle GC, throwing-listener
isolation. 4 new SSE route tests covering wire format, auth, 404,
and Last-Event-ID replay. Total 1841 pass (+18).
