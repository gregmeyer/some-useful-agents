/**
 * `sua behaviors` command wiring.
 *
 * Runs the real command against a temp project via `cwd`, because the thing
 * most worth protecting is user-facing output: an empty result must name the
 * roots it searched and print its warnings, and `validate` must set a non-zero
 * exit code. Both are behaviors a pure unit test of the loader would miss.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { behaviorsCommand } from './behaviors.js';

let dir: string;
let cwd: string;
let logs: string[];
let origLog: typeof console.log;

function run(...args: string[]): void {
  process.exitCode = undefined;
  behaviorsCommand.parse(['node', 'sua-behaviors', ...args]);
}

const out = (): string => logs.join('\n');

function writeSpec(root: string, name: string, front?: string, body = '# b\n\ntext'): void {
  const d = join(root, '.agents', 'behaviors', name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'BEHAVIOR.md'),
    `---\n${front ?? `name: ${name}\ndescription: Spec for ${name}.`}\n---\n${body}`);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-behaviors-cli-'));
  cwd = process.cwd();
  process.chdir(dir);
  logs = [];
  origLog = console.log;
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
});

afterEach(() => {
  console.log = origLog;
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
  process.exitCode = undefined;
});

describe('sua behaviors list', () => {
  it('lists discovered specs with their scope and description', () => {
    writeSpec(dir, 'alpha');
    writeSpec(dir, 'beta');
    run('list');
    expect(out()).toContain('alpha');
    expect(out()).toContain('beta');
    expect(out()).toContain('Spec for alpha.');
    expect(out()).toContain('project');
  });

  it('names the roots it searched when nothing is found', () => {
    // A mute "0 results" is the failure mode this whole feature is built to
    // avoid; the empty state must be actionable.
    run('list');
    expect(out()).toContain('No behavior specs found');
    expect(out()).toContain('.agents/behaviors');
    expect(out()).toContain('BEHAVIOR.md');
  });

  it('prints warnings even when the list is otherwise empty', () => {
    mkdirSync(join(dir, '.agents', 'behaviors', 'no-file'), { recursive: true });
    run('list');
    expect(out()).toContain('behavior/missing-file');
  });

  it('emits stable JSON', () => {
    writeSpec(dir, 'alpha');
    run('list', '--json');
    const parsed = JSON.parse(out());
    expect(parsed.behaviors).toHaveLength(1);
    expect(parsed.behaviors[0].name).toBe('alpha');
    expect(parsed.behaviors[0].location.scope).toBe('project');
    // The body is NOT in list output — it is untrusted bulk.
    expect(parsed.behaviors[0].body).toBeUndefined();
  });
});

describe('sua behaviors validate', () => {
  it('exits 0 when everything is valid', () => {
    writeSpec(dir, 'alpha');
    run('validate');
    expect(process.exitCode).toBeFalsy();
  });

  it('exits 1 on an error and reports the code', () => {
    writeSpec(dir, 'alpha', 'name: not-alpha\ndescription: d');
    run('validate');
    expect(process.exitCode).toBe(1);
    expect(out()).toContain('behavior/name-dir-mismatch');
  });

  it('exits 0 on warnings alone, but 1 with --strict', () => {
    // An empty body is a warning: the spec is structurally valid but says
    // nothing. A stray directory would NOT work here -- that is an error, to
    // match the reference implementation.
    writeSpec(dir, 'alpha', undefined, '   ');

    run('validate');
    expect(process.exitCode).toBeFalsy();

    run('validate', '--strict');
    expect(process.exitCode).toBe(1);
  });
});

describe('sua behaviors show', () => {
  it('hides the untrusted body unless --body is passed', () => {
    writeSpec(dir, 'alpha', undefined, '# Heading\n\nSECRET_MARKER_TEXT');
    run('show', 'alpha');
    expect(out()).not.toContain('SECRET_MARKER_TEXT');
    expect(out()).toContain('Body hidden');
  });

  it('prints the body behind an untrusted-content banner with --body', () => {
    writeSpec(dir, 'alpha', undefined, '# Heading\n\nSECRET_MARKER_TEXT');
    run('show', 'alpha', '--body');
    expect(out()).toContain('SECRET_MARKER_TEXT');
  });

  it('exits 1 and lists known names for an unknown behavior', () => {
    writeSpec(dir, 'alpha');
    run('show', 'nope');
    expect(process.exitCode).toBe(1);
    expect(out()).toContain('alpha');
  });
});
