import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { AgentStore, AgentYamlParseError } from '@some-useful-agents/core';
import { runAgentInstall, collectDeclaredSecrets } from './agent-install.js';

const VALID_YAML = `
id: weekly-digest
name: weekly-digest
status: active
source: community
mcp: false
nodes:
  - id: fetch
    type: shell
    command: echo hi
`.trimStart();

const VALID_WITH_INPUTS = `
id: weather
name: weather
status: active
source: community
mcp: false
inputs:
  ZIP:
    type: string
nodes:
  - id: call
    type: shell
    command: echo "$ZIP"
    secrets:
      - WEATHER_KEY
`.trimStart();

function makeStore(): AgentStore {
  const db = new DatabaseSync(':memory:');
  return AgentStore.fromHandle(db);
}

function makeFetch(body: string, status = 200): typeof fetch {
  return (async () => {
    const buf = Buffer.from(body, 'utf-8');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(buf);
        controller.close();
      },
    });
    return new Response(stream, { status, headers: new Headers() });
  }) as unknown as typeof fetch;
}

describe('runAgentInstall', () => {
  let store: AgentStore;

  beforeEach(() => {
    store = makeStore();
  });

  it('happy path: fetches, parses, and upserts a new agent as source=local', async () => {
    const result = await runAgentInstall({
      url: 'https://example.com/weekly-digest.yaml',
      agentStore: store,
      fetchImpl: makeFetch(VALID_YAML),
      skipSafeUrlCheck: true,
    });
    expect(result.upgraded).toBe(false);
    expect(result.confirmed).toBe(true);
    expect(result.agent.id).toBe('weekly-digest');
    // Installer overrides source even though YAML said 'community'.
    expect(result.agent.source).toBe('local');
    // Persisted in the store.
    const stored = store.getAgent('weekly-digest');
    expect(stored?.source).toBe('local');
  });

  it('id collision: prompts to confirm; aborts when user says no', async () => {
    await runAgentInstall({
      url: 'https://example.com/x.yaml',
      agentStore: store,
      fetchImpl: makeFetch(VALID_YAML),
      skipSafeUrlCheck: true,
    });
    // Second install hits collision.
    const result = await runAgentInstall({
      url: 'https://example.com/x.yaml',
      agentStore: store,
      fetchImpl: makeFetch(VALID_YAML),
      confirm: async () => false,
      skipSafeUrlCheck: true,
    });
    expect(result.confirmed).toBe(false);
    expect(result.upgraded).toBe(false);
  });

  it('id collision: --force skips the prompt and overwrites', async () => {
    await runAgentInstall({
      url: 'https://example.com/x.yaml',
      agentStore: store,
      fetchImpl: makeFetch(VALID_YAML),
      skipSafeUrlCheck: true,
    });
    const result = await runAgentInstall({
      url: 'https://example.com/x.yaml',
      agentStore: store,
      fetchImpl: makeFetch(VALID_YAML),
      force: true,
      skipSafeUrlCheck: true,
    });
    expect(result.upgraded).toBe(true);
    expect(result.confirmed).toBe(true);
  });

  it('id collision: --yes without --force refuses to overwrite', async () => {
    await runAgentInstall({
      url: 'https://example.com/x.yaml',
      agentStore: store,
      fetchImpl: makeFetch(VALID_YAML),
      skipSafeUrlCheck: true,
    });
    await expect(
      runAgentInstall({
        url: 'https://example.com/x.yaml',
        agentStore: store,
        fetchImpl: makeFetch(VALID_YAML),
        yes: true,
        skipSafeUrlCheck: true,
      }),
    ).rejects.toThrow(/already exists/);
  });

  it('rejects YAML that fails schema validation', async () => {
    const bad = 'id: 123\nstatus: active\nnodes: []\n'; // missing required fields
    await expect(
      runAgentInstall({
        url: 'https://example.com/bad.yaml',
        agentStore: store,
        fetchImpl: makeFetch(bad),
        skipSafeUrlCheck: true,
      }),
    ).rejects.toBeInstanceOf(AgentYamlParseError);
  });

  it('rejects URLs that resolve to private IPs (SSRF guard)', async () => {
    // Pass a URL that assertSafeUrl should reject. localhost resolves to 127.0.0.1.
    await expect(
      runAgentInstall({
        url: 'http://localhost:1/agent.yaml',
        agentStore: store,
        fetchImpl: makeFetch(VALID_YAML),
      }),
    ).rejects.toThrow(/private|reserved|loopback/i);
  });

  it('collects declared secrets across nodes', async () => {
    const result = await runAgentInstall({
      url: 'https://example.com/weather.yaml',
      agentStore: store,
      fetchImpl: makeFetch(VALID_WITH_INPUTS),
      skipSafeUrlCheck: true,
    });
    expect(collectDeclaredSecrets(result.agent)).toEqual(['WEATHER_KEY']);
  });

  it('normalizes a github /blob/ URL via fetchImpl recording the requested URL', async () => {
    let requestedUrl = '';
    const f = (async (url: string) => {
      requestedUrl = url;
      return new Response(VALID_YAML, { status: 200 });
    }) as unknown as typeof fetch;
    await runAgentInstall({
      url: 'https://github.com/some-org/sua-agents/blob/main/weekly-digest.yaml',
      agentStore: store,
      fetchImpl: f,
      skipSafeUrlCheck: true,
    });
    expect(requestedUrl).toBe(
      'https://raw.githubusercontent.com/some-org/sua-agents/main/weekly-digest.yaml',
    );
  });
});
