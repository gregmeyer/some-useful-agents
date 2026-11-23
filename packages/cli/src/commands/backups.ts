import { Command } from 'commander';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { formatBytes, pruneBackups } from '@some-useful-agents/core';
import { loadConfig } from '../config.js';
import * as ui from '../ui.js';

/**
 * `sua backups prune`: delete old database backups (`*.db.bak-YYYYMMDD-HHMMSS`)
 * in the data dir and ~/.sua, keeping the newest few and one a day for the last
 * week. A backup with any other name is never touched (backup-retention.ts).
 */
const prune = new Command('prune')
  .description('Delete old database backups, keeping the newest few and one a day for the last week')
  .option('--keep-last <n>', 'Keep the newest this many backup sets', '5')
  .option('--keep-days <n>', 'Plus the newest set of each of this many recent days', '7')
  .option('--dry-run', 'Say what would be deleted, and delete nothing')
  .action((opts: { keepLast: string; keepDays: string; dryRun?: boolean }) => {
    const config = loadConfig();
    const keepLast = Math.max(1, parseInt(opts.keepLast, 10) || 5);
    const keepDays = Math.max(0, parseInt(opts.keepDays, 10) || 0);
    const dirs = [...new Set([resolve(config.dataDir), join(homedir(), '.sua')])];
    let files = 0;
    let bytes = 0;
    for (const dir of dirs) {
      const r = pruneBackups(dir, { keepLast, keepDays, dryRun: opts.dryRun });
      files += r.remove.length;
      bytes += r.bytes;
      if (r.remove.length) console.log(`  ${dir}: ${opts.dryRun ? 'would delete' : 'deleted'} ${r.remove.length} file(s), ${formatBytes(r.bytes)}; ${r.keptSets.length} backup set(s) kept`);
    }
    if (files === 0) console.log(ui.dim('  No old backups to delete.'));
    else console.log(`  ${opts.dryRun ? 'Would free' : 'Freed'} ${formatBytes(bytes)}.`);
  });

export const backupsCommand = new Command('backups')
  .description('Manage database backups')
  .addCommand(prune);
