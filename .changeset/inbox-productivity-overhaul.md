---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox is now the primary productivity surface: tighter nav, gridded
list with inline preview, suggested-next-actions banner, favorited
threads rail, + New conversation button, and a vertical timeline
modal with a pinned composer.

- **Top nav reorder**: Inbox moves to the leftmost position. Scheduled
  moves into the Agents sub-nav (joins Tools / Nodes / Runs / Packs).
  No URL changes — `/scheduled` still works.
- **/inbox shell**: two-column grid with a collapsible "★ Favorited"
  left rail (state persisted in `localStorage`), a `⚡ Suggested next
  actions` banner above the list (deterministic counts of
  high-priority / untriaged / awaiting items; collapsible), and a
  priority-grouped main list of gridded rows.
- **Inline preview**: every row gains a chevron that toggles a body +
  context-payload preview in place with an "Open thread" button. No
  modal needed for a quick triage glance.
- **+ New conversation**: button in the page header. `POST /inbox/new`
  creates a `source: manual` row, returns `X-Inbox-Id` for AJAX, opens
  the modal on the new empty thread; first reply auto-fires triage.
- **Modal timeline**: conversation rendered as a `<ul.inbox-timeline>`
  with a vertical rail line and avatar dots at each entry. The
  existing `.inbox-msg` / `.inbox-action` / `.inbox-action__diff`
  cards become typed objects on the timeline — no data-shape changes.
- **Pinned composer**: textarea + actions row stick to the bottom of
  the modal so the reply box never disappears while scrolling long
  threads.

Tests updated for the new shell; new tests cover `POST /inbox/new`
(AJAX 204 with `X-Inbox-Id`, plain-form 303, empty-title fallback)
and the favorited rail. 1789 tests pass.
