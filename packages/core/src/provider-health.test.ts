import { describe, it, expect } from 'vitest';
import { summarizeProviderHealth, providerHealthProblems, type ProviderHealthInput } from './provider-health.js';

const at = (d: number) => `2026-11-${String(10 + d).padStart(2, '0')}T12:00:00.000Z`;
const fail = (provider: string, category: string, error?: string) => ({ provider, category, ...(error ? { error } : {}) });

describe('summarizeProviderHealth', () => {
  const rows: ProviderHealthInput[] = [
    // codex answers, cheaply
    { usedProvider: 'codex', costUsd: 0, startedAt: at(1) },
    { usedProvider: 'codex', costUsd: 0, startedAt: at(2) },
    // codex out of quota and the local model unreachable: claude answers, and it costs
    { usedProvider: 'claude', costUsd: 0.5, startedAt: at(3), providerFailures: JSON.stringify([fail('codex', 'quota_exceeded'), fail('local', 'binary_missing')]) },
    { usedProvider: 'claude', costUsd: 0.25, startedAt: at(4), providerFailures: JSON.stringify([fail('codex', 'quota_exceeded'), fail('local', 'binary_missing')]) },
    // the local model passed over while it cools down: not a try
    { usedProvider: 'codex', costUsd: 0, startedAt: at(5), providerFailures: JSON.stringify([fail('local', 'binary_missing', 'Skipped: it failed (binary_missing) 1 min ago')]) },
  ];
  const h = summarizeProviderHealth(rows, at(0));

  it('counts who answered, who failed first and why, and who was only passed over', () => {
    const by = Object.fromEntries(h.providers.map((p) => [p.provider, p]));
    expect(by.codex).toMatchObject({ succeeded: 3, failed: 2, skipped: 0, reasons: [{ category: 'quota_exceeded', count: 2 }], lastSucceededAt: at(5), lastFailedAt: at(4) });
    expect(by.local).toMatchObject({ succeeded: 0, failed: 2, skipped: 1, reasons: [{ category: 'binary_missing', count: 2 }] });
    expect(by.claude).toMatchObject({ succeeded: 2, failed: 0, costUsd: 0.75 });
  });

  it('says how many nodes fell back and what they cost', () => {
    expect(h.fellBack).toBe(2);
    expect(h.fellBackCostUsd).toBeCloseTo(0.75);
  });

  it('skips unreadable failure JSON instead of throwing', () => {
    expect(summarizeProviderHealth([{ usedProvider: 'codex', providerFailures: '{not json', startedAt: at(1) }], at(0)).providers[0].succeeded).toBe(1);
  });
});

describe('providerHealthProblems', () => {
  it('flags a rung that never answered and one that mostly fails, and only rungs in the chain', () => {
    const rows: ProviderHealthInput[] = [
      ...Array.from({ length: 12 }, (_, i) => ({ usedProvider: 'claude', costUsd: 0.1, startedAt: at(1 + (i % 9)), providerFailures: JSON.stringify([fail('codex', 'quota_exceeded'), fail('local', 'binary_missing')]) })),
      ...Array.from({ length: 4 }, () => ({ usedProvider: 'codex', startedAt: at(2) })),
      ...Array.from({ length: 9 }, () => ({ usedProvider: 'claude', startedAt: at(3), providerFailures: JSON.stringify([fail('gone', 'binary_missing')]) })),
    ];
    const problems = providerHealthProblems(summarizeProviderHealth(rows, at(0)), ['codex', 'local', 'claude']);
    expect(problems.map((p) => [p.provider, p.kind])).toEqual([['codex', 'mostly-failing'], ['local', 'never-worked']]);
    expect(problems[0].message).toBe('codex failed 12 of 16 tries (mostly out of quota); those nodes went to the next provider.');
    expect(problems[1].message).toMatch(/^local failed all 12 tries \(mostly couldn't be reached or isn't installed\) and never answered/);
  });

  it('flags nothing for a healthy chain or too few tries', () => {
    const rows: ProviderHealthInput[] = [
      { usedProvider: 'codex', startedAt: at(1) },
      { usedProvider: 'claude', startedAt: at(1), providerFailures: JSON.stringify([fail('codex', 'timeout'), fail('local', 'binary_missing')]) },
    ];
    expect(providerHealthProblems(summarizeProviderHealth(rows, at(0)), ['codex', 'local', 'claude'])).toEqual([]);
  });
});
