import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { NotebookStore } from '@some-useful-agents/core';
import { S, makeApp, COOKIE, PORT } from './notebooks.test-kit.js';

// What you asked sua to find out is an answer: the pages you go through say
// so (URLs and names inside stay /notebooks).
const visible = (page: string) => page
  .replace(/<(script|style|template)[\s\S]*?<\/\1>/gi, ' ')
  // What a box or button says counts too.
  .replace(/\b(?:placeholder|aria-label|title)="([^"]*)"/g, '> $1 <')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ');

describe('Answers', () => {
  it('/answers and anything under it go to the same page under /notebooks, the query kept', async () => {
    const app = await makeApp();
    const get = (p: string) => request(app).get(p).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect((await get('/answers')).headers.location).toBe('/notebooks');
    expect((await get('/answers/new?text=hot%20dogs')).headers.location).toBe('/notebooks/new?text=hot%20dogs');
    expect((await get('/answers/car/brief.html')).headers.location).toBe('/notebooks/car/brief.html');
  });

  it('the top bar, Home, the list, Ask a question and an answer\'s page say "answer", never "notebook"', async () => {
    const app = await makeApp();
    const get = async (p: string) => (await request(app).get(p).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Is a hot dog a sandwich', statement: 'Settle it with sources' });
    for (const path of ['/', '/notebooks', '/notebooks/new', `/notebooks/${nb.id}`]) {
      const words = visible(await get(path));
      expect(words, path).toMatch(/\bAnswers?\b|\bAsk a question\b/);
      const said = words.match(/[^.]{0,40}\bnotebooks?\b[^.]{0,40}/gi) ?? [];
      expect(said, path).toEqual([]);
    }
  });
});

// An answer's header and its conversation: what you asked, how many sources,
// Print, where it was asked; a follow-up at its foot, linked both ways.
describe("an answer's header and its conversation", () => {
  it('shows what you asked, its sources, Print and More formats, and links the conversation it was asked in', async () => {
    const app = await makeApp();
    const get = async (p: string) => (await request(app).get(p).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const { InboxStore } = await import('@some-useful-agents/core');
    const inbox = InboxStore.fromHandle(S.runStore.databaseHandle());
    const thread = inbox.add({ priority: 'medium', source: 'manual', title: 'Hot dogs', body: 'is a hot dog a sandwich, by law and by dictionary?' })!;
    const nb = store.create({ title: 'Is a hot dog a sandwich', statement: 'Settle it with sources', asked: 'is a hot dog a sandwich, by law and by dictionary?' });
    store.setSteps(nb.id, [{ title: 'Find sources', kind: 'find', target: 2 }, { title: 'Write the answer', kind: 'write', shape: 'answer' }]);
    store.setAskedIn(nb.id, thread.id);
    store.setAskedIn(nb.id, 'another-thread');
    expect(store.get(nb.id)!.askedIn).toBe(thread.id);
    const a = store.addEntry(nb.id, { kind: 'evidence', title: 'Dictionary', body: '"a sandwich is two slices of bread with a filling" Dictionary', by: 'x', source: 'https://dict.example/sandwich' });
    store.addEntry(nb.id, { kind: 'evidence', title: 'Council', body: '"a hot dog is its own thing entirely" Council', by: 'x', source: 'https://council.example/hot-dog' });
    store.setEntryTrace(nb.id, a.id, 'found');
    const page = await get(`/notebooks/${nb.id}`);
    expect(page).toContain('<span class="nb-hero__asked-label">You asked</span> “is a hot dog a sandwich, by law and by dictionary?”');
    expect(page).toContain(' · 2 sources, 1 checked · ');
    expect(page).toContain(`<a href="/inbox/${thread.id}" title="The conversation you asked it in">From this conversation →</a>`);
    expect(page).toContain(`href="/notebooks/${nb.id}/brief.html" target="_blank" rel="noopener" title="The answer as a page to print, save as a PDF or send">Print</a>`);
    expect(page).toContain('>More</summary>');
    expect(page).toContain(`action="/notebooks/${nb.id}/follow-up"`);
    // The conversation lists it.
    const conv = await get(`/inbox/${thread.id}/fragment`);
    expect(conv).toMatch(new RegExp(`Answers from this conversation</span> <a href="/notebooks/${nb.id}">Is a hot dog a sandwich</a>`));
  });

  it('a follow-up is a new answer asked in this one\'s conversation; each lists the other', async () => {
    const app = await makeApp();
    const post = (p: string, body: Record<string, string>) => request(app).post(p).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const get = async (p: string) => (await request(app).get(p).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Headphones for flights', statement: 'Best noise-cancelling under $300' });
    S.stepsReply = () => `<draft>${JSON.stringify({ title: 'Do they fold flat', statement: 'Which of them fold flat', steps: [{ title: 'Find 2 pairs', kind: 'find', target: 2 }] })}</draft>`;
    const empty = await post(`/notebooks/${nb.id}/follow-up`, { question: '  ' });
    expect(decodeURIComponent(empty.headers.location)).toContain('Say what you want to find out next.');
    const res = await post(`/notebooks/${nb.id}/follow-up`, { question: 'Which of these fold flat?' });
    expect(decodeURIComponent(res.headers.location)).toContain('It will be listed under Follow-ups here');
    const conv = store.get(nb.id)!.conversationId!;
    for (let i = 0; i < 200 && !store.askedInThread(conv).length; i++) await new Promise((r) => setTimeout(r, 25));
    const [follow] = store.askedInThread(conv);
    expect(follow).toMatchObject({ asked: 'Which of these fold flat? (following up on “Headphones for flights”)', askedIn: conv });
    expect(await get(`/notebooks/${nb.id}`)).toContain(`Follow-ups</span> <a href="/notebooks/${follow.id}">${follow.title}</a>`);
    expect(await get(`/notebooks/${follow.id}`)).toContain(`<a href="/inbox/${conv}" title="The conversation you asked it in">From this conversation →</a>`);
    S.stepsReply = undefined;
  });
});

// The top bar: Answers and Settings, the rest under More; Home leads with a question box.
describe('the top bar and Home', () => {
  it('has Answers, Settings and More (Agents, Experiments, Pulse, Help); More shows the page you are on', async () => {
    const { topbarNav } = await import('../views/layout.js');
    const plain = String(topbarNav('notebooks'));
    expect([...plain.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1])).toEqual(['/notebooks', '/settings', '/agents', '/experiments', '/pulse', '/help']);
    expect(plain).toContain('<a href="/notebooks" class="is-active">Answers</a>');
    expect(plain).toMatch(/<summary class="">More<\/summary>/);
    const onAgents = String(topbarNav('runs'));
    expect(onAgents).toContain('<summary class="is-active">More<span class="topbar__more-now"> · Agents</span></summary>');
    expect(onAgents).toContain('href="/agents" class="is-active" aria-current="page"');
  });

  it('Home leads with Ask a question, three examples to start from, and your answers', async () => {
    const app = await makeApp();
    const home = (await request(app).get('/').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;
    // With no agents yet, Home is onboarding; with one, it's the question box.
    if (home.includes('No agents yet')) {
      S.agentStore.createAgent({ id: 'weather', name: 'Weather', status: 'active', source: 'local', mcp: false, nodes: [{ id: 'n', type: 'shell', command: 'echo hi' }] } as never, 'cli');
    }
    const page = (await request(app).get('/').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;
    expect(page).toContain('<h2 class="home-question__title" id="home-question-title">Ask a question</h2>');
    expect(page).toContain('Get back a researched answer you can check, laid out the same clear way every time.');
    expect(page.match(/class="ask-pill" data-ask-fill=/g)?.length).toBeGreaterThanOrEqual(3);
    expect(page.indexOf('home-question-title')).toBeLessThan(page.indexOf('data-home-today'));
  });
});
