import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import request from 'supertest';
import {
  AgentStore,
  InboxStore,
  LocalProvider,
  MemorySecretsStore,
  RunStore,
  buildLoopbackAllowlist,
  loadAgents,
  type SpawnNodeFn,
} from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import type { DashboardContext } from '../context.js';
import { SESSION_COOKIE } from '../session.js';
import { MemorySecretsSession } from '../secrets-session.js';
import { attachChatSocket, type ChatSocketHandle } from './chat-socket.js';
import { InboxEventBus } from './inbox-event-bus.js';

const TOKEN = 'a'.repeat(64);
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;

let dir = '';
let server: Server | undefined;
let socket: ChatSocketHandle | undefined;
let provider: LocalProvider;
let runStore: RunStore;
let agentStore: AgentStore;
let inboxStore: InboxStore;
let port = 0;

/** A model that streams two chunks, calls a tool, and answers. */
const fakeModel: SpawnNodeFn = async (_node, _env, _opts, onProgress) => {
  const at = () => new Date().toISOString();
  onProgress?.({ timestamp: at(), type: 'output_chunk', message: 'Looking ' });
  onProgress?.({ timestamp: at(), type: 'tool_use', toolName: 'web-fetch', toolStatus: 'call', preview: '{"url":"https://x"}' });
  onProgress?.({ timestamp: at(), type: 'output_chunk', message: 'it up…' });
  await new Promise((r) => setTimeout(r, 30));
  return { result: 'It is sunny.', exitCode: 0 };
};

/** A model that streams deltas, then sends the same text as one message (like claude). */
const deltaModel: SpawnNodeFn = async (_node, _env, _opts, onProgress) => {
  const at = () => new Date().toISOString();
  for (const piece of ['It ', 'is ', 'sunny.']) onProgress?.({ timestamp: at(), type: 'output_delta', message: piece });
  onProgress?.({ timestamp: at(), type: 'output_chunk', message: 'It is sunny.' });
  return { result: 'It is sunny.', exitCode: 0 };
};

async function start(model: SpawnNodeFn = fakeModel): Promise<void> {
  dir = mkdtempSync(join(tmpdir(), 'sua-chat-ws-'));
  const dbPath = join(dir, 'runs.db');
  const agentsDir = join(dir, 'agents', 'local');
  mkdirSync(agentsDir, { recursive: true });
  const secretsStore = new MemorySecretsStore();
  runStore = new RunStore(dbPath);
  agentStore = new AgentStore(dbPath);
  inboxStore = new InboxStore(dbPath);
  provider = new LocalProvider(dbPath, secretsStore);
  await provider.initialize();
  agentStore.createAgent({
    id: 'weather', name: 'Weather', status: 'active', source: 'local', mcp: false,
    inputs: { QUESTION: { type: 'string' } },
    nodes: [{ id: 'answer', type: 'llm-prompt', prompt: 'Answer: {{inputs.QUESTION}}' }],
  } as never, 'cli');
  agentStore.createAgent({
    id: 'shop', name: 'Shop', status: 'active', source: 'local', mcp: false,
    inputs: { QUESTION: { type: 'string' } },
    nodes: [{ id: 'answer', type: 'llm-prompt', prompt: 'Answer: {{inputs.QUESTION}}' }],
    view: { components: [
      { id: 'root', component: 'Column', children: ['price', 'cheaper'] },
      { id: 'price', component: 'Metric', label: 'Best price', value: { path: '/outputs/price' } },
      { id: 'cheaper', component: 'Button', child: 'cheaperLabel', action: { event: { name: 'refine', context: { message: 'Show cheaper ones' } } } },
      { id: 'cheaperLabel', component: 'Text', text: 'Cheaper' },
    ] },
  } as never, 'cli');
  server = createServer();
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  port = (server.address() as { port: number }).port;
  const ctx: DashboardContext = {
    token: TOKEN,
    allowlist: buildLoopbackAllowlist(port),
    port,
    provider,
    runStore,
    agentStore,
    loadAgents: () => loadAgents({ directories: [agentsDir] }),
    secretsStore,
    secretsSession: new MemorySecretsSession({ backing: secretsStore }),
    tokenPath: join(dir, 'mcp-token'),
    retentionDays: 30,
    dbPath,
    secretsPath: join(dir, 'secrets.enc'),
    rotateToken: () => 'r'.repeat(64),
    allowUntrustedShell: new Set(),
    activeRuns: new Map(),
    inboxTriageAbortControllers: new Map(),
    inboxTriagePendingRefires: new Set(),
    dataDir: dir,
    dashboardBaseUrl: `http://127.0.0.1:${port}`,
    workflowSpawnNode: model,
    inboxStore,
    inboxEventBus: new InboxEventBus(),
  };
  server.on('request', buildDashboardApp(ctx));
  socket = attachChatSocket(server, ctx);
}

afterEach(async () => {
  socket?.close();
  if (server) await new Promise<void>((r) => { server!.close(() => r()); server!.closeAllConnections(); });
  await provider?.shutdown();
  try { runStore.close(); agentStore.close(); inboxStore.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
  server = undefined; socket = undefined; dir = '';
});

function connect(headers: Record<string, string>): Promise<{ ws: WebSocket; frames: Array<Record<string, unknown>>; next: (pred: (f: Record<string, unknown>) => boolean) => Promise<Record<string, unknown>> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    const frames: Array<Record<string, unknown>> = [];
    const waiters: Array<{ pred: (f: Record<string, unknown>) => boolean; resolve: (f: Record<string, unknown>) => void }> = [];
    ws.on('message', (raw) => {
      const f = JSON.parse(String(raw)) as Record<string, unknown>;
      frames.push(f);
      for (const w of [...waiters]) if (w.pred(f)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(f); }
    });
    const next = (pred: (f: Record<string, unknown>) => boolean) => {
      const found = frames.find(pred);
      if (found) return Promise.resolve(found);
      return new Promise<Record<string, unknown>>((res, rej) => {
        waiters.push({ pred, resolve: res });
        setTimeout(() => rej(new Error(`timed out; got ${JSON.stringify(frames.map((x) => x.event ?? x.type))}`)), 5000);
      });
    };
    ws.once('open', () => resolve({ ws, frames, next }));
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.once('error', reject);
  });
}
const goodHeaders = () => ({ Origin: `http://127.0.0.1:${port}`, Cookie: COOKIE });

describe('chat WebSocket', () => {
  it('refuses connections without a session cookie, without an Origin, or from another Origin', async () => {
    await start();
    await expect(connect({ Origin: `http://127.0.0.1:${port}` })).rejects.toThrow(/HTTP 401/);
    await expect(connect({ Cookie: COOKIE })).rejects.toThrow(/HTTP 403/);
    await expect(connect({ Origin: 'https://evil.example', Cookie: COOKIE })).rejects.toThrow(/HTTP 403/);
  });

  it('starts a conversation and streams the reply: text, tool calls, then turn-end', async () => {
    await start();
    const { ws, next, frames } = await connect(goodHeaders());
    await next((f) => f.type === 'hello');
    ws.send(JSON.stringify({ type: 'chat.send', ref: 'a', agentId: 'weather', text: 'Weather in Lisbon?' }));
    const started = await next((f) => f.type === 'chat.started');
    expect(started).toMatchObject({ ref: 'a', agentId: 'weather' });
    await next((f) => f.event === 'turn-end');
    const events = frames.filter((f) => f.type === 'event').map((f) => [f.event, (f.data as { text?: string; name?: string }).text ?? (f.data as { name?: string }).name ?? '']);
    expect(events).toEqual([
      ['turn-start', ''], ['token', 'Looking '], ['tool', 'web-fetch'], ['token', 'it up…'], ['turn-end', ''],
    ]);
    expect(frames.filter((f) => f.type === 'event').every((f) => (f.data as { runId?: string }).runId === started.runId)).toBe(true);

    // The transcript fragment now has the reply, and nothing is pending.
    const frag = await request(server!).get(`/agents/weather/chat?session=${String(started.sessionId)}&fragment=transcript`)
      .set('Host', `127.0.0.1:${port}`).set('Cookie', COOKIE);
    expect(frag.headers['x-chat-pending']).toBe('0');
    expect(frag.text).toContain('It is sunny.');
    expect(frag.text).toContain('Weather in Lisbon?');
    ws.close();
  });

  it('a second client catches up on a turn by subscribing with since=-1', async () => {
    await start();
    const a = await connect(goodHeaders());
    a.ws.send(JSON.stringify({ type: 'chat.send', ref: 'a', agentId: 'weather', text: 'hi' }));
    const started = await a.next((f) => f.type === 'chat.started');
    await a.next((f) => f.event === 'turn-end');
    const b = await connect(goodHeaders());
    b.ws.send(JSON.stringify({ type: 'subscribe', channel: `session:${String(started.sessionId)}`, since: -1 }));
    const end = await b.next((f) => f.event === 'turn-end');
    expect((end.data as { runId: string }).runId).toBe(started.runId);
    b.ws.send(JSON.stringify({ type: 'subscribe', ref: 'x', channel: 'session:nope' }));
    expect(await b.next((f) => f.type === 'error' && f.ref === 'x')).toMatchObject({ message: 'No such conversation.' });
    a.ws.close(); b.ws.close();
  });

  it('reports bad frames and unknown agents without dropping the connection', async () => {
    await start();
    const { ws, next } = await connect(goodHeaders());
    ws.send('not json');
    await next((f) => f.type === 'error' && f.message === 'Frames must be JSON.');
    ws.send(JSON.stringify({ type: 'chat.send', ref: 'q', agentId: 'ghost', text: 'hi' }));
    expect(await next((f) => f.ref === 'q')).toMatchObject({ type: 'error', message: 'No agent "ghost".' });
    ws.send(JSON.stringify({ type: 'ping' }));
    await next((f) => f.type === 'pong');
    ws.close();
  });
});

describe('chat WebSocket, streamed deltas', () => {
  it('relays deltas as tokens, skips the full message that repeats them, and keeps deltas out of the stored progress', async () => {
    await start(deltaModel);
    const { ws, next, frames } = await connect(goodHeaders());
    ws.send(JSON.stringify({ type: 'chat.send', ref: 'a', agentId: 'weather', text: 'hi' }));
    const started = await next((f) => f.type === 'chat.started');
    await next((f) => f.event === 'turn-end');
    const tokens = frames.filter((f) => f.event === 'token').map((f) => (f.data as { text: string }).text);
    expect(tokens).toEqual(['It ', 'is ', 'sunny.']);
    const progress = JSON.parse(runStore.listNodeExecutions(String(started.runId))[0].progressJson ?? '[]') as Array<{ type: string }>;
    expect(progress.map((p) => p.type)).toEqual(['output_chunk']);
    ws.close();
  });
});

describe('chat WebSocket, inbox threads', () => {
  it('subscribes to a thread and posts a reply over the socket (same path as POST /respond)', async () => {
    await start();
    const thread = inboxStore.add({ priority: 'medium', source: 'manual', title: 'Help', body: 'b' });
    const { ws, next } = await connect(goodHeaders());
    ws.send(JSON.stringify({ type: 'subscribe', channel: `inbox:${thread.id}` }));
    ws.send(JSON.stringify({ type: 'inbox.send', ref: 's', threadId: thread.id, text: 'Can you check the weather?' }));
    expect(await next((f) => f.ref === 's')).toMatchObject({ type: 'inbox.sent', threadId: thread.id });
    const created = await next((f) => f.event === 'message:created');
    expect(created).toMatchObject({ channel: `inbox:${thread.id}`, data: { role: 'user', body: 'Can you check the weather?' } });
    expect(inboxStore.listResponses(thread.id).some((r) => r.role === 'user' && r.body === 'Can you check the weather?')).toBe(true);

    ws.send(JSON.stringify({ type: 'inbox.send', ref: 'e', threadId: thread.id, text: '   ' }));
    expect(await next((f) => f.ref === 'e')).toMatchObject({ type: 'error', message: 'Reply cannot be empty.' });
    ws.send(JSON.stringify({ type: 'subscribe', ref: 'u', channel: 'inbox:nope' }));
    expect(await next((f) => f.ref === 'u')).toMatchObject({ type: 'error', message: 'No such inbox thread.' });
    ws.close();
  });
});

describe('chat WebSocket, inline A2UI views', () => {
  const jsonModel: SpawnNodeFn = async () => ({ result: '{"price":"$89"}', exitCode: 0 });
  it('puts the agent\'s view under its reply, and a widget click becomes the next turn', async () => {
    await start(jsonModel);
    const { ws, next } = await connect(goodHeaders());
    ws.send(JSON.stringify({ type: 'chat.send', ref: 'a', agentId: 'shop', text: 'Trail shoes?' }));
    const started = await next((f) => f.type === 'chat.started');
    await next((f) => f.event === 'turn-end');
    const sid = String(started.sessionId);
    const frag = await request(server!).get(`/agents/shop/chat?session=${sid}&fragment=transcript`)
      .set('Host', `127.0.0.1:${port}`).set('Cookie', COOKIE);
    expect(frag.text).toContain('data-a2ui-surface');
    expect(frag.text).toContain('"price":"$89"');
    const page = await request(server!).get(`/agents/shop/chat?session=${sid}`).set('Host', `127.0.0.1:${port}`).set('Cookie', COOKIE);
    expect(page.text).toContain('<script type="module" src="/assets/a2ui-sua.js"></script>');

    ws.send(JSON.stringify({ type: 'chat.action', ref: 'b', agentId: 'shop', sessionId: sid, action: { name: 'refine', context: { message: 'Show cheaper ones' } } }));
    const second = await next((f) => f.type === 'chat.started' && f.ref === 'b');
    expect(second.sessionId).toBe(sid);
    await next((f) => f.event === 'turn-end' && (f.data as { runId: string }).runId === second.runId);
    const after = await request(server!).get(`/agents/shop/chat?session=${sid}&fragment=transcript`).set('Host', `127.0.0.1:${port}`).set('Cookie', COOKIE);
    expect(after.text).toContain('Show cheaper ones');

    ws.send(JSON.stringify({ type: 'chat.action', ref: 'c', agentId: 'shop', action: { name: 'refine' } }));
    expect(await next((f) => f.ref === 'c')).toMatchObject({ type: 'error', message: 'An action belongs to a conversation.' });
    ws.close();
  });
});
