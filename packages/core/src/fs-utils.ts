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
