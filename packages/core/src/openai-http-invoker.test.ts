/**
 * invokeOpenAiChat maps an OpenAI-compatible HTTP call to a SpawnResult whose
 * error strings/categories the node-spawner waterfall already understands, so
 * an HTTP provider participates in fallback exactly like a CLI one.
 */
import { describe, it, expect } from 'vitest';
import { invokeOpenAiChat } from './openai-http-invoker.js';
import { classifyLlmFailure } from './node-spawner.js';

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
});
