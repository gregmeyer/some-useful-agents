import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

describe('LlmSettingsStore (waterfall)', () => {
  it('defaults to a single-entry chain with claude primary when file is absent', () => {
    const s = store.get();
    expect(s.providers).toEqual(['claude']);
    expect(s.lastFallback).toBeUndefined();
  });

  it('setProviders persists the full ordered chain', () => {
    store.setProviders(['codex', 'claude']);
    const s = store.get();
    expect(s.providers).toEqual(['codex', 'claude']);
  });

  it('setProviders accepts a single-entry chain (no fallback)', () => {
    store.setProviders(['claude']);
    expect(store.get().providers).toEqual(['claude']);
  });

  it('setProviders dedupes (first occurrence wins)', () => {
    store.setProviders(['claude', 'codex', 'claude', 'codex']);
    expect(store.get().providers).toEqual(['claude', 'codex']);
  });

  it('rejects empty chain — at least one provider is required', () => {
    expect(() => store.setProviders([])).toThrow(/at least one/);
  });

  it('rejects unknown providers', () => {
    expect(() => store.setProviders(['made-up' as never])).toThrow(/Invalid provider/);
  });

  it('recordFallback writes telemetry, get() returns it', () => {
    store.setProviders(['claude', 'codex']);
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

  it('clearLastFallback resets telemetry only (chain preserved)', () => {
    store.setProviders(['claude', 'codex']);
    store.recordFallback({
      at: 1, primary: 'claude', fallback: 'codex', reason: 'timeout',
    });
    store.clearLastFallback();
    const s = store.get();
    expect(s.lastFallback).toBeUndefined();
    expect(s.providers).toEqual(['claude', 'codex']);
  });

  it('LLM_PROVIDERS is non-empty and matches the canonical PROVIDER_IDS list', () => {
    expect(LLM_PROVIDERS.length).toBeGreaterThan(0);
    expect(LLM_PROVIDERS).toContain('claude');
  });

  it('migrates the v1 { primary, fallback? } shape into a v2 chain', () => {
    const path = join(dir, 'llm-settings.json');
    writeFileSync(path, JSON.stringify({
      version: 1,
      settings: { primary: 'claude', fallback: 'codex' },
    }));
    const migrated = new LlmSettingsStore(path);
    expect(migrated.get().providers).toEqual(['claude', 'codex']);
  });

  it('migrates v1 with no fallback into a single-entry chain', () => {
    const path = join(dir, 'llm-settings.json');
    writeFileSync(path, JSON.stringify({
      version: 1, settings: { primary: 'codex' },
    }));
    const migrated = new LlmSettingsStore(path);
    expect(migrated.get().providers).toEqual(['codex']);
  });

  it('migrated lastFallback survives the v1 → v2 conversion', () => {
    const path = join(dir, 'llm-settings.json');
    writeFileSync(path, JSON.stringify({
      version: 1,
      settings: {
        primary: 'claude',
        fallback: 'codex',
        lastFallback: {
          at: 1700000000000, primary: 'claude', fallback: 'codex', reason: 'timeout',
        },
      },
    }));
    const migrated = new LlmSettingsStore(path);
    expect(migrated.get().lastFallback?.reason).toBe('timeout');
  });

  it('recovers from a hand-edited v2 file with bad providers by filtering them out', () => {
    const path = join(dir, 'llm-settings.json');
    writeFileSync(path, JSON.stringify({
      version: 2,
      settings: { providers: ['not-a-thing', 'codex'] },
    }));
    const s = new LlmSettingsStore(path).get();
    expect(s.providers).toEqual(['codex']);
  });

  it('recovers from a v2 file with all-invalid providers by falling back to claude', () => {
    const path = join(dir, 'llm-settings.json');
    writeFileSync(path, JSON.stringify({
      version: 2, settings: { providers: ['nope', 'also-nope'] },
    }));
    const s = new LlmSettingsStore(path).get();
    expect(s.providers).toEqual(['claude']);
  });
});
