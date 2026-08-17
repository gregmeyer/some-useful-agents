/**
 * `detectOutcome` — turn one finished run into an evidence-backed
 * `OutcomeRecord`.
 *
 * Order of operations, and why:
 *
 *   1. collect evidence      deterministic, redacted, provenance-tagged
 *   2. evaluate criteria     deterministic, REUSES agent-loop/eval-criteria
 *   3. judge (optional)      inferred prose, sees ONLY the evidence bundle
 *   4. validate citations    every cited id must exist, or the claim dies
 *   5. assemble unknowns     everything we could not determine, typed
 *
 * Deterministic criteria always beat the judge on the `satisfied` verdict.
 * When both ran and disagreed, the record says so
 * (`evaluation.judgeDisagreedWithCriteria`) — that flag is how we measure
 * whether the judge can be trusted in the cases where no criteria exist.
 */

import type { Agent, NodeExecutionRecord } from '../agent-v2-types.js';
import type { Run } from '../types.js';
import { evaluateCriteria, type CriterionResult } from '../agent-loop/eval-criteria.js';
import { collectEvidence } from './evidence.js';
import {
  OUTCOME_RECORD_VERSION,
  type EvidenceItem,
  type GroundedClaim,
  type JudgeFn,
  type JudgeVerdict,
  type OutcomeConfidence,
  type OutcomeExpectation,
  type OutcomeRecord,
  type OutcomeVerdict,
  type UnknownItem,
} from './types.js';

export interface DetectOutcomeInput {
  agent: Agent;
  run: Run;
  /**
   * The run's per-node records. Required, and NOT derivable from `run` —
   * node-level truth lives in a separate table. Callers get these from
   * `runStore.listNodeExecutions(run.id)`.
   */
  nodeExecutions: NodeExecutionRecord[];
  /**
   * Overrides `agent.outcome`. Lets a caller detect against an expectation
   * the agent author never declared (ad-hoc analysis, tests, back-fills).
   */
  expectation?: OutcomeExpectation;
  /** Inputs the run was given. Used for `{{inputs.X}}` expansion. */
  inputs?: Record<string, string>;
  /** Agent state dir, for `{{state}}` expansion in file selectors. */
  stateDir?: string;
  /** Optional inference step. Omit → a fully deterministic record. */
  judge?: JudgeFn;
  signal?: AbortSignal;
  /** Injectable clock so records are reproducible in tests. */
  now?: () => Date;
}

export async function detectOutcome(input: DetectOutcomeInput): Promise<OutcomeRecord> {
  const now = input.now ?? (() => new Date());
  const expectation = input.expectation ?? input.agent.outcome ?? {};
  const unknowns: UnknownItem[] = [];

  const assumptions = expectation.assumptions ?? [];
  const unobservable = expectation.unobservable ?? [];
  const selectors = expectation.evidence ?? [];
  const criteria = expectation.success ?? [];

  // ── 1. Observed ───────────────────────────────────────────────────────
  const evidence = collectEvidence({
    selectors,
    run: input.run,
    nodeExecutions: input.nodeExecutions,
    inputs: input.inputs,
    stateDir: input.stateDir,
    now,
  });

  if (selectors.length === 0) {
    unknowns.push({
      field: 'observation.evidence',
      reason: 'not-captured',
      detail: 'No evidence selectors were declared, so nothing about this run was observed for outcome purposes.',
    });
  }
  for (const item of evidence) {
    if (item.kind === 'absent') {
      unknowns.push({
        field: `observation.evidence.${item.id}`,
        reason: 'evidence-missing',
        detail: item.value,
      });
    }
  }

  // Author-declared blind spots. A detector cannot infer these from a prose
  // expectation — someone has to name them — and naming them is what keeps
  // the record honest instead of quietly confident.
  for (const item of unobservable) {
    unknowns.push({
      field: 'observation.observedOutcome',
      reason: 'not-observable-post-hoc',
      detail: item,
    });
  }

  // ── 2. Evaluated (deterministic) ──────────────────────────────────────
  let criteriaResults: CriterionResult[] | undefined;
  let criteriaVerdict: OutcomeVerdict | undefined;
  if (criteria.length > 0) {
    const result = evaluateCriteria({
      criteria,
      run: input.run,
      nodeExecutions: input.nodeExecutions,
      inputs: input.inputs,
    });
    criteriaResults = result.results;
    if (result.passed) {
      criteriaVerdict = 'yes';
    } else {
      criteriaVerdict = result.results.some((r) => r.passed) ? 'partial' : 'no';
    }
  } else {
    unknowns.push({
      field: 'evaluation.satisfied',
      reason: 'no-criteria',
      detail: 'No machine-checkable success criteria were declared for this outcome.',
    });
  }

  // ── 3. Inferred (optional) ────────────────────────────────────────────
  let verdict: JudgeVerdict | null = null;
  if (input.judge) {
    verdict = await input.judge({
      expected: expectation.expected,
      assumptions,
      unobservable,
      evidence,
      criteriaResults,
      signal: input.signal,
    });
    if (verdict === null) {
      unknowns.push({
        field: 'observation.observedOutcome',
        reason: 'not-inferred',
        detail: 'A judge was supplied but did not return a usable verdict.',
      });
    }
  } else {
    unknowns.push({
      field: 'observation.observedOutcome',
      reason: 'not-inferred',
      detail: 'No judge was supplied; nothing was inferred beyond the deterministic evidence.',
    });
  }

  // ── 4. Citation validation ────────────────────────────────────────────
  // This is the anti-fabrication mechanism. A claim citing evidence that
  // does not exist in the bundle is DROPPED, not softened. Grounding is a
  // property we enforce mechanically, not one we ask the model for.
  let observedOutcome: GroundedClaim | undefined;
  let expectedVsObserved: GroundedClaim | undefined;
  let anyClaimDropped = false;

  if (verdict) {
    const observedCheck = validateClaim(verdict.observedOutcome, evidence);
    if (observedCheck.ok) {
      observedOutcome = observedCheck.claim;
    } else {
      anyClaimDropped = true;
      unknowns.push({
        field: 'observation.observedOutcome',
        reason: 'ungrounded-claim',
        detail: observedCheck.detail,
      });
    }

    const comparisonCheck = validateClaim(verdict.expectedVsObserved, evidence);
    if (comparisonCheck.ok) {
      expectedVsObserved = comparisonCheck.claim;
    } else {
      anyClaimDropped = true;
      unknowns.push({
        field: 'evaluation.expectedVsObserved',
        reason: 'ungrounded-claim',
        detail: comparisonCheck.detail,
      });
    }

    for (const u of verdict.unknowns ?? []) unknowns.push(u);
  }

  // ── 5. Verdict + confidence ───────────────────────────────────────────
  const judgeVerdict = verdict?.satisfied;
  let satisfied: OutcomeVerdict;
  let basis: OutcomeRecord['evaluation']['basis'];
  let judgeDisagreedWithCriteria: boolean | undefined;

  if (criteriaVerdict !== undefined) {
    // Deterministic wins. Always.
    satisfied = criteriaVerdict;
    basis = 'criteria';
    if (judgeVerdict !== undefined) {
      judgeDisagreedWithCriteria = judgeVerdict !== criteriaVerdict;
    }
  } else if (judgeVerdict !== undefined) {
    satisfied = judgeVerdict;
    basis = 'judged';
  } else {
    satisfied = 'undetermined';
    basis = 'undetermined';
  }

  // An author-declared blind spot means we cannot honestly claim full
  // success: something the expectation depends on was never observable.
  if (satisfied === 'yes' && unobservable.length > 0) {
    satisfied = 'partial';
  }

  const confidence = computeConfidence({ basis, anyClaimDropped, satisfied });

  return {
    version: OUTCOME_RECORD_VERSION,
    runId: input.run.id,
    agentId: input.agent.id,
    agentVersion: input.agent.version,
    detectedAt: now().toISOString(),

    intent: {
      ...(expectation.expected !== undefined && { expected: expectation.expected }),
      assumptions,
      ...(criteria.length > 0 && { success: criteria }),
      unobservable,
    },

    execution: {
      actor: {
        agentId: input.agent.id,
        agentVersion: input.agent.version,
        triggeredBy: input.run.triggeredBy,
      },
      runStatus: input.run.status,
      startedAt: input.run.startedAt,
      ...(input.run.completedAt !== undefined && { completedAt: input.run.completedAt }),
      nodes: input.nodeExecutions.map((e) => ({
        nodeId: e.nodeId,
        status: e.status,
        ...(e.exitCode !== undefined && { exitCode: e.exitCode }),
        ...(e.errorCategory !== undefined && { errorCategory: e.errorCategory }),
      })),
    },

    observation: {
      evidence,
      ...(observedOutcome && { observedOutcome }),
    },

    evaluation: {
      satisfied,
      basis,
      ...(criteriaResults && { criteriaResults }),
      ...(expectedVsObserved && { expectedVsObserved }),
      confidence,
      ...(judgeDisagreedWithCriteria !== undefined && { judgeDisagreedWithCriteria }),
    },

    unknowns,
    ...(verdict?.followUp?.length ? { followUp: verdict.followUp } : {}),
  };
}

/**
 * A claim survives only if every id it cites resolves to a real item in
 * the bundle, and it cites at least one. An uncited claim is prose with
 * no provenance — exactly the thing this capability exists to avoid.
 */
function validateClaim(
  claim: GroundedClaim | undefined,
  evidence: EvidenceItem[],
): { ok: true; claim: GroundedClaim } | { ok: false; detail: string } {
  if (!claim || !claim.text?.trim()) {
    return { ok: false, detail: 'The judge returned no text for this claim.' };
  }
  const known = new Set(evidence.map((e) => e.id));
  const cited = claim.citedEvidenceIds ?? [];
  if (cited.length === 0) {
    return {
      ok: false,
      detail: `Claim cited no evidence and was dropped: "${truncateForDetail(claim.text)}"`,
    };
  }
  const bogus = cited.filter((id) => !known.has(id));
  if (bogus.length > 0) {
    return {
      ok: false,
      detail: `Claim cited non-existent evidence [${bogus.join(', ')}] and was dropped: "${truncateForDetail(claim.text)}"`,
    };
  }
  return { ok: true, claim: { text: claim.text.trim(), citedEvidenceIds: cited } };
}

function truncateForDetail(text: string): string {
  return text.length <= 160 ? text : `${text.slice(0, 160)}…`;
}

/**
 * Confidence is rule-derived, never asked for. The rules:
 *   high    — the verdict came from deterministic criteria
 *   medium  — the verdict came from a judge whose every claim was grounded
 *   low     — a claim was dropped, or we could not determine anything
 */
function computeConfidence(args: {
  basis: OutcomeRecord['evaluation']['basis'];
  anyClaimDropped: boolean;
  satisfied: OutcomeVerdict;
}): OutcomeConfidence {
  if (args.satisfied === 'undetermined') return 'low';
  if (args.anyClaimDropped) return 'low';
  if (args.basis === 'criteria') return 'high';
  if (args.basis === 'judged') return 'medium';
  return 'low';
}
