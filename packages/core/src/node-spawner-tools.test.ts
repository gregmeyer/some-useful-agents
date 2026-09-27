import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeDeniedTools, classifyLlmFailure, shouldFallback, spawnNodeReal } from './node-spawner.js';
import type { AgentNode } from './agent-v2-types.js';

// Declared `tools:` on CLI providers. Regression for starter-watch: its
// `fetch` node declared tools: [web-fetch], ran on claude without any web
// tool, and "completed" with "WebFetch ... permission has not been granted".

const opts = (providers: string[]) => ({
  agentId: 'starter-watch',
  agentSource: 'examples' as const,
  llmSettings: { providers },
});

const fetchNode: AgentNode = {
  id: 'fetch',
  type: 'llm-prompt',
  prompt: 'Open https://example.com with the web-fetch tool.',
  tools: ['web-fetch'],
};

describe('declared tools on CLI providers', () => {
  let binDir: string;

  beforeAll(() => {
    // Fake claude: echoes its argv into the result, and reports one refused
    // tool call the way the real CLI does (exit 0, subtype success).
    binDir = mkdtempSync(join(tmpdir(), 'sua-fake-claude-'));
    const script = [
      '#!/bin/sh',
      'cat >/dev/null',
      'printf \'{"type":"result","subtype":"success","is_error":false,"result":"ARGS: %s","permission_denials":[{"tool_name":"Bash","tool_use_id":"t1","tool_input":{}}]}\\n\' "$*"',
    ].join('\n');
    writeFileSync(join(binDir, 'claude'), script);
    chmodSync(join(binDir, 'claude'), 0o755);
  });

  afterAll(() => rmSync(binDir, { recursive: true, force: true }));

  it('skips providers with no equivalent instead of running tool-less, and says what would fix it', async () => {
    const res = await spawnNodeReal(fetchNode, {}, opts(['codex', 'apple-foundation-models']));
    expect(res.exitCode).not.toBe(0);
    expect(res.category).toBe('tool_unavailable');
    expect(res.attemptedProviders).toEqual(['codex', 'apple-foundation-models']);
    expect(res.providerFailures?.map((f) => f.category)).toEqual(['tool_unavailable', 'tool_unavailable']);
    expect(res.error).toContain("No enabled provider can use this node's tools (web-fetch)");
    expect(res.error).toContain('OpenAI-compatible');
  });

  it('falls through a skipped provider to claude, which gets WebFetch in --allowedTools', async () => {
    const env = { PATH: `${binDir}:${process.env.PATH ?? ''}` };
    const res = await spawnNodeReal(fetchNode, env, opts(['codex', 'claude']));
    expect(res.exitCode).toBe(0);
    expect(res.usedLLMProvider).toBe('claude');
    expect(res.attemptedProviders).toEqual(['codex', 'claude']);
    expect(res.result).toContain('--allowedTools WebFetch');
  });

  it('keeps node allowedTools alongside the mapped ones', async () => {
    const env = { PATH: `${binDir}:${process.env.PATH ?? ''}` };
    const res = await spawnNodeReal({ ...fetchNode, allowedTools: ['Read'] }, env, opts(['claude']));
    expect(res.result).toContain('--allowedTools Read,WebFetch');
  });

  it('surfaces a refused tool call as a warning on an otherwise successful node', async () => {
    const env = { PATH: `${binDir}:${process.env.PATH ?? ''}` };
    const res = await spawnNodeReal(fetchNode, env, opts(['claude']));
    expect(res.exitCode).toBe(0);
    expect(res.error).toContain('claude was blocked from using Bash');
  });

  it('leaves nodes without tools: alone (no skip, no --allowedTools)', async () => {
    const env = { PATH: `${binDir}:${process.env.PATH ?? ''}` };
    const res = await spawnNodeReal({ id: 'plain', type: 'llm-prompt', prompt: 'hi' }, env, opts(['claude']));
    expect(res.exitCode).toBe(0);
    expect(res.result).not.toContain('--allowedTools');
  });
});

describe('claudeDeniedTools', () => {
  it('reads tool names from the result event, deduped', () => {
    const stdout = [
      '{"type":"assistant","message":{"content":[]}}',
      JSON.stringify({ type: 'result', result: 'x', permission_denials: [
        { tool_name: 'WebFetch' }, { tool_name: 'WebFetch' }, { tool_name: 'Bash' },
      ] }),
    ].join('\n');
    expect(claudeDeniedTools(stdout)).toEqual(['WebFetch', 'Bash']);
  });

  it('returns [] when there are no denials or no result event', () => {
    expect(claudeDeniedTools('{"type":"result","result":"x","permission_denials":[]}')).toEqual([]);
    expect(claudeDeniedTools('{"type":"result","result":"x"}')).toEqual([]);
    expect(claudeDeniedTools('not json')).toEqual([]);
  });
});

describe('tool_unavailable in the waterfall policy', () => {
  it('is passed through by the classifier and is fallback-worthy', () => {
    expect(classifyLlmFailure({ result: '', exitCode: 1, category: 'tool_unavailable' })).toBe('tool_unavailable');
    expect(shouldFallback('tool_unavailable')).toBe(true);
  });
});
