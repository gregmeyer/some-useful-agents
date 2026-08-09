/**
 * Routing-metadata ABLATION EVAL — does entryConditions/sampleQuestions actually
 * improve which agents triage sees?
 *
 * `selectTriageCatalog` is pure, so we can measure the benefit deterministically
 * with no LLM cost: run a labeled set of `(request → correct agent)` pairs through
 * the ranker twice — once WITH the routing metadata, once with it STRIPPED — and
 * compare two numbers:
 *
 *   - recall@cap : did the correct agent make the capped catalog at all? (if it's
 *                  cut, the triage LLM can never pick it — this is what matters most)
 *   - mean rank  : how near the front did the correct agent land?
 *
 * The fixture is adversarial ON PURPOSE: every request is phrased so it shares NO
 * words with the target agent's id/name/description — the ONLY match signal is the
 * routing metadata. Each target also has an OLD createdAt while the distractors are
 * newer, so without a relevance signal the target is truncated out by the
 * recency/created fill (exactly the real failure this feature fixes). This makes
 * the delta a clean, honest measure of the fields' contribution, and a permanent
 * regression guard: if a change weakens the scoring, recall@cap drops and this fails.
 */
import { describe, it, expect } from 'vitest';
import type { Agent } from '@some-useful-agents/core';
import { selectTriageCatalog } from './inbox-catalog.js';

interface TargetSpec {
  id: string;
  name: string;
  description: string;
  entryConditions: string[];
  sampleQuestions: string[];
  nonEntryConditions?: string[];
}

/**
 * Targets have deliberately BLAND names/descriptions — the discriminating words
 * live only in entryConditions/sampleQuestions, so the ablation isolates the
 * fields' effect. Modeled on the backfilled example agents.
 */
const TARGETS: TargetSpec[] = [
  {
    id: 'sky-helper', name: 'Sky Helper', description: 'Atmospheric utility service',
    entryConditions: ['user asks about rain, umbrella, or the forecast for a place'],
    sampleQuestions: ['Will it rain in Denver tomorrow?', "What's the forecast this weekend?"],
    nonEntryConditions: ['user asks about historical climate averages'],
  },
  {
    id: 'roster-scout', name: 'Roster Scout', description: 'Company roster utility',
    entryConditions: ['user wants open jobs or hiring at a named company'],
    sampleQuestions: ['What roles is Ramp hiring?', 'Show open jobs at Notion'],
  },
  {
    id: 'purrbot', name: 'Purr Bot', description: 'Media retrieval helper',
    entryConditions: ['user wants a cat video or kitten footage'],
    sampleQuestions: ['Find a cat video', 'Show me kittens playing'],
  },
  {
    id: 'chuckle', name: 'Chuckle', description: 'Levity generator',
    entryConditions: ['user wants a joke or something to laugh at'],
    sampleQuestions: ['Tell me a joke', 'Make me laugh with a joke'],
  },
  {
    id: 'brief-maker', name: 'Brief Maker', description: 'Compilation utility',
    entryConditions: ['user wants a multi-source research digest'],
    sampleQuestions: ['Compile a research digest on this topic'],
  },
  {
    id: 'doc-condenser', name: 'Doc Condenser', description: 'Text reduction helper',
    entryConditions: ['user wants to summarize a PDF or document'],
    sampleQuestions: ['Summarize this PDF for me'],
  },
];

/** Labeled requests: paraphrases that avoid each target's own id/name/description vocabulary. */
const REQUESTS: Array<{ text: string; agentId: string }> = [
  { text: 'will it rain in denver tomorrow', agentId: 'sky-helper' },
  { text: "what's the forecast this weekend", agentId: 'sky-helper' },
  { text: 'do i need an umbrella today', agentId: 'sky-helper' },
  { text: 'what roles is ramp hiring for', agentId: 'roster-scout' },
  { text: 'open jobs at notion right now', agentId: 'roster-scout' },
  { text: 'find a cat video', agentId: 'purrbot' },
  { text: 'show me kittens playing', agentId: 'purrbot' },
  { text: 'tell me a joke', agentId: 'chuckle' },
  { text: 'make me laugh', agentId: 'chuckle' },
  { text: 'compile a research digest on payroll', agentId: 'brief-maker' },
  { text: 'summarize this pdf', agentId: 'doc-condenser' },
  { text: 'condense this document for me', agentId: 'doc-condenser' },
];

const CAP = 10;
// Distractors outnumber the cap so it binds; newer createdAt than the targets so
// they win the recency/created fill when the targets have no relevance signal.
const DISTRACTOR_COUNT = 14;

function buildAgents(withFields: boolean): Agent[] {
  const targets = TARGETS.map((t, i): Agent => ({
    id: t.id, name: t.name, description: t.description,
    status: 'active', source: 'local', mcp: false, nodes: [],
    createdAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`, // OLD
    ...(withFields ? {
      entryConditions: t.entryConditions,
      sampleQuestions: t.sampleQuestions,
      ...(t.nonEntryConditions ? { nonEntryConditions: t.nonEntryConditions } : {}),
    } : {}),
  } as unknown as Agent));
  const distractors = Array.from({ length: DISTRACTOR_COUNT }, (_, i): Agent => ({
    id: `filler-${i}`, name: `Filler ${i}`, description: 'A generic background utility',
    status: 'active', source: 'local', mcp: false, nodes: [],
    createdAt: `2026-06-${String(i + 1).padStart(2, '0')}T00:00:00Z`, // NEWER
  } as unknown as Agent));
  return [...targets, ...distractors];
}

function scoreRun(withFields: boolean): { recall: number; meanRank: number; found: boolean[] } {
  const agents = buildAgents(withFields);
  const ranks: number[] = [];
  const found: boolean[] = [];
  for (const req of REQUESTS) {
    const out = selectTriageCatalog(agents, new Map(), req.text, CAP);
    const rank = out.findIndex((a) => a.id === req.agentId);
    found.push(rank >= 0);
    if (rank >= 0) ranks.push(rank);
  }
  const recall = found.filter(Boolean).length / REQUESTS.length;
  const meanRank = ranks.length ? ranks.reduce((s, r) => s + r, 0) / ranks.length : Infinity;
  return { recall, meanRank, found };
}

describe('routing-metadata ablation eval', () => {
  const withFields = scoreRun(true);
  const withoutFields = scoreRun(false);

  it('reports the with/without-fields routing numbers', () => {
    // Visibility line — shows the measured lift when the suite runs verbose.
    // eslint-disable-next-line no-console
    console.log(
      `[routing-eval] recall@${CAP}: with=${withFields.recall.toFixed(2)} without=${withoutFields.recall.toFixed(2)} | ` +
      `meanRank: with=${withFields.meanRank.toFixed(2)} without=${withoutFields.meanRank.toFixed(2)} ` +
      `(${REQUESTS.length} labeled requests, ${TARGETS.length} targets, ${DISTRACTOR_COUNT} distractors)`,
    );
    expect(REQUESTS.length).toBeGreaterThanOrEqual(12);
  });

  it('finds every labeled agent WITH routing metadata (recall@cap = 1.0)', () => {
    expect(withFields.recall).toBe(1);
  });

  it('routing metadata STRICTLY improves recall@cap over the no-fields baseline', () => {
    expect(withFields.recall).toBeGreaterThan(withoutFields.recall);
  });

  it('surfaces the correct agent near the front when fields are present', () => {
    // With relevance front-loading, the target should sit at/near rank 0.
    expect(withFields.meanRank).toBeLessThanOrEqual(3);
  });
});
