import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock the MCP client so the mcp-tool handler tests can assert
// invocations without spawning a real MCP server. vi.hoisted is the
// official escape hatch for forward-referencing mocks from a vi.mock
// factory; without it the factory runs before the const initialises.
const { callMcpToolMock } = vi.hoisted(() => ({ callMcpToolMock: vi.fn() }));
vi.mock('./mcp-client.js', () => ({ callMcpTool: callMcpToolMock }));

import {
  dispatchNotify,
  buildSlackBlocks,
  type NotifyConfig,
} from './notify-dispatcher.js';
import { MemorySecretsStore } from './secrets-store.js';
import { IntegrationsStore } from './integrations-store.js';
import { ToolStore } from './tool-store.js';
import type { Agent } from './agent-v2-types.js';
import type { Run } from './types.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-notify-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    status: 'active',
    source: 'local',
    mcp: false,
    version: 1,
    nodes: [{ id: 'main', type: 'shell', command: 'echo hi' }],
    ...overrides,
  };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-123',
    agentName: 'test-agent',
    status: 'failed',
    startedAt: '2026-04-28T16:00:00Z',
    completedAt: '2026-04-28T16:00:05Z',
    error: 'something exploded',
    triggeredBy: 'cli',
    ...overrides,
  };
}

const silentLogger = { warn: () => {} };

describe('dispatchNotify trigger matching', () => {
  it('fires on failure when on: [failure] and run failed', async () => {
    const notify: NotifyConfig = {
      on: ['failure'],
      handlers: [{ type: 'file', path: 'log.jsonl' }],
    };
    const result = await dispatchNotify(notify, {
      agent: makeAgent(),
      run: makeRun({ status: 'failed' }),
      cwd: dir,
      logger: silentLogger,
    });
    expect(result.fired).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(existsSync(join(dir, 'log.jsonl'))).toBe(true);
  });

  it('does NOT fire on success when on: [failure]', async () => {
    const notify: NotifyConfig = {
      on: ['failure'],
      handlers: [{ type: 'file', path: 'log.jsonl' }],
    };
    const result = await dispatchNotify(notify, {
      agent: makeAgent(),
      run: makeRun({ status: 'completed' }),
      cwd: dir,
      logger: silentLogger,
    });
    expect(result.fired).toBe(0);
    expect(existsSync(join(dir, 'log.jsonl'))).toBe(false);
  });

  it('fires on success when on: [success] and run completed', async () => {
    const notify: NotifyConfig = {
      on: ['success'],
      handlers: [{ type: 'file', path: 'log.jsonl' }],
    };
    const result = await dispatchNotify(notify, {
      agent: makeAgent(),
      run: makeRun({ status: 'completed' }),
      cwd: dir,
      logger: silentLogger,
    });
    expect(result.fired).toBe(1);
  });

  it('always fires on terminal status when on: [always]', async () => {
    const notify: NotifyConfig = {
      on: ['always'],
      handlers: [{ type: 'file', path: 'log.jsonl' }],
    };
    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      const result = await dispatchNotify(notify, {
        agent: makeAgent(),
        run: makeRun({ status }),
        cwd: dir,
        logger: silentLogger,
      });
      expect(result.fired).toBe(1);
    }
  });
});

describe('file handler', () => {
  it('writes a JSON line with the run payload', async () => {
    const notify: NotifyConfig = {
      on: ['failure'],
      handlers: [{ type: 'file', path: 'failures.log' }],
    };
    await dispatchNotify(notify, {
      agent: makeAgent(),
      run: makeRun(),
      cwd: dir,
      logger: silentLogger,
    });
    const contents = readFileSync(join(dir, 'failures.log'), 'utf-8');
    expect(contents.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(contents.trim());
    expect(parsed.agent).toBe('test-agent');
    expect(parsed.run_id).toBe('run-123');
    expect(parsed.status).toBe('failed');
    expect(parsed.error).toBe('something exploded');
  });

  it('appends across calls when append is true (default)', async () => {
    const notify: NotifyConfig = {
      on: ['always'],
      handlers: [{ type: 'file', path: 'log.jsonl' }],
    };
    await dispatchNotify(notify, { agent: makeAgent(), run: makeRun({ id: 'r1' }), cwd: dir, logger: silentLogger });
    await dispatchNotify(notify, { agent: makeAgent(), run: makeRun({ id: 'r2', status: 'completed', error: undefined }), cwd: dir, logger: silentLogger });
    const lines = readFileSync(join(dir, 'log.jsonl'), 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).run_id).toBe('r1');
    expect(JSON.parse(lines[1]).run_id).toBe('r2');
  });

  it('rejects path traversal', async () => {
    const notify: NotifyConfig = {
      on: ['failure'],
      handlers: [{ type: 'file', path: '../escape.log' }],
    };
    const warn = vi.fn();
    const result = await dispatchNotify(notify, {
      agent: makeAgent(),
      run: makeRun(),
      cwd: dir,
      logger: { warn },
    });
    expect(result.fired).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toMatch(/escapes the working directory/);
  });
});

describe('webhook handler', () => {
  it('POSTs JSON body with run payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const notify: NotifyConfig = {
      on: ['failure'],
      handlers: [{ type: 'webhook', url: 'https://example.com/hook' }],
    };
    await dispatchNotify(notify, {
      agent: makeAgent(),
      run: makeRun(),
      cwd: dir,
      fetchImpl: fetchMock as unknown as typeof fetch,
      logger: silentLogger,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.com/hook');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.agent).toBe('test-agent');
    expect(body.run_id).toBe('run-123');
    expect(body.status).toBe('failed');
    expect(body.error).toBe('something exploded');
  });

  it('injects Bearer token from headers_secret', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const secretsStore = new MemorySecretsStore();
    await secretsStore.set('WEBHOOK_TOKEN', 'sekret-value');
    const notify: NotifyConfig = {
      on: ['failure'],
      secrets: ['WEBHOOK_TOKEN'],
      handlers: [{ type: 'webhook', url: 'https://example.com/hook', headers_secret: 'WEBHOOK_TOKEN' }],
    };
    await dispatchNotify(notify, {
      agent: makeAgent(),
      run: makeRun(),
      cwd: dir,
      secretsStore,
      fetchImpl: fetchMock as unknown as typeof fetch,
      logger: silentLogger,
    });
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers.Authorization).toBe('Bearer sekret-value');
  });

  it('rejects bad URLs via assertSafeUrl', async () => {
    const fetchMock = vi.fn();
    const warn = vi.fn();
    const notify: NotifyConfig = {
      on: ['failure'],
      handlers: [{ type: 'webhook', url: 'http://127.0.0.1/hook' }],
    };
    const result = await dispatchNotify(notify, {
      agent: makeAgent(),
      run: makeRun(),
      cwd: dir,
      fetchImpl: fetchMock as unknown as typeof fetch,
      logger: { warn },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.succeeded).toBe(0);
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toMatch(/private|reserved|Blocked/i);
  });

  it('logs a warn on non-2xx response and does not throw', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const warn = vi.fn();
    const notify: NotifyConfig = {
      on: ['failure'],
      handlers: [{ type: 'webhook', url: 'https://example.com/hook' }],
    };
    const result = await dispatchNotify(notify, {
      agent: makeAgent(),
      run: makeRun(),
      cwd: dir,
      fetchImpl: fetchMock as unknown as typeof fetch,
      logger: { warn },
    });
    expect(result.succeeded).toBe(0);
    expect(warn.mock.calls[0][0]).toMatch(/503/);
  });
});

describe('slack handler', () => {
  it('builds Block Kit payload with agent id, run id, status, error tail, dashboard link', () => {
    const out = buildSlackBlocks(
      makeAgent(),
      makeRun(),
      { channel: '#alerts', mention: '@oncall', dashboardBaseUrl: 'https://dash.local' },
    );
    expect(out.channel).toBe('#alerts');
    expect(out.blocks.length).toBeGreaterThan(0);
    const block = out.blocks[0] as { type: string; text: { type: string; text: string } };
    expect(block.type).toBe('section');
    expect(block.text.type).toBe('mrkdwn');
    expect(block.text.text).toContain('test-agent');
    expect(block.text.text).toContain('run-123');
    expect(block.text.text).toContain('failed');
    expect(block.text.text).toContain('something exploded');
    expect(block.text.text).toContain('https://dash.local/runs/run-123');
    expect(block.text.text).toContain('@oncall');
  });

  it('truncates error to last 200 chars', () => {
    const longErr = 'X'.repeat(500) + 'TAIL';
    const out = buildSlackBlocks(makeAgent(), makeRun({ error: longErr }), {});
    const block = out.blocks[0] as { text: { text: string } };
    expect(block.text.text).toContain('TAIL');
    expect(block.text.text).not.toContain('X'.repeat(300));
  });

  it('POSTs to slack webhook when handler fires', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const secretsStore = new MemorySecretsStore();
    await secretsStore.set('SLACK_WEBHOOK', 'https://hooks.slack.com/services/T/B/X');
    const notify: NotifyConfig = {
      on: ['failure'],
      secrets: ['SLACK_WEBHOOK'],
      handlers: [{ type: 'slack', webhook_secret: 'SLACK_WEBHOOK', channel: '#alerts' }],
    };
    await dispatchNotify(notify, {
      agent: makeAgent(),
      run: makeRun(),
      cwd: dir,
      secretsStore,
      fetchImpl: fetchMock as unknown as typeof fetch,
      logger: silentLogger,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hooks.slack.com/services/T/B/X');
    const body = JSON.parse(init.body);
    expect(body.channel).toBe('#alerts');
    expect(Array.isArray(body.blocks)).toBe(true);
  });

  it('warns when the webhook secret is missing from the store', async () => {
    const fetchMock = vi.fn();
    const warn = vi.fn();
    const notify: NotifyConfig = {
      on: ['failure'],
      secrets: ['SLACK_WEBHOOK'],
      handlers: [{ type: 'slack', webhook_secret: 'SLACK_WEBHOOK' }],
    };
    const result = await dispatchNotify(notify, {
      agent: makeAgent(),
      run: makeRun(),
      cwd: dir,
      secretsStore: new MemorySecretsStore(),
      fetchImpl: fetchMock as unknown as typeof fetch,
      logger: { warn },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.succeeded).toBe(0);
    expect(warn.mock.calls[0][0]).toMatch(/SLACK_WEBHOOK/);
  });
});

describe('handler isolation', () => {
  it('one handler failing does not crash the dispatcher or block other handlers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const warn = vi.fn();
    const notify: NotifyConfig = {
      on: ['failure'],
      handlers: [
        { type: 'file', path: '../escape.log' },
        { type: 'webhook', url: 'https://example.com/hook' },
      ],
    };
    const result = await dispatchNotify(notify, {
      agent: makeAgent(),
      run: makeRun(),
      cwd: dir,
      fetchImpl: fetchMock as unknown as typeof fetch,
      logger: { warn },
    });
    expect(result.fired).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });
});

describe('integration resolution', () => {
  function makeIntegrationsStore() {
    return new IntegrationsStore(join(dir, 'runs.db'));
  }

  it('resolves a slack handler by integration id and merges config', async () => {
    const store = makeIntegrationsStore();
    store.upsertIntegration({
      id: 'user:oncall', packId: null, kind: 'slack', name: 'Oncall',
      config: { webhook_secret: 'SLACK_WEBHOOK', channel: '#alerts' },
      secretRefs: ['SLACK_WEBHOOK'],
    });
    const secrets = new MemorySecretsStore();
    await secrets.set('SLACK_WEBHOOK', 'https://hooks.slack.com/services/T/B/x');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const notify: NotifyConfig = {
      on: ['failure'],
      handlers: [{ type: 'slack', integration: 'user:oncall' }],
    };
    const result = await dispatchNotify(notify, {
      agent: makeAgent(),
      run: makeRun(),
      integrationsStore: store,
      secretsStore: secrets,
      fetchImpl: fetchMock as unknown as typeof fetch,
      logger: silentLogger,
    });
    expect(result.fired).toBe(1);
    expect(result.succeeded).toBe(1);
    // Channel from the integration row made it into the Block Kit payload.
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.channel).toBe('#alerts');
  });

  it('inline handler fields override the integration', async () => {
    const store = makeIntegrationsStore();
    store.upsertIntegration({
      id: 'user:oncall', packId: null, kind: 'slack', name: 'Oncall',
      config: { webhook_secret: 'SLACK_WEBHOOK', channel: '#alerts' },
      secretRefs: ['SLACK_WEBHOOK'],
    });
    const secrets = new MemorySecretsStore();
    await secrets.set('SLACK_WEBHOOK', 'https://hooks.slack.com/services/T/B/x');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const notify: NotifyConfig = {
      on: ['failure'],
      handlers: [{ type: 'slack', integration: 'user:oncall', channel: '#war-room' }],
    };
    await dispatchNotify(notify, {
      agent: makeAgent(), run: makeRun(),
      integrationsStore: store, secretsStore: secrets,
      fetchImpl: fetchMock as unknown as typeof fetch,
      logger: silentLogger,
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.channel).toBe('#war-room');
  });

  it('skips a handler whose integration is missing and logs', async () => {
    const store = makeIntegrationsStore();
    const warn = vi.fn();
    const fetchMock = vi.fn();
    const notify: NotifyConfig = {
      on: ['failure'],
      handlers: [{ type: 'slack', integration: 'user:nope' }],
    };
    const result = await dispatchNotify(notify, {
      agent: makeAgent(), run: makeRun(),
      integrationsStore: store,
      fetchImpl: fetchMock as unknown as typeof fetch,
      logger: { warn },
    });
    expect(result.fired).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/not found/));
  });

  it('skips a handler whose integration kind mismatches', async () => {
    const store = makeIntegrationsStore();
    store.upsertIntegration({
      id: 'user:wrong', packId: null, kind: 'file', name: 'Log',
      config: { path: 'out.log' }, secretRefs: [],
    });
    const warn = vi.fn();
    const fetchMock = vi.fn();
    const notify: NotifyConfig = {
      on: ['failure'],
      handlers: [{ type: 'slack', integration: 'user:wrong' }],
    };
    const result = await dispatchNotify(notify, {
      agent: makeAgent(), run: makeRun(),
      integrationsStore: store,
      fetchImpl: fetchMock as unknown as typeof fetch,
      logger: { warn },
    });
    expect(result.fired).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/kind="file" but handler is type="slack"/));
  });

  it('pulls integration secret refs into the resolution bag even when notify.secrets omits them', async () => {
    const store = makeIntegrationsStore();
    store.upsertIntegration({
      id: 'user:hook', packId: null, kind: 'webhook', name: 'Hook',
      config: { url: 'https://example.com/hook', method: 'POST', headers_secret: 'HOOK_TOKEN' },
      secretRefs: ['HOOK_TOKEN'],
    });
    const secrets = new MemorySecretsStore();
    await secrets.set('HOOK_TOKEN', 'shhhhh');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    // Note: notify.secrets is deliberately empty here. The dispatcher should
    // still pull HOOK_TOKEN because the integration declared it.
    const notify: NotifyConfig = {
      on: ['failure'],
      handlers: [{ type: 'webhook', integration: 'user:hook' }],
    };
    await dispatchNotify(notify, {
      agent: makeAgent(), run: makeRun(),
      integrationsStore: store, secretsStore: secrets,
      fetchImpl: fetchMock as unknown as typeof fetch,
      logger: silentLogger,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer shhhhh');
  });
});

describe('mcp-tool handler', () => {
  function makeStores() {
    const integrationsStore = new IntegrationsStore(join(dir, 'runs.db'));
    const toolStore = new ToolStore(join(dir, 'runs.db'));
    return { integrationsStore, toolStore };
  }

  beforeEach(() => {
    callMcpToolMock.mockReset();
  });

  it('resolves integration → calls callMcpTool with merged + templated inputs', async () => {
    const { integrationsStore, toolStore } = makeStores();
    toolStore.upsertMcpServer({
      id: 'claude-ai-gmail', name: 'Claude.ai Gmail',
      transport: 'http', url: 'https://example.invalid/mcp', enabled: true,
    });
    integrationsStore.upsertIntegration({
      id: 'user:gmail-via-mcp', packId: null, kind: 'mcp-tool', name: 'Gmail via Claude MCP',
      config: {
        server_id: 'claude-ai-gmail',
        tool_name: 'mcp__claude_ai_Gmail__create_draft',
        default_inputs: { to: 'ops@example.com', subject: '[sua] {{agent.id}} {{run.status}}' },
      },
      secretRefs: [],
    });
    callMcpToolMock.mockResolvedValueOnce({ content: [{ type: 'text', text: 'ok' }] });

    const notify: NotifyConfig = {
      on: ['failure'],
      handlers: [{
        type: 'mcp-tool',
        integration: 'user:gmail-via-mcp',
        inputs: { body: 'Run {{run.id}} failed: {{run.error}}' },
      }],
    };
    const result = await dispatchNotify(notify, {
      agent: makeAgent({ id: 'health-check' }),
      run: makeRun({ id: 'run-99', error: 'boom' }),
      integrationsStore,
      toolStore,
      logger: silentLogger,
    });

    expect(result.fired).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(callMcpToolMock).toHaveBeenCalledTimes(1);
    const [impl, inputs] = callMcpToolMock.mock.calls[0];
    expect(impl.type).toBe('mcp');
    expect(impl.mcpTransport).toBe('http');
    expect(impl.mcpUrl).toBe('https://example.invalid/mcp');
    expect(impl.mcpToolName).toBe('mcp__claude_ai_Gmail__create_draft');
    // Default + handler inputs merged; template vars substituted.
    expect(inputs).toEqual({
      to: 'ops@example.com',
      subject: '[sua] health-check failed',
      body: 'Run run-99 failed: boom',
    });
  });

  it('handler.inputs win over integration default_inputs', async () => {
    const { integrationsStore, toolStore } = makeStores();
    toolStore.upsertMcpServer({ id: 's1', name: 'S1', transport: 'stdio', command: 'node', args: ['x'], enabled: true });
    integrationsStore.upsertIntegration({
      id: 'user:i', packId: null, kind: 'mcp-tool', name: 'I',
      config: { server_id: 's1', tool_name: 'send', default_inputs: { to: 'default@x.com', subject: 'd' } },
      secretRefs: [],
    });
    callMcpToolMock.mockResolvedValueOnce({});

    await dispatchNotify(
      { on: ['failure'], handlers: [{ type: 'mcp-tool', integration: 'user:i', inputs: { to: 'override@x.com' } }] },
      { agent: makeAgent(), run: makeRun(), integrationsStore, toolStore, logger: silentLogger },
    );
    const [, inputs] = callMcpToolMock.mock.calls[0];
    expect(inputs.to).toBe('override@x.com');
    expect(inputs.subject).toBe('d');
  });

  it('skips and logs when the server is disabled', async () => {
    const { integrationsStore, toolStore } = makeStores();
    toolStore.upsertMcpServer({ id: 's1', name: 'S1', transport: 'stdio', command: 'x', enabled: false });
    integrationsStore.upsertIntegration({
      id: 'user:i', packId: null, kind: 'mcp-tool', name: 'I',
      config: { server_id: 's1', tool_name: 'send' }, secretRefs: [],
    });
    const warn = vi.fn();
    await dispatchNotify(
      { on: ['failure'], handlers: [{ type: 'mcp-tool', integration: 'user:i' }] },
      { agent: makeAgent(), run: makeRun(), integrationsStore, toolStore, logger: { warn } },
    );
    expect(callMcpToolMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/disabled/));
  });

  it('skips and logs when the integration row is missing', async () => {
    const { integrationsStore, toolStore } = makeStores();
    const warn = vi.fn();
    await dispatchNotify(
      { on: ['failure'], handlers: [{ type: 'mcp-tool', integration: 'user:ghost' }] },
      { agent: makeAgent(), run: makeRun(), integrationsStore, toolStore, logger: { warn } },
    );
    expect(callMcpToolMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/not found/));
  });

  it('skips and logs when toolStore is not provided', async () => {
    const { integrationsStore } = makeStores();
    integrationsStore.upsertIntegration({
      id: 'user:i', packId: null, kind: 'mcp-tool', name: 'I',
      config: { server_id: 's1', tool_name: 'send' }, secretRefs: [],
    });
    const warn = vi.fn();
    await dispatchNotify(
      { on: ['failure'], handlers: [{ type: 'mcp-tool', integration: 'user:i' }] },
      { agent: makeAgent(), run: makeRun(), integrationsStore, logger: { warn } },
    );
    expect(callMcpToolMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/toolStore/));
  });
});
