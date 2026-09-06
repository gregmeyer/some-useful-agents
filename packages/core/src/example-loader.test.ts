/**
 * The examples tree is the source of truth for several auto-imported system
 * agents (build-from-goal's surveyor/drafter/designer, the layout planner,
 * inbox triage), but it lives at the repo root and is not in any npm tarball.
 * Before this loader, every consumer read `agents/examples/<id>.yaml` relative
 * to cwd, so all of those features were dead on an npm install.
 *
 * These tests drive the resolver against real directories on disk — a repo-ish
 * dir and a bundled-ish one — rather than asserting the helper matches itself.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readExampleYaml,
  resolveExamplePath,
  listExampleYamls,
  defaultBundledExamplesDir,
} from './example-loader.js';
import { parseAgent } from './agent-yaml.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_EXAMPLES = resolve(HERE, '..', '..', '..', 'agents', 'examples');
const COPY_SCRIPT = resolve(HERE, '..', 'scripts', 'copy-examples.mjs');

/**
 * The bundled copy is a build artifact (gitignored, written by
 * `scripts/copy-examples.mjs` during `npm run build`). Generate it here when
 * absent so these assertions never silently skip on an unbuilt tree — a
 * skipped test would report green for exactly the bug this file exists to
 * catch.
 */
function ensureBundled(): void {
  if (existsSync(defaultBundledExamplesDir())) return;
  execFileSync(process.execPath, [COPY_SCRIPT], { stdio: 'ignore' });
}

function yamlFor(id: string): string {
  return `id: ${id}\nname: ${id}\ndescription: fixture\nstatus: active\nnodes:\n  - id: go\n    type: shell\n    command: echo hi\n`;
}

describe('example-loader', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'sua-examples-'));
    writeFileSync(join(dir, 'from-repo.yaml'), yamlFor('from-repo'));
    mkdirSync(join(dir, 'inbox-triage'), { recursive: true });
    writeFileSync(join(dir, 'inbox-triage', 'kernel.md'), 'KERNEL');
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads a YAML from the repo-style dir when it is present', () => {
    expect(readExampleYaml('from-repo', dir)).toContain('id: from-repo');
  });

  it('returns null rather than throwing when no dir has the agent', () => {
    expect(readExampleYaml('no-such-agent-anywhere', dir)).toBeNull();
  });

  it('falls back to the bundled dir when the repo dir lacks the agent', () => {
    // 'hello' is not in the temp dir, so a hit can only come from the bundle.
    ensureBundled();
    expect(readExampleYaml('hello', dir)).toContain('id: hello');
  });

  it('resolves a nested path inside the examples tree', () => {
    expect(resolveExamplePath('inbox-triage/kernel.md', dir)).toBe(join(dir, 'inbox-triage', 'kernel.md'));
    expect(resolveExamplePath('nope/nothing.md', dir)).toBeNull();
  });

  it('lists YAMLs from the first dir that has any, keyed by filename stem', () => {
    expect(Object.keys(listExampleYamls(dir))).toEqual(['from-repo']);
  });

  it('falls back to the bundled set for an empty repo dir', () => {
    const empty = mkdtempSync(join(tmpdir(), 'sua-empty-'));
    try {
      ensureBundled();
      expect(Object.keys(listExampleYamls(empty)).length).toBeGreaterThan(6);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

/**
 * The whole point of the bundle: an npm install must be able to reach the
 * agents that build-from-goal, the layout planner, and inbox triage need.
 * These ids were the ones proven missing on a fresh install.
 */
describe('bundled examples cover the auto-imported system agents', () => {
  const REQUIRED = [
    'goal-surveyor',
    'agent-drafter',
    'dashboard-designer',
    'layout-planner',
    'inbox-triage',
  ];

  it.each(REQUIRED)('%s is bundled and parses', (id) => {
    ensureBundled();
    const bundled = join(defaultBundledExamplesDir(), `${id}.yaml`);
    expect(existsSync(bundled), `${id}.yaml missing from the bundled examples`).toBe(true);
    expect(parseAgent(readExampleYaml(id, defaultBundledExamplesDir())!).id).toBe(id);
  });

  it('bundles every YAML the repo tree has', () => {
    ensureBundled();
    const repo = Object.keys(listExampleYamls(REPO_EXAMPLES));
    const bundled = Object.keys(listExampleYamls(defaultBundledExamplesDir()));
    expect(bundled.sort()).toEqual(repo.sort());
  });
});
