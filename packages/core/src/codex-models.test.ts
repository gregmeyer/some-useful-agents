import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexConfigModel, codexModelRetired, codexModels, refusedModelId } from './codex-models.js';

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'sua-codex-home-')); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

const cache = (models: unknown[]) => writeFileSync(join(home, 'models_cache.json'), JSON.stringify({ fetched_at: '2026-10-16T20:53:42Z', models }));

describe('codexModels', () => {
  it("lists what Codex offers, in Codex's order, without hidden ones", () => {
    cache([
      { slug: 'gpt-6-sol', display_name: 'GPT-6-Sol', description: 'Workhorse.', visibility: 'list', priority: 3 },
      { slug: 'codex-auto-review', display_name: 'Codex Auto Review', visibility: 'hide', priority: 43 },
      { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', description: 'Frontier.', visibility: 'list', priority: 2 },
    ]);
    const list = codexModels(home);
    expect(list.models.map((m) => m.id)).toEqual(['gpt-6-astra', 'gpt-6-sol']);
    expect(list.models[0]).toEqual({ id: 'gpt-6-astra', label: 'GPT-6-Astra', desc: 'Frontier.' });
    expect(list.ids).toContain('codex-auto-review');
    expect(list.fetchedAt).toBe('2026-10-16T20:53:42Z');
  });

  it('is empty (unknown) without a cache, and then calls nothing retired', () => {
    const list = codexModels(home);
    expect(list).toEqual({ models: [], ids: [] });
    expect(codexModelRetired('gpt-5.5', list)).toBe(false);
  });

  it('calls a model retired once the list no longer has it', () => {
    cache([{ slug: 'gpt-6-sol', visibility: 'list' }, { slug: 'gpt-reserve', visibility: 'hide' }]);
    const list = codexModels(home);
    expect(codexModelRetired('gpt-5.5', list)).toBe(true);
    expect(codexModelRetired('gpt-6-sol', list)).toBe(false);
    expect(codexModelRetired('gpt-reserve', list)).toBe(false);
    expect(codexModelRetired(undefined, list)).toBe(false);
  });
});

describe('codexConfigModel', () => {
  it("reads the model from Codex's config.toml", () => {
    writeFileSync(join(home, 'config.toml'), 'model = "gpt-5.5"\nmodel_reasoning_effort = "medium"\n');
    expect(codexConfigModel(home)).toBe('gpt-5.5');
  });
  it('is undefined without one', () => {
    expect(codexConfigModel(home)).toBeUndefined();
  });
});

describe('refusedModelId', () => {
  it("pulls the model out of the provider's refusal", () => {
    expect(refusedModelId("400 invalid_request_error: The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account.")).toBe('gpt-5.5');
    expect(refusedModelId('The model `gpt-9` does not exist or you do not have access to it.')).toBe('gpt-9');
    expect(refusedModelId('rate limited')).toBeUndefined();
  });
});
