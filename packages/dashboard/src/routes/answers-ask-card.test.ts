import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { S, makeApp, COOKIE, PORT } from './notebooks.test-kit.js';

// One place to ask (the answer prototype): Home has its question box and no
// bar above it; beside an answer, one card asks a follow-up or tells sua
// about this one, each follow-up with where it stands.
describe('one place to ask', () => {
  const setup = async () => {
    const app = await makeApp();
    const { NotebookStore, InboxStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const inbox = InboxStore.fromHandle(S.runStore.databaseHandle());
    const get = async (p: string) => (await request(app).get(p).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;
    return { store, inbox, get };
  };

  it('Home has one ask form, its question box; other pages keep the bar', async () => {
    const { get } = await setup();
    S.agentStore.createAgent({ id: 'weather', name: 'Weather', status: 'active', source: 'local', mcp: false, nodes: [{ id: 'n', type: 'shell', command: 'echo hi' }] } as never, 'cli');
    const home = await get('/');
    // The question box, and no bar above it (the ⌘K panel's own box stays).
    expect(home).toContain('home-ask-card--lead');
    expect(home).not.toContain('home-ask--bar');
    expect(await get('/notebooks')).toContain('home-ask--bar');
  });

  it("beside a done answer, Ask a follow-up opens first; follow-ups say where they stand; Tell sua is the other tab", async () => {
    const { store, inbox, get } = await setup();
    const nb = store.create({ title: 'Headphones for flights' });
    store.setSteps(nb.id, [{ title: 'Find 2', kind: 'find', target: 2, status: 'done' }, { title: 'Pick one', kind: 'decide', target: 1 }]);
    store.upsertOption(nb.id, { title: 'Pair A', by: 'you', data: {} });
    const thread = inbox.add({ priority: 'medium', source: 'manual', title: `Answer: ${nb.title}`, body: '(empty)' })!;
    store.setConversation(nb.id, thread.id);
    const a = store.create({ title: 'Do they fold flat' });
    store.setSteps(a.id, [{ title: 'Find 2', kind: 'find', target: 2, status: 'done' }]);
    store.setAskedIn(a.id, thread.id);
    const b = store.create({ title: 'Which ships to Canada' });
    store.setSteps(b.id, [{ title: 'Find 2', kind: 'find', target: 2, status: 'running' }]);
    store.setAskedIn(b.id, thread.id);
    const html = await get(`/notebooks/${nb.id}`);
    expect(html).toMatch(/aria-selected="true" aria-controls="nb-tab-follow" data-nb-tab="follow">Ask a follow-up</);
    expect(html).toMatch(/data-nb-tab="talk">Tell sua about this one</);
    expect(html).toMatch(/id="nb-tab-talk" role="tabpanel" data-nb-tabpanel="talk" aria-labelledby="nb-talk-title" hidden/);
    expect(html).toContain(`<a href="/notebooks/${a.id}">Do they fold flat</a><span class="nb-follow__state nb-follow__state--done">Done →</span>`);
    expect(html).toContain(`<a href="/notebooks/${b.id}">Which ships to Canada</a><span class="nb-follow__state nb-follow__state--working">Under way</span>`);
    // The talk form still posts where it did.
    expect(html).toContain(`action="/notebooks/${nb.id}/ask"`);
    expect(html).toContain(`action="/notebooks/${nb.id}/follow-up"`);
  });

  it('while its steps are going, Tell sua opens first', async () => {
    const { store, inbox, get } = await setup();
    const nb = store.create({ title: 'Headphones' });
    store.setSteps(nb.id, [{ title: 'Find 2', kind: 'find', target: 2 }, { title: 'Pick one', kind: 'decide', target: 1 }]);
    store.upsertOption(nb.id, { title: 'Pair A', by: 'you', data: {} });
    const thread = inbox.add({ priority: 'medium', source: 'manual', title: 'Answer: Headphones', body: '(empty)' })!;
    store.setConversation(nb.id, thread.id);
    const html = await get(`/notebooks/${nb.id}`);
    expect(html).toMatch(/aria-selected="true" aria-controls="nb-tab-talk"/);
    expect(html).toMatch(/data-nb-tabpanel="follow" hidden/);
  });
});
