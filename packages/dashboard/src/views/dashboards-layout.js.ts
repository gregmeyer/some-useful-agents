/**
 * Dashboards layout JS — gives /dashboards/:id parity with Pulse for
 * tile-level controls (configure, palette, resize, collapse, edit
 * toggle). Reuses the shared widgetLayoutJS factory; storage keys are
 * suffixed at runtime with the dashboard id so each dashboard owns
 * its own client-side state without compiling per-page JS.
 *
 * Server still owns section structure (sections + agentIds) — that's
 * edited via /dashboards/:id/edit. This module only handles the
 * cosmetic state Pulse already manages: palette, size, collapse.
 */

import { widgetLayoutJS } from './widget-layout.js.js';

export const DASHBOARDS_LAYOUT_JS = widgetLayoutJS({
  prefix: 'dashboard',
  storageKey: 'sua-dashboard-layout',
  hostId: 'dashboard-containers',
  dataId: 'dashboard-tile-data',
  editToggleId: 'dashboard-edit-toggle',
  addContainerId: 'dashboard-add-container', // intentionally absent in DOM; widget-layout no-ops
  paletteKey: 'sua-dashboard-palettes',
  sizesKey: 'sua-dashboard-sizes',
  collapsedKey: 'sua-dashboard-collapsed',
  runtimeKeySuffixAttr: 'data-dashboard-id',
});
// Collapse/expand handler now lives in widget-layout.js.ts so each
// surface scopes its persistence properly; removed the duplicate here
// to avoid double-toggling.

