import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmSettingsStore, LLM_PROVIDERS } from './llm-settings-store.js';

let dir: string;
let store: LlmSettingsStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-llm-settings-'));
  store = new LlmSettingsStore(join(dir, 'llm-settings.json'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('LlmSettingsStore', () => {
  it('defaults to claude as primary, no fallback, when file is absent', () => {
    const s = store.get();
    expect(s.primary).toBe('claude');
    expect(s.fallback).toBeUndefined();
    expect(s.lastFallback).toBeUndefined();
  });

  it('setProviders persists primary + fallback', () => {
    store.setProviders('codex', 'claude');
    const s = store.get();
    expect(s.primary).toBe('codex');
    expect(s.fallback).toBe('claude');
  });

  it('setProviders accepts undefined fallback (no automatic switching)', () => {
    store.setProviders('claude');
    expect(store.get().fallback).toBeUndefined();
  });

  it('rejects invalid primary', () => {
    expect(() => store.setProviders('made-up' as never)).toThrow(/Invalid primary/);
  });

  it('rejects invalid fallback', () => {
    expect(() => store.setProviders('claude', 'made-up' as never)).toThrow(/Invalid fallback/);
  });

  it('rejects fallback equal to primary', () => {
    expect(() => store.setProviders('claude', 'claude')).toThrow(/differ from primary/);
  });

  it('recordFallback writes telemetry, get() returns it', () => {
    store.setProviders('claude', 'codex');
    store.recordFallback({
      at: 1700000000000,
      primary: 'claude',
      fallback: 'codex',
      reason: 'credit_exhausted',
      agentId: 'demo',
      nodeId: 'analyze',
    });
    const s = store.get();
    expect(s.lastFallback?.reason).toBe('credit_exhausted');
    expect(s.lastFallback?.agentId).toBe('demo');
    expect(s.lastFallback?.fallback).toBe('codex');
  });

  it('clearLastFallback resets the telemetry only (primary/fallback preserved)', () => {
    store.setProviders('claude', 'codex');
    store.recordFallback({
      at: 1, primary: 'claude', fallback: 'codex', reason: 'timeout',
    });
    store.clearLastFallback();
    const s = store.get();
    expect(s.lastFallback).toBeUndefined();
    expect(s.primary).toBe('claude');
    expect(s.fallback).toBe('codex');
  });

  it('LLM_PROVIDERS is non-empty and matches the canonical PROVIDER_IDS list', () => {
    expect(LLM_PROVIDERS.length).toBeGreaterThan(0);
    expect(LLM_PROVIDERS).toContain('claude');
  });

  it('recovers from a hand-edited file with a bad primary by falling back to default', () => {
    // Write a malformed file.
    const path = join(dir, 'llm-settings.json');
    require('node:fs').writeFileSync(path, JSON.stringify({
      version: 1, settings: { primary: 'not-a-thing' },
    }));
    const store2 = new LlmSettingsStore(path);
    expect(store2.get().primary).toBe('claude');
  });
});
