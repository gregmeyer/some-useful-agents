/**
 * Structural guard: the behaviors module must never reach the LLM layer.
 *
 * Behavior specs are untrusted third-party Markdown that a user can drop into
 * `~/.agents/behaviors/` and have apply to every project on the machine.
 *
 * This module is the READER: discovery, validation, display. It has no business
 * touching the model layer, and the risk is not today's code but the plausible
 * future change where someone "just passes the behavior text to the analyzer"
 * from here. A prose rule in an ADR does not stop that; a failing test does.
 *
 * NOTE for whoever adds behavior-conditioned prompting: the answer is NOT to
 * relax this test. Per ADR-0031, conditioning is opt-in per agent and restricted
 * to `project` scope, because a spec in the repo is code-reviewed while one in a
 * home directory is ambient text. That belongs in its own module with its own
 * scope guard, so this reader stays provably inert.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Modules that mean "this code can talk to a model". */
const FORBIDDEN = [
  'llm-invoker',
  'agent-loop/',
  'node-spawner',
  'dag-executor',
  'outcome/judge',
];

describe('behaviors module isolation', () => {
  const sources = readdirSync(HERE)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

  it('has source files to check (guards against a silently empty assertion)', () => {
    expect(sources.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of sources) {
    it(`${file} does not import the LLM layer`, () => {
      const src = readFileSync(join(HERE, file), 'utf-8');
      const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      const bad = imports.filter((i) => FORBIDDEN.some((f) => i.includes(f)));
      expect(
        bad,
        `${file} imports ${bad.join(', ')} — behavior spec content must never reach a model prompt (ADR-0031).`,
      ).toEqual([]);
    });
  }
});
