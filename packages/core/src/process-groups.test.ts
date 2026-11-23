import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnProcess } from './node-spawner.js';
import { groupAlive, stopGroup, USE_PROCESS_GROUPS } from './process-groups.js';

const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (cond: () => boolean, ms = 3000): Promise<boolean> => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await new Promise((r) => setTimeout(r, 25)); }
  return cond();
};

describe.skipIf(!USE_PROCESS_GROUPS)('a stopped node takes what its shell started with it', () => {
  /** `sh -c` that starts a long `sleep`, writes its pid, and waits on it: the shape of a shell node running a long command. */
  const longCommand = (pidFile: string) => ['-c', `sleep 30 & echo $! > ${pidFile}; wait`];

  it('Stop ends the node at once, and the command its shell started is gone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sua-pgroup-'));
    const pidFile = join(dir, 'sleep.pid');
    try {
      const ac = new AbortController();
      const started = Date.now();
      const done = spawnProcess('sh', longCommand(pidFile), { env: { PATH: process.env.PATH ?? '' }, timeoutSec: 60, signal: ac.signal });
      expect(await waitFor(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim().length > 0)).toBe(true);
      const sleepPid = Number(readFileSync(pidFile, 'utf8').trim());
      expect(alive(sleepPid)).toBe(true);
      ac.abort();
      const res = await done;
      expect(res.exitCode).not.toBe(0);
      expect(Date.now() - started).toBeLessThan(10_000); // not the 30s the sleep would take
      expect(await waitFor(() => !alive(sleepPid))).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('a timeout does the same', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sua-pgroup-'));
    const pidFile = join(dir, 'sleep.pid');
    try {
      const res = await spawnProcess('sh', longCommand(pidFile), { env: { PATH: process.env.PATH ?? '' }, timeoutSec: 1 });
      expect(res.error ?? '').toMatch(/Timed out/);
      const sleepPid = Number(readFileSync(pidFile, 'utf8').trim());
      expect(await waitFor(() => !alive(sleepPid))).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe.skipIf(!USE_PROCESS_GROUPS)('stopGroup', () => {
  it('SIGKILLs a group that ignores SIGTERM once the grace period is up', async () => {
    const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
    const exited = new Promise((r) => child.once('exit', r));
    await new Promise((r) => setTimeout(r, 100));
    stopGroup(child.pid!, 150);
    await new Promise((r) => setTimeout(r, 50));
    expect(groupAlive(child.pid!)).toBe(true); // ignored the SIGTERM
    await exited;
    expect(groupAlive(child.pid!)).toBe(false);
  });
});
