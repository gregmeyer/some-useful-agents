/**
 * Routing-metadata COVERAGE GATE for the agents we actually ship.
 *
 * Why this exists: `agents/examples/` shipped 43 agents of which 8 declared any
 * routing metadata and ZERO declared tags, and nothing noticed for months. Two
 * things hid it. The routing eval was 100% synthetic, so it scored a perfect
 * recall on agents it invented. And CI's "validate all agent YAML" step called
 * `loadAgents`, the V1 loader, which silently skips every file with `id` +
 * `nodes[]` — i.e. all of them — and then printed "0 agent(s) validated
 * successfully" in green.
 *
 * So this gate deliberately:
 *   - uses `parseAgent` (the v2 parser), not `loadAgents`
 *   - asserts the catalog is non-empty before asserting anything about it, so a
 *     future loader change can never turn this file into a silent no-op the way
 *     it turned CI's step into one
 *   - ties its quality checks to `catalogTokens`, the ranker's own tokenizer,
 *     rather than to prose length — a field only helps routing if it survives
 *     tokenization
 *
 * Paired with `routing-eval-catalog.test.ts` in the dashboard, which measures
 * whether the metadata actually ROUTES. This file only measures that it EXISTS
 * and is well-formed. Both are needed: perfect coverage of useless phrases would
 * pass this gate and fail that eval.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAgent } from './agent-yaml.js';
import { catalogTokens } from './agent-relevance.js';
import type { Agent } from './agent-v2-types.js';

const EXAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'agents', 'examples');

/**
 * Agents exempt from the routing-metadata requirement, each with the reason.
 *
 * Two families qualify, and nothing else should:
 *   1. META / INFRASTRUCTURE — dispatched programmatically by the product
 *      (triage, the build orchestrator, the improve-layout wizard). A human
 *      never routes to these by typing a request, so routing metadata would be
 *      dead weight that also pollutes the ranker for real queries.
 *   2. TRIVIAL DEMOS — teaching fixtures that exist to show one mechanic. They
 *      have no real-world job to be routed to.
 *
 * This list is checked in BOTH directions (see the tests below). An id that
 * stops existing must be removed from here, or the list slowly becomes a
 * graveyard that silently exempts agents nobody meant to exempt — exactly how
 * the original coverage gap went unnoticed.
 */
export const METADATA_EXEMPT_AGENT_IDS: Readonly<Record<string, string>> = {
  // 1. meta / infrastructure
  'agent-analyzer': 'dispatched by "Suggest improvements", never routed to by a request',
  'agent-builder': 'goal-driven wizard, invoked by the build flow',
  'agent-catalog-search': 'the search backend itself; routing to it would be circular',
  'agent-drafter': 'invoked per-fragment by the build orchestrator',
  'agent-editor': 'apply-the-fix step dispatched by triage',
  'build-planner': 'stage 2 of the build orchestrator',
  'conditional-router': 'control-flow teaching fixture wired into other DAGs',
  'dashboard-designer': 'stage 3 of the build orchestrator',
  'goal-surveyor': 'stage 1 of the build orchestrator',
  'inbox-learning-extractor': 'post-resolution distillation, runs unattended',
  'inbox-triage': 'the router itself',
  'layout-planner': 'invoked by the improve-layout wizard',

  // 2. trivial demos
  'apple-foundationmodels-prompt': 'provider smoke test, not a user-facing job',
  'hello': 'first-run teaching fixture',
  'parameterised-greet': 'teaching fixture for agent inputs',
  'parameterised-greet-claude': 'teaching fixture for inputs via Claude Code',
  'weather-stub': 'mock data generator; weather-forecast is the real one',
};

const MIN_TAGS = 2;
const MIN_ENTRY_CONDITIONS = 2;
const MIN_SAMPLE_QUESTIONS = 3;
const MIN_SAMPLE_QUESTION_CHARS = 20;
/** A tag shared by more than this many agents has stopped discriminating. */
const MAX_AGENTS_PER_TAG = 6;

function loadExamples(): Agent[] {
  return readdirSync(EXAMPLES_DIR)
    .filter((f) => extname(f) === '.yaml')
    .map((f) => {
      try {
        return parseAgent(readFileSync(join(EXAMPLES_DIR, f), 'utf-8'));
      } catch (err) {
        throw new Error(`agents/examples/${f} failed to parse: ${(err as Error).message}`);
      }
    });
}

const ALL = loadExamples();
const COVERED = ALL.filter((a) => !(a.id in METADATA_EXEMPT_AGENT_IDS));

describe('shipped agent routing-metadata coverage', () => {
  it('actually loaded the shipped catalog (guards against a silent no-op)', () => {
    // The failure this file was written to prevent looked exactly like success.
    expect(ALL.length).toBeGreaterThan(30);
    expect(COVERED.length).toBeGreaterThan(20);
  });

  it('every exempt id still exists on disk (the list is not a graveyard)', () => {
    const ids = new Set(ALL.map((a) => a.id));
    const stale = Object.keys(METADATA_EXEMPT_AGENT_IDS).filter((id) => !ids.has(id));
    expect(stale, `exempt ids no longer in agents/examples (remove them): ${stale.join(', ')}`).toEqual([]);
  });

  it('declares tags, entryConditions and sampleQuestions on every non-exempt agent', () => {
    const bad: string[] = [];
    for (const a of COVERED) {
      const tags = a.tags ?? [];
      const entry = a.entryConditions ?? [];
      const samples = a.sampleQuestions ?? [];
      if (tags.length < MIN_TAGS) bad.push(`${a.id}: ${tags.length} tags (need ${MIN_TAGS})`);
      if (entry.length < MIN_ENTRY_CONDITIONS) bad.push(`${a.id}: ${entry.length} entryConditions (need ${MIN_ENTRY_CONDITIONS})`);
      if (samples.length < MIN_SAMPLE_QUESTIONS) bad.push(`${a.id}: ${samples.length} sampleQuestions (need ${MIN_SAMPLE_QUESTIONS})`);
    }
    expect(bad, `under-specified agents:\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  it('writes sample questions a person would actually type', () => {
    const bad: string[] = [];
    for (const a of COVERED) {
      for (const q of a.sampleQuestions ?? []) {
        if (q.trim().length < MIN_SAMPLE_QUESTION_CHARS) {
          bad.push(`${a.id}: too short (${q.trim().length} < ${MIN_SAMPLE_QUESTION_CHARS}): "${q}"`);
        }
      }
    }
    expect(bad, `weak sample questions:\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  it('never repeats a sample question across two agents', () => {
    // The characteristic failure of a bulk LLM backfill is copy-paste. A shared
    // question is worse than a missing one: it scores BOTH agents equally and
    // destroys the margin the reuse hint depends on.
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const a of COVERED) {
      for (const q of a.sampleQuestions ?? []) {
        const key = q.trim().toLowerCase();
        const prev = seen.get(key);
        if (prev) dupes.push(`"${q}" shared by ${prev} and ${a.id}`);
        else seen.set(key, a.id);
      }
    }
    expect(dupes, `duplicated sample questions:\n  ${dupes.join('\n  ')}`).toEqual([]);
  });

  it('writes routing fields that survive the ranker\'s own tokenizer', () => {
    // Ties the gate to `catalogRelevance`'s real matching rule instead of to
    // prose length: an entry made only of stopwords and 2-char words scores
    // nothing, however long it reads.
    const bad: string[] = [];
    for (const a of COVERED) {
      for (const [field, values] of [
        ['tags', a.tags ?? []],
        ['entryConditions', a.entryConditions ?? []],
        ['sampleQuestions', a.sampleQuestions ?? []],
      ] as const) {
        for (const v of values) {
          if (catalogTokens(v).length === 0) bad.push(`${a.id}.${field}: no scorable token in "${v}"`);
        }
      }
    }
    expect(bad, `unscorable routing entries:\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  it('keeps tags discriminating rather than generic', () => {
    const counts = new Map<string, string[]>();
    for (const a of COVERED) {
      for (const t of a.tags ?? []) {
        const key = t.trim().toLowerCase();
        counts.set(key, [...(counts.get(key) ?? []), a.id]);
      }
    }
    const generic = Array.from(counts.entries())
      .filter(([, ids]) => ids.length > MAX_AGENTS_PER_TAG)
      .map(([t, ids]) => `"${t}" on ${ids.length} agents (${ids.join(', ')})`);
    expect(generic, `over-broad tags:\n  ${generic.join('\n  ')}`).toEqual([]);
  });
});
