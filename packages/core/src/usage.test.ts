import { describe, it, expect } from 'vitest';
import {
  claudeUsage,
  codexUsage,
  openAiUsageAccumulator,
  priceUsage,
  totalUsage,
  localProviderNames,
  formatUsd,
  formatTokens,
  type LlmUsage,
} from './usage.js';

// Shapes sampled live 2026-09-28 (claude 2.1.284, codex exec --json).
const CLAUDE_STDOUT = [
  '{"type":"system","subtype":"init"}',
  '{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}',
  JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, result: 'ok', num_turns: 1, total_cost_usd: 0.1508868,
    usage: { input_tokens: 2, cache_creation_input_tokens: 18594, cache_read_input_tokens: 10234, output_tokens: 4 },
    modelUsage: { 'claude-opus-5-5[1m]': { costUSD: 0.1508868 } },
  }),
].join('\n');

const CODEX_STDOUT = [
  '{"type":"thread.started","thread_id":"t"}',
  '{"type":"turn.started"}',
  '{"type":"turn.completed","usage":{"input_tokens":16093,"cached_input_tokens":4480,"cache_write_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0}}',
  '{"type":"turn.completed","usage":{"input_tokens":1000,"cached_input_tokens":0,"output_tokens":20}}',
].join('\n');

const usage = (over: Partial<LlmUsage> = {}): LlmUsage => ({
  provider: 'codex', inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 500_000, cacheWriteTokens: 0, costSource: 'unpriced', ...over,
});

describe('provider usage parsers', () => {
  it('reads claude\'s reported cost, tokens and model', () => {
    expect(claudeUsage(CLAUDE_STDOUT)).toEqual({
      provider: 'claude', model: 'claude-opus-5-5', inputTokens: 2, outputTokens: 4,
      cacheReadTokens: 10234, cacheWriteTokens: 18594, costUsd: 0.1508868, costSource: 'reported',
    });
    expect(claudeUsage('not json')).toBeUndefined();
  });

  it('sums codex turns, separating cached input from the rest', () => {
    expect(codexUsage(CODEX_STDOUT)).toEqual({
      provider: 'codex', inputTokens: 16093 - 4480 + 1000, outputTokens: 25, cacheReadTokens: 4480, cacheWriteTokens: 0, costSource: 'unpriced',
    });
    expect(codexUsage('{"type":"turn.started"}')).toBeUndefined();
  });

  it('accumulates OpenAI-style usage across tool-loop responses', () => {
    const acc = openAiUsageAccumulator('local-qwen-8b', 'qwen3-8b');
    expect(acc.result()).toBeUndefined();
    acc.add({ prompt_tokens: 100, completion_tokens: 10 });
    acc.add({ prompt_tokens: 300, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 100 } });
    acc.add(undefined);
    expect(acc.result()).toMatchObject({ provider: 'local-qwen-8b', model: 'qwen3-8b', inputTokens: 300, cacheReadTokens: 100, outputTokens: 40 });
  });
});

describe('priceUsage', () => {
  it('keeps a reported cost', () => {
    const u = usage({ provider: 'claude', costUsd: 0.5, costSource: 'reported' });
    expect(priceUsage(u, { pricing: { claude: { inputPerMTok: 99, outputPerMTok: 99 } } })).toBe(u);
  });

  it('estimates from provider/model first, then provider; cached input defaults to the input price', () => {
    const pricing = { codex: { inputPerMTok: 1, outputPerMTok: 10 }, 'codex/gpt-5.5': { inputPerMTok: 2, outputPerMTok: 20, cacheReadPerMTok: 0.2 } };
    expect(priceUsage(usage({ model: 'gpt-5.5' }), { pricing })).toMatchObject({ costUsd: 2 + 2 + 0.1, costSource: 'estimated' });
    expect(priceUsage(usage({ model: 'other' }), { pricing })).toMatchObject({ costUsd: 1 + 1 + 0.5, costSource: 'estimated' });
  });

  it('treats an unpriced local endpoint as free and anything else as unpriced', () => {
    const local = localProviderNames([
      { name: 'local-qwen-8b', apiBase: 'http://127.0.0.1:8181/v1' },
      { name: 'lan-box', apiBase: 'http://localhost:1234/v1' },
      { name: 'gateway', apiBase: 'https://api.example.com/v1' },
    ]);
    expect([...local].sort()).toEqual(['lan-box', 'local-qwen-8b']);
    expect(priceUsage(usage({ provider: 'local-qwen-8b' }), { localProviders: local })).toMatchObject({ costUsd: 0, costSource: 'free' });
    expect(priceUsage(usage({ provider: 'gateway' }), { localProviders: local })).toMatchObject({ costUsd: undefined, costSource: 'unpriced' });
  });
});

describe('totalUsage', () => {
  it('sums attempts and flags an incomplete cost when tokens had no price', () => {
    const t = totalUsage([usage({ costUsd: 0.25, costSource: 'estimated' }), usage({ provider: 'x' })]);
    expect(t).toMatchObject({ inputTokens: 2_000_000, outputTokens: 200_000, cacheReadTokens: 1_000_000, costUsd: 0.25, costComplete: false });
    expect(totalUsage([usage({ costUsd: 0.1, costSource: 'reported' })]).costComplete).toBe(true);
    expect(totalUsage([usage({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 })]).costComplete).toBe(true);
  });
});

describe('formatting', () => {
  it('formats USD and token counts', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(0.00001)).toBe('<$0.0001');
    expect(formatUsd(0.0042)).toBe('$0.0042');
    expect(formatUsd(0.1508868)).toBe('$0.15');
    expect(formatUsd(1234.5)).toBe('$1,235');
    expect(formatUsd(0.02, false)).toBe('≥ $0.02');
    expect(formatTokens(812)).toBe('812');
    expect(formatTokens(12_400)).toBe('12k');
    expect(formatTokens(1_300_000)).toBe('1.3M');
  });
});
