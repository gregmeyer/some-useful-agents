import { describe, it, expect } from 'vitest';
import { buildProviderChain, claudeSpawner, codexSpawner, classifyLlmFailure, type SpawnResult } from './node-spawner.js';

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

describe('claudeSpawner.parseProgress (per-token output_chunk)', () => {
  // The Claude CLI's --output-format stream-json emits one JSON line
  // per event. Assistant events carry a content array with text
  // and/or tool_use items. PR 4 of the streaming UX work uses the
  // output_chunk events to drive the typewriter reveal.

  it('returns null for non-JSON lines', () => {
    expect(claudeSpawner.parseProgress('')).toBeNull();
    expect(claudeSpawner.parseProgress('hello world')).toBeNull();
    expect(claudeSpawner.parseProgress('[not, json]')).toBeNull();
  });

  it('emits output_chunk with the text delta on an assistant text event', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello, world!' }] },
    });
    const p = claudeSpawner.parseProgress(line);
    expect(p).not.toBeNull();
    expect(p?.type).toBe('output_chunk');
    expect(p?.message).toBe('Hello, world!');
  });

  it('emits tool_use when an assistant event has tool_use content (no text)', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Read', input: {} }] },
    });
    const p = claudeSpawner.parseProgress(line);
    expect(p?.type).toBe('tool_use');
  });

  it('prefers text over tool_use when both are present in one assistant event', () => {
    // The first text chunk drives the typewriter; the tool_use is
    // surfaced via the next event in the stream.
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [
        { type: 'text', text: 'Let me check.' },
        { type: 'tool_use', name: 'Read' },
      ] },
    });
    const p = claudeSpawner.parseProgress(line);
    expect(p?.type).toBe('output_chunk');
    expect(p?.message).toBe('Let me check.');
  });

  it('falls back to turn_start for an assistant event with empty content', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [] } });
    const p = claudeSpawner.parseProgress(line);
    expect(p?.type).toBe('turn_start');
  });

  it('skips empty text deltas (no message.length === 0 events)', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: '' }] },
    });
    const p = claudeSpawner.parseProgress(line);
    // Empty text → no useful chunk → falls through to the generic
    // turn_start so the UI knows the model is alive.
    expect(p?.type).toBe('turn_start');
  });

  it('emits turn_complete with the turn count on a result event', () => {
    const line = JSON.stringify({ type: 'result', num_turns: 3 });
    const p = claudeSpawner.parseProgress(line);
    expect(p?.type).toBe('turn_complete');
    expect(p?.turn).toBe(3);
  });

  it('emits tool_use on a top-level tool_use event', () => {
    const line = JSON.stringify({ type: 'tool_use', name: 'Grep' });
    const p = claudeSpawner.parseProgress(line);
    expect(p?.type).toBe('tool_use');
  });

  it('returns null for unrecognized event types', () => {
    const line = JSON.stringify({ type: 'system' });
    expect(claudeSpawner.parseProgress(line)).toBeNull();
  });
});

describe('codexSpawner', () => {
  // Live sample of codex --json (sampled from running `codex exec --json -s read-only`):
  //   {"type":"thread.started","thread_id":"…"}
  //   {"type":"turn.started"}
  //   {"type":"item.completed","item":{"type":"agent_message","text":"…"}}
  //   {"type":"turn.completed","usage":{"output_tokens":N,…}}

  it('buildArgs includes --json so we get structured events instead of raw prose', () => {
    const args = codexSpawner.buildArgs({ prompt: 'hi' });
    expect(args).toContain('--json');
    expect(args).toContain('exec');
    expect(args).toContain('-s');
    expect(args).toContain('read-only');
  });

  it('buildArgs threads through the model when set', () => {
    const args = codexSpawner.buildArgs({ prompt: 'hi', model: 'o3' });
    const i = args.indexOf('-m');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe('o3');
  });

  it('parseProgress returns null for non-JSON lines', () => {
    expect(codexSpawner.parseProgress('')).toBeNull();
    expect(codexSpawner.parseProgress('not json')).toBeNull();
  });

  it('parseProgress emits turn_start on turn.started', () => {
    const p = codexSpawner.parseProgress(JSON.stringify({ type: 'turn.started' }));
    expect(p?.type).toBe('turn_start');
  });

  it('parseProgress emits output_chunk with the agent_message text', () => {
    const line = JSON.stringify({
      type: 'item.completed',
      item: { id: 'item_0', type: 'agent_message', text: 'Hello there.' },
    });
    const p = codexSpawner.parseProgress(line);
    expect(p?.type).toBe('output_chunk');
    expect(p?.message).toBe('Hello there.');
  });

  it('parseProgress skips empty agent_message text', () => {
    const line = JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: '' },
    });
    expect(codexSpawner.parseProgress(line)).toBeNull();
  });

  it('parseProgress ignores non-agent_message item.completed events', () => {
    // Codex may emit tool_use / file_changes / reasoning items in
    // future versions — those should not surface as triage:token.
    const line = JSON.stringify({
      type: 'item.completed',
      item: { type: 'tool_use', name: 'shell' },
    });
    expect(codexSpawner.parseProgress(line)).toBeNull();
  });

  it('parseProgress emits turn_complete on turn.completed with output_tokens', () => {
    const line = JSON.stringify({
      type: 'turn.completed',
      usage: { output_tokens: 57, input_tokens: 12934 },
    });
    const p = codexSpawner.parseProgress(line);
    expect(p?.type).toBe('turn_complete');
    expect(p?.message).toContain('57');
  });

  it('parseProgress emits turn_complete with a generic message when usage is absent', () => {
    const p = codexSpawner.parseProgress(JSON.stringify({ type: 'turn.completed' }));
    expect(p?.type).toBe('turn_complete');
  });

  it('parseProgress returns null for thread.started + unknown event types', () => {
    expect(codexSpawner.parseProgress(JSON.stringify({ type: 'thread.started', thread_id: 'x' }))).toBeNull();
    expect(codexSpawner.parseProgress(JSON.stringify({ type: 'something_new' }))).toBeNull();
  });

  it('extractResult walks back to the last agent_message and returns its text', () => {
    const stdout = [
      JSON.stringify({ type: 'thread.started', thread_id: 'x' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Hello there.' } }),
      JSON.stringify({ type: 'turn.completed', usage: { output_tokens: 12 } }),
    ].join('\n');
    expect(codexSpawner.extractResult(stdout)).toBe('Hello there.');
  });

  it('extractResult prefers the LAST agent_message when multiple appear in one run', () => {
    // Multi-turn runs (e.g. when the model emits a tool_use then a
    // follow-up agent_message) would have several agent_message
    // items. The final one is the user-visible reply.
    const stdout = [
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Intermediate.' } }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Final answer.' } }),
      JSON.stringify({ type: 'turn.completed' }),
    ].join('\n');
    expect(codexSpawner.extractResult(stdout)).toBe('Final answer.');
  });

  it('extractResult falls back to raw stdout when no agent_message is present', () => {
    // Defensive: legacy behavior for any future codex output shape
    // we haven't seen yet — the spawner still hands a string back to
    // the executor instead of throwing.
    const stdout = 'plain unstructured fallback';
    expect(codexSpawner.extractResult(stdout)).toBe(stdout);
  });
});

