---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Dashboard editor — create, customise, reorder (widget-packs PR 5/5).

Closes the widget-packs architecture series. New surfaces:

- **`GET /dashboards/:id/edit`** — editor for any stored dashboard.
  Each section gets a rename input + up/down arrows + delete; each
  tile gets up/down arrows + delete; an "Add tile" dropdown lists
  agents not already in the section; an "Add a section" form at the
  bottom; "Delete dashboard" for user-created dashboards.
- **`POST /dashboards`** — create a user dashboard from the dropdown.
  The dashboards dropdown gained a "New dashboard name" input that
  POSTs here; redirects to the new dashboard's editor.
- **Action endpoints** — `POST /dashboards/:id/sections`,
  `/sections/:idx/{rename,delete,move}`,
  `/sections/:idx/tiles`,
  `/sections/:idx/tiles/:tileIdx/{delete,move}`,
  `/dashboards/:id/delete`. All form-POST + 303-redirect — no JS.
- **"Edit" button** on every dashboard view page (top-right of the
  header strip).
- **Pack-owned dashboards are editable** but can't be deleted directly
  (uninstall the pack instead). User-created dashboards can be deleted.
- The Default Dashboard backing `/pulse` stays non-editable — it's
  auto-derived from `pulseVisible`, so per-agent toggles are the
  edit affordance there (already exists via the existing × button).

Drag-drop reorder is intentionally deferred. The existing
`widget-layout.js.ts` has the bones for it (currently localStorage-only);
swapping its persistence layer to call this PR's `/sections/:idx/move`
endpoints is a clean follow-up.

11 new supertest cases covering every action endpoint; full suite
1038/1038 green. Live smoke: created "Morning Briefing" → added
Weather section → added weather-forecast tile via the editor.
