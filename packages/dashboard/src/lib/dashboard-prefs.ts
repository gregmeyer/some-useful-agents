import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Dashboard-wide preferences (not per-browser), in <dataDir>/.sua/dashboard-prefs.json.
 * Read through a small mtime cache so render paths can ask cheaply.
 */
export interface DashboardPrefs {
  /** Draw signal templates and output widgets through the A2UI renderer (W3 preview). */
  a2uiWidgets?: boolean;
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
    if (v && typeof v === 'object') prefs = { a2uiWidgets: (v as DashboardPrefs).a2uiWidgets === true };
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

/** Whether pre-A2UI widgets should be drawn through the A2UI renderer. */
export function a2uiWidgetsEnabled(): boolean {
  return getDashboardPrefs().a2uiWidgets === true;
}
