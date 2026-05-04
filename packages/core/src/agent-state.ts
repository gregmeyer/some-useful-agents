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
import { rmSync } from 'node:fs';
import { ensureDir, chmod0700Safe } from './fs-utils.js';

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
