import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { AgentStore, DashboardsStore, PacksStore } from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import { SESSION_COOKIE } from '../auth-middleware.js';
import { createTestContext, closeTestContext, type TestContext } from '../test-harness.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3995;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;

let agentStore: AgentStore;
let t: TestContext | undefined;

async function makeApp(opts: { schedule?: string; allowHighFrequency?: boolean } = {}) {
  t = await createTestContext({ port: PORT, prefix: 'sua-schedule-edit-', extra: ({ dbPath }) => ({
    packsStore: new PacksStore(dbPath), dashboardsStore: new DashboardsStore(dbPath),
  }) });
  const { ctx } = t;
  agentStore = ctx.agentStore;

  agentStore.createAgent({
    id: 'sched-agent',
    name: 'Sched Agent',
    status: 'active',
    source: 'local',
    mcp: false,
    schedule: opts.schedule,
    allowHighFrequency: opts.allowHighFrequency,
    nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }],
  }, 'cli');

  return buildDashboardApp(ctx);
}

afterEach(async () => {
  await closeTestContext(t);
  t = undefined;
});

describe('POST /agents/:id/schedule', () => {
  it('sets a valid 5-field cron expression', async () => {
    const app = await makeApp();
    const res = await request(app).post('/agents/sched-agent/schedule')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ schedule: '0 8 * * *' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain('Schedule%20set');
    expect(agentStore.getAgent('sched-agent')!.schedule).toBe('0 8 * * *');
  });

  it('clears the schedule when given an empty string', async () => {
    const app = await makeApp({ schedule: '0 8 * * *' });
    const res = await request(app).post('/agents/sched-agent/schedule')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ schedule: '' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain('Schedule%20cleared');
    expect(agentStore.getAgent('sched-agent')!.schedule).toBeUndefined();
  });

  it('reports unchanged when the same schedule is submitted', async () => {
    const app = await makeApp({ schedule: '0 8 * * *' });
    const res = await request(app).post('/agents/sched-agent/schedule')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ schedule: '0 8 * * *' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain('Schedule%20unchanged');
  });

  it('rejects invalid cron with a helpful message', async () => {
    const app = await makeApp();
    const res = await request(app).post('/agents/sched-agent/schedule')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ schedule: 'totally bogus' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/not%20a%20valid%20cron/i);
    expect(agentStore.getAgent('sched-agent')!.schedule).toBeUndefined();
  });

  it('rejects sub-minute (6-field) schedules unless allowHighFrequency is set', async () => {
    const app = await makeApp();
    const res = await request(app).post('/agents/sched-agent/schedule')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ schedule: '*/30 * * * * *' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/sub-minute|allowHighFrequency/i);
    expect(agentStore.getAgent('sched-agent')!.schedule).toBeUndefined();
  });

  it('accepts sub-minute schedules when allowHighFrequency is true', async () => {
    const app = await makeApp({ allowHighFrequency: true });
    const res = await request(app).post('/agents/sched-agent/schedule')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ schedule: '*/30 * * * * *' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain('Schedule%20set');
    expect(agentStore.getAgent('sched-agent')!.schedule).toBe('*/30 * * * * *');
  });

  it('returns 404 for unknown agent ids', async () => {
    const app = await makeApp();
    const res = await request(app).post('/agents/nope/schedule')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ schedule: '0 8 * * *' });
    // 404 → redirect to /agents per the existing pattern.
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/agents');
  });
});

describe('POST /agents/:id/permissions', () => {
  it('accepts a newline-separated list of valid hosts and bumps the agent version', async () => {
    const app = await makeApp();
    const initial = agentStore.getAgent('sched-agent')!.version;
    const res = await request(app).post('/agents/sched-agent/permissions')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ imgSrc: 'images.unsplash.com\n*.unsplash.com' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain('img-src%20updated');
    const after = agentStore.getAgent('sched-agent')!;
    expect(after.permissions?.imgSrc).toEqual(['images.unsplash.com', '*.unsplash.com']);
    expect(after.version).toBe(initial + 1);
  });

  it('strips https:// + paths + ports so users can paste full URLs', async () => {
    const app = await makeApp();
    const res = await request(app).post('/agents/sched-agent/permissions')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ imgSrc: 'https://images.unsplash.com/foo/bar, http://other.example.com:8080/x' });
    expect(res.status).toBe(303);
    expect(agentStore.getAgent('sched-agent')!.permissions?.imgSrc).toEqual([
      'images.unsplash.com',
      'other.example.com',
    ]);
  });

  it('rejects malformed hosts with a flash message and leaves the agent unchanged', async () => {
    const app = await makeApp();
    const before = agentStore.getAgent('sched-agent')!.version;
    const res = await request(app).post('/agents/sched-agent/permissions')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ imgSrc: 'bad_host_with_underscore' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/Invalid%20host/);
    expect(agentStore.getAgent('sched-agent')!.version).toBe(before);
  });

  it('clears imgSrc when given an empty list', async () => {
    const app = await makeApp();
    // Seed permissions first.
    await request(app).post('/agents/sched-agent/permissions')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ imgSrc: 'images.unsplash.com' });
    expect(agentStore.getAgent('sched-agent')!.permissions?.imgSrc).toEqual(['images.unsplash.com']);

    const res = await request(app).post('/agents/sched-agent/permissions')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ imgSrc: '' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain('cleared');
    expect(agentStore.getAgent('sched-agent')!.permissions).toBeUndefined();
  });

  it('can enable inbox runnable without changing img-src hosts', async () => {
    const app = await makeApp();
    const initial = agentStore.getAgent('sched-agent')!.version;
    const res = await request(app).post('/agents/sched-agent/permissions')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)
      .type('form').send({ imgSrc: '', inboxRunnable: '1' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain('Inbox%20runnable%20enabled');
    const after = agentStore.getAgent('sched-agent')!;
    expect(after.permissions?.inboxRunnable).toBe(true);
    expect(after.permissions?.imgSrc).toBeUndefined();
    expect(after.version).toBe(initial + 1);
  });
});
