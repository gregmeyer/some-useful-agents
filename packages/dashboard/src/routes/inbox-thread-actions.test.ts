/**
 * Inbox thread-usability routes (control-plane Phase 2): reopen and summarize.
 * Each route runs in dual 204/303 mode; these assert the store side effects
 * via the AJAX (X-Requested-With) path.
 */
import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { InboxStore } from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import { SESSION_COOKIE } from '../auth-middleware.js';
import { createTestContext, closeTestContext, type TestContext } from '../test-harness.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3992;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;
const AJAX = { Cookie: COOKIE, Host: `127.0.0.1:${PORT}`, 'X-Requested-With': 'fetch' };

let inboxStore: InboxStore;
let t: TestContext | undefined;

async function makeApp() {
  t = await createTestContext({ port: PORT, prefix: 'sua-inbox-thread-', extra: ({ dbPath }) => ({ inboxStore: new InboxStore(dbPath) }) });
  const { ctx } = t;
  inboxStore = ctx.inboxStore!;
  return buildDashboardApp(ctx);
}

afterEach(async () => {
  await closeTestContext(t);
  t = undefined;
});

function newThread() {
  return inboxStore.add({ priority: 'medium', source: 'manual', title: 'My thread', body: 'b', agentId: 'old-agent' });
}

describe('POST /inbox/:id/reopen', () => {
  it('flips a resolved thread back to open and posts a note', async () => {
    const app = await makeApp();
    const m = newThread();
    inboxStore.updateStatus(m.id, 'resolved');
    const res = await request(app).post(`/inbox/${m.id}/reopen`).set(AJAX);
    expect(res.status).toBe(204);
    expect(inboxStore.get(m.id)!.status).toBe('open');
    expect(inboxStore.listResponses(m.id).some((r) => r.role === 'system' && /reopened/i.test(r.body))).toBe(true);
  });
});

describe('POST /inbox/:id/summarize', () => {
  it('posts a derived summary as a system note', async () => {
    const app = await makeApp();
    const m = newThread();
    inboxStore.addResponse(m.id, 'user', 'Please show me a random comic');
    const res = await request(app).post(`/inbox/${m.id}/summarize`).set(AJAX);
    expect(res.status).toBe(204);
    const sys = inboxStore.listResponses(m.id).find((r) => r.role === 'system');
    expect(sys?.body).toMatch(/Thread summary/);
    expect(sys?.body).toMatch(/Goal: Please show me a random comic/);
  });
});
