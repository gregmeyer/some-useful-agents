---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox streaming: typewriter UI for triage replies.

Plan path B, PR 4 of 4 — completes the streaming work. Triage's
reply now paints into a live bubble as the LLM streams text,
replacing the prior "wall of text materializes at LLM finish"
moment with a ChatGPT-style incremental reveal.

**Modal JS** (`packages/dashboard/src/views/inbox-modal.js.ts`)
listens for three new SSE event types:

- `triage:started` — creates a streaming bubble with the Tri avatar
  and a "Writing…" meta label. The server-rendered thinking
  indicator is removed so the operator doesn't see "Triage agent
  is thinking…" sitting above the live reply.
- `triage:token` — appends `chunk` to the bubble's text. Chunks
  accumulate into a string queue and flush once per animation
  frame via `requestAnimationFrame` so a burst of tokens doesn't
  thrash layout. Uses `appendChild(createTextNode(...))` — never
  innerHTML — so any "<" or "&" in the model output renders as
  text, not markup. Auto-scrolls only when the operator was
  already near the bottom (preserves their reading position).
- `triage:complete` — clears `data-streaming`, sets
  `data-settled="1"`. The blinking caret hides; the canonical
  fragment refresh that follows (via the existing onAnyEvent
  scheduler) replaces the bubble with the persisted entry,
  no flicker.

**CSS** (`packages/dashboard/src/assets/screens.css`) adds the
streaming caret — a black-vertical-rectangle pseudo-element after
`.inbox-msg__text`, blinking at 900ms via `inbox-stream-caret`
keyframes. Settled state hides it.

Live-verified end-to-end: posted a reply, watched
`bubble-text-len=582 streaming=true` at t=9s and
`settled=true` at t=10s with the screenshot showing the bubble
mid-write (avatar + "Writing…" meta + visible streamed text
ending in `<plan>` `{`).

1850 tests pass (no test changes — pure runtime behavior).
