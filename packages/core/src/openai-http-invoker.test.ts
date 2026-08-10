/**
 * invokeOpenAiChat maps an OpenAI-compatible HTTP call to a SpawnResult whose
 * error strings/categories the node-spawner waterfall already understands, so
 * an HTTP provider participates in fallback exactly like a CLI one.
 */
import { describe, it, expect } from 'vitest';
import { invokeOpenAiChat } from './openai-http-invoker.js';
import { classifyLlmFailure, type SpawnProgress } from './node-spawner.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const base = { apiBase: 'http://127.0.0.1:8181/v1', model: 'qwen', prompt: 'hi', timeoutSec: 5 };

describe('invokeOpenAiChat', () => {
  it('returns the assistant content on a 200', async () => {
    const fetchImpl = (async () => jsonResponse(200, { choices: [{ message: { content: 'pong' } }] })) as unknown as typeof fetch;
    const r = await invokeOpenAiChat({ ...base, fetchImpl });
    expect(r.exitCode).toBe(0);
    expect(r.result).toBe('pong');
  });

  it('sends the model + prompt and a Bearer header only when apiKey is set', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(200, { choices: [{ message: { content: 'ok' } }] });
    }) as unknown as typeof fetch;

    await invokeOpenAiChat({ ...base, apiKey: 'secret', fetchImpl });
    const withKey = calls[0];
    expect(withKey.url).toBe('http://127.0.0.1:8181/v1/chat/completions');
    expect((withKey.init.headers as Record<string, string>).authorization).toBe('Bearer secret');
    expect(JSON.parse(withKey.init.body as string)).toMatchObject({ model: 'qwen', stream: false });

    await invokeOpenAiChat({ ...base, fetchImpl });
    expect((calls[1].init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('classifies a 401 as auth_required (fallback-worthy)', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 401, statusText: 'Unauthorized' })) as unknown as typeof fetch;
    const r = await invokeOpenAiChat({ ...base, fetchImpl });
    expect(r.exitCode).not.toBe(0);
    expect(classifyLlmFailure(r)).toBe('auth_required');
  });

  it('classifies a 429 as rate_limited', async () => {
    const fetchImpl = (async () => new Response('slow down', { status: 429, statusText: 'Too Many Requests' })) as unknown as typeof fetch;
    const r = await invokeOpenAiChat({ ...base, fetchImpl });
    expect(classifyLlmFailure(r)).toBe('rate_limited');
  });

  it('maps a network failure (endpoint down) to spawn_failure ⇒ binary_missing', async () => {
    const fetchImpl = (async () => { throw new Error('fetch failed: ECONNREFUSED'); }) as unknown as typeof fetch;
    const r = await invokeOpenAiChat({ ...base, fetchImpl });
    expect(r.category).toBe('spawn_failure');
    expect(classifyLlmFailure(r)).toBe('binary_missing');
  });

  it('reports a timeout category when the request aborts', async () => {
    const fetchImpl = ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      const sig = init.signal as AbortSignal;
      sig.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch;
    const r = await invokeOpenAiChat({ ...base, timeoutSec: 1, fetchImpl });
    expect(r.category).toBe('timeout');
    expect(classifyLlmFailure(r)).toBe('timeout');
  });

  it('treats empty/malformed choices as a non-zero result', async () => {
    const fetchImpl = (async () => jsonResponse(200, { choices: [] })) as unknown as typeof fetch;
    const r = await invokeOpenAiChat({ ...base, fetchImpl });
    expect(r.exitCode).not.toBe(0);
    expect(r.error).toMatch(/no message content/);
  });

  it('does NOT send a tools array when no tools are provided (back-compat)', async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return jsonResponse(200, { choices: [{ message: { content: 'plain' } }] });
    }) as unknown as typeof fetch;
    const r = await invokeOpenAiChat({ ...base, fetchImpl });
    expect(r.result).toBe('plain');
    expect('tools' in body).toBe(false);
  });

  describe('tool loop', () => {
    const tools = [{ type: 'function' as const, function: { name: 'web-scrape', parameters: { type: 'object' as const, properties: {}, required: [], additionalProperties: false } } }];

    it('runs a tool_call, feeds the result back, and returns the final answer', async () => {
      const seenToolArgs: string[] = [];
      let post = 0;
      const bodies: Array<Record<string, unknown>> = [];
      const fetchImpl = (async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        post++;
        if (post === 1) {
          // First response: model asks to call web-scrape.
          return jsonResponse(200, { choices: [{ message: { role: 'assistant', content: '', tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'web-scrape', arguments: '{"url":"https://x.test"}' } },
          ] } }] });
        }
        // Second response: model produces the final answer.
        return jsonResponse(200, { choices: [{ message: { role: 'assistant', content: 'DONE' } }] });
      }) as unknown as typeof fetch;

      const onToolCall = async (name: string, argsJson: string) => {
        seenToolArgs.push(`${name}:${argsJson}`);
        return { content: '{"json_ld":[]}' };
      };

      const r = await invokeOpenAiChat({ ...base, fetchImpl, tools, onToolCall, maxTurns: 5 });
      expect(r.exitCode).toBe(0);
      expect(r.result).toBe('DONE');
      expect(seenToolArgs).toEqual(['web-scrape:{"url":"https://x.test"}']);
      // Second request carried the tools + the tool result message.
      expect(bodies[0].tools).toBeDefined();
      const msgs = bodies[1].messages as Array<Record<string, unknown>>;
      expect(msgs.some((m) => m.role === 'tool' && m.content === '{"json_ld":[]}')).toBe(true);
    });

    it('emits tool_use progress events (call + result) so the run record shows the round-trip', async () => {
      let post = 0;
      const fetchImpl = (async () => {
        post++;
        if (post === 1) {
          return jsonResponse(200, { choices: [{ message: { role: 'assistant', content: '', tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'http-get', arguments: '{"url":"https://wttr.in"}' } },
          ] } }] });
        }
        return jsonResponse(200, { choices: [{ message: { role: 'assistant', content: '65F' } }] });
      }) as unknown as typeof fetch;
      const onToolCall = async () => ({ content: 'temp_F:65 humidity:70' });

      const events: SpawnProgress[] = [];
      await invokeOpenAiChat({ ...base, fetchImpl, tools, onToolCall, maxTurns: 5, onProgress: (e) => events.push(e) });

      const toolEvents = events.filter((e) => e.type === 'tool_use');
      expect(toolEvents).toHaveLength(2);
      expect(toolEvents[0]).toMatchObject({ toolStatus: 'call', toolName: 'http-get' });
      expect(String(toolEvents[0].preview)).toContain('wttr.in');
      expect(toolEvents[1]).toMatchObject({ toolStatus: 'result', toolName: 'http-get', isError: false });
      expect(String(toolEvents[1].preview)).toContain('humidity:70');
    });

    it('marks a tool error in the result progress event', async () => {
      const fetchImpl = (async () => jsonResponse(200, { choices: [{ message: { role: 'assistant', content: '', tool_calls: [
        { id: 'c', type: 'function', function: { name: 'http-get', arguments: '{}' } },
      ] } }] })) as unknown as typeof fetch;
      const onToolCall = async () => ({ content: 'boom', isError: true });
      const events: SpawnProgress[] = [];
      await invokeOpenAiChat({ ...base, fetchImpl, tools, onToolCall, maxTurns: 1, onProgress: (e) => events.push(e) });
      const result = events.find((e) => e.type === 'tool_use' && e.toolStatus === 'result');
      expect(result).toMatchObject({ isError: true });
    });

    it('stops at maxTurns if the model keeps calling tools', async () => {
      const fetchImpl = (async () => jsonResponse(200, { choices: [{ message: { role: 'assistant', content: 'thinking', tool_calls: [
        { id: 'c', type: 'function', function: { name: 'web-scrape', arguments: '{}' } },
      ] } }] })) as unknown as typeof fetch;
      const onToolCall = async () => ({ content: 'x' });
      const r = await invokeOpenAiChat({ ...base, fetchImpl, tools, onToolCall, maxTurns: 2 });
      // Never got a final (no-tool) answer; returns last text content, exit 0.
      expect(r.result).toBe('thinking');
    });
  });
});
