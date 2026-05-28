---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox: in-place modal + Slack-style triage conversation.

Dogfood feedback: "doesn't feel fluid to have to go to a new page load
to have a conversation about the current row, and I'd like the triage
agent to join the thread." A previous take stalled because the modal
polled on a `triageRunId` marker that races the dag-executor — when
the executor's run-store row landed after the modal's first refresh,
polling stopped and the agent's reply never appeared.

This PR:

- **Single sortable grid** (Priority / Source / Agent / Title / Age /
  Status) replacing the three priority-grouped tables. Click any
  column header to sort; the active column shows ↑/↓. Priority and
  Source render as colored badges (warn/info/muted) so high-pri and
  run-failure rows pop visually.
- **In-place modal** opens on row click — no page navigation. The
  `<a href="/inbox/:id">` link still works as a fallback for
  right-click "open in new tab" and no-JS users. Esc / backdrop /
  Close all dismiss.
- **Slack-style conversation thread**: avatar + name + timestamp +
  body per entry, colour-coded by role (YOU teal, TRI info-blue,
  SYS muted). New entries on each fragment refresh get a one-shot
  `inbox-msg--new` slide-in animation. The conversation pane
  auto-scrolls to the bottom when new content lands.
- **Animated "thinking..." indicator** with three pulsing dots
  (Slack-style typing). Replaces the previous static text.
- **Reliable polling**: the modal force-polls for 30s after every
  Reply / Ask-triage submit, in addition to honouring the
  `data-triage-pending="1"` marker. The server-side fragment also
  reports pending when the latest response is a user reply <30s old
  with no later triage/system reply — covers the unavoidable race
  between POST returning 204 and the dag-executor's run-store row
  appearing.
- **`agents/examples/inbox-triage.yaml`** — `source: examples`
  system agent. Single llm-prompt node; takes message + context +
  conversation as inputs; emits `<plan>{messageId, recommendation,
  verifyHint}</plan>` parsed by the route (mirrors layout-planner
  pattern; no new built-in tool, no SSRF whitelist).
- **`POST /inbox/:id/triage`** inserts a synthetic "Asked triage to
  take another look" user marker before kicking off the agent, so
  the operator's action is visible in the thread.
- **Dual-mode mutation routes**: 204 with no body for AJAX (modal
  fetch), 303 redirect for plain form posts (fallback page).
- 16 route tests cover sort, fragment rendering with avatars,
  pending-indicator derivation, all three mutation routes in both
  modes, and synthetic-marker insertion on /triage.
