import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bareModelId, claudeConfigModel, claudeModels } from './claude-models.js';
import { modelRetired, refusedModelId } from './codex-models.js';
import { classifyLlmFailure } from './node-spawner.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sua-claude-dir-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const catalog = (models: unknown[]) => {
  mkdirSync(join(dir, 'cache', 'model-catalog'), { recursive: true });
  writeFileSync(join(dir, 'cache', 'model-catalog', 'acct-cc.json'), JSON.stringify({
    version: 2, fetchedAt: 1792184026957,
    catalog: { config: { models, provider_alias_targets: { opus: {}, sonnet: {}, fable: {} } } },
  }));
};

describe('claudeModels', () => {
  it('lists current models first, then older ones still offered; aliases are known', () => {
    catalog([
      { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', section: 'overflow' },
      { id: 'claude-opus-5-5', name: 'Opus 5.5', description: 'For complex work', section: 'main' },
    ]);
    const list = claudeModels(dir);
    expect(list.models).toEqual([
      { id: 'claude-opus-5-5', label: 'Opus 5.5', desc: 'For complex work' },
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', desc: 'Older model, still offered' },
    ]);
    expect(list.ids).toEqual(expect.arrayContaining(['claude-opus-5-5', 'claude-sonnet-4-6', 'opus', 'haiku', 'fable']));
    expect(modelRetired('claude-3-opus-20240229', list)).toBe(true);
    expect(modelRetired('opus[1m]', list)).toBe(false);
    expect(modelRetired('claude-opus-5-5[1m]', list)).toBe(false);
  });

  it('is empty (unknown) without a catalog', () => {
    expect(claudeModels(dir)).toEqual({ models: [], ids: [] });
  });
});

describe('claudeConfigModel', () => {
  it("reads the model from Claude's settings.json", () => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ model: 'opus[1m]' }));
    expect(claudeConfigModel(dir)).toBe('opus[1m]');
    expect(bareModelId('opus[1m]')).toBe('opus');
  });
});

describe("Claude's retired-model wording", () => {
  const said = "There's an issue with the selected model (claude-3-opus-20240229). It may not exist or you may not have access to it. Run --model to pick a different model.";
  it('is model_unavailable, naming the model', () => {
    expect(classifyLlmFailure({ result: said, exitCode: 1, error: 'Process exited with code 1' })).toBe('model_unavailable');
    expect(refusedModelId(said)).toBe('claude-3-opus-20240229');
  });
});
