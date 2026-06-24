---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Inbox dashboard-editor: resolve dashboards by name, and auto-link `/dashboards/` refs.

Two fixes found dogfooding the new `dashboard-editor` action:

- **No more duplicate dashboards.** add-tile/create now resolve a `DASHBOARD`
  given as a display name ("Morning Brief") to an existing dashboard
  (`user:morning-brief`) by id, slug, or case-insensitive name — instead of
  minting a near-duplicate `user:morning-brief-<ts>`. create is idempotent by
  name.
- **Dashboard links are clickable.** `linkifyRefs` now auto-links bare
  `/dashboards/<id>` references in triage recommendations (it only handled
  `/runs` and `/agents`), and drops the `user:`/pack namespace from the link
  label so `/dashboards/user:morning-brief` reads as `morning-brief`.
