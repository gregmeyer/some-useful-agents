/**
 * Evaluation of OutcomeDetection itself.
 *
 * The question this file exists to answer is not "does the code run" but
 * "should we believe the records it produces". It scores the detector on
 * the five properties that make an outcome record trustworthy, against
 * the labelled 12-run fixture in `fixtures/scenarios.ts`, and prints a
 * scorecard.
 *
 * Deliberately not a framework: the repo has no eval harness, and one
 * labelled fixture plus five ratios is enough to catch a regression. It
 * runs fully offline — the judge under test is scripted, including one
 * that lies and one that is credulous, because the interesting failures
 * of an LLM judge are not random noise.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { forJudge, runAllScenariosMulti, type MultiScenarioResult, type ScenarioResult } from './fixtures/scenarios.js';
import type { JudgeFn, OutcomeRecord } from './types.js';

const TIMEOUT = 180_000;

interface Scorecard {
  evidenceGrounding: number;
  outcomeRecall: number;
  falseOutcomeRate: number;
  missingStateDetection: number;
  evaluationAccuracy: number;
  /** Not a gate. Verdicts stronger than ground truth without being an outright false "yes". */
  overclaimRate: number;
}

/**
 * `hasJudge` matters for missing-state scoring: `not-inferred` is by
 * definition only emitted when no judge ran, so requiring it in judged
 * mode would score a fixture artifact rather than the detector.
 */
function score(results: ScenarioResult[], hasJudge = false): Scorecard {
  let citedTotal = 0;
  let citedResolved = 0;
  let recallHits = 0;
  let falseOutcomes = 0;
  let yesClaims = 0;
  let missingStateHits = 0;
  let accurate = 0;
  let overclaims = 0;

  const strength: Record<OutcomeRecord['evaluation']['satisfied'], number> = {
    no: 0, undetermined: 1, partial: 2, yes: 3,
  };

  for (const r of results) {
    const rec = r.record;
    const truth = r.spec.groundTruth;

    // 1. Evidence grounding — does every citation resolve to a real item?
    const known = new Set(rec.observation.evidence.map((e) => e.id));
    for (const claim of [rec.observation.observedOutcome, rec.evaluation.expectedVsObserved]) {
      for (const id of claim?.citedEvidenceIds ?? []) {
        citedTotal++;
        if (known.has(id)) citedResolved++;
      }
    }

    // 2. Outcome recall — did it surface the evidence this run turns on?
    const kinds = new Set(rec.observation.evidence.map((e) => e.kind));
    if (truth.mustSurfaceEvidenceKinds.every((k) => kinds.has(k as never))) recallHits++;

    // 3. False outcome rate — claimed success where there was none.
    if (rec.evaluation.satisfied === 'yes') {
      yesClaims++;
      if (truth.satisfied !== 'yes') falseOutcomes++;
    }

    // 4. Missing-state detection — did it admit what it could not know?
    const reasons = new Set(rec.unknowns.map((u) => u.reason));
    const required = hasJudge
      ? truth.mustFlagUnknownReasons.filter((x) => x !== 'not-inferred')
      : truth.mustFlagUnknownReasons;
    if (required.every((x) => reasons.has(x as never))) missingStateHits++;

    // 5. Evaluation accuracy.
    if (rec.evaluation.satisfied === truth.satisfied) accurate++;
    else if (strength[rec.evaluation.satisfied] > strength[truth.satisfied]) overclaims++;
  }

  const n = results.length;
  return {
    evidenceGrounding: citedTotal === 0 ? 1 : citedResolved / citedTotal,
    outcomeRecall: recallHits / n,
    falseOutcomeRate: yesClaims === 0 ? 0 : falseOutcomes / yesClaims,
    missingStateDetection: missingStateHits / n,
    evaluationAccuracy: accurate / n,
    overclaimRate: overclaims / n,
  };
}

function printScorecard(label: string, s: Scorecard): void {
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  // eslint-disable-next-line no-console
  console.log(
    `\n  OutcomeDetection scorecard — ${label}\n`
    + `  ├─ evidence grounding ......... ${pct(s.evidenceGrounding)}  (gate: 100%)\n`
    + `  ├─ outcome recall ............. ${pct(s.outcomeRecall)}  (gate: ≥90%)\n`
    + `  ├─ false outcome rate ......... ${pct(s.falseOutcomeRate)}  (gate: 0%)\n`
    + `  ├─ missing-state detection .... ${pct(s.missingStateDetection)}  (gate: ≥90%)\n`
    + `  ├─ evaluation accuracy ........ ${pct(s.evaluationAccuracy)}  (gate: ≥90%)\n`
    + `  └─ overclaim rate ............. ${pct(s.overclaimRate)}  (reported, not gated)\n`,
  );
}

/**
 * ONE execution pass, re-detected under every judge. Detection is pure over
 * (agent, run, nodeExecutions), so re-running the agent per judge would triple
 * the real process spawns for no extra signal — and this suite is heavy enough
 * that doing so destabilises unrelated port-binding tests elsewhere in the
 * repo (see vitest.config.ts on CI oversubscription).
 */
let pass: MultiScenarioResult[];

/** Cites evidence that was never in the bundle. */
const fabricator: JudgeFn = async () => ({
  observedOutcome: { text: 'The digest was emailed to the whole team.', citedEvidenceIds: ['ev404'] },
  expectedVsObserved: { text: 'Fully met.', citedEvidenceIds: ['ev404', 'ev999'] },
  satisfied: 'yes',
});

/** Grounded, but says yes to everything. The realistic LLM-judge failure. */
const credulous: JudgeFn = async ({ evidence }) => ({
  observedOutcome: { text: 'Everything looks fine.', citedEvidenceIds: [evidence[0]?.id ?? 'ev1'] },
  expectedVsObserved: { text: 'Expectation met.', citedEvidenceIds: [evidence[0]?.id ?? 'ev1'] },
  satisfied: 'yes',
});

beforeAll(async () => {
  pass = await runAllScenariosMulti({ none: undefined, fabricator, credulous });
}, TIMEOUT);

describe('OutcomeDetection self-evaluation — deterministic (no judge)', () => {
  let card: Scorecard;

  beforeAll(() => {
    card = score(forJudge(pass, 'none'));
    printScorecard('deterministic, no judge', card);
  });

  it('grounds every claim it makes', () => {
    expect(card.evidenceGrounding).toBe(1);
  });

  it('surfaces the materially important evidence', () => {
    expect(card.outcomeRecall).toBeGreaterThanOrEqual(0.9);
  });

  it('never claims an outcome the evidence does not support', () => {
    expect(card.falseOutcomeRate).toBe(0);
  });

  it('correctly identifies what it could not determine', () => {
    expect(card.missingStateDetection).toBeGreaterThanOrEqual(0.9);
  });

  it('classifies success correctly where criteria exist', () => {
    expect(card.evaluationAccuracy).toBeGreaterThanOrEqual(0.9);
  });
});

/**
 * The judge is the untrusted component. These runs measure what happens
 * when it misbehaves in the three ways that actually matter — not random
 * noise, but plausible-sounding wrongness.
 */
describe('OutcomeDetection self-evaluation — adversarial judges', () => {
  it('lets no fabricated citation into a record', () => {
    const results = forJudge(pass, 'fabricator');
    const card = score(results, true);
    printScorecard('adversarial: fabricated citations', card);

    // Grounding stays perfect because the ungrounded claims were DROPPED,
    // not because the judge behaved.
    expect(card.evidenceGrounding).toBe(1);
    for (const r of results) {
      expect(r.record.observation.observedOutcome).toBeUndefined();
      expect(r.record.evaluation.expectedVsObserved).toBeUndefined();
      expect(r.record.unknowns.some((u) => u.reason === 'ungrounded-claim')).toBe(true);
      expect(r.record.evaluation.confidence).toBe('low');
    }
    // …and it never talked the detector into a false success.
    expect(card.falseOutcomeRate).toBe(0);
  });

  it('is not talked into success by a credulous judge where criteria exist', () => {
    const results = forJudge(pass, 'credulous');
    const card = score(results, true);
    printScorecard('adversarial: credulous judge', card);

    expect(card.falseOutcomeRate).toBe(0);

    // Deterministic criteria overrode the judge on every run that had them,
    // and the disagreement is recorded rather than smoothed over.
    const withCriteria = results.filter((r) => r.record.evaluation.basis === 'criteria');
    expect(withCriteria.length).toBe(10);
    const disagreements = withCriteria.filter((r) => r.record.evaluation.judgeDisagreedWithCriteria);
    expect(disagreements.length).toBe(4); // the 2 empty-source + 2 missing-source runs
  });

  /**
   * The honest limit of v0.1, asserted so it cannot regress silently and
   * cannot be forgotten. Where NO deterministic criteria exist, the judge
   * IS the verdict — the `unobservable` guard downgrades yes→partial, but
   * that is still stronger than the truthful `undetermined`.
   */
  it('overclaims on judge-only runs, and the guard limits but does not prevent it', () => {
    const judgeOnly = forJudge(pass, 'credulous').filter((r) => r.scenario === 'unobservable');

    for (const r of judgeOnly) {
      // Not 'yes' — the declared blind spots forced it down…
      expect(r.record.evaluation.satisfied).toBe('partial');
      // …but ground truth is 'undetermined', so this IS an overclaim.
      expect(r.spec.groundTruth.satisfied).toBe('undetermined');
      expect(r.record.unknowns.some((u) => u.reason === 'not-observable-post-hoc')).toBe(true);
    }
  });
});
