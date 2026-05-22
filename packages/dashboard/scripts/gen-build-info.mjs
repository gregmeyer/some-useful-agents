// Generate dist/build-info.json with the git commit + build timestamp.
// Run after tsc in the root build so the running daemon can report
// exactly which code it's serving (surfaced in /health and the footer).
// Best-effort: if git isn't available (e.g. building from a tarball),
// fall back to "unknown" so the build never fails on this.
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const distRoot = resolve(here, '..', 'dist');

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch {
    return '';
  }
}

let commit = git('rev-parse --short HEAD') || 'unknown';
// Mark a dirty working tree so a build off uncommitted changes is
// distinguishable from a clean one.
if (commit !== 'unknown') {
  const dirty = git('status --porcelain');
  if (dirty) commit += '-dirty';
}

const info = { commit, builtAt: new Date().toISOString() };

mkdirSync(distRoot, { recursive: true });
writeFileSync(resolve(distRoot, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
console.log(`build-info: ${info.commit} @ ${info.builtAt}`);
