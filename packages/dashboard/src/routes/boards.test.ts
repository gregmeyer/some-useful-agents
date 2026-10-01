import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentStore, BoardsStore, DashboardsStore, LocalProvider, MemorySecretsStore, RunStore,
  buildLoopbackAllowlist, loadAgents,
} from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import type { DashboardContext } from '../context.js';
import { SESSION_COOKIE } from '../session.js';
import { MemorySecretsSession } from '../secrets-session.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3990;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;
let dir = '';
let ctx: DashboardContext;
let provider: LocalProvider;

async function setup() {
  dir = mkdtempSync(join(tmpdir(), 'sua-boards-route-'));
  const dbPath = join(dir, 'runs.db');
  const agentsDir = join(dir, 'agents', 'local');
  mkdirSync(agentsDir, { recursive: true });
  const secretsStore = new MemorySecretsStore();
  provider = new LocalProvider(dbPath, secretsStore);
  await provider.initialize();
  ctx = {
    token: TOKEN, allowlist: buildLoopbackAllowlist(PORT), port: PORT, provider,
    runStore: new RunStore(dbPath), agentStore: new AgentStore(dbPath), dashboardsStore: new DashboardsStore(dbPath),
    loadAgents: () => loadAgents({ directories: [agentsDir] }), secretsStore,
    secretsSession: new MemorySecretsSession({ backing: secretsStore }), tokenPath: join(dir, 'mcp-token'),
    retentionDays: 30, dbPath, secretsPath: join(dir, 'secrets.enc'), rotateToken: () => 'r'.repeat(64),
    allowUntrustedShell: new Set(), activeRuns: new Map(), inboxTriageAbortControllers: new Map(),
    inboxTriagePendingRefires: new Set(), dataDir: dir, dashboardBaseUrl: `http://127.0.0.1:${PORT}`,
  } as DashboardContext;
  const add = (id: string, size?: string) => ctx.agentStore.createAgent({ id, name: id, status: 'active', source: 'local', mcp: false,
    nodes: [{ id: 'n', type: 'shell', command: 'echo hi' }], signal: { title: id, template: 'text-headline', mapping: { headline: 'result' }, ...(size ? { size } : {}) } } as never, 'cli');
  add('news'); add('weather', '2x1'); add('notes');
  ctx.dashboardsStore!.upsertDashboard({ id: 'user:morning', packId: null, name: 'Morning', layout: { sections: [{ title: 'Today', agentIds: ['news', 'weather', 'ghost'] }] } } as never);
  return buildDashboardApp(ctx);
}
afterEach(async () => {
  await provider?.shutdown();
  try { ctx.runStore.close(); ctx.agentStore.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});
const get = (app: Parameters<typeof request>[0], p: string) => request(app).get(p).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);

describe('boards (read-only)', () => {
  it('derives a named dashboard as a board from its sections, with a missing agent shown in place', async () => {
    const app = await setup();
    const json = await get(app, '/boards/user:morning.json');
    expect(json.status).toBe(200);
    expect(json.body.board).toMatchObject({ id: 'user:morning', name: 'Morning', derived: true, version: 0 });
    expect(json.body.board.items.map((i: { kind: string; agentId?: string; w: number }) => `${i.kind}:${i.agentId ?? ''}:${i.w}`))
      .toEqual(['heading::12', 'agent:news:3', 'agent:weather:6', 'agent:ghost:3']);
    const page = await get(app, '/boards/user:morning');
    expect(page.text).toContain('class="board-grid"');
    expect(page.text).toContain('grid-column: 4 / span 6;'); // weather, 2x1, after news
    expect(page.text).toContain("isn't installed");
  });

  it('shows Pulse with everything in the Unplaced tray until something is placed, then the placed tiles on the grid', async () => {
    const app = await setup();
    let json = await get(app, '/boards/pulse.json');
    expect(json.body.board).toMatchObject({ id: 'pulse', derived: true, items: [] });
    expect(json.body.unplaced).toEqual(expect.arrayContaining(['news', 'weather', 'notes']));
    new BoardsStore(ctx.runStore.databaseHandle()).save({ id: 'pulse', name: 'Pulse', items: [{ id: 'a', kind: 'agent', agentId: 'news', x: 0, y: 3, w: 6, h: 5 }], expectedVersion: 0 });
    json = await get(app, '/boards/pulse.json');
    expect(json.body.board).toMatchObject({ derived: false, version: 1, items: [{ agentId: 'news', y: 0 }] });
    expect(json.body.unplaced).not.toContain('news');
    const page = await get(app, '/boards/pulse');
    expect(page.text).toContain('data-board-item="a"');
    expect(page.text).toContain('Unplaced');
    // each unplaced tile appears exactly once in the tray (system tiles head it, not repeated)
    for (const id of ['_system-runs-today', 'weather']) expect(page.text.split(`data-agent-id="${id}" data-tile-size`).length - 1).toBe(1);
  });

  it('404s for an unknown board', async () => {
    const app = await setup();
    expect((await get(app, '/boards/nope')).status).toBe(404);
    expect((await get(app, '/boards/nope.json')).status).toBe(404);
  });
});
