/**
 * OutcomeDetection v0.1 — data model.
 *
 * An *outcome* in sua is a claim about what resulted from one `Run`,
 * evaluated against a declared expectation, where every claim carries a
 * pointer back to the evidence that supports it.
 *
 * It is deliberately NOT `run.status`. A run can exit 0 and not achieve
 * its outcome; a run can fail and still have produced a partial result
 * worth recording.
 *
 * Four information tiers are kept separate on purpose, because the whole
 * point of the capability is to know which is which:
 *
 *   declared   known before execution   intent.*, execution.actor
 *   observed   captured during the run  observation.evidence[]
 *   inferred   guessed after the fact   observation.observedOutcome,
 *                                       evaluation.expectedVsObserved
 *   evaluated  judged after the fact    evaluation.satisfied / confidence
 *
 * Nothing is ever fabricated to fill a gap. Anything we cannot determine
 * becomes an explicit `unknowns[]` entry with a typed reason.
 */

import type { AgentSuccessCriterion, NodeErrorCategory } from '../agent-v2-types.js';
import type { CriterionResult } from '../agent-loop/eval-criteria.js';
import type { Run, RunStatus } from '../types.js';

/** Current record schema version. Bumped when the shape changes incompatibly. */
export const OUTCOME_RECORD_VERSION = 1 as const;

// ── Declared: what the author told us before the run ────────────────────

/**
 * Author-declared pointer at something that should count as evidence.
 * Deliberately a closed set: every kind must be resolvable from data sua
 * already persists (or from a post-hoc filesystem probe). We do not invent
 * a capture channel in v0.1 — see docs/outcome-detection.md § Limits.
 */
export type EvidenceSelector =
  /** The node's stringified output (`node_executions.result`). */
  | { kind: 'nodeResult'; nodeId: string; label?: string }
  /** One field of the node's structured output (`node_executions.outputsJson`). */
  | { kind: 'nodeOutputField'; nodeId: string; field: string; label?: string }
  /** The node's terminal status + exit code + error category. */
  | { kind: 'nodeStatus'; nodeId: string; label?: string }
  /** The run's own terminal status + error. */
  | { kind: 'runStatus'; label?: string }
  /** A post-hoc filesystem probe. `{{inputs.X}}` and `{{state}}` expand. */
  | { kind: 'file'; pathTemplate: string; label?: string };

export type EvidenceSelectorKind = EvidenceSelector['kind'];

/**
 * The `outcome:` block on an agent, or the equivalent object passed
 * imperatively to `detectOutcome`.
 */
export interface OutcomeExpectation {
  /** Prose statement of the outcome the caller expects. Free text. */
  expected?: string;
  /** Things taken for granted. Recorded, never verified. */
  assumptions?: string[];
  /** What to collect. Empty/absent → the record carries no observed evidence. */
  evidence?: EvidenceSelector[];
  /**
   * Optional machine-checkable definition of done. Reuses the existing
   * `successCriteria` union so authors learn one grammar, and so the
   * deterministic evaluator (`evaluateCriteria`) is shared, not forked.
   */
  success?: AgentSuccessCriterion[];
  /**
   * Author-declared blind spots: parts of the expected outcome that sua
   * provably cannot observe (e.g. "whether a human read the digest").
   *
   * This exists because the honest answer to "which information can't be
   * reconstructed after execution?" is that a detector cannot infer its
   * own blind spots from a prose expectation — someone has to name them.
   * Each entry becomes an `unknowns[]` row with reason
   * `not-observable-post-hoc`, and forces `satisfied` away from `yes`.
   */
  unobservable?: string[];
}

// ── Observed: what actually got captured ────────────────────────────────

export type EvidenceKind =
  | 'node-result'
  | 'node-output-field'
  | 'node-status'
  | 'run-status'
  | 'file'
  /** A selector resolved to nothing. "We looked and it wasn't there" is evidence. */
  | 'absent';

/**
 * One piece of evidence. `source` is a resolvable provenance pointer, not
 * a description — a reader can go back to `node_executions` / the
 * filesystem and re-derive `value` themselves.
 */
export interface EvidenceItem {
  /** Stable within a record (`ev1`, `ev2`, …). This is what the judge cites. */
  id: string;
  kind: EvidenceKind;
  /** Human label from the selector, when the author supplied one. */
  label?: string;
  source: {
    runId: string;
    nodeId?: string;
    field?: string;
    path?: string;
    /** Which selector produced this item — kept so `absent` rows stay legible. */
    selector: EvidenceSelectorKind;
  };
  /** Redacted and truncated. Empty string for `absent` items. */
  value: string;
  truncated: boolean;
  capturedAt: string;
}

// ── Inferred / evaluated ────────────────────────────────────────────────

/** A prose claim that must point at the evidence backing it. */
export interface GroundedClaim {
  text: string;
  citedEvidenceIds: string[];
}

export type OutcomeVerdict = 'yes' | 'no' | 'partial' | 'undetermined';
export type OutcomeBasis = 'criteria' | 'judged' | 'undetermined';
export type OutcomeConfidence = 'high' | 'medium' | 'low';

export type UnknownReason =
  /** Nothing in the run recorded this. */
  | 'not-captured'
  /** Could only have been captured during execution; unrecoverable now. */
  | 'not-observable-post-hoc'
  /** No success definition was declared, so "did it work" has no answer. */
  | 'no-criteria'
  /** A declared selector resolved to nothing. */
  | 'evidence-missing'
  /** No judge was supplied, so nothing was inferred. */
  | 'not-inferred'
  /** A judge claim cited evidence that does not exist; the claim was dropped. */
  | 'ungrounded-claim';

export interface UnknownItem {
  /** Dotted path into the record that could not be filled. */
  field: string;
  reason: UnknownReason;
  detail?: string;
}

// ── The record ──────────────────────────────────────────────────────────

export interface OutcomeRecord {
  version: typeof OUTCOME_RECORD_VERSION;
  runId: string;
  agentId: string;
  agentVersion: number;
  detectedAt: string;

  /** declared */
  intent: {
    expected?: string;
    assumptions: string[];
    success?: AgentSuccessCriterion[];
    unobservable: string[];
  };

  /** observed */
  execution: {
    actor: {
      agentId: string;
      agentVersion: number;
      triggeredBy: Run['triggeredBy'];
    };
    runStatus: RunStatus;
    startedAt: string;
    completedAt?: string;
    nodes: Array<{
      nodeId: string;
      status: string;
      exitCode?: number | null;
      errorCategory?: NodeErrorCategory;
    }>;
  };

  observation: {
    /** observed */
    evidence: EvidenceItem[];
    /** inferred — absent unless a judge ran and its citations checked out */
    observedOutcome?: GroundedClaim;
  };

  /** evaluated */
  evaluation: {
    satisfied: OutcomeVerdict;
    basis: OutcomeBasis;
    /** Present iff `intent.success` was declared. Deterministic. */
    criteriaResults?: CriterionResult[];
    /** inferred */
    expectedVsObserved?: GroundedClaim;
    confidence: OutcomeConfidence;
    /**
     * True when deterministic criteria and the judge reached different
     * verdicts. Criteria always win; this flag is how we measure whether
     * the judge is trustworthy enough to be relied on where criteria
     * don't exist.
     */
    judgeDisagreedWithCriteria?: boolean;
  };

  unknowns: UnknownItem[];

  /**
   * Suggested next steps. INERT — nothing in sua reads this to modify an
   * agent, prompt, or config. Detecting an outcome and deciding how the
   * system should change are separate operations; see
   * docs/adr/0030-outcome-detection.md § Why learning is out of scope.
   */
  followUp?: string[];
}

/** What a judge returns, before citation validation. */
export interface JudgeVerdict {
  observedOutcome: GroundedClaim;
  expectedVsObserved: GroundedClaim;
  satisfied: OutcomeVerdict;
  unknowns?: UnknownItem[];
  followUp?: string[];
}

/**
 * Inference step. Receives ONLY the evidence bundle and the declared
 * intent — never the raw run — so it cannot cite anything it wasn't shown.
 * Returns `null` when it could not produce a verdict at all.
 */
export type JudgeFn = (input: {
  expected?: string;
  assumptions: string[];
  unobservable: string[];
  evidence: EvidenceItem[];
  criteriaResults?: CriterionResult[];
  signal?: AbortSignal;
}) => Promise<JudgeVerdict | null>;
