/**
 * Copy the repo's example agents into the published package.
 *
 * `agents/examples/` is the source of truth, but the npm tarball only ships
 * what `files` lists — so an npm install had no copy of it at all, and every
 * feature that auto-imports an example (build-from-goal, the layout planner,
 * inbox triage) failed on a fresh install. This mirrors `packs/`: a sibling
 * of `dist/` in both the repo and an npm install, so one relative path works
 * in both layouts.
 *
 * Only files a user's install needs are copied. Generated databases and the
 * scripts that build them stay behind.
 */
import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const src = resolve(pkgRoot, '..', '..', 'agents', 'examples');
const dst = resolve(pkgRoot, 'examples');

/** Data files that are generated, not authored — never ship these. */
const SKIP = new Set(['churn-customers.db', 'error-reference.db', 'make-churn-db.sh', 'make-error-reference-db.mjs']);

rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });

let yamls = 0;
for (const entry of readdirSync(src)) {
  if (SKIP.has(entry)) continue;
  const from = join(src, entry);
  if (statSync(from).isDirectory()) {
    cpSync(from, join(dst, entry), {
      recursive: true,
      filter: (p) => !SKIP.has(p.split('/').pop()),
    });
  } else {
    cpSync(from, join(dst, entry));
    if (entry.endsWith('.yaml')) yamls++;
  }
}

console.log(`bundled ${yamls} example agents -> ${dst}`);
