/**
 * How many database backups to keep.
 *
 * An update backs up each database as `<name>.db.bak-YYYYMMDD-HHMMSS` (one
 * "set" per timestamp). Without pruning they pile up: a runs.db of half a
 * gigabyte, backed up several times a day, filled 120 GB in seven weeks.
 *
 * Kept: the newest `keepLast` sets, plus the newest set of each of the last
 * `keepDays` days that have one. Backups with any other name (`.bak-before-
 * sweep`, `.bak-2026-07-07`, or a set's -wal/-shm files whose set is kept)
 * are never touched, so a backup someone named by hand stays. The -wal and
 * -shm files of a pruned set go with it.
 */
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export interface BackupRetention {
  /** The newest this many sets are kept. Default 5. */
  keepLast?: number;
  /** Plus the newest set of each of this many most recent days. Default 7. */
  keepDays?: number;
}

export interface BackupPrunePlan {
  /** Timestamps of the sets kept, oldest first. */
  keptSets: string[];
  /** Files to delete, sorted. */
  remove: string[];
}

const STAMPED = /^(.+)\.bak-(\d{8})-(\d{6})(-wal|-shm)?$/;

/** Which backup files in a directory listing to delete. Pure: names in, names out. */
export function planBackupPrune(fileNames: readonly string[], opts: BackupRetention = {}): BackupPrunePlan {
  const keepLast = Math.max(1, opts.keepLast ?? 5);
  const keepDays = Math.max(0, opts.keepDays ?? 7);
  const stamped = fileNames.flatMap((f) => {
    const m = STAMPED.exec(f);
    return m ? [{ file: f, stamp: `${m[2]}-${m[3]}` }] : [];
  });
  const stamps = [...new Set(stamped.map((s) => s.stamp))].sort();
  const keep = new Set(stamps.slice(-keepLast));
  const days = keepDays > 0 ? [...new Set(stamps.map((s) => s.slice(0, 8)))].sort().slice(-keepDays) : [];
  for (const day of days) {
    const newest = stamps.filter((s) => s.startsWith(day)).pop();
    if (newest) keep.add(newest);
  }
  return {
    keptSets: [...keep].sort(),
    remove: stamped.filter((s) => !keep.has(s.stamp)).map((s) => s.file).sort(),
  };
}

export interface BackupPruneResult extends BackupPrunePlan {
  dir: string;
  /** Bytes the removed files took (or would take, on a dry run). */
  bytes: number;
}

/** Plan the prune for `dir` and, unless `dryRun`, delete the files it names. */
export function pruneBackups(dir: string, opts: BackupRetention & { dryRun?: boolean } = {}): BackupPruneResult {
  let names: string[];
  try { names = readdirSync(dir); } catch { return { dir, keptSets: [], remove: [], bytes: 0 }; }
  const plan = planBackupPrune(names, opts);
  let bytes = 0;
  for (const f of plan.remove) {
    const path = join(dir, f);
    try { bytes += statSync(path).size; } catch { continue; }
    if (!opts.dryRun) unlinkSync(path);
  }
  return { dir, ...plan, bytes };
}
