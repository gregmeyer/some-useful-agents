import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Provider, Run, RunRequest } from '@some-useful-agents/core';
import { startMcpServer } from './index.js';

/**
 * Regression test for the "Already connected to a transport" crash.
 *
 * Pre-fix, the MCP server reused a single McpServer instance across all
 * sessions and called `server.connect(transport)` once per new session.
 * The MCP SDK rejects the second connect — uncaught, the error surfaced as
 * an HTTP parser exception and crashed the process. Two consecutive
 * `initialize` POSTs from independent clients reproduce it.
 */
describe('MCP server multi-session', () => {
  let dataDir: string;
  let tokenPath: string;
  let secretsPath: string;
  // Bound port populated from `serverHandle.port` after startMcpServer
  // returns. We pass `port: 0` so the OS picks an available port — this
  // eliminates the collision class that came from `Math.random()` against
  // a narrow pool, which surfaced as `UND_ERR_SOCKET` flakes in CI when a
  // prior test's half-torn-down connection lingered.
  let port: number;
  let serverHandle: { port: number; shutdown: () => Promise<void> } | undefined;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sua-mcp-multi-'));
    tokenPath = join(dataDir, 'mcp-token');
    writeFileSync(tokenPath, 't'.repeat(64));
    chmodSync(tokenPath, 0o600);
    secretsPath = join(dataDir, 'secrets.enc');
    port = 0; // populated from serverHandle.port once the server boots
  });

  afterEach(async () => {
    if (serverHandle) {
      await serverHandle.shutdown();
      serverHandle = undefined;
    }
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('serves two independent initialize requests without crashing', async () => {
    serverHandle = await startMcpServer({
      port: 0,
      host: '127.0.0.1',
      agentDirs: [dataDir], // empty dir — agent loader returns no agents
      dbPath: join(dataDir, 'runs.db'),
      secretsPath,
      tokenPath,
    });
    port = serverHandle.port;

    const token = 't'.repeat(64);
    const init = {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      },
      id: 1,
    };

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };

    // Session 1.
    const r1 = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify(init),
    });
    expect(r1.status).toBe(200);
    const sid1 = r1.headers.get('mcp-session-id');
    expect(sid1).toBeTruthy();

    // Session 2 — the one that crashed pre-fix.
    const r2 = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify(init),
    });
    expect(r2.status).toBe(200);
    const sid2 = r2.headers.get('mcp-session-id');
    expect(sid2).toBeTruthy();
    expect(sid2).not.toBe(sid1);

    // Server still alive — health reports both sessions.
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(health.status).toBe(200);
    const body = (await health.json()) as { status: string; sessions: number };
    expect(body.status).toBe('ok');
    expect(body.sessions).toBe(2);
  });
});

/**
 * Phase A of Temporal wiring: the CLI builds the provider (via createProvider)
 * and injects it. An injected provider arrives already initialized, so the
 * server must NOT re-initialize it — re-initializing a TemporalProvider would
 * open a second client connection. Verify the injected provider is the one the
 * server uses and that initialize() is not called on it.
 */
describe('MCP server provider injection', () => {
  let dataDir: string;
  let tokenPath: string;
  let secretsPath: string;
  let serverHandle: { port: number; shutdown: () => Promise<void> } | undefined;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sua-mcp-prov-'));
    tokenPath = join(dataDir, 'mcp-token');
    writeFileSync(tokenPath, 't'.repeat(64));
    chmodSync(tokenPath, 0o600);
    secretsPath = join(dataDir, 'secrets.enc');
  });

  afterEach(async () => {
    if (serverHandle) {
      await serverHandle.shutdown();
      serverHandle = undefined;
    }
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('uses an injected provider without re-initializing it', async () => {
    let initializeCalls = 0;
    let shutdownCalls = 0;
    const injected: Provider = {
      name: 'stub',
      async initialize() { initializeCalls++; },
      async shutdown() { shutdownCalls++; },
      async submitRun(_req: RunRequest): Promise<Run> {
        return { id: 'stub-run', agentName: 'x', status: 'completed', startedAt: '2026-01-01T00:00:00Z', triggeredBy: 'mcp' };
      },
      async getRun(): Promise<Run | null> { return null; },
      async listRuns(): Promise<Run[]> { return []; },
      async cancelRun(): Promise<void> {},
      async getRunLogs(): Promise<string> { return ''; },
    };

    serverHandle = await startMcpServer({
      port: 0,
      host: '127.0.0.1',
      agentDirs: [dataDir],
      dbPath: join(dataDir, 'runs.db'),
      secretsPath,
      tokenPath,
      provider: injected,
    });

    // Server booted on the injected provider; the CLI already initialized it,
    // so the server left it alone.
    expect(initializeCalls).toBe(0);
    const health = await fetch(`http://127.0.0.1:${serverHandle.port}/health`);
    expect(health.status).toBe(200);

    await serverHandle.shutdown();
    serverHandle = undefined;
    // The server owns teardown of whatever provider it was handed.
    expect(shutdownCalls).toBe(1);
  });
});

/**
 * End-to-end exercise of `run-agent` with inputs. Uses the official MCP
 * client + StreamableHTTP transport to drive the protocol so the test is
 * close to what Claude Desktop / Cursor / claude mcp does at runtime.
 */
describe('MCP run-agent with inputs', () => {
  let dataDir: string;
  let agentDir: string;
  let tokenPath: string;
  let secretsPath: string;
  // Populated from serverHandle.port after startMcpServer returns. Each
  // test passes `port: 0` so the OS picks a guaranteed-unique port —
  // see the note in the first describe block.
  let port: number;
  let serverHandle: { port: number; shutdown: () => Promise<void> } | undefined;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sua-mcp-run-'));
    agentDir = join(dataDir, 'agents');
    require('node:fs').mkdirSync(agentDir);
    tokenPath = join(dataDir, 'mcp-token');
    writeFileSync(tokenPath, 't'.repeat(64));
    chmodSync(tokenPath, 0o600);
    secretsPath = join(dataDir, 'secrets.enc');
    port = 0; // populated from serverHandle.port once the server boots

    // A simple shell agent that echoes the TOPIC input. The shell command
    // template-substitutes inputs.TOPIC at execute time. Single-quoted so
    // the shell doesn't try to interpret the value.
    writeFileSync(
      join(agentDir, 'echoer.yaml'),
      [
        'name: echoer',
        'type: shell',
        "command: \"printf '%s' \\\"$TOPIC\\\"\"",
        'mcp: true',
        'inputs:',
        '  TOPIC:',
        '    type: string',
        '    required: true',
        '',
      ].join('\n'),
    );
  });

  afterEach(async () => {
    if (serverHandle) {
      await serverHandle.shutdown();
      serverHandle = undefined;
    }
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function connectClient(): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
      {
        requestInit: {
          headers: { Authorization: `Bearer ${'t'.repeat(64)}` },
        },
      },
    );
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(transport);
    return client;
  }

  it('list-agents returns the declared input schema', async () => {
    serverHandle = await startMcpServer({
      port: 0,
      host: '127.0.0.1',
      agentDirs: [agentDir],
      dbPath: join(dataDir, 'runs.db'),
      secretsPath,
      tokenPath,
    });
    port = serverHandle.port;

    const client = await connectClient();
    try {
      const res = await client.callTool({ name: 'list-agents', arguments: {} });
      const payload = JSON.parse((res.content as Array<{ text: string }>)[0].text);
      expect(payload).toHaveLength(1);
      expect(payload[0]).toMatchObject({
        name: 'echoer',
        inputs: { TOPIC: { type: 'string', required: true } },
      });
    } finally {
      await client.close();
    }
  });

  it('run-agent threads inputs through to the run', async () => {
    serverHandle = await startMcpServer({
      port: 0,
      host: '127.0.0.1',
      agentDirs: [agentDir],
      dbPath: join(dataDir, 'runs.db'),
      secretsPath,
      tokenPath,
    });
    port = serverHandle.port;

    const client = await connectClient();
    try {
      const res = await client.callTool({
        name: 'run-agent',
        arguments: { name: 'echoer', inputs: { TOPIC: 'Q2 wins' } },
      });
      expect(res.isError).toBeFalsy();
      const payload = JSON.parse((res.content as Array<{ text: string }>)[0].text);
      expect(payload.status).toBe('completed');
      expect(payload.result).toBe('Q2 wins');
    } finally {
      await client.close();
    }
  });

  it('run-agent returns an MCP error when a required input is missing', async () => {
    serverHandle = await startMcpServer({
      port: 0,
      host: '127.0.0.1',
      agentDirs: [agentDir],
      dbPath: join(dataDir, 'runs.db'),
      secretsPath,
      tokenPath,
    });
    port = serverHandle.port;

    const client = await connectClient();
    try {
      const res = await client.callTool({
        name: 'run-agent',
        arguments: { name: 'echoer', inputs: {} },
      });
      expect(res.isError).toBe(true);
      const text = (res.content as Array<{ text: string }>)[0].text;
      expect(text).toMatch(/TOPIC/);
    } finally {
      await client.close();
    }
  });

  it('run-agent rejects oversize input values before submitting', async () => {
    serverHandle = await startMcpServer({
      port: 0,
      host: '127.0.0.1',
      agentDirs: [agentDir],
      dbPath: join(dataDir, 'runs.db'),
      secretsPath,
      tokenPath,
    });
    port = serverHandle.port;

    const client = await connectClient();
    try {
      const res = await client.callTool({
        name: 'run-agent',
        arguments: { name: 'echoer', inputs: { TOPIC: 'x'.repeat(10_000) } },
      });
      expect(res.isError).toBe(true);
      const text = (res.content as Array<{ text: string }>)[0].text;
      expect(text).toMatch(/per-value cap/);
    } finally {
      await client.close();
    }
  });
});
