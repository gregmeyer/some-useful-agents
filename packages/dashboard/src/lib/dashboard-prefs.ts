import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Dashboard-wide preferences (not per-browser), in <dataDir>/.sua/dashboard-prefs.json.
 * Read through a small mtime cache so render paths can ask cheaply.
 */
export interface DashboardPrefs {
  /**
   * Draw signal templates and output widgets through the A2UI renderer.
   * Default ON (unset = on); `false` switches back to the previous renderer,
   * which stays one release as a fallback before it's removed.
   */
  a2uiWidgets?: boolean;
  /**
   * Pulse and named dashboards render as boards (docs/boards.md). Default ON;
   * `false` switches back to the previous layout, kept one release.
   */
  boardPages?: boolean;
}

let file: string | undefined;
let cache: { mtimeMs: number; prefs: DashboardPrefs } | undefined;

export function setDashboardPrefsDir(dataDir: string): void {
  file = join(dataDir, '.sua', 'dashboard-prefs.json');
  cache = undefined;
}

export function getDashboardPrefs(): DashboardPrefs {
  if (!file) return {};
  let mtimeMs: number;
  try { mtimeMs = statSync(file).mtimeMs; } catch { cache = undefined; return {}; }
  if (cache && cache.mtimeMs === mtimeMs) return cache.prefs;
  let prefs: DashboardPrefs = {};
  try {
    const v = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (v && typeof v === 'object') {
      const o = v as DashboardPrefs;
      if (typeof o.a2uiWidgets === 'boolean') prefs.a2uiWidgets = o.a2uiWidgets;
      if (typeof o.boardPages === 'boolean') prefs.boardPages = o.boardPages;
    }
  } catch { /* unreadable: defaults */ }
  cache = { mtimeMs, prefs };
  return prefs;
}

export function setDashboardPrefs(patch: DashboardPrefs): DashboardPrefs {
  if (!file) throw new Error('dashboard prefs location not set');
  const next = { ...getDashboardPrefs(), ...patch };
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  cache = undefined;
  return next;
}

/** Whether pre-A2UI widgets are drawn through the A2UI renderer (the default). */
export function a2uiWidgetsEnabled(): boolean {
  return getDashboardPrefs().a2uiWidgets !== false;
}

/** Whether Pulse and named dashboards render as boards (the default). */
export function boardPagesEnabled(): boolean {
  return getDashboardPrefs().boardPages !== false;
}
