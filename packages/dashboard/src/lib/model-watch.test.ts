import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InboxStore, type Agent, type LlmSettings, type ProviderModelList } from '@some-useful-agents/core';
import { buildRetiredModelMessage, checkModelsOnce, findRetiredModels, MODEL_RETIRED_DEDUPE_PREFIX, type ProviderModels, type WatchedProvider } from './model-watch.js';

const CODEX: ProviderModelList = {
  models: [
    { id: 'gpt-6-astra', label: 'GPT-6-Astra', desc: 'Frontier intelligence.' },
    { id: 'gpt-6-sol', label: 'GPT-6-Sol', desc: 'Workhorse.' },
  ],
  ids: ['gpt-6-astra', 'gpt-6-sol', 'codex-auto-review'],
};
const CLAUDE: ProviderModelList = {
  models: [
    { id: 'claude-opus-5-5', label: 'Opus 5.5', desc: 'For complex work and everyday tasks' },
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', desc: 'Older model, still offered' },
  ],
  ids: ['claude-opus-5-5', 'claude-sonnet-4-6', 'opus', 'sonnet', 'haiku', 'fable', 'default'],
};
const providers = (codexDefault?: string, claudeDefault?: string): Partial<Record<WatchedProvider, ProviderModels>> => ({
  codex: { list: CODEX, configModel: codexDefault },
  claude: { list: CLAUDE, configModel: claudeDefault },
});
const settings = (over: Partial<LlmSettings> = {}): LlmSettings => ({ providers: ['codex', 'claude'], ...over });
const agent = (over: Partial<Agent>): Agent => ({
  id: 'a', name: 'A', status: 'active', source: 'local', mcp: false, version: 1,
  nodes: [], ...over,
} as Agent);

describe('findRetiredModels', () => {
  it("flags Codex's own default when Codex no longer offers it", () => {
    const r = findRetiredModels({ settings: settings(), providers: providers('gpt-5.5', 'opus[1m]'), agents: [] });
    expect(r).toEqual([{ provider: 'codex', model: 'gpt-5.5', where: ["Codex's own default (`model` in ~/.codex/config.toml)"] }]);
  });

  it("flags Claude's own default the same way; aliases and [1m] tags are fine", () => {
    expect(findRetiredModels({ settings: settings({ providers: ['claude'] }), providers: providers(undefined, 'claude-3-opus-20240229'), agents: [] }))
      .toEqual([{ provider: 'claude', model: 'claude-3-opus-20240229', where: ["Claude's own default (`model` in ~/.claude/settings.json)"] }]);
    expect(findRetiredModels({ settings: settings({ providers: ['claude'] }), providers: providers(undefined, 'opus[1m]'), agents: [] })).toEqual([]);
    expect(findRetiredModels({ settings: settings({ providers: ['claude'] }), providers: providers(undefined, 'claude-opus-5-5[1m]'), agents: [] })).toEqual([]);
  });

  it('a model picked in Settings replaces the config default', () => {
    expect(findRetiredModels({ settings: settings({ models: { codex: 'gpt-6-sol' } }), providers: providers('gpt-5.5'), agents: [] })).toEqual([]);
    expect(findRetiredModels({ settings: settings({ models: { claude: 'claude-opus-4-1' } }), providers: providers('gpt-6-sol'), agents: [] }))
      .toEqual([{ provider: 'claude', model: 'claude-opus-4-1', where: ['Settings → LLM (the Claude model)'] }]);
  });

  it('ignores a default while its provider is off or not in the waterfall', () => {
    expect(findRetiredModels({ settings: settings({ disabledProviders: ['codex'] }), providers: providers('gpt-5.5'), agents: [] })).toEqual([]);
    expect(findRetiredModels({ settings: settings({ providers: ['claude'] }), providers: providers('gpt-5.5'), agents: [] })).toEqual([]);
  });

  it('finds agents and steps that pin a retired model, grouped by provider and model', () => {
    const agents = [
      agent({ id: 'digest', provider: 'codex', model: 'o4-mini' }),
      agent({ id: 'mixed', nodes: [
        { id: 'judge', type: 'llm-prompt', prompt: 'x', provider: 'codex', model: 'o4-mini' },
        { id: 'writer', type: 'llm-prompt', prompt: 'x', provider: 'claude', model: 'claude-3-5-sonnet-20241022' },
        { id: 'unpinned', type: 'llm-prompt', prompt: 'x', model: 'whatever' },
        { id: 'ok', type: 'llm-prompt', prompt: 'x', provider: 'claude', model: 'claude-sonnet-4-6' },
      ] as Agent['nodes'] }),
      agent({ id: 'old', status: 'archived', provider: 'codex', model: 'o3' }),
    ];
    const r = findRetiredModels({ settings: settings({ models: { codex: 'gpt-6-sol' } }), providers: providers(undefined, 'opus'), agents });
    expect(r).toEqual([
      { provider: 'codex', model: 'o4-mini', where: ['agent `digest`', 'agent `mixed`, step `judge`'] },
      { provider: 'claude', model: 'claude-3-5-sonnet-20241022', where: ['agent `mixed`, step `writer`'] },
    ]);
  });

  it('a refusal counts even when the list still has the model, or is unknown', () => {
    const s = settings({ models: { codex: 'gpt-6-sol' }, unavailableModels: { 'codex/gpt-6-sol': { at: 1, error: 'not supported' } } });
    expect(findRetiredModels({ settings: s, providers: { codex: { list: { models: [], ids: [] } } }, agents: [] }))
      .toEqual([{ provider: 'codex', model: 'gpt-6-sol', where: ['Settings → LLM (the Codex model)'], refusal: 'not supported' }]);
  });

  it('an unknown list calls nothing retired on its own', () => {
    expect(findRetiredModels({ settings: settings(), providers: { codex: { list: { models: [], ids: [] }, configModel: 'gpt-5.5' } }, agents: [] })).toEqual([]);
  });
});

describe('buildRetiredModelMessage', () => {
  it('names the model, where it is used, what the provider offers now, and where to fix it', () => {
    const msg = buildRetiredModelMessage({ provider: 'codex', model: 'gpt-5.5', where: ['Settings → LLM (the Codex model)'] }, CODEX);
    expect(msg).toMatchObject({ priority: 'high', source: 'system-health', title: 'Codex no longer offers gpt-5.5', dedupeKey: `${MODEL_RETIRED_DEDUPE_PREFIX}codex/gpt-5.5` });
    expect(msg.body).toContain('`gpt-6-astra` — GPT-6-Astra: Frontier intelligence.');
    expect(msg.body).toContain('[Settings → LLM](/settings/llm)');
    expect(msg.body).toContain('- Settings → LLM (the Codex model)');
  });

  it('speaks of Claude for a Claude model', () => {
    const msg = buildRetiredModelMessage({ provider: 'claude', model: 'claude-3-opus-20240229', where: ['x'] }, CLAUDE);
    expect(msg.title).toBe('Claude no longer offers claude-3-opus-20240229');
    expect(msg.body).toContain('`claude-opus-5-5` — Opus 5.5');
    expect(msg.dedupeKey).toBe(`${MODEL_RETIRED_DEDUPE_PREFIX}claude/claude-3-opus-20240229`);
  });
});

describe('checkModelsOnce', () => {
  let dir: string;
  let inbox: InboxStore;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sua-model-watch-'));
    inbox = new InboxStore(join(dir, 'runs.db'));
  });
  afterEach(() => { inbox.close?.(); rmSync(dir, { recursive: true, force: true }); });

  it('tells sua once per retired model, then resolves once nothing uses it', () => {
    const opts = { providers: providers('gpt-5.5', 'opus') };
    expect(checkModelsOnce(inbox, settings(), [], opts)).toEqual({ posted: ['codex/gpt-5.5'], resolved: [] });
    expect(checkModelsOnce(inbox, settings(), [], opts)).toEqual({ posted: [], resolved: [] });
    const [thread] = inbox.list({ source: 'system-health' });
    expect(thread.title).toBe('Codex no longer offers gpt-5.5');

    expect(checkModelsOnce(inbox, settings({ models: { codex: 'gpt-6-sol' } }), [], opts)).toEqual({ posted: [], resolved: ['codex/gpt-5.5'] });
    expect(inbox.get(thread.id)?.status).toBe('resolved');
  });
});
