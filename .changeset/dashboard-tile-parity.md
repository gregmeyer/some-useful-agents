---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Bring `/dashboards/:id` to parity with Pulse for tile-level controls.

Tiles on a stored dashboard now get the same chrome as Pulse tiles:
- **Configure tile** (already worked — listener is global).
- **Palette cycle** with persistence (was renderless on dashboards).
- **Resize handle** with persistence (didn't work at all on dashboards).
- **Collapse / expand** with persistence (didn't work at all).
- **"Edit layout" toggle** in the dashboard header reveals resize handles
  and delete buttons, mirroring Pulse's edit mode.
- **× remove button**: when rendered on a dashboard, the × now removes
  the tile from THAT DASHBOARD's section (POSTs to the existing
  `/sections/:idx/tiles/:tileIdx/delete` endpoint) instead of toggling
  the agent's global Pulse visibility. Pulse's × keeps its old semantic.

Cosmetic state (palette / size / collapsed) is persisted to localStorage
keyed per-dashboard (`sua-dashboard-<kind>-<id>`), matching Pulse's
client-state model. Server still owns section structure (which is
edited via `/dashboards/:id/edit`'s up/down + add/remove flow).

Implementation:
- `widgetLayoutJS` gained an optional `runtimeKeySuffixAttr` that
  appends a host-element attribute value to all storage keys at
  runtime — so a single global JS bundle can serve every dashboard
  page with isolated state.
- New `DASHBOARDS_LAYOUT_JS` module composes `widgetLayoutJS` with
  dashboard-specific element ids + a per-dashboard collapse handler.
- `tileWrap` now accepts an optional `TileWrapContext` that controls
  the × button's form action.
- The dashboards view renders a `#dashboard-containers` host with
  `data-dashboard-id`, embeds tile data in
  `<script id="dashboard-tile-data">`, and adds an "Edit layout"
  button next to the existing "Edit sections" link.

Out of scope (deferred): drag-drop tile reorder + add-container —
the existing `/dashboards/:id/edit` page covers section structure
with up/down arrows.

Tests bumped; full suite 1066/1066.
