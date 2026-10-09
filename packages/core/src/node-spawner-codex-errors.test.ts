import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyLlmFailure, codexFailureMessage, codexFinishedTurn, shouldFallback, spawnNodeReal } from './node-spawner.js';

// Regression: codex pinned to a model the account no longer supports failed
// every call with a 400 in its `turn.failed` event, while stderr carried an
// unrelated MCP server's auth error. sua classified it from stderr as
// auth_required; without that noise it was `other`, which stops the waterfall.

const API_ERROR = JSON.stringify({
  type: 'error',
  status: 400,
  error: { type: 'invalid_request_error', message: "The 'gpt-5.4' model is not supported when using Codex with a ChatGPT account." },
});
const CODEX_STDOUT = [
  JSON.stringify({ type: 'thread.started', thread_id: 't' }),
  JSON.stringify({ type: 'turn.started' }),
  JSON.stringify({ type: 'error', message: API_ERROR }),
  JSON.stringify({ type: 'turn.failed', error: { message: API_ERROR } }),
].join('\n');
const MCP_NOISE = 'ERROR rmcp::transport::worker: worker quit with fatal: AuthRequired(AuthRequiredError { error="invalid_token", error_description="Missing or invalid access token" }) 401 Unauthorized';

describe('codexFailureMessage', () => {
  it('unwraps the API error inside turn.failed', () => {
    expect(codexFailureMessage(CODEX_STDOUT)).toBe(
      "400 invalid_request_error: The 'gpt-5.4' model is not supported when using Codex with a ChatGPT account.",
    );
  });

  it('returns a plain-text message as-is, and undefined when nothing failed', () => {
    expect(codexFailureMessage(JSON.stringify({ type: 'turn.failed', error: { message: 'stream disconnected' } })))
      .toBe('stream disconnected');
    expect(codexFailureMessage(JSON.stringify({ type: 'turn.completed', usage: {} }))).toBeUndefined();
    expect(codexFailureMessage('not json')).toBeUndefined();
  });
});

describe('model_unavailable', () => {
  it('classifies a rejected model and falls back on it', () => {
    const category = classifyLlmFailure({ result: '', exitCode: 1, error: codexFailureMessage(CODEX_STDOUT) });
    expect(category).toBe('model_unavailable');
    expect(shouldFallback('model_unavailable')).toBe(true);
  });

  it('matches other providers\' wording too', () => {
    expect(classifyLlmFailure({ result: '', exitCode: 1, error: 'Error code: 404 - model_not_found' })).toBe('model_unavailable');
    expect(classifyLlmFailure({ result: '', exitCode: 1, error: "The model `gpt-9` does not exist or you do not have access to it." })).toBe('model_unavailable');
  });
});

describe('codex failure through the waterfall', () => {
  let binDir: string;

  beforeAll(() => {
    binDir = mkdtempSync(join(tmpdir(), 'sua-fake-codex-'));
    writeFileSync(join(binDir, 'codex-stdout.jsonl'), CODEX_STDOUT + '\n');
    writeFileSync(join(binDir, 'codex'), [
      '#!/bin/sh',
      'cat >/dev/null',
      `cat "${join(binDir, 'codex-stdout.jsonl')}"`,
      `echo '${MCP_NOISE}' >&2`,
      'exit 1',
    ].join('\n'));
    writeFileSync(join(binDir, 'claude'), [
      '#!/bin/sh',
      'cat >/dev/null',
      'echo \'{"type":"result","subtype":"success","result":"answered by claude"}\'',
    ].join('\n'));
    chmodSync(join(binDir, 'codex'), 0o755);
    chmodSync(join(binDir, 'claude'), 0o755);
  });

  afterAll(() => rmSync(binDir, { recursive: true, force: true }));

  it('records the real reason and falls through to the next provider', async () => {
    const res = await spawnNodeReal(
      { id: 'judge', type: 'llm-prompt', prompt: 'hi' },
      { PATH: `${binDir}:${process.env.PATH ?? ''}` },
      { agentId: 'starter-watch', agentSource: 'examples', llmSettings: { providers: ['codex', 'claude'] } },
    );
    expect(res.exitCode).toBe(0);
    expect(res.result).toBe('answered by claude');
    expect(res.usedLLMProvider).toBe('claude');
    const [codexFailure] = res.providerFailures ?? [];
    expect(codexFailure.category).toBe('model_unavailable');
    expect(codexFailure.error).toContain("'gpt-5.4' model is not supported");
    expect(codexFailure.error).not.toContain('rmcp');
  });
});

describe('auth_required — claude CLI wording', () => {
  it('classifies claude\'s "Not logged in" as auth_required (fallback-worthy), not other', () => {
    const category = classifyLlmFailure({ result: 'Not logged in · Please run /login', exitCode: 1, error: 'Process exited with code 1' });
    expect(category).toBe('auth_required');
    expect(shouldFallback(category)).toBe(true);
  });
});

// Regression: codex sometimes exits 1 after it has finished its turn and
// given its answer, with nothing but its "Reading prompt from stdin..."
// banner on stderr. The node failed with that banner as its "reason", and a
// good answer was thrown away (starter-research gather-counter).
describe('codex exits non-zero after finishing its answer', () => {
  let binDir: string;
  const ANSWER = 'Home Depot: WELLFOR 24 in. cabinet, $100, towel bar.';
  const finished = [
    JSON.stringify({ type: 'thread.started', thread_id: 't' }),
    JSON.stringify({ type: 'turn.started' }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: ANSWER } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } }),
  ].join('\n');
  const unfinished = [JSON.stringify({ type: 'thread.started', thread_id: 't' }), JSON.stringify({ type: 'turn.started' })].join('\n');
  const fake = (name: string, stdout: string) => {
    writeFileSync(join(binDir, `${name}.jsonl`), `${stdout}\n`);
    mkdirSync(join(binDir, name), { recursive: true });
    writeFileSync(join(binDir, name, 'codex'), ['#!/bin/sh', 'cat >/dev/null', 'echo "Reading prompt from stdin..." >&2', `cat "${join(binDir, `${name}.jsonl`)}"`, 'exit 1'].join('\n'));
    chmodSync(join(binDir, name, 'codex'), 0o755);
    return join(binDir, name);
  };
  const run = (dir: string) => spawnNodeReal(
    { id: 'gather', type: 'llm-prompt', prompt: 'hi' },
    { PATH: `${dir}:${process.env.PATH ?? ''}` },
    { agentId: 'starter-research', agentSource: 'examples', llmSettings: { providers: ['codex'] } },
  );

  beforeAll(() => { binDir = mkdtempSync(join(tmpdir(), 'sua-fake-codex-exit-')); });
  afterAll(() => rmSync(binDir, { recursive: true, force: true }));

  it('keeps the answer and says what happened', async () => {
    expect(codexFinishedTurn(finished)).toBe(true);
    const res = await run(fake('finished', finished));
    expect(res.exitCode).toBe(0);
    expect(res.result).toBe(ANSWER);
    expect(res.error).toBe('codex exited with code 1 after finishing its answer, without reporting an error. The answer was kept.');
  });

  it("still fails when it didn't finish, and doesn't call its banner the reason", async () => {
    expect(codexFinishedTurn(unfinished)).toBe(false);
    expect(codexFinishedTurn(`${finished}\n${JSON.stringify({ type: 'error', message: 'boom' })}`)).toBe(false);
    const res = await run(fake('unfinished', unfinished));
    expect(res.exitCode).not.toBe(0);
    const err = res.providerFailures?.[0]?.error ?? res.error ?? '';
    expect(err).not.toContain('Reading prompt from stdin');
    expect(err).toContain('codex exited with code 1 without saying why');
  });
});
