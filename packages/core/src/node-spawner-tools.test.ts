import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeDeniedTools, classifyLlmFailure, shouldFallback, spawnNodeReal } from './node-spawner.js';
import type { AgentNode } from './agent-v2-types.js';

// Declared `tools:` on CLI providers (ADR-0036). Regression for starter-watch:
// its `fetch` node declared tools: [web-fetch], ran on claude without any web
// tool, and "completed" with "WebFetch ... permission has not been granted".
// Claude now gets the node's sua tools from a per-attempt MCP endpoint.

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

// Where the MCP client lives, so the fake claude below can be a real client.
const MCP_CLIENT = pathToFileURL(
  createRequire(import.meta.url).resolve('@modelcontextprotocol/client').replace(/index\.cjs$/, 'index.mjs'),
).href;

describe('declared tools on CLI providers', () => {
  let binDir: string;
  const env = () => ({ PATH: `${binDir}:${process.env.PATH ?? ''}` });

  beforeAll(() => {
    // Fake claude, as a real MCP client: reads the --mcp-config it was given,
    // connects to sua's endpoint with the bearer token, calls json-parse, and
    // reports like the real CLI (including its own copy of the MCP tool_use,
    // which sua must not double-count) plus one refused tool call.
    binDir = mkdtempSync(join(tmpdir(), 'sua-fake-claude-'));
    const script = `#!/usr/bin/env node
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
process.stdin.resume(); process.stdin.on('data', () => {});
const i = args.indexOf('--mcp-config');
let toolText = '(no tools)';
if (i >= 0) {
  const cfg = JSON.parse(readFileSync(args[i + 1], 'utf8')).mcpServers.sua;
  const { Client, StreamableHTTPClientTransport } = await import(${JSON.stringify(MCP_CLIENT)});
  const client = new Client({ name: 'fake-claude', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers } }));
  const listed = (await client.listTools()).tools.map((t) => t.name);
  const res = await client.callTool({ name: 'json-parse', arguments: { text: '[1,2]' } });
  toolText = 'listed=' + listed.join(',') + ' got=' + res.content[0].text;
  await client.close();
}
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'm1', name: 'mcp__sua__json-parse', input: { text: '[1,2]' } }] } });
emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'm1', content: '[1,2]' }] } });
emit({ type: 'result', subtype: 'success', is_error: false, result: 'ARGS: ' + args.join(' ') + ' | ' + toolText,
  permission_denials: [{ tool_name: 'Bash', tool_use_id: 't1', tool_input: {} }] });
`;
    writeFileSync(join(binDir, 'claude'), script);
    chmodSync(join(binDir, 'claude'), 0o755);
  });

  afterAll(() => rmSync(binDir, { recursive: true, force: true }));

  it('skips CLIs that cannot load sua tools instead of running tool-less, and says what would fix it', async () => {
    const res = await spawnNodeReal(fetchNode, {}, opts(['codex', 'apple-foundation-models']));
    expect(res.exitCode).not.toBe(0);
    expect(res.category).toBe('tool_unavailable');
    expect(res.attemptedProviders).toEqual(['codex', 'apple-foundation-models']);
    expect(res.providerFailures?.map((f) => f.category)).toEqual(['tool_unavailable', 'tool_unavailable']);
    expect(res.error).toContain("No enabled provider can use this node's tools (web-fetch)");
    expect(res.error).toContain('Enable Claude or an OpenAI-compatible provider');
  });

  it('serves the node\'s sua tools to claude over MCP: it lists and calls them for real', async () => {
    const node: AgentNode = { id: 'parse', type: 'llm-prompt', prompt: 'parse it', tools: ['json-parse'] };
    const res = await spawnNodeReal(node, env(), opts(['codex', 'claude']));
    expect(res.exitCode).toBe(0);
    expect(res.usedLLMProvider).toBe('claude');
    expect(res.result).toContain('listed=json-parse');
    expect(res.result).toMatch(/got=\[\s*1,\s*2\s*\]/);
    expect(res.result).toContain('--strict-mcp-config');
    expect(res.result).toContain('--allowedTools mcp__sua');
  });

  it('records the call once, as the sua tool — not again as claude\'s mcp__sua__ copy', async () => {
    const node: AgentNode = { id: 'parse', type: 'llm-prompt', prompt: 'parse it', tools: ['json-parse'] };
    const res = await spawnNodeReal(node, env(), opts(['claude']));
    expect(res.toolCalls).toEqual([expect.objectContaining({ provider: 'claude', source: 'sua', toolId: 'json-parse', isError: false })]);
  });

  it('applies the tool policy on the MCP path: claude gets a readable deny, and the trace records it', async () => {
    const node: AgentNode = { id: 'parse', type: 'llm-prompt', prompt: 'parse it', tools: ['json-parse'] };
    const res = await spawnNodeReal(node, env(), {
      ...opts(['claude']),
      policyDocument: { version: 1, defaultAction: 'allow', rules: [{ tool: 'json-parse', action: 'execute', resources: [], effect: 'deny', reason: 'parsing is off today' }] },
    });
    expect(res.result).toContain('got=Blocked by policy: parsing is off today');
    expect(res.toolCalls).toEqual([expect.objectContaining({ source: 'sua', toolId: 'json-parse', isError: true, resultPreview: 'Blocked by policy: parsing is off today' })]);
  });

  it('removes the config file (it holds the bearer token) once the attempt ends', async () => {
    const node: AgentNode = { id: 'parse', type: 'llm-prompt', prompt: 'x', tools: ['json-parse'] };
    const res = await spawnNodeReal(node, env(), opts(['claude']));
    const configPath = /--mcp-config (\S+)/.exec(res.result)?.[1];
    expect(configPath).toBeTruthy();
    expect(existsSync(configPath!)).toBe(false);
  });

  it('keeps node allowedTools (claude\'s own tools) alongside sua\'s endpoint', async () => {
    const res = await spawnNodeReal({ id: 'p', type: 'llm-prompt', prompt: 'x', tools: ['json-parse'], allowedTools: ['Read'] }, env(), opts(['claude']));
    expect(res.result).toContain('--allowedTools Read,mcp__sua');
  });

  it('surfaces a refused tool call as a warning on an otherwise successful node', async () => {
    const res = await spawnNodeReal({ id: 'p', type: 'llm-prompt', prompt: 'x', tools: ['json-parse'] }, env(), opts(['claude']));
    expect(res.exitCode).toBe(0);
    expect(res.error).toContain('claude was blocked from using Bash');
  });

  it('leaves nodes without tools: alone (no endpoint, no --allowedTools)', async () => {
    const res = await spawnNodeReal({ id: 'plain', type: 'llm-prompt', prompt: 'hi' }, env(), opts(['claude']));
    expect(res.exitCode).toBe(0);
    expect(res.result).not.toContain('--allowedTools');
    expect(res.result).not.toContain('--mcp-config');
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
