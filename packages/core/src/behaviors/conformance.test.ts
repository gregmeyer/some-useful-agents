/**
 * CONFORMANCE suite for the Agent Behavior standard.
 *
 * Table-driven, one row per normative rule, asserting the exact diagnostic code
 * so a message reword doesn't silently weaken a rule.
 *
 * The last test is the important one: for EVERY case, `record` is present iff
 * there is no error diagnostic. That is the standard's "skip structurally
 * invalid specs and surface a diagnostic rather than load partial or ambiguous
 * content", enforced across the whole table instead of trusted per branch.
 */
import { describe, it, expect } from 'vitest';
import { validateBehavior } from './validate.js';
import { MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH } from './constants.js';
import type { BehaviorDiagnosticCode, BehaviorLocation } from './types.js';

const loc = (dirName = 'refund-tone'): BehaviorLocation => ({
  scope: 'project',
  rootDir: '/repo/.agents/behaviors',
  dir: `/repo/.agents/behaviors/${dirName}`,
  file: `/repo/.agents/behaviors/${dirName}/BEHAVIOR.md`,
});

const fm = (body: string, front: string): string => `---\n${front}\n---\n${body}`;
const VALID_FRONT = 'name: refund-tone\ndescription: Keep refund replies calm and specific.';
const VALID = fm('# Refund tone\n\n**Intent:** be kind.', VALID_FRONT);

interface Case {
  label: string;
  raw: string;
  dirName?: string;
  expectRecord: boolean;
  codes: BehaviorDiagnosticCode[];
}

const CASES: Case[] = [
  { label: 'minimal valid spec', raw: VALID, expectRecord: true, codes: [] },
  {
    label: 'valid with license + metadata',
    raw: fm('# X\n\nbody', `${VALID_FRONT}\nlicense: Apache-2.0\nmetadata:\n  owner: payments\n  tags: [a, b]`),
    expectRecord: true, codes: [],
  },
  {
    label: 'unknown frontmatter key still loads (forward compatible)',
    raw: fm('# X\n\nbody', `${VALID_FRONT}\nfutureField: 1`),
    expectRecord: true, codes: [],
  },
  {
    label: 'name with underscore/uppercase is rejected',
    raw: fm('b', 'name: Refund_Tone\ndescription: d'),
    expectRecord: false, codes: ['behavior/invalid-name'],
  },
  {
    label: 'name with leading hyphen is rejected',
    raw: fm('b', 'name: -refund\ndescription: d'),
    expectRecord: false, codes: ['behavior/invalid-name'],
  },
  {
    label: 'name over 64 chars is rejected',
    raw: fm('b', `name: ${'a'.repeat(MAX_NAME_LENGTH + 1)}\ndescription: d`),
    expectRecord: false, codes: ['behavior/name-too-long'],
  },
  {
    label: 'name must match the directory name',
    raw: fm('b', 'name: alpha\ndescription: d'),
    dirName: 'beta',
    expectRecord: false, codes: ['behavior/name-dir-mismatch'],
  },
  {
    label: 'description at exactly 1024 is allowed (boundary)',
    raw: fm('b', `name: refund-tone\ndescription: ${'d'.repeat(MAX_DESCRIPTION_LENGTH)}`),
    expectRecord: true, codes: [],
  },
  {
    label: 'description at 1025 is rejected (boundary)',
    raw: fm('b', `name: refund-tone\ndescription: ${'d'.repeat(MAX_DESCRIPTION_LENGTH + 1)}`),
    expectRecord: false, codes: ['behavior/description-too-long'],
  },
  {
    label: 'missing name and description are BOTH reported',
    raw: fm('b', 'license: MIT'),
    expectRecord: false, codes: ['behavior/missing-name', 'behavior/missing-description'],
  },
  {
    label: 'no frontmatter fence at all',
    raw: '# Just markdown\n\nno frontmatter here',
    expectRecord: false, codes: ['behavior/missing-frontmatter'],
  },
  {
    label: 'frontmatter opened but never closed',
    raw: '---\nname: refund-tone\ndescription: d\n\n# body',
    expectRecord: false, codes: ['behavior/missing-frontmatter'],
  },
  {
    label: 'unparseable YAML',
    raw: fm('b', 'name: [unclosed\ndescription: d'),
    expectRecord: false, codes: ['behavior/invalid-yaml'],
  },
  {
    label: 'frontmatter is a list, not a mapping',
    raw: fm('b', '- one\n- two'),
    expectRecord: false, codes: ['behavior/frontmatter-not-mapping'],
  },
  {
    label: 'nested metadata value is dropped, spec still loads',
    raw: fm('b', `${VALID_FRONT}\nmetadata:\n  nested:\n    deep: 1`),
    expectRecord: true, codes: ['behavior/invalid-metadata'],
  },
  {
    label: 'non-string license is ignored, spec still loads',
    raw: fm('b', `${VALID_FRONT}\nlicense: 42`),
    expectRecord: true, codes: ['behavior/invalid-license'],
  },
  {
    label: 'empty body warns but loads',
    raw: fm('   \n', VALID_FRONT),
    expectRecord: true, codes: ['behavior/empty-body'],
  },
];

describe('Agent Behavior conformance', () => {
  for (const c of CASES) {
    it(c.label, () => {
      const res = validateBehavior({ raw: c.raw, location: loc(c.dirName) });
      const got = res.diagnostics.map((d) => d.code);
      for (const code of c.codes) expect(got, `expected ${code}, got ${got.join(', ')}`).toContain(code);
      expect(Boolean(res.record), `record presence for "${c.label}"`).toBe(c.expectRecord);
    });
  }

  it('holds the record⇔no-error invariant across every case', () => {
    for (const c of CASES) {
      const res = validateBehavior({ raw: c.raw, location: loc(c.dirName) });
      const hasError = res.diagnostics.some((d) => d.severity === 'error');
      expect(
        Boolean(res.record),
        `"${c.label}": record present=${Boolean(res.record)} but hasError=${hasError}`,
      ).toBe(!hasError);
    }
  });

  it('reports the real file line for a YAML error, not line 1 of the substring', () => {
    // The frontmatter starts on file line 2, so an error on its 3rd line is
    // file line 4. Getting this wrong sends people to the wrong place.
    const raw = '---\nname: refund-tone\ndescription: d\nbad: [unclosed\n---\nbody';
    const res = validateBehavior({ raw, location: loc() });
    const err = res.diagnostics.find((d) => d.code === 'behavior/invalid-yaml');
    expect(err).toBeDefined();
    expect(err?.line).toBeGreaterThanOrEqual(4);
    expect(err?.file).toBe(loc().file);
  });

  it('preserves the body byte-for-byte, including code fences', () => {
    const body = '# Title\n\n```yaml\nname: not-parsed\n```\n\n- bullet\n';
    const res = validateBehavior({ raw: fm(body, VALID_FRONT), location: loc() });
    expect(res.record?.body.trim()).toBe(body.trim());
  });

  it('truncates an oversized body and flags it', () => {
    const res = validateBehavior({
      raw: fm('x'.repeat(5000), VALID_FRONT), location: loc(), maxBodyBytes: 1000,
    });
    expect(res.record).toBeDefined();
    expect(res.record?.bodyTruncated).toBe(true);
    expect(res.diagnostics.map((d) => d.code)).toContain('behavior/body-truncated');
  });

  it('gives the same spec a stable sha256 and different specs different ones', () => {
    const a = validateBehavior({ raw: VALID, location: loc() }).record;
    const b = validateBehavior({ raw: VALID, location: loc() }).record;
    const c = validateBehavior({ raw: `${VALID}\nextra`, location: loc() }).record;
    expect(a?.sha256).toBe(b?.sha256);
    expect(a?.sha256).not.toBe(c?.sha256);
  });

  it('defaults metadata to an empty object rather than undefined', () => {
    // Callers iterate this without a guard; undefined would be a crash.
    const res = validateBehavior({ raw: VALID, location: loc() });
    expect(res.record?.metadata).toEqual({});
  });
});
