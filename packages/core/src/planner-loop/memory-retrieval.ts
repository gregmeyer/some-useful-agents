/**
 * Goal-similarity retrieval over `PlannerMemoryStore`. Used by the
 * planner's `understand` phase to surface prior successful plans before
 * composing a new one.
 *
 * MVP scoring = bag-of-words Jaccard on tokenised goals, with intent
 * equality as a hard filter when supplied. Cheap, deterministic, no
 * external deps. Embeddings replace this when N grows enough that
 * token overlap stops resolving "weather agent" vs "weather alerts".
 */

import type { PlannerMemoryStore, PlannerMemoryRow } from './memory-store.js';
import { tokeniseGoal } from './memory-store.js';

export interface PriorPlanCandidate {
  row: PlannerMemoryRow;
  /** Jaccard similarity score in [0, 1]. */
  score: number;
}

/** Hard floor: candidates below this similarity are dropped. Tuned for noise rejection on short goals. */
const MIN_SIMILARITY = 0.15;

/**
 * Find up to `k` prior committed plans similar to `goal`. When `intent`
 * is supplied, only plans with the same intent are considered (sharpest
 * signal). When omitted (first-attempt retrieval before the planner has
 * classified intent), all intents compete via Jaccard alone.
 *
 * Ranking: similarity DESC, then attempts ASC (prefer plans that took
 * fewer planner tries — that's our cheap "quality" signal).
 */
export function findSimilarCommittedPlans(
  store: PlannerMemoryStore,
  args: { goal: string; intent?: string; k?: number },
): PriorPlanCandidate[] {
  const k = args.k ?? 3;
  const queryTokens = new Set(tokeniseGoal(args.goal));
  if (queryTokens.size === 0) return [];

  // Pull a wider candidate set than we'll keep so Jaccard ranking has room to discriminate.
  const candidates = args.intent ? store.listByIntent(args.intent, 50) : store.listAll(50);

  const scored: PriorPlanCandidate[] = [];
  for (const row of candidates) {
    const rowTokens = new Set(row.goalTokens.split(/\s+/).filter((t) => t.length > 0));
    const score = jaccard(queryTokens, rowTokens);
    if (score >= MIN_SIMILARITY) scored.push({ row, score });
  }

  scored.sort((a, b) => (b.score - a.score) || (a.row.attempts - b.row.attempts));
  return scored.slice(0, k);
}

/** Set Jaccard: |A ∩ B| / |A ∪ B|. Returns 0 when both sets are empty. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Format a list of prior-plan candidates as a `<priorPlans>` block the
 * planner can read on its next call. Each entry shows the original goal +
 * a compact summary of the plan (intent, newAgent ids, dashboard id).
 * Full plan JSON is NOT inlined — too much context for marginal value.
 */
export function formatPriorPlansBlock(candidates: PriorPlanCandidate[]): string {
  if (candidates.length === 0) return '';
  const lines: string[] = [];
  lines.push('<priorPlans>');
  lines.push('# Successful plans previously committed for similar goals. Prefer reusing patterns from these when the intent matches.');
  for (const c of candidates) {
    const p = c.row.plan;
    const newAgentSummary = p.newAgents.length === 0
      ? 'no new agents'
      : `new agents: ${p.newAgents.map((a) => a.id).join(', ')}`;
    const dashSummary = p.dashboard ? ` | dashboard: ${p.dashboard.id}` : '';
    lines.push(`- score=${c.score.toFixed(2)} attempts=${c.row.attempts} intent=${p.intent} | goal: ${c.row.goal.slice(0, 200)}`);
    lines.push(`  ${newAgentSummary}${dashSummary}`);
  }
  lines.push('</priorPlans>');
  return lines.join('\n');
}
