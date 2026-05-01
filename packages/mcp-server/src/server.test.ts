import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  let port: number;
  let httpServer: { close: () => void } | undefined;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sua-mcp-multi-'));
    tokenPath = join(dataDir, 'mcp-token');
    writeFileSync(tokenPath, 't'.repeat(64));
    chmodSync(tokenPath, 0o600);
    secretsPath = join(dataDir, 'secrets.enc');
    // Pick a high random port to avoid stomping on the user's running server.
    port = 18000 + Math.floor(Math.random() * 1000);
  });

  afterEach(() => {
    httpServer?.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('serves two independent initialize requests without crashing', async () => {
    await startMcpServer({
      port,
      host: '127.0.0.1',
      agentDirs: [dataDir], // empty dir — agent loader returns no agents
      dbPath: join(dataDir, 'runs.db'),
      secretsPath,
      tokenPath,
    });

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
