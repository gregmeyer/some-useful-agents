import { chmodSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Best-effort chmod 0o600 on a file. Silently no-ops if the underlying call
 * throws, which happens on Windows and on some network mounts that don't
 * support POSIX permissions. The file is still written; the chmod is purely
 * additional defense-in-depth on top of the user-home directory perms.
 */
export function chmod600Safe(path: string): void {
  try {
    chmodSync(path, 0o600);
  } catch {
    // Intentional: filesystem doesn't support POSIX perms, nothing we can do.
  }
}

/** Ensure the parent directory of `path` exists (mkdir -p). */
export function ensureParentDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Best-effort chmod 0o700 (rwx-only-for-owner) on a directory. Same
 * silent-no-op posture as `chmod600Safe` for filesystems without POSIX
 * permission support (Windows, some network mounts). Used for per-agent
 * state directories that may hold sensitive intermediate artifacts.
 */
export function chmod0700Safe(path: string): void {
  try {
    chmodSync(path, 0o700);
  } catch {
    // Intentional: filesystem doesn't support POSIX perms.
  }
}

/** Ensure a directory exists (mkdir -p). */
export function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}
