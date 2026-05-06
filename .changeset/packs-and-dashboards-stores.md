---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Foundation for widget packs + dashboards (PR 1 of 5).

Two new SQLite-backed stores in `packages/core`:

- **`PacksStore`** — `packs` table holds pack registrations
  (`id, name, version, source, manifest_json, installed_at`). CRUD plus
  `markInstalled` / `markUninstalled` / `listInstalled`. Re-registering
  a built-in pack preserves its installed state across daemon restarts.
- **`DashboardsStore`** — `dashboards` table holds named, ordered,
  sectioned views (`id, pack_id, name, layout_json, …`). CRUD plus
  `updateLayout`, `listByPack`, `listUserDashboards`, `deleteByPack`.

Pack→dashboard cascade is handled explicitly via `deleteByPack`
(no SQL FK) so the stores don't couple table-creation order.

Both wired into `DashboardContext` (optional fields for now); no UI
or routes consume them yet — that's PR 2 onwards. The
"Default Dashboard" backing `/pulse` will be computed in PR 4, not
stored here.

Tests cover round-trips, install-state preservation across upsert,
and explicit cascade behaviour.
