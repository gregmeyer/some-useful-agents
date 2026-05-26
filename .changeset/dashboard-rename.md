---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Rename a dashboard from the editor.

The dashboard editor (`/dashboards/:id/edit`) now has a name field + Rename
button, posting to a new `POST /dashboards/:id/rename` route. Renaming
re-upserts with the existing id, packId, and layout — so the stable id never
changes and the dashboard stays findable for delete (and pack uninstall, for
pack-owned dashboards) after the display name changes. The editor header now
shows that stable id. The built-in "Default Dashboard" (the Pulse view) has no
stored row and is not renameable by design.

Pack-owned dashboards can't be deleted directly (deleting would just reappear on
pack reload). Their editor now explains this and links to the owning pack's page,
where uninstall removes the pack's dashboards while keeping contributed agents.
