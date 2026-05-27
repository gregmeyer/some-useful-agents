---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox MVP — dashboard surface (PR 2/2 of the Inbox MVP).

Wires the `InboxStore` from PR 1 into the dashboard:

- Top nav gains an **Inbox** entry between Scheduled and Agents
  (`activeNav: 'inbox'`)
- `GET /inbox` renders a priority-grouped list (High / Medium / Low
  sections) with row columns: agent, title, source, age, status.
  Mirrors the runs-list table pattern.
- `GET /inbox/:id` renders a detail page with priority/source/age/status
  badges, the message body, a collapsible Context payload, and a
  placeholder for the conversation thread + recommendation that
  arrive in PR 4
- `inboxStore` wired into `DashboardContext` (optional — booting
  without it renders the empty state)
- New `SUA_INBOX_DEMO=1` env flag seeds one message per priority on
  boot so the UI is visible before producers are wired in PR 3.
  Disappears when PR 3 lands.

The MVP is read-only. Producer hooks (failed runs, CSP-block
escalation, cadence agent), mutation routes (dismiss / respond /
triage), CLI verbs, and verification all ship in follow-up PRs.
