/**
 * Files a run keeps (a tool's screenshots): `<dataRoot>/run-files/<runId>/`.
 * A tool gets its place through BuiltinToolContext.runFiles; the dashboard
 * lists and serves them by run (GET /runs/:id/files/:name).
 */
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ensureDir } from './fs-utils.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
/** A run file's name: letters, digits, - and _, then .png. */
export const RUN_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,100}\.png$/;

/** Where a run's files go. Throws on an id that isn't safe as a folder name. */
export function runFilesDir(dataRoot: string, runId: string): string {
  if (!SAFE_ID.test(runId)) throw new Error(`Refusing to compute run-files dir for unsafe run id: ${runId}`);
  return resolve(join(dataRoot, 'run-files', runId));
}

/** Keep a file with the run, named `<node>-<n>.png` (the next free n). Returns its name. */
export function saveRunFile(place: { dir: string; nodeId: string }, bytes: Buffer): string {
  ensureDir(place.dir);
  const stem = place.nodeId.replace(/[^A-Za-z0-9_-]/g, '-').replace(/^-+/, '').slice(0, 60) || 'node';
  let n = 1;
  while (existsSync(join(place.dir, `${stem}-${String(n)}.png`))) n++;
  const name = `${stem}-${String(n)}.png`;
  writeFileSync(join(place.dir, name), bytes);
  return name;
}

/** A run's files, in name order (none: []). */
export function listRunFiles(dataRoot: string, runId: string): Array<{ name: string; bytes: number }> {
  let dir: string;
  try { dir = runFilesDir(dataRoot, runId); } catch { return []; }
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => RUN_FILE_NAME.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => ({ name, bytes: statSync(join(dir, name)).size }));
}
