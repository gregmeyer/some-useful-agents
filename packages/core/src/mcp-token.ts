import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chmod600Safe, ensureParentDir } from './fs-utils.js';

/** Length of the bearer token in bytes (256 bits). */
const TOKEN_BYTES = 32;

/** Default path to the per-user MCP bearer token file. */
export function getMcpTokenPath(): string {
  return join(homedir(), '.sua', 'mcp-token');
}

/** Generate a fresh bearer token. Hex-encoded, URL-safe. */
function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

/**
 * Return the contents of the MCP token file at `path`, or undefined if the
 * file does not exist. Trims trailing whitespace.
 */
export function readMcpToken(path = getMcpTokenPath()): string | undefined {
  if (!existsSync(path)) return undefined;
  return readFileSync(path, 'utf-8').trim();
}

/**
 * Read the token at `path` if present, otherwise generate a new one, write it
 * with mode 0o600, and return it. Idempotent on warm runs.
 *
 * Returns `{ token, created }` so callers can show first-run UI.
 */
export function ensureMcpToken(path = getMcpTokenPath()): { token: string; created: boolean } {
  const existing = readMcpToken(path);
  if (existing && existing.length > 0) {
    return { token: existing, created: false };
  }
  const token = generateToken();
  ensureParentDir(path);
  writeFileSync(path, token + '\n', 'utf-8');
  chmod600Safe(path);
  return { token, created: true };
}

/**
 * Force-generate a new token, overwriting any existing file. Returns the new
 * token. Caller is responsible for telling clients (Claude Desktop, etc.) to
 * update their config.
 */
export function rotateMcpToken(path = getMcpTokenPath()): string {
  const token = generateToken();
  ensureParentDir(path);
  writeFileSync(path, token + '\n', 'utf-8');
  chmod600Safe(path);
  return token;
}
