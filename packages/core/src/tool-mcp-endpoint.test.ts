import { describe, it, expect, afterEach } from 'vitest';
import { request } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startToolEndpoint, type ToolEndpoint } from './tool-mcp-endpoint.js';
import type { OpenAiTool } from './llm-tools.js';

const echo: OpenAiTool = {
  type: 'function',
  function: {
    name: 'echo-upper',
    description: 'Upper-case some text.',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
  },
};

let endpoint: ToolEndpoint | undefined;
afterEach(async () => { await endpoint?.close(); endpoint = undefined; });

async function connect(ep: ToolEndpoint, token = ep.token): Promise<Client> {
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(ep.url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  return client;
}

/** Raw POST so we control the Host header (fetch won't let us spoof it). */
function rawPost(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
  });
}

describe('startToolEndpoint', () => {
  it('lists the tools and dispatches calls through the given executor', async () => {
    const seen: Array<[string, string]> = [];
    endpoint = await startToolEndpoint({
      tools: [echo],
      execute: async (name, argsJson) => {
        seen.push([name, argsJson]);
        return { content: String(JSON.parse(argsJson).text).toUpperCase() };
      },
    });
    expect(endpoint.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);

    const client = await connect(endpoint);
    const { tools } = await client.listTools();
    expect(tools.map((t) => [t.name, t.description])).toEqual([['echo-upper', 'Upper-case some text.']]);
    const res = await client.callTool({ name: 'echo-upper', arguments: { text: 'hi' } });
    expect(res.content).toEqual([{ type: 'text', text: 'HI' }]);
    expect(res.isError).toBeFalsy();
    expect(seen).toEqual([['echo-upper', '{"text":"hi"}']]);
    await client.close();
  });

  it('passes executor errors back as MCP tool errors the model can read', async () => {
    endpoint = await startToolEndpoint({ tools: [echo], execute: async () => ({ content: 'Blocked by policy: nope', isError: true }) });
    const client = await connect(endpoint);
    const res = await client.callTool({ name: 'echo-upper', arguments: { text: 'x' } });
    expect(res.isError).toBe(true);
    expect(res.content).toEqual([{ type: 'text', text: 'Blocked by policy: nope' }]);
    await client.close();
  });

  it('rejects a missing or wrong bearer token', async () => {
    endpoint = await startToolEndpoint({ tools: [echo], execute: async () => ({ content: '' }) });
    const accept = { accept: 'application/json, text/event-stream' };
    expect(await rawPost(endpoint.url, accept)).toBe(401);
    expect(await rawPost(endpoint.url, { ...accept, authorization: 'Bearer nope' })).toBe(401);
    await expect(connect(endpoint, 'nope')).rejects.toThrow();
  });

  it('rejects a non-loopback Host (DNS rebinding) even with the right token', async () => {
    endpoint = await startToolEndpoint({ tools: [echo], execute: async () => ({ content: '' }) });
    const status = await rawPost(endpoint.url, {
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${endpoint.token}`,
      host: 'evil.example:80',
    });
    expect(status).toBe(403);
  });

  it('uses a fresh token per endpoint and stops listening on close', async () => {
    const a = await startToolEndpoint({ tools: [echo], execute: async () => ({ content: '' }) });
    const b = await startToolEndpoint({ tools: [echo], execute: async () => ({ content: '' }) });
    expect(a.token).not.toBe(b.token);
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
    await b.close();
    await a.close();
    await expect(rawPost(a.url, { authorization: `Bearer ${a.token}` })).rejects.toThrow();
  });
});
