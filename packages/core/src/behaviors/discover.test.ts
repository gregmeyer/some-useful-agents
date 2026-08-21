/**
 * Discovery tests. The load-bearing one is "returns EXACTLY 3 records and 0
 * errors" — the anti-silent-skip assertion. `agent-loader.ts` skipped every v2
 * file with a bare `continue` and no warning, and CI reported success while
 * validating nothing for months. A count assertion is what catches that class
 * of bug; a "does it find some" assertion does not.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadBehaviors, defaultBehaviorScopes } from './discover.js';
import { BEHAVIORS_DIR } from './constants.js';

let dirs: string[] = [];

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'sua-behaviors-'));
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

/** Write a spec into `<root>/.agents/behaviors/<name>/BEHAVIOR.md`. */
function writeSpec(root: string, name: string, opts: {
  frontName?: string; description?: string; body?: string; fileName?: string; subdir?: string;
} = {}): string {
  const dir = join(root, BEHAVIORS_DIR, name, opts.subdir ?? '');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, opts.fileName ?? 'BEHAVIOR.md');
  writeFileSync(file,
    `---\nname: ${opts.frontName ?? name}\ndescription: ${opts.description ?? `Spec for ${name}.`}\n---\n${opts.body ?? `# ${name}\n\nbody`}`);
  return file;
}

const project = (root: string) => ({ scopes: [{ scope: 'project' as const, rootDir: root, optional: true }] });

describe('behavior discovery', () => {
  it('finds EXACTLY the valid specs, with no errors (anti-silent-skip)', () => {
    const root = tmp();
    writeSpec(root, 'alpha');
    writeSpec(root, 'beta');
    writeSpec(root, 'gamma');

    const res = loadBehaviors(project(root));

    expect(res.behaviors).toHaveLength(3);
    expect(res.behaviors.map((b) => b.name)).toEqual(['alpha', 'beta', 'gamma']); // sorted
    expect(res.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(res.byName.get('beta')?.description).toBe('Spec for beta.');
  });

  it('records provenance: scope and absolute paths', () => {
    const root = tmp();
    const file = writeSpec(root, 'alpha');
    const rec = loadBehaviors(project(root)).byName.get('alpha');
    expect(rec?.location.scope).toBe('project');
    expect(rec?.location.file).toBe(file);
    expect(rec?.location.dir).toBe(join(root, BEHAVIORS_DIR, 'alpha'));
  });

  it('keeps going after one bad spec, and reports it', () => {
    const root = tmp();
    writeSpec(root, 'good');
    writeSpec(root, 'bad', { frontName: 'not-bad' }); // valid format, wrong dir

    const res = loadBehaviors(project(root));
    expect(res.behaviors.map((b) => b.name)).toEqual(['good']);
    expect(res.diagnostics.map((d) => d.code)).toContain('behavior/name-dir-mismatch');
  });

  it('project wins a name collision with user, and the loser is kept as shadowed', () => {
    const proj = tmp();
    const home = tmp();
    writeSpec(proj, 'shared', { description: 'From the project.' });
    writeSpec(home, 'shared', { description: 'From the user home.' });

    const res = loadBehaviors({
      scopes: [
        { scope: 'project', rootDir: proj, optional: true },
        { scope: 'user', rootDir: home, optional: true },
      ],
    });

    expect(res.behaviors).toHaveLength(1);
    expect(res.byName.get('shared')?.description).toBe('From the project.');
    expect(res.shadowed).toHaveLength(1);
    expect(res.shadowed[0].location.scope).toBe('user');

    const dupe = res.diagnostics.find((d) => d.code === 'behavior/duplicate-name');
    expect(dupe).toBeDefined();
    // The message must name BOTH files, or the user cannot find the shadowing one.
    expect(dupe?.message).toContain(proj);
    expect(dupe?.message).toContain(home);
  });

  it('ERRORS on a directory with no BEHAVIOR.md, matching the reference validator', () => {
    // Severity is unspecified by the standard; upstream `agentbehavior
    // validate` treats this as an error, and disagreeing would mean the two
    // validators return different exit codes for the same tree.
    const root = tmp();
    mkdirSync(join(root, BEHAVIORS_DIR, 'empty-dir'), { recursive: true });
    const res = loadBehaviors(project(root));
    expect(res.behaviors).toEqual([]);
    const d = res.diagnostics.find((x) => x.code === 'behavior/missing-file');
    expect(d?.severity).toBe('error');
  });

  it('refuses a lowercase behavior.md and says to rename it', () => {
    const root = tmp();
    writeSpec(root, 'alpha', { fileName: 'behavior.md' });
    const res = loadBehaviors(project(root));
    expect(res.behaviors).toEqual([]);
    const d = res.diagnostics.find((x) => x.code === 'behavior/filename-case');
    expect(d?.message).toContain('BEHAVIOR.md');
  });

  it('warns on a spec nested one level too deep', () => {
    const root = tmp();
    writeSpec(root, 'alpha', { subdir: 'nested' });
    const res = loadBehaviors(project(root));
    expect(res.behaviors).toEqual([]);
    expect(res.diagnostics.map((d) => d.code)).toContain('behavior/nested-ignored');
  });

  it('catches the agents/ vs .agents/ mistake by name', () => {
    const root = tmp();
    // Deliberately the WRONG (undotted) directory.
    const wrong = join(root, 'agents', 'behaviors', 'alpha');
    mkdirSync(wrong, { recursive: true });
    writeFileSync(join(wrong, 'BEHAVIOR.md'), '---\nname: alpha\ndescription: d\n---\nbody');

    const res = loadBehaviors(project(root));
    expect(res.behaviors).toEqual([]);
    const d = res.diagnostics.find((x) => x.code === 'behavior/misplaced-directory');
    expect(d).toBeDefined();
    // Must name both paths so the missing dot is visible.
    expect(d?.message).toContain('.agents/behaviors');
    expect(d?.message).toContain(join(root, 'agents', 'behaviors'));
  });

  it('skips a symlinked directory that escapes the root', () => {
    const root = tmp();
    const outside = tmp();
    const outsideSpec = join(outside, 'evil');
    mkdirSync(outsideSpec, { recursive: true });
    writeFileSync(join(outsideSpec, 'BEHAVIOR.md'), '---\nname: evil\ndescription: d\n---\nbody');

    mkdirSync(join(root, BEHAVIORS_DIR), { recursive: true });
    symlinkSync(outsideSpec, join(root, BEHAVIORS_DIR, 'evil'));

    const res = loadBehaviors(project(root));
    expect(res.behaviors).toEqual([]);
    expect(res.diagnostics.map((d) => d.code)).toContain('behavior/symlink-escape');
  });

  it('treats a missing optional root as normal, not an error', () => {
    const res = loadBehaviors(project(tmp()));
    expect(res.behaviors).toEqual([]);
    expect(res.diagnostics).toEqual([]);
  });

  it('reports a missing root that was explicitly configured', () => {
    const res = loadBehaviors({ scopes: [{ scope: 'org', rootDir: join(tmp(), 'nope'), optional: false }] });
    expect(res.diagnostics.map((d) => d.code)).toContain('behavior/root-missing');
  });

  it('fires onDiagnostic once per diagnostic', () => {
    const root = tmp();
    mkdirSync(join(root, BEHAVIORS_DIR, 'empty-dir'), { recursive: true });
    const seen: string[] = [];
    const res = loadBehaviors({ ...project(root), onDiagnostic: (d) => seen.push(d.code) });
    expect(seen).toEqual(res.diagnostics.map((d) => d.code));
  });

  it('orders default scopes project, user, org', () => {
    const scopes = defaultBehaviorScopes({ projectRoot: '/p', home: '/h', orgDir: '/o' });
    expect(scopes.map((s) => s.scope)).toEqual(['project', 'user', 'org']);
  });

  it('omits the user scope when asked', () => {
    const scopes = defaultBehaviorScopes({ projectRoot: '/p', home: '/h', userScope: false });
    expect(scopes.map((s) => s.scope)).toEqual(['project']);
  });
});
