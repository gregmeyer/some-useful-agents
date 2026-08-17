/**
 * The optional inference step.
 *
 * The judge exists to answer "what happened, in words" for the cases a
 * regex can't reach. It is deliberately constrained so it cannot become
 * "ask an LLM whether it worked":
 *
 *  - It sees ONLY the evidence bundle and the declared intent. Never the
 *    run, never the agent definition, never the raw node records. It
 *    cannot cite what it was not shown.
 *  - Every claim must carry `citedEvidenceIds`. `detect.ts` validates
 *    those against the bundle afterwards and drops any claim that fails.
 *  - It never decides `satisfied` when deterministic criteria exist —
 *    `detect.ts` overrides it and records the disagreement.
 *
 * `JudgeFn` is the seam. `llmJudge()` is one implementation over the
 * repo's existing one-off `invokeLlm` helper; tests pass their own
 * function and never spawn a process.
 */

import { z } from 'zod';
import { extractTaggedJson } from '../build-plan-schema.js';
import { invokeLlm } from '../llm-invoker.js';
import type { LlmProvider } from '../llm-providers.js';
import type { CriterionResult } from '../agent-loop/eval-criteria.js';
import type { EvidenceItem, JudgeFn, JudgeVerdict } from './types.js';

const groundedClaimSchema = z.object({
  text: z.string(),
  // Lenient on shape, strict on truth: we accept whatever ids the model
  // emits here and let `detect.ts` reject the ones that don't resolve.
  citedEvidenceIds: z.array(z.string()).default([]),
});

export const judgeVerdictSchema = z.object({
  observedOutcome: groundedClaimSchema,
  expectedVsObserved: groundedClaimSchema,
  satisfied: z.enum(['yes', 'no', 'partial', 'undetermined']),
  unknowns: z.array(z.object({
    field: z.string(),
    reason: z.enum([
      'not-captured',
      'not-observable-post-hoc',
      'no-criteria',
      'evidence-missing',
      'not-inferred',
      'ungrounded-claim',
    ]),
    detail: z.string().optional(),
  })).optional(),
  followUp: z.array(z.string()).optional(),
});

/**
 * Render the evidence bundle as the judge's entire view of reality.
 * Exported so tests can assert what the model is (and is not) shown.
 */
export function buildJudgePrompt(input: {
  expected?: string;
  assumptions: string[];
  unobservable: string[];
  evidence: EvidenceItem[];
  criteriaResults?: CriterionResult[];
}): string {
  const lines: string[] = [];

  lines.push(
    'You are evaluating what resulted from one automated agent run.',
    '',
    'You are shown a numbered EVIDENCE bundle. That bundle is the ONLY thing',
    'you know about the run. Do not speculate beyond it, and do not assume',
    'anything not present in it happened.',
    '',
  );

  lines.push('## Expected outcome');
  lines.push(input.expected?.trim() || '(none declared)');
  lines.push('');

  if (input.assumptions.length > 0) {
    lines.push('## Assumptions the author declared (unverified)');
    for (const a of input.assumptions) lines.push(`- ${a}`);
    lines.push('');
  }

  if (input.unobservable.length > 0) {
    lines.push('## Known blind spots (the system cannot observe these at all)');
    for (const u of input.unobservable) lines.push(`- ${u}`);
    lines.push('');
  }

  lines.push('## Evidence');
  if (input.evidence.length === 0) {
    lines.push('(no evidence was collected for this run)');
  }
  for (const item of input.evidence) {
    const where = [
      item.source.nodeId ? `node=${item.source.nodeId}` : null,
      item.source.field ? `field=${item.source.field}` : null,
      item.source.path ? `path=${item.source.path}` : null,
    ].filter(Boolean).join(' ');
    const header = `[${item.id}] kind=${item.kind}${where ? ` ${where}` : ''}${item.label ? ` label="${item.label}"` : ''}`;
    lines.push(header);
    lines.push(item.kind === 'absent' ? `  NOT FOUND: ${item.value}` : indent(item.value));
    lines.push('');
  }

  if (input.criteriaResults && input.criteriaResults.length > 0) {
    lines.push('## Deterministic criteria already evaluated (authoritative — do not contradict lightly)');
    for (const r of input.criteriaResults) {
      lines.push(`- ${r.description}: ${r.passed ? 'PASSED' : `FAILED (${r.reason ?? 'no reason given'})`}`);
    }
    lines.push('');
  }

  lines.push(
    '## Your task',
    '',
    'Reply with ONLY a single `<outcome>` block containing JSON:',
    '',
    '<outcome>',
    '{',
    '  "observedOutcome":    { "text": "what actually resulted", "citedEvidenceIds": ["ev1"] },',
    '  "expectedVsObserved": { "text": "how that compares to what was expected", "citedEvidenceIds": ["ev1"] },',
    '  "satisfied": "yes" | "no" | "partial" | "undetermined",',
    '  "unknowns": [{ "field": "…", "reason": "not-captured", "detail": "…" }],',
    '  "followUp": ["optional suggestions"]',
    '}',
    '</outcome>',
    '',
    'Rules:',
    '- Every claim MUST cite at least one evidence id, and every id you cite',
    '  MUST appear in the bundle above. Claims citing ids that do not exist are',
    '  discarded automatically, so inventing one loses you the whole claim.',
    '- If the evidence does not let you tell whether the expected outcome was',
    '  reached, answer "undetermined" and say what is missing in `unknowns`.',
    '  "undetermined" is a correct answer. Guessing is not.',
    '- An agent finishing without error is NOT the same as the outcome being',
    '  achieved. Only cite evidence of the result itself.',
    '- Valid `reason` values: not-captured, not-observable-post-hoc, no-criteria,',
    '  evidence-missing, not-inferred.',
  );

  return lines.join('\n');
}

function indent(text: string): string {
  return text.split('\n').map((l) => `  ${l}`).join('\n');
}

/** Parse a raw judge response. Returns null on anything unusable. */
export function parseJudgeResponse(raw: string): JudgeVerdict | null {
  const json = extractTaggedJson(raw, 'outcome');
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const result = judgeVerdictSchema.safeParse(parsed);
  return result.success ? (result.data as JudgeVerdict) : null;
}

export interface LlmJudgeOptions {
  provider: LlmProvider;
  timeoutMs?: number;
  /** Injectable transport. Defaults to the repo's `invokeLlm`. */
  invoke?: typeof invokeLlm;
}

/**
 * A `JudgeFn` backed by a local LLM CLI. Off by default everywhere —
 * callers opt in explicitly, because inference costs tokens and adds
 * latency to whatever is awaiting the run (notably the Temporal
 * activity's start-to-close budget).
 */
export function llmJudge(options: LlmJudgeOptions): JudgeFn {
  const invoke = options.invoke ?? invokeLlm;
  return async (input) => {
    const prompt = buildJudgePrompt(input);
    const result = await invoke({
      prompt,
      provider: options.provider,
      timeoutMs: options.timeoutMs ?? 60_000,
    });
    if (result.exitCode !== 0) return null;
    return parseJudgeResponse(result.output);
  };
}
