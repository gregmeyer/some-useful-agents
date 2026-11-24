/**
 * Regression test for the X-button on a pulse tile.
 *
 * The handler used to toggle the legacy `signal.hidden` field, but the
 * pulse-visibility filter has preferred `pulseVisible` since v0.19 —
 * once any agent had pulseVisible set (which the Config-tab visibility
 * toggle does on the first click), the X button posted successfully
 * but the tile stayed visible. This test locks in the new behaviour:
 * clicking X flips pulseVisible so the next render hides the tile.
 */

import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { AgentStore, DashboardsStore, PacksStore } from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import { SESSION_COOKIE } from '../auth-middleware.js';
import { createTestContext, closeTestContext, type TestContext } from '../test-harness.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3997;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;

let agentStore: AgentStore;
let t: TestContext | undefined;

async function makeApp(initial: { pulseVisible?: boolean }) {
  t = await createTestContext({ port: PORT, prefix: 'sua-pulse-toggle-', extra: ({ dbPath }) => ({
    packsStore: new PacksStore(dbPath), dashboardsStore: new DashboardsStore(dbPath),
  }) });
  const { ctx } = t;
  agentStore = ctx.agentStore;

  agentStore.createAgent({
    id: 'tile-a',
    name: 'Tile A',
    status: 'active',
    source: 'local',
    mcp: false,
    pulseVisible: initial.pulseVisible,
    nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }],
    signal: { title: 'A', template: 'text-headline', mapping: { headline: 'result' } },
  }, 'cli');

  return buildDashboardApp(ctx);
}

afterEach(async () => {
  await closeTestContext(t);
  t = undefined;
});

describe('POST /agents/:id/signal/toggle', () => {
  it('hides a tile whose pulseVisible was previously true', async () => {
    const app = await makeApp({ pulseVisible: true });
    expect(agentStore.getAgent('tile-a')!.pulseVisible).toBe(true);
    const res = await request(app).post('/agents/tile-a/signal/toggle')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(303);
    expect(agentStore.getAgent('tile-a')!.pulseVisible).toBe(false);
  });

  it('hides a tile whose pulseVisible was undefined (default visible)', async () => {
    const app = await makeApp({});
    expect(agentStore.getAgent('tile-a')!.pulseVisible).toBeUndefined();
    const res = await request(app).post('/agents/tile-a/signal/toggle')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(303);
    expect(agentStore.getAgent('tile-a')!.pulseVisible).toBe(false);
  });

  it('restores a tile whose pulseVisible was false', async () => {
    const app = await makeApp({ pulseVisible: false });
    expect(agentStore.getAgent('tile-a')!.pulseVisible).toBe(false);
    const res = await request(app).post('/agents/tile-a/signal/toggle')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(303);
    expect(agentStore.getAgent('tile-a')!.pulseVisible).toBe(true);
  });
});
