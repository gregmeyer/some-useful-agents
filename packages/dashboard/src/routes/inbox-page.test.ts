import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { createTestContext, closeTestContext, TEST_TOKEN, type TestContext } from '../test-harness.js';
import { buildDashboardApp } from '../index.js';
import { InboxStore } from '@some-useful-agents/core';

// The Inbox page (the inbox cleanup): /inbox is the Inbox, not Home: its crumb,
// its name and one line of where it stands with Autonomy on it. Home's goal,
// intro and Adjust Home stay on Home.
const PORT = 3988;
let t: TestContext | undefined;
afterEach(async () => { await closeTestContext(t); t = undefined; });

async function app() {
  t = await createTestContext({ port: PORT, prefix: 'sua-inbox-page-' });
  t.ctx.inboxStore = InboxStore.fromHandle(t.ctx.runStore.databaseHandle());
  t.ctx.agentStore.createAgent({ id: 'weather', name: 'Weather', status: 'active', source: 'local', mcp: false, nodes: [{ id: 'n', type: 'shell', command: 'echo hi' }] } as never, 'cli');
  return buildDashboardApp(t.ctx);
}
const get = (a: Awaited<ReturnType<typeof app>>, p: string) => request(a).get(p).set('Host', `127.0.0.1:${PORT}`).set('Cookie', `sua_dashboard_session=${TEST_TOKEN}`);

describe('the Inbox page', () => {
  it('/inbox is the Inbox: Home › Inbox, its name, what needs you and what is open, Autonomy; no Home goal or intro', async () => {
    const a = await app();
    const inbox = t!.ctx.inboxStore!;
    const m = inbox.add({ priority: 'medium', source: 'manual', title: 'Pick a colour', body: '(empty)' })!;
    inbox.addResponse(m.id, 'triage', 'Blue or green?');
    inbox.updateStatus(m.id, 'awaiting_user');
    const page = (await get(a, '/inbox')).text;
    expect(page).toContain('<title>Inbox');
    expect(page).toMatch(/<h1>Inbox<\/h1>/);
    expect(page).toContain('href="/">Home</a>');
    expect(page).toMatch(/inbox-head__meta">[\s\S]*?1 needs you[\s\S]*?1 open[\s\S]*?action="\/inbox\/trust\/mode"/);
    expect(page).not.toContain('home-head__goal');
    expect(page).not.toContain('data-intro-key="home"');
    expect(page).toContain('data-inbox-split');
    // A thread's own address is the same page with it open.
    expect((await get(a, `/inbox/${m.id}`)).text).toContain(`data-initial-thread="${m.id}"`);
  });

  it('Home keeps its own page', async () => {
    const a = await app();
    const home = (await get(a, '/')).text;
    expect(home).toMatch(/<h1>Home<\/h1>/);
    expect(home).not.toContain('inbox-head__meta');
  });
});
