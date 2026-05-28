---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox: in-place modal + triage agent joins the thread.

Dogfood feedback: "doesn't feel fluid to have to go to a new page load
to have a conversation about the current row, and I'd like the triage
agent to join the thread."

This PR replaces the click-to-navigate detail flow with a modal that
opens over the inbox list, and adds the triage system agent that
auto-replies in the conversation thread when the user posts a reply.

- **Single sortable grid** with priority + source badges (replaces
  the three priority-grouped sub-tables from the MVP). Click any
  column header to sort; active column shows ↑/↓.
- **Modal in place**: row click opens `<div id="inbox-modal">` over
  the list. `inbox-modal.js.ts` fetches `/inbox/:id/fragment`,
  intercepts the Reply / Dismiss / Ask-triage forms via `fetch`,
  re-fetches the fragment after each mutation, polls every 1.5s
  while a triage run is in progress, and removes the row from the
  list when Dismiss succeeds. Esc / backdrop / Close all dismiss.
  The `<a href="/inbox/:id">` row link still navigates as a
  fallback (right-click "open in new tab", no-JS users).
- **`GET /inbox/:id/fragment`** returns inner detail HTML with no
  layout chrome — the modal's fetch target. `GET /inbox/:id` still
  serves the full-page version, wrapping the same fragment renderer
  in the standard layout.
- **`agents/examples/inbox-triage.yaml`** — new `source: examples`
  system agent. Single llm-prompt node, takes the message + context
  + conversation as inputs, emits `<plan>{ messageId, recommendation,
  verifyHint }</plan>` parsed by the route (mirrors the layout-planner
  / build-orchestrator pattern; no new built-in tool needed, no SSRF
  whitelist).
- **`POST /inbox/:id/triage`** — lazy-installs the YAML, spawns the
  agent via `executeAgentDag`, parses the plan, appends a
  `triage`-role response to the conversation, transitions the
  message to `awaiting_user`, and mirrors the recommendation onto
  the message row.
- **Auto-trigger** — `POST /inbox/:id/respond` fires the triage
  agent in the background (fire-and-forget) after storing the user
  reply. The modal polls `/fragment` while `[data-triage-pending]`
  is present; the agent's reply appears in the thread without any
  user action.
- Mutation routes return **204 for AJAX (modal) / 303 for plain
  form posts** (fallback page) so the same endpoints serve both
  flows cleanly.

15 new route tests cover the grid sort + fragment render + all
three mutation routes in both AJAX and form-post modes.
