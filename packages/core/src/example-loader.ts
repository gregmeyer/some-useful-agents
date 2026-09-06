/**
 * Bundled example agent resolution.
 *
 * `agents/examples/` is the source of truth in a repo checkout, but it is not
 * part of any npm tarball. Several dashboard features auto-import an example
 * agent on first use by reading `agents/examples/<id>.yaml` relative to the
 * process cwd — build-from-goal, the Pulse/dashboard layout planner, and inbox
 * triage. On an npm install that read always failed, so those features were
 * dead with no in-product way to recover.
 *
 * `packages/core/examples/` is a build-time copy of that directory, shipped in
 * the package alongside `dist/` and `packs/`. Lookups try the repo copy first
 * so editing an example still takes effect without a rebuild, then fall back
 * to the bundled copy.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where a repo checkout keeps the editable examples, relative to cwd. */
export const REPO_EXAMPLES_DIR = 'agents/examples';

/**
 * Location of the bundled examples relative to this module.
 *
 * In repo: `packages/core/src/example-loader.ts` compiles to
 * `packages/core/dist/example-loader.js`, and the copy lives at
 * `packages/core/examples/` — one level up from `dist/`. In an npm install
 * the shape is identical: `dist/` and `examples/` are siblings under
 * `node_modules/@some-useful-agents/core/`.
 */
export function defaultBundledExamplesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', 'examples');
}

/**
 * Directories to search, in order: the cwd-relative repo copy (freshest, and
 * what a contributor is editing), then the bundled copy.
 */
export function exampleSearchDirs(repoDir: string = REPO_EXAMPLES_DIR): string[] {
  return [resolve(repoDir), defaultBundledExamplesDir()];
}

/**
 * Read one example agent's YAML by id. Returns null when no search dir has it.
 */
export function readExampleYaml(agentId: string, repoDir?: string): string | null {
  for (const dir of exampleSearchDirs(repoDir)) {
    const path = join(dir, `${agentId}.yaml`);
    try {
      if (existsSync(path)) return readFileSync(path, 'utf-8');
    } catch { /* unreadable — try the next dir */ }
  }
  return null;
}

/**
 * Resolve a path INSIDE the examples tree (e.g. `inbox-triage/kernel.md`)
 * against the first search dir that has it. Returns null when absent.
 */
export function resolveExamplePath(relPath: string, repoDir?: string): string | null {
  for (const dir of exampleSearchDirs(repoDir)) {
    const path = join(dir, relPath);
    try {
      if (existsSync(path)) return path;
    } catch { /* unreadable — try the next dir */ }
  }
  return null;
}

/**
 * Every example YAML from the first search dir that has any, keyed by filename
 * stem. The dirs are not merged: a repo checkout should get exactly what is on
 * disk, not on-disk plus leftovers from a stale bundled copy.
 */
export function listExampleYamls(repoDir?: string): Record<string, string> {
  for (const dir of exampleSearchDirs(repoDir)) {
    const out: Record<string, string> = {};
    try {
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.yaml')) continue;
        try {
          out[file.slice(0, -'.yaml'.length)] = readFileSync(join(dir, file), 'utf-8');
        } catch { /* skip unreadable file */ }
      }
    } catch { continue; }
    if (Object.keys(out).length > 0) return out;
  }
  return {};
}
