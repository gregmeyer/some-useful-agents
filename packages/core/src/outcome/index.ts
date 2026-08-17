/**
 * OutcomeDetection — turn agent execution into evidence-backed outcome
 * records. See docs/outcome-detection.md and
 * docs/adr/0030-outcome-detection.md.
 *
 * Named exports only. The core barrel uses `export *` for 35 modules, so
 * a bare `Evidence` or `Judge` here would be a collision waiting to happen.
 */

export {
  OUTCOME_RECORD_VERSION,
  type EvidenceItem,
  type EvidenceKind,
  type EvidenceSelector,
  type EvidenceSelectorKind,
  type GroundedClaim,
  type JudgeFn,
  type JudgeVerdict,
  type OutcomeBasis,
  type OutcomeConfidence,
  type OutcomeEvaluationRecord,
  type OutcomeHistory,
  type OutcomeHistoryChangeReason,
  type OutcomeHistoryEvaluation,
  type OutcomeHistoryEvidence,
  type OutcomeExpectation,
  type OutcomeRecord,
  type OutcomeVerdict,
  type UnknownItem,
  type UnknownReason,
} from './types.js';

export {
  collectEvidence,
  expandPath,
  MAX_EVIDENCE_ITEMS,
  MAX_EVIDENCE_VALUE_CHARS,
  type CollectEvidenceInput,
} from './evidence.js';

export { detectOutcome, evaluateOutcome, type DetectOutcomeInput, type EvaluateOutcomeInput } from './detect.js';

export {
  buildOutcomeFeedback,
  formatOutcomeFeedback,
  withOutcomeFeedback,
  OUTCOME_FEEDBACK_INPUT,
  type OutcomeFeedbackSource,
} from './feedback.js';

export {
  buildJudgePrompt,
  judgeVerdictSchema,
  llmJudge,
  parseJudgeResponse,
  type LlmJudgeOptions,
} from './judge.js';

export {
  OutcomeStore,
  type AttachOutcomeEvidenceInput,
  type ListOutcomesQuery,
  type OutcomeRow,
  type PersistedOutcomeEvidence,
  type RecordOutcomeOptions,
} from './outcome-store.js';

export {
  outcomeDetectionHook,
  type OutcomeDetectionHookOptions,
} from './hook.js';

export {
  evidenceSelectorSchema,
  outcomeExpectationSchema,
  outcomeSuccessCriterionSchema,
  type OutcomeExpectationParsed,
} from './schema.js';
