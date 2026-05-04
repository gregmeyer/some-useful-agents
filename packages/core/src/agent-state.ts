/**
 * Per-agent state directory. Lazily created at `<dataRoot>/agent-state/<id>/`,
 * chmod 0o700 (owner-only). Promotes the convention agents had to invent
 * by hand into a first-class primitive available as `$STATE_DIR` for
 * shell nodes and `{{state}}` for claude-code prompts.
 *
 * Lifecycle:
 *   - Created on first run that touches `ensureStateDir`.
 *   - Persists across runs (the whole point — diff-over-time agents need it).
 *   - Removed when the agent is deleted via `agentStore.deleteAgent`.
 *   - NOT swept by the run-retention timer; state outlives runs.
 *
 * Sandboxing: the agent id is regex-validated by the schema
 * (lowercase + hyphens), but we re-check here as defense in depth so a
 * caller can't traverse via "../" if validation is ever bypassed.
 */

import { join, resolve } from 'node:path';
import { rmSync, readdirSync, statSync, existsSync } from 'node:fs';
import { ensureDir, chmod0700Safe } from './fs-utils.js';

/** Default per-agent state-dir cap (100 MB). Overridable via `agent.stateMaxBytes`. */
export const DEFAULT_STATE_MAX_BYTES = 100 * 1024 * 1024;

const SAFE_AGENT_ID = /^[a-z0-9][a-z0-9-]*$/;

/** Resolve the state directory path for an agent. Does not touch disk. */
export function stateDirFor(agentId: string, dataRoot: string): string {
  if (!SAFE_AGENT_ID.test(agentId)) {
    throw new Error(`Refusing to compute state dir for unsafe agent id: ${agentId}`);
  }
  return resolve(join(dataRoot, 'agent-state', agentId));
}

/** Create the state directory if it doesn't exist; chmod 0o700. Returns the path. */
export function ensureStateDir(agentId: string, dataRoot: string): string {
  const dir = stateDirFor(agentId, dataRoot);
  ensureDir(dir);
  chmod0700Safe(dir);
  return dir;
}

/** Remove an agent's state directory and everything in it. Idempotent. */
export function removeStateDir(agentId: string, dataRoot: string): void {
  const dir = stateDirFor(agentId, dataRoot);
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Total bytes-on-disk in an agent's state directory, including all
 * subdirectories. Returns 0 when the dir doesn't exist (so the caller
 * doesn't need to pre-check). Walks the tree synchronously; for typical
 * agent state (a handful of files) this is microseconds. For pathological
 * cases (thousands of files) it's O(n) and worth caching at the call site.
 */
export function stateDirSize(agentId: string, dataRoot: string): number {
  const dir = stateDirFor(agentId, dataRoot);
  if (!existsSync(dir)) return 0;
  return walkSize(dir);
}

function walkSize(path: string): number {
  let total = 0;
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(path, { withFileTypes: true }) as import('node:fs').Dirent[];
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const name = String(entry.name);
    const full = join(path, name);
    try {
      if (entry.isDirectory()) {
        total += walkSize(full);
      } else if (entry.isFile()) {
        total += statSync(full).size;
      }
      // Symlinks intentionally skipped — don't follow, don't count target size.
    } catch {
      // Race with the agent removing a file mid-walk. Ignore — close enough.
    }
  }
  return total;
}

/** Format a byte count as a short human-readable string (1.5 MB, 12 KB, 800 B). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
