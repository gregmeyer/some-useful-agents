import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InboxStore, type Agent, type CodexModelList, type LlmSettings } from '@some-useful-agents/core';
import { buildRetiredModelMessage, checkModelsOnce, findRetiredModels, MODEL_RETIRED_DEDUPE_PREFIX } from './model-watch.js';

const CODEX: CodexModelList = {
  models: [
    { id: 'gpt-6-astra', label: 'GPT-6-Astra', desc: 'Frontier intelligence.' },
    { id: 'gpt-6-sol', label: 'GPT-6-Sol', desc: 'Workhorse.' },
  ],
  ids: ['gpt-6-astra', 'gpt-6-sol', 'codex-auto-review'],
};
const settings = (over: Partial<LlmSettings> = {}): LlmSettings => ({ providers: ['codex', 'claude'], ...over });
const agent = (over: Partial<Agent>): Agent => ({
  id: 'a', name: 'A', status: 'active', source: 'local', mcp: false, version: 1,
  nodes: [], ...over,
} as Agent);

describe('findRetiredModels', () => {
  it("flags Codex's own default when Codex no longer offers it", () => {
    const r = findRetiredModels({ settings: settings(), codex: CODEX, codexConfigModel: 'gpt-5.5', agents: [] });
    expect(r).toEqual([{ provider: 'codex', model: 'gpt-5.5', where: ["Codex's own default (`model` in ~/.codex/config.toml)"] }]);
  });

  it('a model picked in Settings replaces the config default', () => {
    expect(findRetiredModels({ settings: settings({ models: { codex: 'gpt-6-sol' } }), codex: CODEX, codexConfigModel: 'gpt-5.5', agents: [] })).toEqual([]);
  });

  it('ignores the default while Codex is off or not in the waterfall', () => {
    expect(findRetiredModels({ settings: settings({ disabledProviders: ['codex'] }), codex: CODEX, codexConfigModel: 'gpt-5.5', agents: [] })).toEqual([]);
    expect(findRetiredModels({ settings: settings({ providers: ['claude'] }), codex: CODEX, codexConfigModel: 'gpt-5.5', agents: [] })).toEqual([]);
  });

  it('finds agents and steps that pin a retired Codex model, grouped by model', () => {
    const agents = [
      agent({ id: 'digest', provider: 'codex', model: 'o4-mini' }),
      agent({ id: 'mixed', nodes: [
        { id: 'judge', type: 'llm-prompt', prompt: 'x', provider: 'codex', model: 'o4-mini' },
        { id: 'claude-step', type: 'llm-prompt', prompt: 'x', model: 'claude-sonnet-4-6' },
        { id: 'ok', type: 'llm-prompt', prompt: 'x', provider: 'codex', model: 'gpt-6-sol' },
      ] as Agent['nodes'] }),
      agent({ id: 'old', status: 'archived', provider: 'codex', model: 'o3' }),
    ];
    const r = findRetiredModels({ settings: settings({ models: { codex: 'gpt-6-sol' } }), codex: CODEX, agents });
    expect(r).toEqual([{ provider: 'codex', model: 'o4-mini', where: ['agent `digest`', 'agent `mixed`, step `judge`'] }]);
  });

  it('a refusal counts even when the list still has the model, or is unknown', () => {
    const s = settings({ models: { codex: 'gpt-6-sol' }, unavailableModels: { 'codex/gpt-6-sol': { at: 1, error: 'not supported' } } });
    expect(findRetiredModels({ settings: s, codex: { models: [], ids: [] }, agents: [] }))
      .toEqual([{ provider: 'codex', model: 'gpt-6-sol', where: ['Settings → LLM (the Codex model)'], refusal: 'not supported' }]);
  });

  it('an unknown list calls nothing retired on its own', () => {
    expect(findRetiredModels({ settings: settings(), codex: { models: [], ids: [] }, codexConfigModel: 'gpt-5.5', agents: [] })).toEqual([]);
  });
});

describe('buildRetiredModelMessage', () => {
  it('names the model, where it is used, what Codex offers now, and where to fix it', () => {
    const msg = buildRetiredModelMessage({ provider: 'codex', model: 'gpt-5.5', where: ['Settings → LLM (the Codex model)'] }, CODEX);
    expect(msg).toMatchObject({ priority: 'high', source: 'system-health', title: 'Codex no longer offers gpt-5.5', dedupeKey: `${MODEL_RETIRED_DEDUPE_PREFIX}codex/gpt-5.5` });
    expect(msg.body).toContain('`gpt-6-astra` — GPT-6-Astra: Frontier intelligence.');
    expect(msg.body).toContain('[Settings → LLM](/settings/llm)');
    expect(msg.body).toContain('- Settings → LLM (the Codex model)');
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
    const opts = { codex: CODEX, codexConfigModel: 'gpt-5.5' };
    expect(checkModelsOnce(inbox, settings(), [], opts)).toEqual({ posted: ['gpt-5.5'], resolved: [] });
    expect(checkModelsOnce(inbox, settings(), [], opts)).toEqual({ posted: [], resolved: [] });
    const [thread] = inbox.list({ source: 'system-health' });
    expect(thread.title).toBe('Codex no longer offers gpt-5.5');

    expect(checkModelsOnce(inbox, settings({ models: { codex: 'gpt-6-sol' } }), [], opts)).toEqual({ posted: [], resolved: ['gpt-5.5'] });
    expect(inbox.get(thread.id)?.status).toBe('resolved');
  });
});
