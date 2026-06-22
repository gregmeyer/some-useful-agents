/**
 * selectTriageCatalog — picks the agents triage sees by blending relevance to
 * the operator's request + recency-of-use + newest-created, so a named/used
 * agent isn't truncated out by a creation-order cut.
 */
import { describe, it, expect } from 'vitest';
import type { Agent } from '@some-useful-agents/core';
import { selectTriageCatalog } from './inbox-catalog.js';

/** Minimal Agent for selection tests (only id/name/description/tags/createdAt are read). */
function mk(id: string, createdAt: string, extra: Partial<Agent> = {}): Agent {
  return { id, name: id, status: 'active', source: 'local', mcp: false, nodes: [], createdAt, ...extra } as Agent;
}

const ids = (out: Agent[]): string[] => out.map((a) => a.id);

describe('selectTriageCatalog', () => {
  it('includes a named-but-old agent when the request mentions it', () => {
    const agents = [
      mk('weather-dashboard', '2026-01-01T00:00:00Z'), // old, never used
      ...Array.from({ length: 50 }, (_, i) => mk(`agent-${i}`, `2026-06-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`)),
    ];
    const out = selectTriageCatalog(agents, new Map(), 'show me the weather-dashboard output', 40);
    expect(ids(out)).toContain('weather-dashboard');
    expect(ids(out)[0]).toBe('weather-dashboard'); // relevance is front-loaded
  });

  it('ranks a recently-used agent above an old unused one', () => {
    const agents = [
      mk('old-unused', '2026-01-01T00:00:00Z'),
      mk('used-recently', '2026-01-02T00:00:00Z'),
    ];
    const used = new Map([['used-recently', '2026-06-20T00:00:00Z']]);
    const out = selectTriageCatalog(agents, used, 'unrelated request', 40);
    expect(ids(out).indexOf('used-recently')).toBeLessThan(ids(out).indexOf('old-unused'));
  });

  it('keeps a brand-new never-run agent (created reserve) even when budget is tight', () => {
    // 10 heavily-used agents + 1 brand-new never-run; max 6 → reserve guarantees the new one.
    const used = new Map<string, string>();
    const agents = Array.from({ length: 10 }, (_, i) => {
      const id = `used-${i}`;
      used.set(id, `2026-05-${String(i + 1).padStart(2, '0')}T00:00:00Z`);
      return mk(id, '2026-01-01T00:00:00Z');
    });
    agents.push(mk('brand-new', '2026-06-30T00:00:00Z')); // newest createdAt, never run
    const out = selectTriageCatalog(agents, used, 'no match', 6);
    expect(out).toHaveLength(6);
    expect(ids(out)).toContain('brand-new');
  });

  it('caps the total at max and dedupes', () => {
    const agents = Array.from({ length: 100 }, (_, i) => mk(`a-${i}`, `2026-06-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`));
    const out = selectTriageCatalog(agents, new Map(), '', 40);
    expect(out).toHaveLength(40);
    expect(new Set(ids(out)).size).toBe(40);
  });

  it('returns all agents when there are fewer than max', () => {
    const agents = [mk('a', '2026-01-01T00:00:00Z'), mk('b', '2026-02-01T00:00:00Z'), mk('c', '2026-03-01T00:00:00Z')];
    const out = selectTriageCatalog(agents, new Map(), '', 40);
    expect(ids(out).sort()).toEqual(['a', 'b', 'c']);
  });

  it('ignores stopwords / short tokens so a vague ask does not match everything', () => {
    const agents = [mk('weather-bot', '2026-01-01T00:00:00Z'), mk('pr-reviewer', '2026-01-02T00:00:00Z')];
    // "show me the output" is all stopwords/short → no relevance signal → pure recency order.
    const out = selectTriageCatalog(agents, new Map(), 'show me the output', 40);
    expect(ids(out).sort()).toEqual(['pr-reviewer', 'weather-bot']); // both present, none "matched"
  });
});
