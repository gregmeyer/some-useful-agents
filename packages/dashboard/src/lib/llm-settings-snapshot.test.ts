/**
 * buildLlmSettingsSnapshot is the single seam where LLM settings reach every run
 * path. It must exclude DISABLED providers from the runtime waterfall (the
 * per-provider off switch) while still carrying custom-provider definitions.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmSettingsStore } from '@some-useful-agents/core';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';

let dir: string;

afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

function makeStore(): LlmSettingsStore {
  dir = mkdtempSync(join(tmpdir(), 'sua-snap-'));
  return new LlmSettingsStore(join(dir, 'llm-settings.json'));
}

describe('buildLlmSettingsSnapshot', () => {
  it('excludes disabled providers from the runtime chain', () => {
    const store = makeStore();
    store.setProviders(['claude', 'codex']);
    store.setProviderEnabled('claude', false);
    const snap = buildLlmSettingsSnapshot({ llmSettingsStore: store });
    expect(snap?.providers).toEqual(['codex']); // claude skipped at runtime
  });

  it('carries the disabled list through so pins to disabled providers can be neutralized', () => {
    const store = makeStore();
    store.setProviders(['claude', 'codex']);
    store.setProviderEnabled('claude', false);
    const snap = buildLlmSettingsSnapshot({ llmSettingsStore: store });
    expect(snap?.disabledProviders).toEqual(['claude']);
  });

  it('keeps all providers when none are disabled, and carries custom defs', () => {
    const store = makeStore();
    store.addCustomProvider({ name: 'local-qwen', kind: 'openai', apiBase: 'http://x/v1', model: 'q' });
    store.setProviders(['claude', 'local-qwen']);
    const snap = buildLlmSettingsSnapshot({ llmSettingsStore: store });
    expect(snap?.providers).toEqual(['claude', 'local-qwen']);
    expect(snap?.customProviders?.map((c) => c.name)).toEqual(['local-qwen']);
  });

  it('returns undefined when no store is configured', () => {
    expect(buildLlmSettingsSnapshot({ llmSettingsStore: undefined })).toBeUndefined();
  });
});
