import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planBackupPrune, pruneBackups } from './backup-retention.js';

const set = (stamp: string, dbs = ['runs.db', 'sua.db']) => dbs.map((d) => `${d}.bak-${stamp}`);

describe('planBackupPrune', () => {
  it('keeps the newest sets and the newest of each recent day, and removes the rest', () => {
    const files = [
      ...set('20261001-100000'), // old: goes
      ...set('20261120-090000'), ...set('20261120-180000'), // Nov 20: the 18:00 set stays
      ...set('20261121-120000'),
      ...set('20261122-080000'), ...set('20261122-090000'), ...set('20261122-100000'), ...set('20261122-110000'), ...set('20261122-120000'), ...set('20261122-130000'),
      'runs.db', 'sua.db',
    ];
    const plan = planBackupPrune(files, { keepLast: 5, keepDays: 3 });
    expect(plan.keptSets).toEqual(['20261120-180000', '20261121-120000', '20261122-090000', '20261122-100000', '20261122-110000', '20261122-120000', '20261122-130000']);
    expect(plan.remove).toEqual([...set('20261001-100000'), ...set('20261120-090000'), ...set('20261122-080000')].sort());
  });

  it('never touches the live databases or a backup named by hand', () => {
    const files = ['runs.db', 'runs.db-wal', 'runs.db.bak-before-sweep-v5', 'runs.db.bak-templates-writeup', 'secrets.enc.bak-2026-07-07', ...set('20260101-000000')];
    const plan = planBackupPrune(files, { keepLast: 1, keepDays: 0 });
    expect(plan.remove).toEqual([]);
  });

  it("removes a pruned set's -wal and -shm files with it", () => {
    const files = ['runs.db.bak-20261007-153800', 'runs.db.bak-20261007-153800-wal', 'runs.db.bak-20261007-153800-shm', ...set('20261122-130000')];
    expect(planBackupPrune(files, { keepLast: 1, keepDays: 0 }).remove).toEqual(['runs.db.bak-20261007-153800', 'runs.db.bak-20261007-153800-shm', 'runs.db.bak-20261007-153800-wal']);
  });
});

describe('pruneBackups', () => {
  it('deletes what the plan names, counts the bytes, and leaves everything on a dry run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sua-backups-'));
    try {
      for (const f of ['runs.db', ...set('20261001-000000'), ...set('20261122-130000')]) writeFileSync(join(dir, f), 'x'.repeat(10));
      const dry = pruneBackups(dir, { keepLast: 1, keepDays: 0, dryRun: true });
      expect(dry.remove).toHaveLength(2);
      expect(dry.bytes).toBe(20);
      expect(readdirSync(dir)).toHaveLength(5);
      pruneBackups(dir, { keepLast: 1, keepDays: 0 });
      expect(readdirSync(dir).sort()).toEqual(['runs.db', ...set('20261122-130000')].sort());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is a no-op for a directory that does not exist', () => {
    expect(pruneBackups('/nonexistent/sua-backups').remove).toEqual([]);
  });
});
