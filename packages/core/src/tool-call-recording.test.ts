import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { buildToolExecutor } from './llm-tool-dispatch.js';
import { claudeToolCalls, spawnNodeReal } from './node-spawner.js';
import { RunStore } from './run-store.js';
import type { ToolCallRecord } from './tool-call-record.js';

// Phase A / A2: every tool call a model makes is recorded, whichever provider
// made it, so a run can answer "what did the agent actually do".

describe('buildToolExecutor onCall', () => {
  const recorded: ToolCallRecord[] = [];
  const exec = buildToolExecutor({
    exposedToolIds: ['json-parse'],
    agentId: 'a', agentSource: 'local',
    onCall: (r) => recorded.push(r),
  });

  it('records a successful call with the real tool id, args, result and timing', async () => {
    recorded.length = 0;
    const res = await exec('json-parse', JSON.stringify({ text: '{"x":1}' }));
    expect(res.isError).toBeFalsy();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ source: 'sua', toolId: 'json-parse', isError: false });
    expect(recorded[0].argsJson).toContain('{\\"x\\":1}');
    expect(recorded[0].resultChars).toBeGreaterThan(0);
    expect(recorded[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(recorded[0].startedAt).toMatch(/^\d{4}-/);
  });

  it('records calls refused before dispatch (unknown tool, bad JSON) as errors', async () => {
    recorded.length = 0;
    await exec('shell-exec', '{"command":"rm -rf /"}');
    await exec('json-parse', '{not json');
    expect(recorded.map((r) => [r.toolId, r.isError])).toEqual([['shell-exec', true], ['json-parse', true]]);
    expect(recorded[0].resultPreview).toContain('is not available');
  });

  it('never lets a throwing recorder affect the call', async () => {
    const noisy = buildToolExecutor({
      exposedToolIds: ['json-parse'], agentId: 'a', agentSource: 'local',
      onCall: () => { throw new Error('disk full'); },
    });
    const res = await noisy('json-parse', JSON.stringify({ text: '[1]' }));
    expect(res.isError).toBeFalsy();
  });
});

describe('claudeToolCalls', () => {
  const line = (o: unknown) => JSON.stringify(o);

  it('pairs tool_use with tool_result by id, handling string and block content', () => {
    const stdout = [
      line({ type: 'assistant', message: { content: [
        { type: 'text', text: 'let me look' },
        { type: 'tool_use', id: 't1', name: 'WebFetch', input: { url: 'https://example.com' } },
      ] } }),
      line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Example Domain' }] } }),
      line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'ls' } }] } }),
      line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: [{ type: 'text', text: 'denied' }] }] } }),
      line({ type: 'result', result: 'done' }),
    ].join('\n');
    const calls = claudeToolCalls(stdout);
    expect(calls.map((c) => [c.source, c.toolId, c.resultPreview, c.isError])).toEqual([
      ['native', 'WebFetch', 'Example Domain', false],
      ['native', 'Bash', 'denied', true],
    ]);
    expect(calls[0].argsJson).toBe('{"url":"https://example.com"}');
  });

  it('keeps a call that never got a result, marked as an error', () => {
    const calls = claudeToolCalls(line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name: 'Read', input: {} }] } }));
    expect(calls).toHaveLength(1);
    expect(calls[0].isError).toBe(true);
    expect(calls[0].resultPreview).toMatch(/no result/);
  });

  it('returns [] for output with no tool use', () => {
    expect(claudeToolCalls('not json\n{"type":"result","result":"x"}')).toEqual([]);
  });
});

describe('spawnNodeReal returns the trace', () => {
  let binDir: string;
  let server: Server;
  let apiBase: string;

  beforeAll(async () => {
    binDir = mkdtempSync(join(tmpdir(), 'sua-trace-'));
    writeFileSync(join(binDir, 'claude'), [
      '#!/bin/sh',
      'cat >/dev/null',
      `echo '${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'WebFetch', input: { url: 'https://example.com' } }] } })}'`,
      `echo '${JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Example Domain' }] } })}'`,
      `echo '${JSON.stringify({ type: 'result', subtype: 'success', result: 'fetched' })}'`,
    ].join('\n'));
    chmodSync(join(binDir, 'claude'), 0o755);

    // Fake OpenAI-compatible endpoint: first turn asks for json-parse, second answers.
    let turn = 0;
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        turn += 1;
        const message = turn === 1
          ? { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'json-parse', arguments: '{"text":"[1,2]"}' } }] }
          : { role: 'assistant', content: 'parsed it' };
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message, finish_reason: turn === 1 ? 'tool_calls' : 'stop' }] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    apiBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });

  afterAll(() => {
    rmSync(binDir, { recursive: true, force: true });
    server.close();
  });

  it('records sua tool calls from the HTTP tool loop, stamped with the provider', async () => {
    const res = await spawnNodeReal(
      { id: 'n', type: 'llm-prompt', prompt: 'parse [1,2]', tools: ['json-parse'] },
      {},
      {
        agentId: 'a', agentSource: 'local',
        llmSettings: { providers: ['fake-local'], customProviders: [{ name: 'fake-local', kind: 'openai', apiBase, model: 'm' }] },
      },
    );
    expect(res.exitCode).toBe(0);
    expect(res.toolCalls).toEqual([expect.objectContaining({ seq: 0, provider: 'fake-local', source: 'sua', toolId: 'json-parse', isError: false })]);
  });

  it('records claude\'s native tool calls from its event stream', async () => {
    const res = await spawnNodeReal(
      { id: 'n', type: 'llm-prompt', prompt: 'hi' },
      { PATH: `${binDir}:${process.env.PATH ?? ''}` },
      { agentId: 'a', agentSource: 'local', llmSettings: { providers: ['claude'] } },
    );
    expect(res.toolCalls).toEqual([expect.objectContaining({ seq: 0, provider: 'claude', source: 'native', toolId: 'WebFetch', resultPreview: 'Example Domain' })]);
  });

  it('leaves toolCalls unset when nothing was called', async () => {
    const res = await spawnNodeReal({ id: 's', type: 'shell', command: 'true' }, { PATH: process.env.PATH ?? '' }, { agentId: 'a', agentSource: 'local' });
    expect(res.toolCalls).toBeUndefined();
  });
});

describe('RunStore tool_calls', () => {
  let dir: string;
  let store: RunStore;
  const call = (toolId: string, extra: Partial<ToolCallRecord> = {}): ToolCallRecord => ({
    source: 'sua', toolId, argsJson: '{}', resultPreview: 'ok', resultChars: 2, isError: false, ...extra,
  });

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'sua-toolcalls-db-'));
    store = new RunStore(join(dir, 'runs.db'));
  });
  afterAll(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

  it('stores, lists by node in order, and replaces a node\'s calls on re-execution', () => {
    store.createRun({ id: 'r1', agentName: 'a', status: 'running', startedAt: new Date().toISOString(), triggeredBy: 'cli' });
    store.replaceToolCalls('r1', 'fetch', [call('web-fetch', { provider: 'claude', durationMs: 12 }), call('json-parse', { isError: true })]);
    store.replaceToolCalls('r1', 'judge', [call('template')]);
    let byNode = store.listToolCalls('r1');
    expect(byNode.get('fetch')?.map((c) => [c.seq, c.toolId, c.isError, c.provider, c.durationMs]))
      .toEqual([[0, 'web-fetch', false, 'claude', 12], [1, 'json-parse', true, undefined, undefined]]);

    store.replaceToolCalls('r1', 'fetch', [call('http-get')]);
    byNode = store.listToolCalls('r1');
    expect(byNode.get('fetch')?.map((c) => c.toolId)).toEqual(['http-get']);
    expect(byNode.get('judge')?.map((c) => c.toolId)).toEqual(['template']);
  });

  it('retention removes the tool calls of expired runs (no FK cascade on this connection)', () => {
    store.createRun({ id: 'old', agentName: 'a', status: 'completed', startedAt: '2020-01-01T00:00:00.000Z', triggeredBy: 'cli' });
    store.replaceToolCalls('old', 'n', [call('web-fetch')]);
    store.sweepExpired(30);
    expect(store.listToolCalls('old').size).toBe(0);
    expect(store.listToolCalls('r1').size).toBe(2);
  });
});
