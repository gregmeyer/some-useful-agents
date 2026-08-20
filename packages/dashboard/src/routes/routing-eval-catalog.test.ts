/**
 * Routing eval — REAL CATALOG mode.
 *
 * The sibling `routing-eval.test.ts` is an ablation eval over a synthetic
 * fixture: it proves the FIELDS work, using agents it invents. That is exactly
 * why it never noticed that only 8 of the 43 agents we actually ship declare
 * any routing metadata at all — a perfect score on invented agents says nothing
 * about the catalog a newcomer gets from `sua init`.
 *
 * This file closes that gap. It loads `agents/examples/` off disk and runs a
 * labeled set of NEWCOMER PHRASINGS through the same two pure functions triage
 * uses, reporting:
 *
 *   - recall@cap : did the right agent make the capped triage catalog?
 *   - mean rank  : how near the front did it land?
 *   - reuse hint : does `strongestReuseCandidate` fire, and on the right agent?
 *
 * The last one is the load-bearing check, and it is the one a naive backfill
 * breaks. `strongestReuseCandidate` needs score >= 9 AND a >= 3 margin over the
 * runner-up. Adding metadata to a CLUSTER of similar agents (four `ashby-*` on
 * "find me jobs", two `weather-*` on "what's the temperature") lifts them all
 * together: every member clears the score floor while the MARGIN between them
 * collapses, so the hint fires LESS than it did before. A routing regression
 * caused by a routing improvement. Asserting on the hint here is what makes
 * that visible instead of silent.
 *
 * Phrasings are written the way someone types into the ask band on day one —
 * not the way the agent describes itself.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAgent, rankAgentsByRelevance } from '@some-useful-agents/core';
import type { Agent } from '@some-useful-agents/core';
import { selectTriageCatalog, strongestReuseCandidate } from './inbox-catalog.js';
import { SYSTEM_AGENT_IDS } from './inbox-shared.js';

const EXAMPLES_DIR = join(
  dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'agents', 'examples',
);

const CAP = 10;

/**
 * `(what a newcomer types) → (the agent that should handle it)`.
 *
 * Built BEFORE the metadata backfill and deliberately not derived from it —
 * if the labels were written from the same draft as the `sampleQuestions`, the
 * eval would be grading the drafter against itself and would pass by
 * construction. Phrasings avoid echoing the target's id/name where a newcomer
 * plausibly would not know it.
 */
const LABELED: Array<{ text: string; agentId: string }> = [
  // weather
  { text: "what's the temperature outside right now", agentId: 'weather-forecast' },
  { text: 'will i need a jacket this week', agentId: 'weather-forecast' },
  { text: 'put local conditions on a dashboard tile', agentId: 'weather-dashboard' },

  // jobs / ashby cluster — the margin-collapse cluster
  { text: 'find open engineering roles at a company', agentId: 'ashby-job-finder' },
  { text: 'which startups are hiring right now', agentId: 'ashby-discover' },
  { text: 'search several companies job boards at once', agentId: 'ashby-jobs-multi' },
  { text: 'find companies hiring then search all their boards', agentId: 'ashby-search-discovered' },

  // starters + digests
  { text: 'watch a website for changes', agentId: 'starter-watch' },
  { text: 'research a topic and cite sources', agentId: 'starter-research' },
  { text: 'write me a first draft and improve it', agentId: 'starter-draft' },
  { text: 'give me a roundup of news headlines', agentId: 'two-step-digest' },
  { text: 'compile a digest from several sources', agentId: 'research-digest' },

  // local ops / monitoring
  { text: 'is my website up or down', agentId: 'api-monitor' },
  { text: 'how much disk space is left on this machine', agentId: 'system-health' },
  { text: 'how many commits did we make this week', agentId: 'git-activity' },
  { text: 'what did my agents do today', agentId: 'daily-summary' },
  { text: 'my agent failed with exit code 127', agentId: 'error-troubleshooter' },

  // records / data / graphics
  { text: 'log an architecture decision we just made', agentId: 'adr-logger' },
  { text: 'look up past architecture decisions', agentId: 'adr-browser' },
  { text: 'which customers cancelled recently', agentId: 'churn-watcher' },
  { text: 'turn this csv into a chart', agentId: 'chart-creator-mcp' },
  { text: 'make a hero image for my blog post', agentId: 'graphics-creator-mcp' },

  // media / fun
  { text: 'find a funny cat video', agentId: 'cat-video-finder' },
  { text: 'make up a joke about programming', agentId: 'llm-tells-a-joke' },
  { text: 'send me a joke every morning', agentId: 'daily-joke' },
  { text: 'show me interesting short films', agentId: 'vimeo-staff-picks' },
  { text: 'say good morning to me each day', agentId: 'daily-greeting' },
];

/**
 * Queries whose whole point is that they are AMBIGUOUS within a cluster. The
 * right behavior is no reuse hint at all: triage should fall through to
 * agent-catalog-search and the LLM rather than spotlight one arbitrary member
 * of a family of near-identical agents.
 */
const AMBIGUOUS_CLUSTER_QUERIES = [
  'find me jobs',
  'tell me a joke',
];

/**
 * Read the shipped examples with the V2 parser.
 *
 * NOT `loadAgents` — that is the v1 loader, and `agent-loader.ts` SILENTLY
 * skips any file with `id` + `nodes[]` (i.e. every v2 agent) with no warning.
 * Pointing it at `agents/examples` returns an empty map and zero warnings,
 * which reads exactly like success. CI's validate-agents job makes that same
 * mistake and has been printing "0 agent(s) validated successfully" for real.
 * An eval that loaded nothing would score a silent, meaningless 0 here too.
 */
function loadExampleCatalog(): Agent[] {
  const files = readdirSync(EXAMPLES_DIR).filter((f) => extname(f) === '.yaml');
  const agents = files.map((f) => {
    try {
      return parseAgent(readFileSync(join(EXAMPLES_DIR, f), 'utf-8'));
    } catch (err) {
      throw new Error(`agents/examples/${f} failed to parse: ${(err as Error).message}`);
    }
  });
  return agents.filter((a) => !SYSTEM_AGENT_IDS.has(a.id));
}

const CATALOG = loadExampleCatalog();

/**
 * Two metrics, because they measure different things and only one of them is
 * honest about this catalog.
 *
 * recall@cap was nearly saturated BEFORE any backfill (0.96): the cap is 10 and
 * the catalog is only ~37 agents, so a single +1 description word is usually
 * enough to make the cut. It guards against a catastrophic ranking regression
 * and little else.
 *
 * top-1 is the metric that discriminates, and it is what the operator actually
 * experiences — the first result in `/agents` search, and the agent triage
 * spotlights for reuse. Measured pre-backfill at 15/27 = 0.56, with agents like
 * `adr-browser` and `vimeo-staff-picks` scoring a flat ZERO on their own
 * queries while `ashby-job-finder` won four asks that had nothing to do with
 * jobs. That is the number this backfill exists to move.
 */
function evaluate() {
  const ranks: number[] = [];
  const misses: string[] = [];
  const notTop1: string[] = [];
  let top1 = 0;

  for (const { text, agentId } of LABELED) {
    const out = selectTriageCatalog(CATALOG, new Map(), text, CAP);
    const rank = out.findIndex((a) => a.id === agentId);
    if (rank < 0) misses.push(`${agentId} <- "${text}"`);
    else ranks.push(rank);

    const ranked = rankAgentsByRelevance(CATALOG, text);
    if (ranked[0]?.agent.id === agentId) top1 += 1;
    else {
      const want = ranked.find((r) => r.agent.id === agentId);
      notTop1.push(
        `${agentId} <- "${text}" | got ${ranked[0]?.agent.id}(${ranked[0]?.score}) want(${want?.score ?? 0})`,
      );
    }
  }

  return {
    recall: ranks.length / LABELED.length,
    meanRank: ranks.length ? ranks.reduce((s, r) => s + r, 0) / ranks.length : Infinity,
    top1: top1 / LABELED.length,
    misses,
    notTop1,
  };
}

describe('routing eval — real agents/examples catalog', () => {
  const result = evaluate();

  it('every labeled agent id exists on disk (the labels do not rot)', () => {
    const ids = new Set(CATALOG.map((a) => a.id));
    const unknown = Array.from(new Set(LABELED.map((l) => l.agentId))).filter((id) => !ids.has(id));
    expect(unknown, `labeled ids not found in agents/examples: ${unknown.join(', ')}`).toEqual([]);
  });

  it('reports recall + mean rank over the shipped catalog', () => {
    // eslint-disable-next-line no-console
    console.log(
      `[routing-eval:real] catalog=${CATALOG.length} queries=${LABELED.length} ` +
      `top1=${result.top1.toFixed(2)} recall@${CAP}=${result.recall.toFixed(2)} ` +
      `meanRank=${result.meanRank.toFixed(2)}` +
      (result.misses.length ? `\n  not in cap:\n    ${result.misses.join('\n    ')}` : '') +
      (result.notTop1.length ? `\n  not top-1:\n    ${result.notTop1.join('\n    ')}` : ''),
    );
    expect(CATALOG.length).toBeGreaterThan(30);
  });

  it('ranks the right agent FIRST for most newcomer phrasings (top-1)', () => {
    // Pre-backfill this was 0.56. The bar is set just under the post-backfill
    // measurement rather than at 1.0: a few labels are genuinely ambiguous
    // between sibling agents, and forcing those to top-1 would mean overfitting
    // sampleQuestions to the eval — the exact dishonesty the labeled set is
    // meant to prevent.
    expect(result.top1, `not top-1:\n${result.notTop1.join('\n')}`).toBeGreaterThanOrEqual(0.85);
  });

  it('surfaces the right agent for every newcomer phrasing (recall@cap = 1.0)', () => {
    expect(result.misses, `missed: ${result.misses.join(' | ')}`).toEqual([]);
    expect(result.recall).toBe(1);
  });

  it('lands the right agent near the front, not merely inside the cap', () => {
    expect(result.meanRank).toBeLessThanOrEqual(3);
  });

  it('fires the reuse hint on the RIGHT agent for unambiguous asks', () => {
    // A sharply-worded ask should spotlight exactly one agent. Anything that
    // fires on the wrong id is worse than not firing: triage would propose
    // reusing an agent that cannot do the job.
    const sharp = [
      { text: 'watch a website for changes', agentId: 'starter-watch' },
      { text: "what's the temperature outside right now", agentId: 'weather-forecast' },
      { text: 'find a funny cat video', agentId: 'cat-video-finder' },
    ];
    const wrong = sharp
      .map((s) => ({ ...s, got: strongestReuseCandidate(CATALOG, s.text) }))
      .filter((s) => s.got !== null && s.got.id !== s.agentId)
      .map((s) => `"${s.text}" -> ${s.got?.id} (want ${s.agentId})`);
    expect(wrong, `reuse hint fired on the wrong agent: ${wrong.join(' | ')}`).toEqual([]);
  });

  it('stays silent on queries that are ambiguous within a cluster', () => {
    // The backfill lifts every member of a cluster at once. If it ever lifts
    // ONE member clear of its siblings by 3+ points on a query this generic,
    // that is a drafting bug (a sample question that swallowed the whole
    // cluster's vocabulary), not a win.
    const spurious = AMBIGUOUS_CLUSTER_QUERIES
      .map((text) => ({ text, got: strongestReuseCandidate(CATALOG, text) }))
      .filter((x) => x.got !== null)
      .map((x) => `"${x.text}" -> ${x.got?.id} (score ${x.got?.score})`);
    expect(spurious, `reuse hint fired on an ambiguous cluster query: ${spurious.join(' | ')}`).toEqual([]);
  });
});
