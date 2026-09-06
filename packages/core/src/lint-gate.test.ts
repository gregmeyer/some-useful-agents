/**
 * Guards the type-check gate itself.
 *
 * `npm run lint` was `tsc --noEmit` for a long time and checked **nothing**:
 * the root `tsconfig.json` is `{ "files": [], "references": [...] }`, and a
 * non-build `tsc` invocation against that visits zero files. It exited 0 on a
 * file containing both a type error and an undefined identifier, in CI as well
 * as locally. The build was the only thing catching anything.
 *
 * The shape of that trap is easy to reintroduce — `--noEmit` looks like the
 * obviously-right flag for a lint script — so the reasoning is encoded here.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const readJson = (rel: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(root, rel), 'utf-8')) as Record<string, unknown>;

describe('the type-check gate', () => {
  it('the root tsconfig delegates entirely to project references', () => {
    const tsconfig = readJson('tsconfig.json');
    // This is WHY a bare `tsc` is a no-op here: there are no files to check.
    expect(tsconfig.files).toEqual([]);
    expect(Array.isArray(tsconfig.references)).toBe(true);
    expect((tsconfig.references as unknown[]).length).toBeGreaterThan(0);
  });

  it('lint runs a build, because that is the only form that checks anything', () => {
    const scripts = readJson('package.json').scripts as Record<string, string>;
    // `tsc --build` is required, not stylistic. With `files: []` a non-build
    // run checks zero files, and `tsc --build --noEmit` is refused outright:
    //   TS6310: Referenced project '...' may not disable emit.
    // Composite references have to emit declarations for downstream projects
    // to type-check against, so "check without emitting" is not available.
    expect(scripts.lint).toContain('--build');
    expect(scripts.lint).not.toBe('tsc --noEmit');
  });
});
