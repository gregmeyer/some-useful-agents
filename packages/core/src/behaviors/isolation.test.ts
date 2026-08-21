/**
 * Structural guard: the behaviors module must never reach the LLM layer.
 *
 * Behavior specs are untrusted third-party Markdown that a user can drop into
 * `~/.agents/behaviors/` and have apply to every project on the machine. The
 * standard's own client guidance says clients SHOULD NOT inject behavior specs
 * into runtime prompts, and ADR-0031 makes that a hard rule for us rather than
 * a preference.
 *
 * The risk is not today's code — it is the plausible future change where
 * someone "just passes the behavior text to the analyzer". A prose rule in an
 * ADR does not stop that; a failing test does. This asserts on imports rather
 * than on behavior because an import is the thing that has to appear first.
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
