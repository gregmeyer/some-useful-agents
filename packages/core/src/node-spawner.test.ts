import { describe, it, expect } from 'vitest';
import { buildProviderChain, classifyLlmFailure, type SpawnResult } from './node-spawner.js';

function r(partial: Partial<SpawnResult>): SpawnResult {
  return {
    result: '',
    exitCode: 1,
    error: '',
    ...partial,
  };
}

describe('classifyLlmFailure', () => {
  it('returns other for a zero-exit (successful) result', () => {
    expect(classifyLlmFailure(r({ exitCode: 0 }))).toBe('other');
  });

  it('detects credit exhausted via stderr', () => {
    expect(classifyLlmFailure(r({ error: 'Your credit balance is too low.' })))
      .toBe('credit_exhausted');
    expect(classifyLlmFailure(r({ error: 'insufficient credit' })))
      .toBe('credit_exhausted');
  });

  it('detects quota exceeded', () => {
    expect(classifyLlmFailure(r({ error: 'Quota exceeded for this period.' })))
      .toBe('quota_exceeded');
    expect(classifyLlmFailure(r({ result: 'API usage limit reached' })))
      .toBe('quota_exceeded');
  });

  it('detects rate limited (transient — should NOT fall back)', () => {
    expect(classifyLlmFailure(r({ error: 'rate limit hit; retry after 30s' })))
      .toBe('rate_limited');
    expect(classifyLlmFailure(r({ result: 'HTTP 429 too many requests' })))
      .toBe('rate_limited');
  });

  it('detects auth required', () => {
    expect(classifyLlmFailure(r({ error: 'not authenticated; please log in' })))
      .toBe('auth_required');
    expect(classifyLlmFailure(r({ error: '401 Unauthorized' })))
      .toBe('auth_required');
  });

  it('detects binary missing (category set OR string match)', () => {
    expect(classifyLlmFailure(r({ category: 'spawn_failure', error: 'spawn ENOENT' })))
      .toBe('binary_missing');
    expect(classifyLlmFailure(r({ error: 'codex: command not found' })))
      .toBe('binary_missing');
  });

  it('detects timeout', () => {
    expect(classifyLlmFailure(r({ category: 'timeout', error: 'Timed out after 60s' })))
      .toBe('timeout');
  });

  it('falls through to other for unrecognized failures', () => {
    expect(classifyLlmFailure(r({ error: 'mysterious crash deep in the CLI' })))
      .toBe('other');
  });

  it('checks both error AND result fields (CLI errors land in either)', () => {
    expect(classifyLlmFailure(r({ result: 'Your credit balance is too low to continue.' })))
      .toBe('credit_exhausted');
  });
});

describe('buildProviderChain (waterfall)', () => {
  it('returns the configured order when no pin is set', () => {
    expect(buildProviderChain(undefined, ['claude', 'codex'])).toEqual(['claude', 'codex']);
  });

  it('puts a pinned provider at the head and keeps the rest of the chain as fallbacks', () => {
    // The bug fix: pinning claude no longer disables fallback. The pin
    // just chooses the FIRST attempt; codex still runs on classified
    // failures.
    expect(buildProviderChain('claude', ['codex', 'claude'])).toEqual(['claude', 'codex']);
  });

  it('dedupes when the pinned provider is also in the configured order', () => {
    expect(buildProviderChain('codex', ['claude', 'codex'])).toEqual(['codex', 'claude']);
  });

  it('falls back to the hardcoded claude default when nothing is configured', () => {
    expect(buildProviderChain(undefined, undefined)).toEqual(['claude']);
    expect(buildProviderChain(undefined, [])).toEqual(['claude']);
  });

  it('respects a pin even when no global chain is configured', () => {
    expect(buildProviderChain('codex', undefined)).toEqual(['codex']);
    expect(buildProviderChain('codex', [])).toEqual(['codex']);
  });

  it('supports a 3-provider chain — pin still goes first, rest follows in order', () => {
    expect(buildProviderChain('codex', ['claude', 'gemini', 'codex'])).toEqual(['codex', 'claude', 'gemini']);
  });
});

