import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFilesDir, saveRunFile, listRunFiles } from './run-files.js';

describe('run files', () => {
  it('keeps each file under its run, named for its node, and lists them in order', () => {
    const root = mkdtempSync(join(tmpdir(), 'sua-runfiles-'));
    try {
      const dir = runFilesDir(root, 'run-abc');
      expect(dir).toBe(join(root, 'run-files', 'run-abc'));
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      expect(saveRunFile({ dir, nodeId: 'research' }, png)).toBe('research-1.png');
      expect(saveRunFile({ dir, nodeId: 'research' }, png)).toBe('research-2.png');
      expect(saveRunFile({ dir, nodeId: '../odd node' }, png)).toBe('odd-node-1.png');
      expect(listRunFiles(root, 'run-abc')).toEqual([
        { name: 'odd-node-1.png', bytes: 4 }, { name: 'research-1.png', bytes: 4 }, { name: 'research-2.png', bytes: 4 },
      ]);
      expect(listRunFiles(root, 'no-such-run')).toEqual([]);
      expect(() => runFilesDir(root, '../escape')).toThrow(/unsafe run id/);
      expect(listRunFiles(root, '../escape')).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
