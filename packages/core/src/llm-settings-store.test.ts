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

describe('LlmSettingsStore (custom OpenAI-compatible providers)', () => {
  const qwen = {
    name: 'local-qwen-8b', kind: 'openai' as const,
    apiBase: 'http://127.0.0.1:8181/v1', apiKey: 'local', model: 'unsloth/Qwen3-8B-GGUF:UD-Q4_K_XL',
  };

  it('adds, lists, and gets a custom provider', () => {
    store.addCustomProvider(qwen);
    expect(store.listCustomProviders()).toEqual([qwen]);
    expect(store.getCustomProvider('local-qwen-8b')).toEqual(qwen);
    expect(store.getCustomProvider('nope')).toBeUndefined();
  });

  it('lets the waterfall reference a custom name once it is defined', () => {
    store.addCustomProvider(qwen);
    store.setProviders(['local-qwen-8b', 'claude']);
    expect(store.get().providers).toEqual(['local-qwen-8b', 'claude']);
  });

  it('rejects a waterfall entry that names an undefined provider', () => {
    expect(() => store.setProviders(['ghost-model'])).toThrow(/Invalid provider/);
  });

  it('edits a custom provider in place when re-added by the same name', () => {
    store.addCustomProvider(qwen);
    store.addCustomProvider({ ...qwen, model: 'other-model', apiKey: undefined });
    const got = store.getCustomProvider('local-qwen-8b');
    expect(got?.model).toBe('other-model');
    expect(got?.apiKey).toBeUndefined();
    expect(store.listCustomProviders()).toHaveLength(1);
  });

  it('validates name, apiBase, and model', () => {
    expect(() => store.addCustomProvider({ ...qwen, name: 'has spaces' })).toThrow(/slug/);
    expect(() => store.addCustomProvider({ ...qwen, name: 'claude' })).toThrow(/builtin/);
    expect(() => store.addCustomProvider({ ...qwen, apiBase: 'not-a-url' })).toThrow(/http/);
    expect(() => store.addCustomProvider({ ...qwen, model: '' })).toThrow(/model/);
  });

  it('removing a custom provider strips it from the waterfall', () => {
    store.addCustomProvider(qwen);
    store.setProviders(['local-qwen-8b', 'claude']);
    store.removeCustomProvider('local-qwen-8b');
    expect(store.getCustomProvider('local-qwen-8b')).toBeUndefined();
    expect(store.get().providers).toEqual(['claude']);
  });

  it('refuses to remove a custom provider that is the only waterfall entry', () => {
    store.addCustomProvider(qwen);
    store.setProviders(['local-qwen-8b']);
    expect(() => store.removeCustomProvider('local-qwen-8b')).toThrow(/last provider/);
  });

  it('migrates a v2 file to v3 (adds an empty customProviders list)', () => {
    const path = join(dir, 'llm-settings.json');
    writeFileSync(path, JSON.stringify({ version: 2, settings: { providers: ['claude'] } }));
    const s = new LlmSettingsStore(path).get();
    expect(s.providers).toEqual(['claude']);
    expect(s.customProviders).toEqual([]);
  });

  it('drops malformed custom-provider entries from a hand-edited file', () => {
    const path = join(dir, 'llm-settings.json');
    writeFileSync(path, JSON.stringify({
      version: 3,
      settings: {
        providers: ['claude'],
        customProviders: [
          { name: 'ok', kind: 'openai', apiBase: 'http://x/v1', model: 'm' },
          { name: 'bad-kind', kind: 'anthropic', apiBase: 'http://x/v1', model: 'm' },
          { name: 'missing-model', kind: 'openai', apiBase: 'http://x/v1' },
        ],
      },
    }));
    const s = new LlmSettingsStore(path).get();
    expect(s.customProviders?.map((c) => c.name)).toEqual(['ok']);
  });
});
