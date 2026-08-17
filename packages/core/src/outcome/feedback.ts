/**
 * Cross-run outcome feedback.
 *
 * `LOOP_FEEDBACK` (agent-loop/runner.ts) already feeds criterion failures back
 * into the NEXT ITERATION of a single eval loop. This is the same idea across
 * RUNS: a scheduled agent that missed its outcome last night starts tonight's
 * run knowing what went wrong and what the evidence was.
 *
 * Two properties keep this from being "learning" in the sense ADR-0030 defers:
 *
 *  1. It is per-run *context*, not a modification. Nothing is written to the
 *     agent, its prompt, or its config — the string is an input to one run and
 *     then gone.
 *  2. It reads only the IMMEDIATELY PREVIOUS run. A miss from three weeks ago
 *     is not context, it's noise, and injecting it would quietly bias every
 *     future run of an agent that has since been fixed.
 *
 * Opt-in for free: an agent must declare `OUTCOME_FEEDBACK` in its `inputs:`
 * block or `mergedInputs` drops it (node-env.ts), so wiring this into callers
 * changes nothing for any agent that predates it.
 */

import type { OutcomeRecord } from './types.js';

/** The input name callers set and agents declare. */
export const OUTCOME_FEEDBACK_INPUT = 'OUTCOME_FEEDBACK';

/** Minimal surface of `OutcomeStore` this needs, so tests can pass a fake. */
export interface OutcomeFeedbackSource {
  list(query: { agentId?: string; limit?: number }): Array<{ record: OutcomeRecord }>;
}

/**
 * Format the previous run's unsatisfied outcome as feedback, or `undefined`
 * when there's nothing useful to say.
 *
 * Returns undefined when: the agent has no records, the most recent run
 * achieved its outcome, or the outcome was `undetermined` (we don't know that
 * anything went wrong, so telling the agent it did would be a fabrication).
 */
export function buildOutcomeFeedback(
  store: OutcomeFeedbackSource | undefined,
  agentId: string,
): string | undefined {
  if (!store) return undefined;
  let latest: OutcomeRecord | undefined;
  try {
    // Only the most recent record for this agent — see the recency note above.
    latest = store.list({ agentId, limit: 1 })[0]?.record;
  } catch {
    return undefined;
  }
  if (!latest) return undefined;

  const { satisfied } = latest.evaluation;
  if (satisfied !== 'no' && satisfied !== 'partial') return undefined;

  return formatOutcomeFeedback(latest);
}

/**
 * Render a record as feedback text. Mirrors `formatCriterionFailures`'
 * shape so the two feedback channels read the same way to an agent author.
 * Exported for tests and for callers that already hold a record.
 */
export function formatOutcomeFeedback(record: OutcomeRecord): string {
  const lines: string[] = [
    `Feedback from the previous run (${record.runId.slice(0, 8)}): it completed, but ${
      record.evaluation.satisfied === 'partial' ? 'only partly achieved' : 'did not achieve'
    } its declared outcome. Fix this before producing the same result again.`,
  ];

  if (record.intent.expected) {
    lines.push('', `Expected: ${record.intent.expected.trim()}`);
  }

  const failed = (record.evaluation.criteriaResults ?? []).filter((c) => !c.passed);
  if (failed.length > 0) {
    lines.push('', 'Checks that failed:');
    for (const c of failed) lines.push(`- ${c.description}: ${c.reason ?? 'failed'}`);
  }

  // Evidence, so the next run can see what was actually produced rather than
  // only being told it was wrong.
  const evidence = record.observation.evidence.slice(0, 3);
  if (evidence.length > 0) {
    lines.push('', 'What was actually observed:');
    for (const e of evidence) {
      const where = e.source.nodeId
        ? `${e.source.nodeId}${e.source.field ? `.${e.source.field}` : ''}`
        : e.source.path ?? 'run';
      const oneLine = e.value.replace(/\s+/g, ' ').trim().slice(0, 300);
      lines.push(`- ${where}${e.kind === 'absent' ? ' (NOT FOUND)' : ''}: ${oneLine}`);
    }
  }

  return lines.join('\n');
}

/**
 * Merge outcome feedback into a run's inputs. No-op when there's nothing to
 * report, so callers can apply it unconditionally.
 */
export function withOutcomeFeedback(
  inputs: Record<string, string> | undefined,
  store: OutcomeFeedbackSource | undefined,
  agentId: string,
): Record<string, string> | undefined {
  const feedback = buildOutcomeFeedback(store, agentId);
  if (!feedback) return inputs;
  return { ...(inputs ?? {}), [OUTCOME_FEEDBACK_INPUT]: feedback };
}
