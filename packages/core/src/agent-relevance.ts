/**
 * Deterministic agent relevance scoring.
 *
 * Lifted verbatim out of the dashboard's inbox-catalog so more than one surface
 * can use it: inbox triage ranks the catalog it hands the LLM, and the /agents
 * search box ranks what it shows the operator. Both should agree about what
 * "matches" means — a newcomer who searches and a newcomer who asks should land
 * on the same agent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CAREFUL: this scorer is shared with triage's CALIBRATED thresholds
 * (`STRONG_CANDIDATE_MIN_SCORE` / `STRONG_CANDIDATE_MIN_MARGIN` in
 * routes/inbox-catalog.ts, retuned 6→9 after a live mis-route). Changing the
 * weights, the +3/+1 split, or the substring matching rule silently re-tunes
 * agent routing everywhere.
 *
 * If a caller wants different semantics — word boundaries, prefix matching,
 * BM25 — add a SECOND scorer. Do not tune this one.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { Agent } from './agent-v2-types.js';

/**
 * Generic filler words to ignore when matching the operator's request against
 * agent id/name/tags. Deliberately small — topic words like "weather",
 * "dashboard", "pr", "review" must still match.
 */
export const CATALOG_STOPWORDS: ReadonlySet<string> = new Set([
  'show', 'the', 'and', 'for', 'with', 'from', 'this', 'that', 'what', 'does',
  'are', 'you', 'can', 'get', 'see', 'pull', 'run', 'now', 'again', 'latest',
  'current', 'output', 'please', 'give', 'tell', 'about', 'into', 'out', 'any',
  'all', 'how', 'why', 'who', 'when', 'where', 'has', 'have', 'want', 'need',
]);

/** Meaningful tokens (≥3 chars, not stopwords) from free text. */
export function catalogTokens(text: string): string[] {
  return Array.from(new Set(
    text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !CATALOG_STOPWORDS.has(t)),
  ));
}

/** Relevance score of an agent to the request tokens: id/name/tags and the
 *  deliberate routing signals (entryConditions, sampleQuestions) weigh more than
 *  the prose description. `nonEntryConditions` is intentionally NOT scored — it's
 *  a negative signal handled by the triage LLM, not the deterministic ranker, so
 *  a matching non-entry phrase can't quietly drop an agent below the cap before
 *  the LLM ever sees it. 0 = no signal. */
export function catalogRelevance(agent: Agent, tokens: readonly string[]): number {
  if (tokens.length === 0) return 0;
  const strong = `${agent.id} ${agent.name} ${(agent.tags ?? []).join(' ')} ${(agent.entryConditions ?? []).join(' ')} ${(agent.sampleQuestions ?? []).join(' ')}`.toLowerCase();
  const weak = (agent.description ?? '').toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (strong.includes(t)) score += 3;
    else if (weak.includes(t)) score += 1;
  }
  return score;
}

/**
 * Score every agent against a free-text query, best first.
 *
 * Convenience over `catalogTokens` + `catalogRelevance` for callers that just
 * want an ordered list. Keeps zero-score entries — the caller decides whether a
 * miss means "hide it" or "show it last"; /agents search deliberately shows
 * them last rather than removing results a substring match would have found.
 *
 * Ties break on id so the order is stable across requests.
 */
export function rankAgentsByRelevance<T extends Agent>(
  agents: readonly T[],
  query: string,
): Array<{ agent: T; score: number }> {
  const tokens = catalogTokens(query);
  return agents
    .map((agent) => ({ agent, score: catalogRelevance(agent, tokens) }))
    .sort((a, b) => b.score - a.score || a.agent.id.localeCompare(b.agent.id));
}
