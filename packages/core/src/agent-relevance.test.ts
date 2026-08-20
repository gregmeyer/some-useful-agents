import { describe, it, expect } from 'vitest';
import { catalogTokens, catalogRelevance, rankAgentsByRelevance } from './agent-relevance.js';
import type { Agent } from './agent-v2-types.js';

/**
 * The scoring contract, pinned directly.
 *
 * This scorer is shared between inbox triage (whose STRONG_CANDIDATE thresholds
 * are calibrated against these exact numbers) and the /agents search box. The
 * triage tests cover it end-to-end through `selectTriageCatalog`; these cover
 * the arithmetic itself, so a future "improvement" to the weights fails here
 * loudly rather than quietly re-tuning routing.
 */
const mk = (over: Partial<Agent>): Agent => ({
  id: 'a', name: 'A', status: 'active', source: 'local', mcp: false, version: 1, nodes: [],
  ...over,
} as Agent);

describe('catalogTokens', () => {
  it('lowercases, splits on non-alphanumerics, and dedupes', () => {
    expect(catalogTokens('Weather, weather; FORECAST')).toEqual(['weather', 'forecast']);
  });

  it('drops tokens shorter than 3 chars', () => {
    // This is why `q=pr` and `q=ci` rank nothing — worth knowing, not a bug.
    expect(catalogTokens('pr ci ok fix')).toEqual(['fix']);
  });

  it('drops stopwords but keeps topic words', () => {
    expect(catalogTokens('show me the weather dashboard')).toEqual(['weather', 'dashboard']);
  });

  it('returns nothing for an all-stopword query', () => {
    expect(catalogTokens('what can you show me')).toEqual([]);
  });
});

describe('catalogRelevance', () => {
  it('scores a strong-field hit at 3', () => {
    expect(catalogRelevance(mk({ id: 'weather-forecast' }), ['weather'])).toBe(3);
  });

  it('scores a description-only hit at 1', () => {
    expect(catalogRelevance(mk({ description: 'reads the weather' }), ['weather'])).toBe(1);
  });

  it('does NOT stack strong and weak for the same token', () => {
    // The implementation is `if (strong) … else if (weak) …`. A token present in
    // both fields is worth 3, not 4.
    const agent = mk({ id: 'weather-forecast', description: 'the weather today' });
    expect(catalogRelevance(agent, ['weather'])).toBe(3);
  });

  it('sums across distinct tokens', () => {
    const agent = mk({ id: 'weather-forecast', description: 'hourly rainfall' });
    expect(catalogRelevance(agent, ['weather', 'rainfall'])).toBe(4); // 3 + 1
  });

  it('scores every strong field: name, tags, entryConditions, sampleQuestions', () => {
    expect(catalogRelevance(mk({ name: 'Rainfall' }), ['rainfall'])).toBe(3);
    expect(catalogRelevance(mk({ tags: ['rainfall'] }), ['rainfall'])).toBe(3);
    expect(catalogRelevance(mk({ entryConditions: ['user asks about rainfall'] }), ['rainfall'])).toBe(3);
    expect(catalogRelevance(mk({ sampleQuestions: ['will it rainfall today?'] }), ['rainfall'])).toBe(3);
  });

  it('never scores nonEntryConditions', () => {
    // Deliberate: it's a negative signal for the triage LLM, not the ranker. If
    // it scored, a "not for X" phrase would BOOST an agent for X.
    expect(catalogRelevance(mk({ nonEntryConditions: ['historical rainfall data'] }), ['rainfall'])).toBe(0);
  });

  it('matches on substrings, not word boundaries', () => {
    // "track" hitting spotify-playlist-builder (music tracks) is the known cost
    // of this. Pinned so a future word-boundary "fix" is a deliberate decision.
    expect(catalogRelevance(mk({ id: 'spotify-playlist-builder', description: 'picks tracks' }), ['track'])).toBe(1);
  });

  it('scores 0 with no tokens', () => {
    expect(catalogRelevance(mk({ id: 'weather' }), [])).toBe(0);
  });
});

describe('rankAgentsByRelevance', () => {
  const agents = [
    mk({ id: 'unrelated', name: 'Unrelated' }),
    mk({ id: 'weather-stub', name: 'Weather Stub', description: 'stub' }),
    mk({ id: 'forecast', name: 'Forecast', entryConditions: ['user wants the weather forecast'] }),
  ];

  it('orders best match first and keeps zero-score entries', () => {
    const ranked = rankAgentsByRelevance(agents, 'weather forecast');
    expect(ranked[0].agent.id).toBe('forecast');   // 3 (entry) + 3 (id/name) = 6
    expect(ranked.map((r) => r.agent.id)).toContain('unrelated');
    expect(ranked.find((r) => r.agent.id === 'unrelated')!.score).toBe(0);
  });

  it('breaks ties on id so ordering is stable', () => {
    const tied = [mk({ id: 'b-weather' }), mk({ id: 'a-weather' })];
    expect(rankAgentsByRelevance(tied, 'weather').map((r) => r.agent.id)).toEqual(['a-weather', 'b-weather']);
  });

  it('leaves every score at 0 for an unrankable query', () => {
    expect(rankAgentsByRelevance(agents, 'what can you show me').every((r) => r.score === 0)).toBe(true);
  });
});
