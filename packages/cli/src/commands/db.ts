import { Command } from 'commander';
import { statSync } from 'node:fs';
import { RunStore, formatBytes } from '@some-useful-agents/core';
import { getDbPath, loadConfig } from '../config.js';
import * as ui from '../ui.js';

const fileSize = (path: string): number => {
  let total = 0;
  for (const p of [path, `${path}-wal`]) { try { total += statSync(p).size; } catch { /* none */ } }
  return total;
};

/**
 * `sua db compact`: rewrite run rows stored before large inputs were kept
 * once (run-blobs.ts), then VACUUM so the file gives the space back.
 */
const compact = new Command('compact')
  .description('Keep large stored run inputs once (rewrites older rows), then shrink the database file')
  .option('--no-vacuum', 'Rewrite the rows but leave the file size as it is')
  .action((opts: { vacuum: boolean }) => {
    const dbPath = getDbPath(loadConfig());
    const before = fileSize(dbPath);
    const store = new RunStore(dbPath, { retentionDays: 0 });
    try {
      const running = store.listRuns({ status: 'running', limit: 1 }).length;
      const { rows, charsSaved } = store.compactStoredInputs();
      console.log(`  Rewrote ${rows} row(s); ${formatBytes(charsSaved)} of repeated input text is now kept once.`);
      if (opts.vacuum) {
        if (running) {
          ui.warn('A run is in progress, so the file was not shrunk. Run `sua db compact` again when nothing is running.');
        } else {
          const db = store.databaseHandle();
          db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
          db.exec('VACUUM');
          db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        }
      }
    } catch (err) {
      ui.fail(`Couldn't compact ${dbPath}: ${(err as Error).message}. If the dashboard is busy, stop the daemon (sua daemon stop) and try again.`);
      process.exitCode = 1;
    } finally {
      store.close();
    }
    console.log(`  ${dbPath}: ${formatBytes(before)} → ${formatBytes(fileSize(dbPath))}`);
  });

export const dbCommand = new Command('db')
  .description('Maintain the run database')
  .addCommand(compact);
