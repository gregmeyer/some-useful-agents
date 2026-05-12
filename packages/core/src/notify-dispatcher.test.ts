import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  dispatchNotify,
  buildSlackBlocks,
  type NotifyConfig,
} from './notify-dispatcher.js';
import { MemorySecretsStore } from './secrets-store.js';
import { IntegrationsStore } from './integrations-store.js';
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

  it('gmail handler refreshes the token and posts to Gmail send', async () => {
    const store = makeIntegrationsStore();
    store.upsertIntegration({
      id: 'user:gmail-oncall', packId: null, kind: 'gmail', name: 'Oncall Gmail',
      config: {
        client_id_secret: 'GMAIL_CLIENT_ID',
        client_secret_secret: 'GMAIL_CLIENT_SECRET',
        refresh_token_secret: 'USER_GMAIL_ONCALL__REFRESH_TOKEN',
        connected_account: 'oncall@example.com',
      },
      secretRefs: ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'USER_GMAIL_ONCALL__REFRESH_TOKEN'],
    });
    const secrets = new MemorySecretsStore();
    await secrets.set('GMAIL_CLIENT_ID', 'cid');
    await secrets.set('GMAIL_CLIENT_SECRET', 'csec');
    await secrets.set('USER_GMAIL_ONCALL__REFRESH_TOKEN', 'rt-xyz');

    // First fetch: token refresh; second fetch: Gmail send.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'AT', expires_in: 3600, scope: 's', token_type: 'Bearer' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '{}' });

    const notify: NotifyConfig = {
      on: ['failure'],
      handlers: [{
        type: 'gmail',
        integration: 'user:gmail-oncall',
        to: 'someone@example.com',
        subject: 'Run failed',
      }],
    };
    const result = await dispatchNotify(notify, {
      agent: makeAgent(),
      run: makeRun(),
      integrationsStore: store,
      secretsStore: secrets,
      fetchImpl: fetchMock as unknown as typeof fetch,
      logger: silentLogger,
    });
    expect(result.succeeded).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(String(tokenUrl)).toContain('oauth2.googleapis.com/token');
    expect(String(tokenInit.body)).toContain('refresh_token=rt-xyz');
    const [sendUrl, sendInit] = fetchMock.mock.calls[1];
    expect(String(sendUrl)).toContain('gmail.googleapis.com');
    expect(sendInit.headers.Authorization).toBe('Bearer AT');
    const sendBody = JSON.parse(sendInit.body as string);
    expect(typeof sendBody.raw).toBe('string');
    const decoded = Buffer.from(sendBody.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
    expect(decoded).toContain('To: someone@example.com');
    expect(decoded).toContain('Subject: Run failed');
    expect(decoded).toContain('From: oncall@example.com');
  });

  it('gmail handler reports a missing-connection error when refresh_token_secret is absent', async () => {
    const store = makeIntegrationsStore();
    store.upsertIntegration({
      id: 'user:gmail-half', packId: null, kind: 'gmail', name: 'Half-Configured',
      config: { client_id_secret: 'GMAIL_CLIENT_ID', client_secret_secret: 'GMAIL_CLIENT_SECRET' },
      secretRefs: ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET'],
    });
    const warn = vi.fn();
    const fetchMock = vi.fn();
    const notify: NotifyConfig = {
      on: ['failure'],
      handlers: [{ type: 'gmail', integration: 'user:gmail-half', to: 'a@b.example.com', subject: 's' }],
    };
    const result = await dispatchNotify(notify, {
      agent: makeAgent(), run: makeRun(),
      integrationsStore: store,
      fetchImpl: fetchMock as unknown as typeof fetch,
      logger: { warn },
    });
    expect(result.succeeded).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/not connected/));
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
