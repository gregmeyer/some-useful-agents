/**
 * The containers a Docker-run tool server leaves behind. Each `docker run`
 * makes one; `--rm` removes it when it stops, but one that was made and never
 * started (a start cut short) stays, and so does a stopped one without
 * `--rm`. Clean up removes those, for the server's image only. A running one
 * is in use (by sua, or another program using the same server, such as an
 * editor) and is left alone: it goes when that program closes it, and sua
 * closes its own after 10 minutes unused.
 */
import { execFile } from 'node:child_process';
import { dockerShares, type McpServerConfig } from '@some-useful-agents/core';

/** Run a command and give its output (stdout), or throw. Swappable in tests. */
export type RunCommand = (command: string, args: readonly string[]) => Promise<string>;

export const runCommand: RunCommand = (command, args) => new Promise((resolve, reject) => {
  execFile(command, [...args], { timeout: 15_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) reject(new Error(String(stderr || err.message).trim().split('\n')[0]));
    else resolve(String(stdout));
  });
});

export interface ServerContainers {
  running: number;
  /** Stopped or never started: safe to remove. */
  leftover: string[];
}

/** The image a server runs, when it's a Docker-run server. */
export function serverImage(server: McpServerConfig): string | undefined {
  return dockerShares(server).image;
}

/** A Docker-run server's containers: how many run, and which are left over. Undefined when it isn't one. */
export async function serverContainers(server: McpServerConfig, run: RunCommand = runCommand): Promise<ServerContainers | undefined> {
  const image = serverImage(server);
  if (!image || !server.command) return undefined;
  const out = await run(server.command, ['ps', '-a', '--filter', `ancestor=${image}`, '--format', '{{.ID}}\t{{.State}}']);
  const rows = out.split('\n').map((l) => l.trim().split('\t')).filter((r) => r.length === 2 && /^[0-9a-f]{6,64}$/i.test(r[0]));
  return {
    running: rows.filter((r) => /^(running|restarting|paused)$/i.test(r[1])).length,
    leftover: rows.filter((r) => /^(created|exited|dead)$/i.test(r[1])).map((r) => r[0]),
  };
}

/** Remove a Docker-run server's left-over containers. Says how many went, and how many still run. */
export async function cleanUpServerContainers(server: McpServerConfig, run: RunCommand = runCommand): Promise<{ removed: number; running: number }> {
  const found = await serverContainers(server, run);
  if (!found) throw new Error(`${server.id} doesn't run in Docker.`);
  if (found.leftover.length) await run(server.command!, ['rm', ...found.leftover]);
  return { removed: found.leftover.length, running: found.running };
}
