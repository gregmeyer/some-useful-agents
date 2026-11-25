import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InboxStore } from '@some-useful-agents/core';
import { S, makeApp, COOKIE, PORT } from './notebooks.test-kit.js';

describe('notebooks pages', () => {
  const post = (app: Awaited<ReturnType<typeof makeApp>>, path: string, body: Record<string, string>) => request(app).post(path)
    .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
  const get = (app: Awaited<ReturnType<typeof makeApp>>, path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);

  it("an answer's TL;DR card: not on its brief by default (it says the answer again); Always puts it back, Auto takes it away", async () => {
    const app = await makeApp();
    const { NotebookStore, layoutPreset } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Understand A2UI vs AG-UI' });
    store.setSteps(nb.id, [{ title: 'Write the answer', kind: 'write', shape: 'answer' }]);
    store.setAnswer(nb.id, { question: 'How do they differ?', by: 'agent:notebook-writer', text: 'A2UI describes the interface; AG-UI carries events.', confidence: 'medium', basis: '', findings: [{ text: 'A2UI is a spec.', from: [] }], open: [], at: new Date().toISOString() });
    // A page composed with the TL;DR picture under its title, as the writer often draws one.
    const layout = layoutPreset('answer')!.layout;
    const components = layout.components.map((c) => (c.id === 'root' ? { ...c, children: ['tldr_pic', ...(c.children as string[])] } : c));
    store.setLayout(nb.id, { ...layout, components: [...components, { id: 'tldr_pic', component: 'Picture', picture: { path: '/notebook/picture' } }] }, 'agent:notebook-writer');
    const card = /<article class="tl[ "]/;
    expect((await get(app, `/notebooks/${nb.id}/brief.html`)).text).not.toMatch(card);
    // Nor on its page: the Picture part has no picture to draw.
    expect((await get(app, `/notebooks/${nb.id}`)).text).not.toContain('tldr.png?v=');
    expect((await post(app, `/notebooks/${nb.id}/tldr-card`, { mode: 'always' })).status).toBe(303);
    expect((await get(app, `/notebooks/${nb.id}`)).text).toContain('tldr.png?v=');
    expect(store.get(nb.id)!.tldrCard).toBe('always');
    expect((await get(app, `/notebooks/${nb.id}/brief.html`)).text).toMatch(card);
    await post(app, `/notebooks/${nb.id}/tldr-card`, { mode: 'auto' });
    expect(store.get(nb.id)!.tldrCard).toBeUndefined();
    expect((await get(app, `/notebooks/${nb.id}/brief.html`)).text).not.toMatch(card);
    expect((await post(app, `/notebooks/${nb.id}/tldr-card`, { mode: 'sometimes' })).headers.location).toContain(encodeURIComponent('Choose Auto, Always or Never.'));
  });

  it('with no notebooks, says what one is and offers ways to start, then your templates', async () => {
    const app = await makeApp();
    const page = (await get(app, '/notebooks')).text;
    expect(page).toContain('No notebooks yet');
    expect(page).not.toContain('No active notebooks');
    expect(page.match(/class="nbl-empty__start" href="\/notebooks\/new\?text=/g)).toHaveLength(3);
    expect(page).toContain(`href="/notebooks/new?text=${encodeURIComponent('A quiet 2-bed rental in Fremont under $2,600, decide by next month')}"`);
    expect(page).toContain('href="/notebooks/new">Describe your own →</a>');
    expect(page).not.toContain('nbl-empty__tpl');

    // A template outlives the notebook it came from: offered while you have none.
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const seed = store.create({ title: 'Meet a founder', statement: 'Prepare for a meeting' });
    store.saveTemplate('Meeting prep', seed.id);
    store.delete(seed.id);
    const withTpl = (await get(app, '/notebooks')).text;
    expect(withTpl).toContain('Or start from one of your templates: <a href="/notebooks/new#nbd-tpl-h">Meeting prep</a>');

    // Once there is one, the list (and a search with no matches) is as before.
    const bike = store.create({ title: 'Buy a bike', statement: 'A commuter bike' });
    const listed = (await get(app, '/notebooks?q=nothing-like-this')).text;
    expect(listed).not.toContain('No notebooks yet');
    expect(listed).toContain('No active notebooks matching');
    expect(listed).toContain('<a href="/notebooks">Clear the search</a>');
    expect(listed).not.toContain('nbl-empty__start');

    // All archived: Active and All say where they are, with ways to start.
    store.archive(bike.id);
    for (const path of ['/notebooks', '/notebooks?status=all']) {
      const none = (await get(app, path)).text;
      expect(none).toContain(path === '/notebooks' ? 'No active notebooks' : 'No notebooks in use');
      expect(none).toContain('Yours are under <a href="/notebooks?status=archived">Archived (1)</a>.');
      expect(none.match(/class="nbl-empty__start"/g)).toHaveLength(3);
      expect(none).toContain('Meeting prep</a>');
    }
    expect((await get(app, '/notebooks?status=archived')).text).toContain('Buy a bike');
  });

  it('a calmer header: no "active" chip, a statement that repeats the title is left out, and how it was made is in the meta line', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const same = store.create({ title: 'Prepare for a meeting with Dana', statement: 'Prepare for a meeting with Dana.' });
    const page = (await get(app, `/notebooks/${same.id}`)).text;
    const hero = page.slice(page.indexOf('class="nb-hero'), page.indexOf('</section>', page.indexOf('class="nb-hero')));
    expect(hero).not.toContain('nb-status--active');
    expect(hero).not.toContain('<p class="nb-hero__statement">');
    // The title, its star and any status share a line; nothing has run yet, so the meta line's link is How it was made.
    expect(hero).toMatch(/<div class="nb-hero__nameline"><h1 class="nb-hero__title" id="nb-title">Prepare for a meeting with Dana<\/h1><form method="POST" action="\/notebooks\/[^"]+\/star" class="nb-hero__star">/);
    expect(hero).toMatch(/<span class="nb-hero__meta">started [^<]+ · runs when you ask · <a href="\/notebooks\/[^"]+\/workflow">How it was made →<\/a><\/span>/);

    // A statement that says more still shows; a decided notebook still says so.
    const more = store.create({ title: 'Buy a bike', statement: 'A commuter bike under $800' });
    store.setStatus(more.id, 'decided');
    const decided = (await get(app, `/notebooks/${more.id}`)).text;
    expect(decided).toContain('<p class="nb-hero__statement">A commuter bike under $800</p>');
    expect(decided).toContain('nb-status--decided');
  });

  it('a star: the list puts starred notebooks first and under Starred; it toggles from a card or the page and goes back where you were', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const older = store.create({ title: 'Plan a trip', statement: 'A week away' });
    store.create({ title: 'Buy a bike', statement: 'A commuter bike' });
    const before = store.get(older.id)!.updatedAt;

    // No stars yet: no Starred tab, and each card offers one.
    const plain = (await get(app, '/notebooks')).text;
    expect(plain).not.toContain('★ Starred');
    expect(plain).toContain(`action="/notebooks/${older.id}/star"`);
    expect(plain).toContain('aria-label="Star Plan a trip"');

    // Starring from the list goes back to the list (with its query) and doesn't count as a change.
    expect(plain).toContain('name="back" value="/notebooks"');
    const res = await post(app, `/notebooks/${older.id}/star`, { starred: '1', back: '/notebooks?sort=title' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/notebooks?sort=title');
    expect(store.get(older.id)!.starredAt).toBeTruthy();
    expect(store.get(older.id)!.updatedAt).toBe(before);

    // Starred first whatever the sort; a Starred tab lists only those.
    const listed = (await get(app, '/notebooks?sort=title')).text;
    expect(listed.indexOf('Plan a trip')).toBeLessThan(listed.indexOf('Buy a bike'));
    expect(listed).toContain('★ Starred <span class="nb-tabs__n">1</span>');
    expect(listed).toContain('aria-label="Unstar Plan a trip"');
    const starred = (await get(app, '/notebooks?status=starred')).text;
    expect(starred).toContain('Plan a trip');
    expect(starred).not.toContain('Buy a bike');

    // The page has it too; a back that isn't a page here isn't followed; no value flips it.
    expect((await get(app, `/notebooks/${older.id}`)).text).toContain('class="nb-hero__star"');
    for (const back of ['//example.com/x', 'https://example.com/x', '/\\example.com']) {
      expect((await post(app, `/notebooks/${older.id}/star`, { starred: '1', back })).headers.location).toBe(`/notebooks/${older.id}`);
    }
    const off = await post(app, `/notebooks/${older.id}/star`, {});
    expect(off.headers.location).toBe(`/notebooks/${older.id}`);
    expect(store.get(older.id)!.starredAt).toBeUndefined();
    expect((await post(app, '/notebooks/no-such/star', { starred: '1' })).headers.location).toBe('/notebooks');
  });

  it("Download / share: a briefing leads with the brief and offers its findings as a spreadsheet; a shortlist asks which options", async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const meet = store.create({ title: 'Prepare for a meeting with Dana Reyes', statement: 'Help me prepare.' });
    store.setSteps(meet.id, [{ title: 'Find 5 themes', kind: 'find', target: 5 }, { title: 'Write the talking points', kind: 'write' }]);
    store.upsertOption(meet.id, { title: 'Scaling ops teams', by: 'you', data: {} });
    const menu = (await get(app, `/notebooks/${meet.id}`)).text.split('nb-csv__panel')[1].split('</details>')[0];
    expect(menu).not.toContain('Which options?');
    expect(menu).not.toContain('In the running');
    // One row a thing to share, its forms as short links: the brief (open, PDF, HTML), the picture, every finding in full.
    expect(menu).toContain('<span class="nb-share__what">The brief</span>');
    expect(menu).toContain('<span class="nb-share__what">Every finding in full</span>');
    expect(menu).toContain(`href="/notebooks/${meet.id}/brief.pdf" download title="The brief as a PDF file named after the notebook, ready to send: its pictures inside it, page numbers, no print dialog" aria-label="Download the brief as PDF">PDF</a>`);
    expect(menu).toContain(`aria-label="Download the TL;DR picture as PNG">PNG</a>`);
    // …and the TL;DR card's switch: Auto unless you chose.
    // …and, last, To another sua: the notebook file.
    expect(menu.match(/class="nb-share__row"/g)).toHaveLength(5);
    expect(menu.indexOf('To another sua')).toBeGreaterThan(menu.indexOf('The findings as a spreadsheet'));
    expect(menu).toContain(`href="/notebooks/${meet.id}/export.suanb" download`);
    expect(menu).toContain(`action="/notebooks/${meet.id}/tldr-card"`);
    expect(menu).toMatch(/class="nb-share__mode is-on"[^>]*aria-pressed="true">Auto</);
    expect(menu.indexOf('To share')).toBeLessThan(menu.indexOf('The findings as a spreadsheet'));
    expect(menu).toContain('href="/notebooks/prepare-for-a-meeting-with-dana-reyes/shortlist.csv?rows=running" download title="Every finding still in, with its facts and sources">What it found (CSV) <span class="nb-csv__n">1</span>');

    const car = store.create({ title: 'Buy a used car', statement: 'A reliable SUV' });
    store.upsertOption(car.id, { title: '2012 RAV4', by: 'you', data: {} });
    const shop = (await get(app, `/notebooks/${car.id}`)).text.split('nb-csv__panel')[1].split('</details>')[0];
    // To share comes first, then the spreadsheets.
    expect(shop.indexOf('To share')).toBeLessThan(shop.indexOf('The options as a spreadsheet'));
    expect(shop).toContain('In the running');
    expect(shop).toContain('<span class="nb-share__what">Each option in full</span>');
    expect(shop).not.toContain("What's new");

    // An answer explained from sources alone (evidence, no options) still shares its brief and picture.
    const ask = store.create({ title: 'Understand A vs B', statement: 'Help me understand the difference.' });
    store.setSteps(ask.id, [{ title: 'Find 8 sources', kind: 'find', target: 8 }, { title: 'Write the answer', kind: 'write', shape: 'answer' }]);
    store.addEntry(ask.id, { kind: 'evidence', title: 'A describes it, B carries it', body: 'From the spec.', by: 'agent:x', source: 'https://a.example/spec' });
    const said = (await get(app, `/notebooks/${ask.id}`)).text.split('nb-csv__panel')[1].split('</details>')[0];
    expect(said).toContain('<span class="nb-share__what">The brief</span>');
    expect(said).toContain('aria-label="Download the TL;DR picture as PNG">PNG</a>');
    // No options: no spreadsheet and no "in full" (they'd be empty).
    expect(said).not.toContain('shortlist.csv');
    expect(said).not.toContain('Every finding in full');
    const brief = await get(app, `/notebooks/${ask.id}/brief.html`);
    expect(brief.status).toBe(200);
    expect(brief.text).toContain('A describes it, B carries it');

    // A shortlist with nothing in it yet has nothing to share.
    const empty = store.create({ title: 'Buy a desk', statement: 'A standing desk' });
    expect((await get(app, `/notebooks/${empty.id}`)).text).not.toContain('nb-csv__panel');
  });

  it("a briefing run again says what's new since the run before, marks its facts, and so does its brief", async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Prepare for a meeting with Dana Reyes', statement: 'Help me prepare.' });
    const [profile] = store.setSteps(nb.id, [{ title: 'Learn about Dana Reyes', kind: 'profile', subject: 'Dana Reyes' }]).steps!;
    // A meeting briefing's page (its brief prints as that page).
    const { layoutPreset } = await import('@some-useful-agents/core');
    store.setLayout(nb.id, layoutPreset('dossier')!.layout);
    const look = (d: string, facts: Array<{ key: string; value: string }>) => {
      const id = store.startPass(nb.id, 'pipeline', `2026-10-${d}T10:00:00.000Z`, { stepId: profile.id });
      store.setAbout(nb.id, 'person', { name: 'Dana Reyes', facts }, `2026-10-${d}T10:30:00.000Z`);
      store.finishPass(id, 'research-one: learned', `2026-10-${d}T11:00:00.000Z`);
    };
    look('26', [{ key: 'role', value: 'VP Ops' }, { key: 'location', value: 'Austin' }]);
    // One run: nothing to compare with.
    expect((await get(app, `/notebooks/${nb.id}`)).text).not.toContain('nb-new');
    look('28', [{ key: 'role', value: 'COO' }, { key: 'location', value: 'Austin' }, { key: 'revenue', value: '$4M' }]);
    const page = (await get(app, `/notebooks/${nb.id}`)).text;
    expect(page).toContain("What's new since Oct 26");
    expect(page).toContain('<li>1 new fact: Revenue</li>');
    expect(page).toContain('<li>Changed: Role, VP Ops → COO</li>');
    // The fact sheet's rows carry the mark (the page draws it).
    const { notebookWidgetData } = await import('../lib/notebook-widgets.js');
    const data = notebookWidgetData(store.get(nb.id)!, [], store).notebook;
    const facts = data.facts;
    expect(facts.find((f) => f.label === 'Role')).toMatchObject({ value: 'COO', mark: 'changed', was: 'VP Ops' });
    expect(facts.find((f) => f.label === 'Revenue')).toMatchObject({ mark: 'new' });
    expect(facts.find((f) => f.label === 'Location')!.mark).toBeUndefined();
    // The timeline says it looked again, with what's new.
    expect(data.timeline.find((t) => t.title === 'Looked again: Learn about Dana Reyes')).toMatchObject({ body: '1 new fact: Revenue · Changed: Role, VP Ops → COO' });
    // The brief leaves what's new out unless asked for (?new=1).
    expect((await get(app, `/notebooks/${nb.id}/brief.html`)).text).not.toContain('class="whatsnew"');
    const brief = (await get(app, `/notebooks/${nb.id}/brief.html?new=1`)).text;
    expect(brief).toContain("What's new since");
    expect(brief).toContain('<span class="mark">changed</span> <span class="muted">(was VP Ops)</span>');
    // Again with nothing new: it says so.
    look('29', [{ key: 'role', value: 'COO' }]);
    expect((await get(app, `/notebooks/${nb.id}`)).text).toContain('nothing new since Oct 28.');
  });

  it('starts a notebook, shows its cover, adds entries, ticks criteria, decides', async () => {
    const app = await makeApp();
    const empty = await get(app, '/notebooks');
    expect(empty.text).toContain('+ New notebook');
    expect(empty.text).toContain('class="btn btn--primary btn--sm nbl-new__btn" href="/notebooks/new"');

    const made = await post(app, '/notebooks', { title: 'Buy a used car', statement: 'Find a reliable SUV', params: 'AWD\nunder $26k', criteria: 'One fits\nClean history\nDecided' });
    expect(made.status).toBe(303);
    expect(made.headers.location).toMatch(/^\/notebooks\/buy-a-used-car\?flash=/);

    await post(app, '/notebooks/buy-a-used-car/edit', { title: 'Buy a used car', statement: 'Find a reliable SUV', params: 'AWD\nunder $26k', criteria: 'One fits\nClean history\nDecided', pipeline: 'sched-agent\nnot-there', cadence: '0 7 * * *' });
    const bad = await post(app, '/notebooks/buy-a-used-car/edit', { title: 'x', cadence: 'every day' });
    expect(decodeURIComponent(bad.headers.location)).toContain("isn't a schedule sua understands");

    await post(app, '/notebooks/buy-a-used-car/entries', { kind: 'option', title: '2019 RAV4 XLE', body: '54k mi, $24,900' });
    await post(app, '/notebooks/buy-a-used-car/criteria/0', { met: '1' });
    const page = await get(app, '/notebooks/buy-a-used-car');
    expect(page.status).toBe(200);
    expect(page.text).toContain('class="nb-hero"');
    expect(page.text).toContain('aria-label="1 of 3 criteria met"');
    expect(page.text).toContain('<span class="nb-chip">AWD</span>');
    expect(page.text).toContain('runs every day at 7:00 AM');
    expect(page.text).toMatch(/class="nb-pipe"[\s\S]*sched-agent \(not run yet\), not-there \(not installed\)/);
    expect(page.text).toContain('data-surface-region="options"');
    expect(page.text).toContain('2019 RAV4 XLE');

    await post(app, '/notebooks/buy-a-used-car/decide', { decision: 'Buy the RAV4' });
    const done = await get(app, '/notebooks/buy-a-used-car');
    expect(done.text).toContain('nb-status--decided');
    expect(done.text).toContain('Buy the RAV4');
    expect(done.text).toContain('>Reopen</button>');
    expect((await get(app, '/notebooks?status=decided')).text).toContain('Buy the RAV4');
    expect((await get(app, '/notebooks/nope')).status).toBe(303);
  });

  it('done-whens the work meets tick themselves when the page opens, and say so; your untick stays', async () => {
    const app = await makeApp();
    await post(app, '/notebooks', { title: 'Cabinet', criteria: 'At least one cabinet that fits\nA decision recorded by Oct 20\nLooks nice' });
    await post(app, '/notebooks/cabinet/entries', { kind: 'option', title: 'BEARSOLIM 24-in' });
    const page = await get(app, '/notebooks/cabinet');
    expect(page.text).toContain('aria-label="1 of 3 criteria met"');
    expect(page.text).toContain('title="Ticks itself when you decide."');
    expect(page.text).not.toMatch(/title="Ticks itself[^"]*">Looks nice/);
    await post(app, '/notebooks/cabinet/criteria/0', { met: '0' });
    expect((await get(app, '/notebooks/cabinet')).text).toContain('aria-label="0 of 3 criteria met"');
  });

});

describe('filing into a notebook of organizations', () => {
  it('shows that it is working: the running step turns, and background work is named in the header', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Gadgets', pipeline: ['sched-agent'] });
    store.setSteps(nb.id, [{ title: 'Find 5', kind: 'find', agentId: 'sched-agent', target: 5, status: 'running' }, { title: 'Pick one', kind: 'decide', target: 1 }]);
    const page = async () => (await request(app).get(`/notebooks/${nb.id}`).set('Cookie', COOKIE).set('Host', `127.0.0.1:${String(PORT)}`)).text;
    const ctx = (await import('../context.js')).getContext(app.locals);

    // A 'running' status left behind (nothing actually running): no spinner, no working line.
    let html = await page();
    expect(html).not.toContain('is-live');
    expect(html).not.toContain('data-notebook-running');

    // The step is really running, and photos are being found too.
    ctx.notebookPipelines ??= new Map();
    ctx.notebookPipelines.set(nb.id, { agentId: 'sched-agent', step: 1, of: 2, startedAt: Date.now() });
    ctx.notebookPictures ??= new Set();
    ctx.notebookPictures.add(nb.id);
    html = await page();
    expect(html).toMatch(/class="nb-step nb-step--running[^"]* is-live"/);
    // The standard working panel: the step as its title, the rest after, counting up from when it started.
    expect(html).toMatch(/data-notebook-running>\s*<div class="working working--panel"/);
    expect(html).toContain('<p class="working__title">Working on step 1: Find 5…</p>');
    expect(html).toContain('Also: Finding photos. This page updates as it goes');
    expect(html).toMatch(/data-working-since="\d{4}-\d\d-\d\dT/);
    // Scrolled past it, a pinned line keeps it in view (hidden until then).
    expect(html).toContain('data-nb-live-pin hidden');
    // The page says something is running; its script redraws the working panel in place (no reload).
    expect(html).toContain('data-nb-running="1"');
    expect(html).not.toContain('location.reload(); }, 6000)');

    // Only background work: still says so.
    ctx.notebookPipelines.delete(nb.id);
    html = await page();
    expect(html).toContain('<p class="working__title">Finding photos…</p>');
    expect(html).not.toContain('data-working-since');
    expect(html).toContain('data-nb-running="1"');
    ctx.notebookPictures.delete(nb.id);
  });

  it("says on the page when its conversation is waiting on you, or sua is replying there", async () => {
    const app = await makeApp();
    const { NotebookStore, InboxStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const inbox = InboxStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Staff PM roles' });
    store.addEntry(nb.id, { kind: 'note', title: 'Looking at AI platform teams', by: 'user' });
    const t = inbox.add({ priority: 'medium', source: 'manual', title: 'Staff PM roles', body: 'find roles' });
    store.setConversation(nb.id, t.id);
    const get = (path = '') => request(app).get(`/notebooks/${nb.id}${path}`).set('Cookie', COOKIE).set('Host', `127.0.0.1:${String(PORT)}`);

    // Quiet: no live bar, no callout, an empty live header.
    inbox.addResponse(t.id, 'triage', 'I filed 4 roles.');
    inbox.updateStatus(t.id, 'triaged');
    let html = (await get()).text;
    expect(html).toContain('data-nb-live-bar hidden');
    expect(html).not.toContain('nb-talk__waiting');
    expect((await get('/main')).headers['x-notebook-live']).toBe('');

    // You wrote; sua is answering.
    inbox.addResponse(t.id, 'user', 'Check the two at the top.');
    html = (await get()).text;
    expect(html).toContain('nb-live__row--working');
    expect(html).toContain('<strong>sua is working</strong> on a reply');
    expect(html).toContain(`data-nb-continue="${t.id}">Watch`);
    expect(html).toContain('class="nb-talk__working"');

    // sua asks something back: waiting on you, in the header, the Talk card and the poll.
    inbox.addResponse(t.id, 'triage', 'Both pass. Want me to check comp for them too?');
    inbox.updateStatus(t.id, 'awaiting_user');
    html = (await get()).text;
    expect(html).toContain('nb-live__row--waiting');
    expect(html).toContain('<strong>sua needs your answer</strong> · Want me to check comp for them too?');
    expect(html).toContain('nb-talk is-waiting');
    expect(html).toMatch(new RegExp(`class="nb-talk__waiting"[\\s\\S]*data-nb-continue="${t.id}">Answer sua`));
    const main = await get('/main');
    expect(decodeURIComponent(main.headers['x-notebook-live'])).toBe('waiting:Want me to check comp for them too?');
    expect(decodeURIComponent(main.headers['x-notebook-waiting'])).toBe('Want me to check comp for them too?');
    expect(html).toContain('data-nb-live="waiting:Want me to check comp for them too?"');

    // A card to approve reads as an OK.
    inbox.addResponse(t.id, 'action', 'Run comp check', JSON.stringify({ kind: 'action', status: 'proposed', agentId: 'comp-check', inputs: {} }));
    html = (await get()).text;
    expect(html).toContain('<strong>sua needs your OK</strong> · Run comp-check');
    expect(html).toContain('>Review and approve</button>');

    // Nothing asked in the conversation, but the next step is yours: that's what waits on you.
    inbox.updateStatus(t.id, 'triaged');
    store.setSteps(nb.id, [{ title: 'Pick the final 10 roles', kind: 'decide', target: 10 }]);
    html = (await get()).text;
    expect(html).toContain('<strong>Your step</strong> · Pick the final 10 roles');
    expect(html).toContain('data-nb-open-act="decide">Decide…</button>');
    expect(html).toContain(`data-nb-continue="${t.id}">Ask sua</button>`);
    expect(decodeURIComponent((await get('/main')).headers['x-notebook-waiting'])).toBe('Your step: Pick the final 10 roles');
    // Decided: nothing waits.
    store.setStatus(nb.id, 'decided');
    expect((await get('/main')).headers['x-notebook-waiting']).toBe('');
  });

  it("a decided notebook drawn as widgets: actions beside the title, its steps on one quiet row, its picks as a list", async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Peers' });
    store.setFields(nb.id, [{ key: 'employees', label: 'Employees', type: 'number' }]);
    const a = store.upsertOption(nb.id, { title: 'Acme: planning suite', by: 'you', data: { employees: 300 } }).entry;
    const b = store.upsertOption(nb.id, { title: 'Bolt', by: 'you', data: { employees: 90 } }).entry;
    store.setSteps(nb.id, [{ title: 'Find 2', kind: 'find', target: 2 }, { title: 'Pick 2', kind: 'decide', target: 2 }]);
    for (const id of ['s1', 's2']) store.updateStep(nb.id, id, { status: 'done' });
    store.decide(nb.id, 'Both fit.', 'you', [a.id, b.id]);
    const page = (await request(app).get(`/notebooks/${nb.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;
    expect(page).toContain('class="nb-hero nb-hero--wide"');
    expect(page).toMatch(/nb-hero__titlerow">[\s\S]*?<div class="nb-hero__acts">[\s\S]*?Reopen/);
    expect(page).not.toContain('nb-hero__side');
    expect(page).toContain('class="nb-steps nb-steps--done" style="--n:2"');
    expect(page).toContain('· 2 chosen');
    expect(page).toContain(`<a href="/notebooks/${nb.id}/entries/${a.id}">Acme</a> <span class="nb-decided__what">planning suite</span>`);
    expect(page).toContain('<p class="nb-decided__why">Both fit.</p>');
    // A decision in its own words shows as written.
    const { decidedBox } = await import('../views/notebooks.js');
    expect(String(decidedBox({ ...store.get(nb.id)!, decision: 'Went with neither.' }, store.entries(nb.id, 100)))).toMatch(/<strong>Decided [^<]*:<\/strong> Went with neither\.<\/div>/);
  });

  it('steps are set by hand and shown with how far each is toward its goal', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Comp set', pipeline: ['sched-agent'] });
    store.setFields(nb.id, [{ key: 'employees', label: 'Employees', type: 'number' }]);
    store.upsertOption(nb.id, { title: 'Acme Planning', by: 'you', data: { employees: 300 } });
    const post = (steps: unknown) => request(app).post(`/notebooks/${nb.id}/steps`).set('Cookie', COOKIE).set('Host', `127.0.0.1:${String(PORT)}`).send({ steps });

    const bad = await post([{ title: 'Find 3', kind: 'find', agentId: 'not-installed' }]);
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('No agent "not-installed".');

    const ok = await post([{ title: 'Find 3 companies', kind: 'find', agentId: 'sched-agent', target: 3 }, { title: 'Source their facts', kind: 'source' }]);
    expect(ok.status).toBe(200);
    expect(ok.body.steps.map((x: { id: string; status: string }) => `${x.id}:${x.status}`)).toEqual(['s1:todo', 's2:todo']);

    const page = await request(app).get(`/notebooks/${nb.id}`).set('Cookie', COOKIE).set('Host', `127.0.0.1:${String(PORT)}`);
    expect(page.text).toContain('class="nb-steps" style="--n:2"');
    expect(page.text).toContain('nb-step nb-step--todo nb-step--current" title="Still needed: 2 more"');
    expect(page.text).toContain('<span class="nb-step__count">1 of 3 found</span><span class="nb-step__state nb-step__state--todo">to do</span>');
    expect(page.text).toContain('with <span class="nb-step__agent" title="sched-agent">sched-agent</span>');
    expect(page.text).toContain('1 of 1 facts');
    // The source step has no agent of its own yet.
    expect(page.text).toContain('needs an agent');

    expect((await post([])).body.steps).toEqual([]);
    expect(store.get(nb.id)!.steps).toBeUndefined();
  });

  it('steps set up on a notebook partway done: the ones its work covers are done, and sua says where it starts', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Example peers', pipeline: ['sched-agent'] });
    store.setFields(nb.id, [{ key: 'employees', label: 'Employees', type: 'number' }]);
    store.setChecks(nb.id, ['Sells software']);
    store.upsertOption(nb.id, { title: 'Example Co 1', by: 'you', data: { employees: 300 } });
    const co2 = store.upsertOption(nb.id, { title: 'Example Co 2', by: 'you', data: {} }).entry;
    const steps = [
      { title: 'Find 2 companies', kind: 'find', agentId: 'sched-agent', target: 2 },
      { title: 'Source their facts', kind: 'source', agentId: 'sched-agent' },
      { title: 'Check them', kind: 'check' },
      { title: 'Pick 1', kind: 'decide', target: 1 },
    ];
    const res = await request(app).post(`/notebooks/${nb.id}/steps`).set('Cookie', COOKIE).set('Host', `127.0.0.1:${String(PORT)}`).send({ steps });
    expect(res.body.steps.map((x: { status: string; note?: string }) => `${x.status}:${x.note ?? ''}`)).toEqual(['done:2 of 2 found, already', 'todo:1 of 2 facts sourced', 'todo:', 'todo:']);
    // sua says so in the notebook's conversation; Next step starts at step 2.
    const thread = store.get(nb.id)!.conversationId!;
    const said = InboxStore.fromHandle(S.runStore.databaseHandle()).listResponses(thread);
    expect(said.at(-2)!.body).toBe('The notebook already has what this step needs, so it’s done: step 1, **Find 2 companies** (2 of 2 found). Next is step 2, **Source their facts** (1 of 2 facts sourced).');
    // …and the step it starts at waits on you there too, as the header's Next step does.
    expect(JSON.parse(said.at(-1)!.metaJson!)).toMatchObject({ agentId: 'notebook-step', status: 'proposed', ctaLabel: 'Start', inputs: { STEP: 's2', WAS: 'todo' } });
    const { nextStepAction } = await import('../views/notebooks.js');
    expect(nextStepAction(store.get(nb.id)!)).toMatchObject({ label: 'Next step', hint: 'Step 2 of 4: Source their facts' });

    // Once the facts are in, setting the steps again marks source done too; the check step is next.
    store.correctOption(nb.id, co2.id, { employees: 120 });
    const again = await request(app).post(`/notebooks/${nb.id}/steps`).set('Cookie', COOKIE).set('Host', `127.0.0.1:${String(PORT)}`).send({ steps });
    expect(again.body.steps.map((x: { status: string }) => x.status)).toEqual(['done', 'done', 'todo', 'todo']);
    expect(InboxStore.fromHandle(S.runStore.databaseHandle()).listResponses(thread).filter((r) => r.role === 'triage').map((r) => r.body).at(-1)).toContain('step 2, **Source their facts** (2 of 2 facts sourced). Next is step 3, **Check them** (0 of 2 checked).');

    // Every option checked: only Decide is left, and that's never done for you.
    for (const o of store.entries(nb.id, 100).filter((e) => e.kind === 'option')) store.checkOption(nb.id, o.id, 'Sells software', true);
    const last = await request(app).post(`/notebooks/${nb.id}/steps`).set('Cookie', COOKIE).set('Host', `127.0.0.1:${String(PORT)}`).send({ steps });
    expect(last.body.steps.map((x: { status: string }) => x.status)).toEqual(['done', 'done', 'done', 'todo']);
    expect(InboxStore.fromHandle(S.runStore.databaseHandle()).listResponses(thread).map((r) => r.body).at(-1)).toContain('Next is **Pick 1**, with Decide.');
  });

  it('the keeper can\'t write "Ruled out: …" about an option the notebook has; a new one it rules out is kept ruled out', async () => {
    await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { applyKeeperResult } = await import('../lib/notebook-pipeline.js');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb0 = store.create({ title: 'Comp set' });
    store.setFields(nb0.id, [{ key: 'company', label: 'Company', type: 'text', role: 'org' }, { key: 'founded', label: 'Founded', type: 'number' }]);
    store.upsertOption(nb0.id, { title: 'Vena: Excel-centered FP&A', by: 'you', data: { company: 'Vena' } });
    store.upsertOption(nb0.id, { title: 'Prophix: Office-of-CFO suite', by: 'you', data: { company: 'Prophix' } });
    const keeper = `<notebook>${JSON.stringify({ entries: [
      { kind: 'decision', title: 'Ruled out: Vena, founded 2011 with 501–1,000 employees', body: '' },
      { kind: 'decision', title: 'Ruled out - Prophix (founded 1987)', body: '' },
      { kind: 'decision', title: 'Skipped vendors outside North America and Europe', body: '' },
      { kind: 'option', title: 'Adaptive Insights', body: 'Founded 2003.', data: { company: 'Adaptive Insights', founded: 2003 }, ruleOut: 'Unfit: founded 2003, before 2015' },
    ] })}</notebook>`;
    const out = applyKeeperResult(store, store.get(nb0.id)!, 'firmographic-research', 'run-r', keeper, { source: 'Adaptive Insights founded 2003' });
    expect(out).toMatchObject({ added: 2, skipped: 2 });
    const all = store.entries(nb0.id);
    expect(all.filter((e) => e.kind === 'decision').map((e) => e.title)).toEqual(['Skipped vendors outside North America and Europe']);
    expect(all.find((e) => e.title === 'Adaptive Insights')?.ruledOut).toMatchObject({ reason: 'Unfit: founded 2003, before 2015', by: 'agent:firmographic-research' });
    expect(all.filter((e) => e.kind === 'option' && e.ruledOut).map((e) => e.title)).toEqual(['Adaptive Insights']);
  });

  it("a research result too long to read at once is read in parts, so every option it covers gets its fact (not only the ones before the cut)", async () => {
    await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { keep, passNote } = await import('../lib/notebook-pipeline.js');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb0 = store.create({ title: 'Batteries' });
    store.setFields(nb0.id, [{ key: 'warranty', label: 'Warranty', type: 'text' }]);
    const options = Array.from({ length: 8 }, (_, i) => store.upsertOption(nb0.id, { title: `Battery ${String(i + 1)}`, by: 'you' }).entry);
    const output = JSON.stringify({ headline: '8 of 8 researched.', results: options.map((o, i) => ({ subject: o.title, status: 'done', found: { warranty: { value: `${String(i + 6)} months free replacement`, quote: 'q'.repeat(2800) } } })) });
    expect(output.length).toBeGreaterThan(20_000);
    const saw: string[] = [];
    // The keeper files what the part in front of it says, and nothing else.
    S.ctx!.notebookKeeperRun = async (inputs) => {
      saw.push(inputs.RUN_OUTPUT);
      const part = JSON.parse(inputs.RUN_OUTPUT.slice(inputs.RUN_OUTPUT.indexOf('\n') + 1)) as { results: Array<{ subject: string; found: { warranty: { value: string } } }> };
      return `<notebook>${JSON.stringify({ entries: [], facts: part.results.map((r) => ({ id: options.find((o) => o.title === r.subject)!.id, data: { warranty: r.found.warranty.value } })), summary: `Added ${String(part.results.length)}.` })}</notebook>`;
    };
    const out = await keep(S.ctx!, store, store.get(nb0.id)!, 'research-fanout', 'run-w', output);
    expect(saw.length).toBeGreaterThan(1);
    for (const s of saw) expect(s).not.toContain('(truncated)');
    expect(out).toMatchObject({ added: 0, factsSet: 8 });
    expect(out.error).toBeUndefined();
    expect(passNote('research-fanout', out)).toBe('research-fanout: 0 new, 8 updated');
    expect(store.entries(nb0.id).filter((e) => e.kind === 'option').map((e) => e.data?.warranty).sort()).toEqual(options.map((_, i) => `${String(i + 6)} months free replacement`).sort());
    // A part the keeper fails on doesn't lose what the others filed; it is said.
    const again = store.create({ title: 'Batteries again' });
    store.setFields(again.id, [{ key: 'warranty', label: 'Warranty', type: 'text' }]);
    const more = Array.from({ length: 8 }, (_, i) => store.upsertOption(again.id, { title: `Battery ${String(i + 1)}`, by: 'you' }).entry);
    let n = 0;
    S.ctx!.notebookKeeperRun = async (inputs) => {
      if (++n === 1) return undefined;
      const part = JSON.parse(inputs.RUN_OUTPUT.slice(inputs.RUN_OUTPUT.indexOf('\n') + 1)) as { results: Array<{ subject: string; found: { warranty: { value: string } } }> };
      return `<notebook>${JSON.stringify({ entries: [], facts: part.results.map((r) => ({ id: more.find((o) => o.title === r.subject)!.id, data: { warranty: r.found.warranty.value } })) })}</notebook>`;
    };
    const half = await keep(S.ctx!, store, store.get(again.id)!, 'research-fanout', 'run-x', output);
    expect(half.error).toBeUndefined();
    expect(half.factsSet).toBeGreaterThan(0);
    expect(half.factsSet).toBeLessThan(8);
    expect(half.summary).toContain('Part of the output could not be read');
  });

  it("the keeper puts a run's figures for an option it already has onto that option, by id; numbers not in the output stay out", async () => {
    await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { applyKeeperResult, passNote } = await import('../lib/notebook-pipeline.js');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb0 = store.create({ title: 'Comp set' });
    store.setFields(nb0.id, [{ key: 'company', label: 'Company', type: 'text', role: 'org' }, { key: 'employees', label: 'Employees', type: 'number', role: 'measure', range: true }, { key: 'revenue', label: 'Revenue', type: 'money' }, { key: 'founded', label: 'Founded', type: 'number' }]);
    const vena = store.upsertOption(nb0.id, { title: 'Vena: Excel-centered FP&A', by: 'you', data: { company: 'Vena' } }).entry;
    const output = '{"companies":[{"company":"Vena","employees":"501-1,000 (LinkedIn)","revenue":"passed $100M ARR (https://venasolutions.com/press)","founded":2011}]}';
    const keeper = `<notebook>${JSON.stringify({ entries: [], facts: [{ id: vena.id, data: {
      employees: { value: { min: 501, max: 1000 }, estimate: true }, revenue: { value: 100000000, source: 'https://venasolutions.com/press', estimate: true }, founded: 2011, fit: 99,
    } }, { id: 'nope', data: { founded: 2011 } }] })}</notebook>`;
    const out = applyKeeperResult(store, store.get(nb0.id)!, 'firmographic-research', 'run-f', keeper, { source: output });
    expect(out).toMatchObject({ added: 0, factsSet: 1 });
    const after = store.entries(nb0.id).find((e) => e.id === vena.id)!;
    expect(after.data).toMatchObject({ company: 'Vena', employees: { min: 501, max: 1000 }, founded: 2011 });
    expect(after.factMeta?.revenue).toMatchObject({ source: 'https://venasolutions.com/press', estimate: true });
    expect(after.data).toMatchObject({ revenue: 100000000 });
    expect(after.data).not.toHaveProperty('fit'); // 99 is nowhere in the output (and not a field)
    expect(store.entries(nb0.id).filter((e) => e.kind === 'evidence')).toHaveLength(0);
    expect(passNote('firmographic-research', out)).toBe('firmographic-research: 0 new, 1 updated, 1 number not in its output left out');
  });

  it("a run that names a company the notebook has fills in its facts instead of adding it again", async () => {
    await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { applyKeeperResult } = await import('../lib/notebook-pipeline.js');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb0 = store.create({ title: 'Comp set' });
    store.setFields(nb0.id, [{ key: 'company', label: 'Company', type: 'text', role: 'org' }, { key: 'employees', label: 'Employees', type: 'number', role: 'measure' }, { key: 'founded', label: 'Founded', type: 'number' }]);
    store.upsertOption(nb0.id, { title: 'Motive: planning and forecasting', by: 'you', data: { company: 'Motive' } });
    store.upsertOption(nb0.id, { title: 'Everlaw: Q2C backlog', by: 'you', data: { company: 'Everlaw' } });
    const nb = store.get(nb0.id)!;
    const run = `Motive has 4,100 employees and was founded in 2013. Everlaw: 1,200 employees. Brightwave was founded in 2023.`;
    const out = applyKeeperResult(store, nb, 'firmographic-research', 'run-1', `<notebook>${JSON.stringify({ entries: [
      { kind: 'option', title: 'Motive', data: { company: 'Motive', employees: 4100, founded: 2013 } },
      // The same title it already has: refreshed, not skipped.
      { kind: 'option', title: 'Everlaw: Q2C backlog', data: { company: 'Everlaw', employees: 1200 } },
      { kind: 'option', title: 'Brightwave', data: { company: 'Brightwave', founded: 2023 } },
    ] })}</notebook>`, { source: run });
    expect(out).toMatchObject({ added: 1, refreshed: 2 });
    const opts = store.entries(nb.id).filter((e) => e.kind === 'option');
    expect(opts.map((e) => e.title).sort()).toEqual(['Brightwave', 'Everlaw: Q2C backlog', 'Motive: planning and forecasting']);
    expect(opts.find((e) => e.title.startsWith('Motive'))!.data).toEqual({ company: 'Motive', employees: 4100, founded: 2013 });
    expect(opts.find((e) => e.title.startsWith('Everlaw'))!.data).toEqual({ company: 'Everlaw', employees: 1200 });
  });
});

describe('notebook pipeline (G2–G3)', () => {
  it('the keeper sets fields once, records option facts, and refreshes an option found again', async () => {
    await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { applyKeeperResult } = await import('../lib/notebook-pipeline.js');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Buy a used commuter car' });
    const block = (o: unknown) => `<notebook>${JSON.stringify(o)}</notebook>`;
    const fields = [
      { key: 'price', label: 'Price', type: 'money', role: 'price' },
      { key: 'miles', label: 'Miles', type: 'number', unit: 'mi', role: 'measure' },
      { key: 'listing_url', label: 'Listing', type: 'url', role: 'link' },
    ];
    const rav4 = { kind: 'option', title: '2010 Toyota RAV4 Sport 4WD', body: 'Best fit.', data: { price: 4023, miles: 149652, listing_url: 'https://www.cargurus.com/l/123' } };

    const first = applyKeeperResult(store, nb, 'sweep', 'run-1', block({ fields, entries: [rav4, { kind: 'note', title: 'Edmunds blocked page reads' }] }));
    expect(first).toMatchObject({ added: 2, skipped: 0 });
    expect(store.get(nb.id)!.fields.map((f) => f.key)).toEqual(['price', 'miles', 'listing_url']);

    // Next run: the same car, cheaper, reworded; and a keeper that tries to change the fields.
    const second = applyKeeperResult(store, store.get(nb.id)!, 'sweep', 'run-2', block({
      fields: [{ key: 'rent', type: 'money' }],
      entries: [{ ...rav4, title: 'RAV4 Sport, Lynnwood', data: { price: '$3,900', listing_url: 'https://cargurus.com/l/123/' } }],
    }));
    expect(second).toMatchObject({ added: 0, refreshed: 1 });
    expect(store.get(nb.id)!.fields.map((f) => f.key)).toEqual(['price', 'miles', 'listing_url']);
    const options = store.entries(nb.id).filter((e) => e.kind === 'option');
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ title: '2010 Toyota RAV4 Sport 4WD', runId: 'run-2', data: { price: 3900, miles: 149652 } });
    // Facts the keeper gives with a source or as an estimate keep that; the same option is still found.
    const third = applyKeeperResult(store, store.get(nb.id)!, 'sweep', 'run-3', block({
      entries: [{ ...rav4, data: { price: { value: 3850, source: 'https://www.cargurus.com/l/123/history' }, miles: { value: 150000, estimate: true }, listing_url: 'https://www.cargurus.com/l/123' } }],
    }));
    expect(third).toMatchObject({ added: 0, refreshed: 1 });
    const kept = store.entries(nb.id).find((e) => e.kind === 'option')!;
    expect(kept.data).toMatchObject({ price: 3850, miles: 150000 });
    expect(kept.factMeta).toEqual({ price: { source: 'https://www.cargurus.com/l/123/history' }, miles: { estimate: true } });
  });

  it('the keeper adds new entries with provenance, skips what the notebook has, and ticks criteria with a reason', async () => {
    await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { applyKeeperResult, pipelineInputs, notebookBrief } = await import('../lib/notebook-pipeline.js');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Buy a used car', statement: 'Find a reliable SUV', params: ['AWD'], criteria: ['One fits', 'Clean history'] });
    store.addEntry(nb.id, { kind: 'option', title: '2019 RAV4 XLE, 54k mi', by: 'you' });

    const raw = `Here you go.\n<notebook>${JSON.stringify({
      entries: [
        { kind: 'option', title: '2019 RAV4 XLE — 54k mi!', body: 'dup, reworded punctuation' },
        { kind: 'option', title: '2020 Mazda CX-5 Touring, 38k mi, $23,400', body: 'one owner' },
        { kind: 'evidence', title: 'Carfax: CX-5 clean' },
        { kind: 'gossip', title: 'nope' },
      ],
      criteriaMet: [{ index: 0, why: 'The CX-5 fits every parameter.' }, { index: 7, why: 'no such' }],
      summary: 'One new option and its history.',
    })}</notebook>`;
    const out = applyKeeperResult(store, nb, 'listings-search', 'run-abc', raw);
    expect(out).toEqual({ added: 2, options: 1, skipped: 2, criteriaMet: 1, summary: 'One new option and its history.' });
    const entries = store.entries(nb.id);
    expect(entries.find((e) => e.title.startsWith('2020 Mazda'))).toMatchObject({ by: 'agent:listings-search', runId: 'run-abc' });
    expect(entries.find((e) => e.title === 'Met: One fits')).toMatchObject({ kind: 'note', body: 'The CX-5 fits every parameter.' });
    expect(store.get(nb.id)!.criteria[0].met).toBe(true);
    expect(applyKeeperResult(store, nb, 'x', 'r', 'no block here').error).toContain('no <notebook> block');

    expect(pipelineInputs({ inputs: { GOAL: { type: 'string' }, topic: { type: 'string' }, LIMIT: { type: 'number' } } } as never, nb))
      .toEqual({ GOAL: notebookBrief(nb), topic: 'Find a reliable SUV' });
    expect(notebookBrief(nb)).toBe('Find a reliable SUV\nParameters: AWD\nDone when: One fits; Clean history');
    // An agent that files directly gets the notebook's field keys and roles.
    const withFields = store.setFields(nb.id, [{ key: 'company', label: 'Company', type: 'text', role: 'org' }, { key: 'fit', label: 'Fit', type: 'number', role: 'score' }]);
    expect(JSON.parse(pipelineInputs({ inputs: { FIELDS: { type: 'string' } } } as never, withFields).FIELDS))
      .toEqual([{ key: 'company', label: 'Company', type: 'text', role: 'org' }, { key: 'fit', label: 'Fit', type: 'number', role: 'score' }]);
  });

  it("tells a search what the notebook has and which facts each option still lacks", async () => {
    await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { notebookBrief, notebookGaps } = await import('../lib/notebook-pipeline.js');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb0 = store.create({ title: 'Comp set', statement: 'Find software comps' });
    store.setFields(nb0.id, [
      { key: 'company', label: 'Company', type: 'text', role: 'org' }, { key: 'website', label: 'Website', type: 'url', role: 'link' },
      { key: 'employees', label: 'Employees', type: 'number', role: 'measure' }, { key: 'founded', label: 'Founded', type: 'number' },
      { key: 'fit', label: 'Fit', type: 'number', role: 'score' },
    ]);
    store.upsertOption(nb0.id, { title: 'Motive: planning and forecasting', by: 'you', data: { company: 'Motive', fit: 97 } });
    store.upsertOption(nb0.id, { title: 'Everlaw: Q2C backlog', by: 'you', data: { company: 'Everlaw', fit: 92, employees: 800, founded: 2010 } });
    const out = store.upsertOption(nb0.id, { title: 'Acme: ruled out', by: 'you', data: { company: 'Acme', fit: 10 } }).entry;
    store.ruleOut(nb0.id, out.id, 'too small');
    const nb = store.get(nb0.id)!;
    const gaps = notebookGaps(nb, store.entries(nb.id));
    // Best first; ruled out left out; no link, picture or fit asked for.
    expect(gaps).toBe("It has 2 options in the running; don't add these again: Motive: planning and forecasting; Everlaw: Q2C backlog.\nFacts still missing (find them, with a source, and give them under the option's name):\n- Motive: planning and forecasting — employees, founded");
    expect(notebookBrief(nb, store.entries(nb.id))).toBe(`Find software comps\n${gaps}`);
    // Nothing yet: nothing to say.
    expect(notebookGaps(store.create({ title: 'Empty' }), [])).toBe('');

    // A step's job goes first: in the brief, the topic, and a STEP input; other inputs keep their defaults.
    const { pipelineInputs, stepLine } = await import('../lib/notebook-pipeline.js');
    const job = { step: { title: 'Source firmographics', kind: 'source' as const }, want: 2, have: 1, missing: ['Motive: planning and forecasting — employees, founded'] };
    const line = 'This step: Source firmographics. Don\'t look for new options. For these options only, find the missing facts, each with a source:\n- Motive: planning and forecasting — employees, founded';
    expect(stepLine(nb, job)).toBe(line);
    expect(pipelineInputs({ inputs: { NOTEBOOK: {}, TOPIC: {}, STEP: {}, DEPTH: {} } } as never, nb, store.entries(nb.id), job)).toEqual({
      NOTEBOOK: `${line}\nFind software comps\n${gaps}`, TOPIC: `${line}\n\nFind software comps`, STEP: line,
    });
    expect(stepLine(nb, { step: { title: 'Find 10', kind: 'find' }, want: 10, have: 4, missing: [] })).toBe("This step: Find 10. Find 6 more options that fit (the notebook wants 10 in the running and has 4). Don't bring back ones it already has. Give each one's own page (the listing, posting or product page itself), not a search-results page that lists many.");
    // Without a step: as before, and no STEP.
    expect(pipelineInputs({ inputs: { TOPIC: {}, STEP: {} } } as never, nb)).toEqual({ TOPIC: 'Find software comps' });
  });

  it("the header's Next step: what it says for each kind of step, and when it steps aside", async () => {
    await makeApp();
    const { nextStepAction } = await import('../views/notebooks.js');
    const nb = (steps: unknown[]) => ({ steps } as never);
    const st = (kind: string, status = 'todo', agentId?: string) => ({ id: kind, title: `The ${kind}`, kind, status, tries: 0, ...(agentId ? { agentId } : {}) });
    expect(nextStepAction(nb([st('find', 'todo', 'a'), st('decide')]))).toEqual({ label: 'Next step', hint: 'Step 1 of 2: The find' });
    // A check step without an agent uses sua's checker: still a Next step.
    expect(nextStepAction(nb([st('find', 'done', 'a'), st('check')]))).toEqual({ label: 'Next step', hint: 'Step 2 of 2: The check' });
    expect(nextStepAction(nb([st('source')]))).toEqual({ note: 'The source needs an agent. Ask sua to pick or build one.' });
    expect(nextStepAction(nb([st('find', 'stuck', 'a')]))).toMatchObject({ label: 'Try again' });
    expect(nextStepAction(nb([st('find', 'met', 'a'), st('source', 'todo', 'b')]))).toEqual({ label: 'Next step', hint: 'Step 1 is done. Next: step 2 of 2, The source.' });
    expect(nextStepAction(nb([st('find', 'met', 'a')]))).toMatchObject({ label: 'Finish' });
    expect(nextStepAction(nb([st('find', 'met', 'a'), st('decide')]))).toEqual({ note: 'Step 1 is done. Next: The decide, with Decide.' });
    expect(nextStepAction(nb([st('find', 'done', 'a')]))).toBeUndefined();
    expect(nextStepAction(nb([]))).toBeUndefined();
  });

  it('a source step looks up only its facts, and stopping its run stops the step instead of trying again', async () => {
    const app = await makeApp();
    S.agentStore.createAgent({ id: 'slow-source', name: 'Slow source', status: 'active', source: 'local', mcp: false, inputs: { NOTEBOOK: { type: 'string', default: '' } }, nodes: [{ id: 'n', type: 'shell', command: 'sleep 20' }] } as never, 'cli');
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Example peers' });
    store.setFields(nb.id, [
      { key: 'company', label: 'Company', type: 'text', role: 'org' },
      { key: 'employees', label: 'Employees', type: 'number' },
      { key: 'founded', label: 'Founded', type: 'number' },
      { key: 'why_buy', label: 'Why people buy it', type: 'text' },
    ]);
    store.upsertOption(nb.id, { title: 'Example Co 1', by: 'you', data: { company: 'Example Co 1', employees: 300 } });
    store.upsertOption(nb.id, { title: 'Example Co 2', by: 'you', data: { company: 'Example Co 2', employees: 120, founded: 2015 } });
    store.setSteps(nb.id, [{ title: 'Source firmographics', kind: 'source', agentId: 'slow-source', facts: ['employees', 'Founded'] }]);

    // Only its facts count, one by one; the page names them.
    const page = (await request(app).get(`/notebooks/${nb.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;
    expect(page).toContain('<span class="nb-step__facts" title="employees, founded">2 facts</span>');
    expect(page).toContain('<span class="nb-step__count">3 of 4 facts</span><span class="nb-step__state nb-step__state--todo">to do</span>');
    // Its job names only those facts.
    const { pipelineInputs } = await import('../lib/notebook-pipeline.js');
    const step = store.get(nb.id)!.steps![0];
    const inputs = pipelineInputs({ inputs: { NOTEBOOK: {} } } as never, store.get(nb.id)!, store.entries(nb.id), { step, want: 4, have: 3, missing: ['Example Co 1 — founded'] });
    expect(inputs.NOTEBOOK).toContain('find the missing facts (only employees, founded), each with a source:\n- Example Co 1 — founded');

    // Stopping its run stops the step: one try, no second run.
    await request(app).post(`/notebooks/${nb.id}/run`).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send({});
    const runs = () => S.runStore.databaseHandle().prepare("SELECT id, status FROM runs WHERE agentName = 'slow-source'").all() as Array<{ id: string; status: string }>;
    for (let i = 0; i < 200 && !runs().some((r) => r.status === 'running'); i++) await new Promise((r) => setTimeout(r, 25));
    await request(app).post(`/runs/${runs()[0].id}/cancel`).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send({});
    for (let i = 0; i < 200 && store.get(nb.id)!.steps![0].status === 'running'; i++) await new Promise((r) => setTimeout(r, 25));
    expect(store.get(nb.id)!.steps![0]).toMatchObject({ status: 'stuck', tries: 1 });
    expect(runs()).toHaveLength(1);
    expect(store.passes(nb.id)[0].note).toBe('slow-source: stopped');
  });

  it('a source step whose agent reads one page a run reads each option\'s own page, never an empty one', async () => {
    const app = await makeApp();
    const wanted = join(S.dir, 'wanted');
    S.agentStore.createAgent({ id: 'page-reader', name: 'Page reader', status: 'active', source: 'local', mcp: false,
      inputs: { PAGE_URL: { type: 'string', default: '' }, WANT: { type: 'string', default: 'price' } },
      nodes: [{ id: 'n', type: 'shell', command: `echo "$PAGE_URL|$WANT" >> ${wanted}; case "$PAGE_URL" in *blocked*) echo '{"url":"x","status":"blocked"}';; *sold*) echo '{"status":"gone"}';; *) echo '{"url":"x","status":"ok","price":40,"Seller":"Ann","odometer":0}';; esac` }] } as never, 'cli');
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Example speakers' });
    store.setFields(nb.id, [
      { key: 'price', label: 'Price', type: 'money', role: 'price' },
      { key: 'seller', label: 'Seller', type: 'text' },
      { key: 'odometer', label: 'Odometer', type: 'number' },
      { key: 'listing', label: 'Listing', type: 'url', role: 'link' },
    ]);
    const add = (title: string, listing?: string) => store.upsertOption(nb.id, { title, by: 'you', data: listing ? { listing } : {} }).entry;
    const a = add('Set A', 'https://shop.example/a');
    add('Set B', 'https://blocked.example/b');
    const c = add('Set C', 'https://shop.example/sold-c');
    add('Set D');
    store.setSteps(nb.id, [{ title: 'Read each listing', kind: 'source', agentId: 'page-reader', facts: ['price', 'seller'] }]);

    await request(app).post(`/notebooks/${nb.id}/run`).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send({});
    for (let i = 0; i < 400 && store.get(nb.id)!.steps![0].status === 'running'; i++) await new Promise((r) => setTimeout(r, 25));

    // One run per option with a page, each given its page and the facts it lacks; none empty.
    const calls = readFileSync(wanted, 'utf-8').trim().split('\n').sort();
    expect(calls).toEqual(['https://blocked.example/b|Price, Seller', 'https://shop.example/a|Price, Seller', 'https://shop.example/sold-c|Price, Seller']);
    // What the page said is on the option, sourced to it (a 0 the page didn't give is left out).
    const optA = store.entries(nb.id).find((e) => e.id === a.id)!;
    expect(optA.data).toMatchObject({ price: 40, seller: 'Ann' });
    expect(optA.data?.odometer).toBeUndefined();
    expect(optA.factMeta?.price?.source).toBe('https://shop.example/a');
    // A gone item is ruled out; a blocked page and an option without a page are said.
    expect(store.entries(nb.id).find((e) => e.id === c.id)!.ruledOut).toBeTruthy();
    const note = store.passes(nb.id)[0].note ?? '';
    expect(note).toContain('page-reader: read 2 of 3 pages, 2 facts');
    expect(note).toContain('blocked.example blocked the reader');
    expect(note).toContain('1 gone, ruled out');
    expect(note).toContain('1 without a page of their own');
    // An agent that takes the notebook isn't a page reader, even with a URL input.
    const { perItemInputs } = await import('../lib/notebook-pipeline.js');
    expect(perItemInputs({ inputs: { NOTEBOOK: {}, URL: {} } } as never)).toBeUndefined();
    expect(perItemInputs({ inputs: { URL: {}, FACTS: {} } } as never)).toEqual({ page: 'URL', want: 'FACTS' });
    // As a check step it would run with no page: sua's checker does the step instead, and says so; the reader never runs.
    store.setChecks(nb.id, ['Works']);
    store.setSteps(nb.id, [{ title: 'Check each set', kind: 'check', agentId: 'page-reader' }]);
    const before = readFileSync(wanted, 'utf-8').trim().split('\n').length;
    const ran = await request(app).post(`/notebooks/${nb.id}/run`).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send({});
    const said = decodeURIComponent(ran.headers.location);
    expect(said).toContain("Sua’s checker does “Check each set”: page-reader reads one item's own page at a time, so it can only do a source step.");
    expect(said).not.toContain('with page-reader');
    expect(store.get(nb.id)!.steps![0].agentId).toBeUndefined();
    for (let i = 0; i < 200 && store.get(nb.id)!.steps![0].status === 'running'; i++) await new Promise((r) => setTimeout(r, 25));
    expect(readFileSync(wanted, 'utf-8').trim().split('\n')).toHaveLength(before);

    // Saving steps that give it a find or check step takes it off there (and says so); a source step keeps it.
    const saved = await request(app).post(`/notebooks/${nb.id}/steps`).set('Cookie', COOKIE).set('Host', `127.0.0.1:${String(PORT)}`)
      .send({ steps: [{ title: 'Find sets', kind: 'find', agentId: 'page-reader' }, { title: 'Source each set', kind: 'source', agentId: 'page-reader' }, { title: 'Check each set', kind: 'check', agentId: 'page-reader' }] });
    expect(saved.body.steps.map((x: { agentId?: string }) => x.agentId ?? null)).toEqual([null, 'page-reader', null]);
    expect(saved.body.notes).toEqual([
      "Sua’s finder does “Find sets”: page-reader reads one item's own page at a time, so it can only do a source step.",
      "Sua’s checker does “Check each set”: page-reader reads one item's own page at a time, so it can only do a source step.",
    ]);
  });

  it('a step still getting closer when it runs out of tries offers Try again first; Stop and Move on from the header', async () => {
    const app = await makeApp();
    const post = (path: string, body: Record<string, string> = {}) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const counter = join(S.dir, 'n2');
    S.agentStore.createAgent({ id: 'finder2', name: 'Finder', status: 'active', source: 'local', mcp: false, nodes: [{ id: 'n', type: 'shell', command: `n=$(cat ${counter} 2>/dev/null || echo 0); n=$((n+1)); echo $n > ${counter}; echo '<notebook>{"entries":[{"kind":"option","title":"Example Co '$n'"}]}</notebook>'` }] } as never, 'cli');
    S.agentStore.createAgent({ id: 'slow-find', name: 'Slow', status: 'active', source: 'local', mcp: false, nodes: [{ id: 'n', type: 'shell', command: 'sleep 20' }] } as never, 'cli');
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Example peers' });
    store.setSteps(nb.id, [
      { title: 'Find 5 companies', kind: 'find', agentId: 'finder2', target: 5 },
      { title: 'Find 9 companies', kind: 'find', agentId: 'slow-find', target: 9 },
      { title: 'Pick 3', kind: 'decide', target: 3 },
    ]);
    const settle = async () => { for (let i = 0; i < 400 && (store.get(nb.id)!.steps ?? []).some((x) => x.status === 'running'); i++) await new Promise((r) => setTimeout(r, 25)); };
    const page = async () => (await request(app).get(`/notebooks/${nb.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;
    const said = () => InboxStore.fromHandle(S.runStore.databaseHandle()).listResponses(store.get(nb.id)!.conversationId!);

    // Three runs, each one closer, none enough: Try again first, Move on second.
    await post(`/notebooks/${nb.id}/run`);
    await settle();
    expect(store.get(nb.id)!.steps![0]).toMatchObject({ status: 'stuck', tries: 3, note: '3 of 5 found' });
    expect(store.get(nb.id)!.steps![0].stalled).toBeUndefined();
    expect(said().some((r) => r.body.includes('**Find 5 companies** stopped short after 3 tries (3 of 5 found), still getting closer.'))).toBe(true);
    expect(said().filter((r) => r.role === 'action').map((r) => (JSON.parse(r.metaJson!) as { ctaLabel: string }).ctaLabel)).toEqual(['Try again', 'Move on']);
    expect(await page()).toContain('>Try again →</button>');

    // Move on from the header: done with what it found, and the next step starts.
    const moved = await post(`/notebooks/${nb.id}/steps/move-on`, { step: 's1' });
    expect(decodeURIComponent(moved.headers.location)).toContain('Moved on from Find 5 companies, keeping what it found. Working on Find 9 companies now');
    expect(store.get(nb.id)!.steps![0]).toMatchObject({ status: 'done', movedOn: true });
    // While it runs, the header has Stop.
    for (let i = 0; i < 200 && !S.runStore.databaseHandle().prepare("SELECT 1 FROM runs WHERE agentName = 'slow-find' AND status = 'running'").get(); i++) await new Promise((r) => setTimeout(r, 25));
    expect(await page()).toContain(`action="/notebooks/${nb.id}/steps/stop"`);
    // A stale Move on (step 1 again) does nothing.
    expect(decodeURIComponent((await post(`/notebooks/${nb.id}/steps/move-on`, { step: 's1' })).headers.location)).toContain('still running');
    // Stop: the run is cancelled, the step stops with Move on first, and no second try starts.
    expect(decodeURIComponent((await post(`/notebooks/${nb.id}/steps/stop`)).headers.location)).toContain('Stopping the step.');
    await settle();
    expect(store.get(nb.id)!.steps![1]).toMatchObject({ status: 'stuck', stalled: true, tries: 1 });
    expect((S.runStore.databaseHandle().prepare("SELECT count(*) AS n FROM runs WHERE agentName = 'slow-find'").get() as { n: number }).n).toBe(1);
    expect(await page()).toContain('>Move on →</button>');
    expect(decodeURIComponent((await post(`/notebooks/${nb.id}/steps/stop`)).headers.location)).toContain('No step is running.');

    // sua can propose Move on itself when you say to stop a step.
    const { parseProposedActions } = await import('./inbox-plan.js');
    const { accepted, rejected } = parseProposedActions([{ type: 'notebook-step', rationale: 'You said that is enough', inputs: { NOTEBOOK: nb.id, STEP: 's2', MOVE: '1' } }, { type: 'notebook-step', inputs: {} }], [], []);
    expect(accepted[0]).toMatchObject({ agentId: 'notebook-step', ctaLabel: 'Move on', inputs: { NOTEBOOK: nb.id, STEP: 's2', MOVE: '1' } });
    expect(rejected[0].reason).toBe('notebook-step needs inputs.NOTEBOOK');
  });

  it('works on one step at a time: retries toward its goal, pauses for Continue, and says when it is stuck', async () => {
    const app = await makeApp();
    const post = (path: string) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send({});
    // A search that finds one new company a run (filed directly from its <notebook> block)…
    const counter = join(S.dir, 'n');
    S.agentStore.createAgent({ id: 'finder', name: 'Finder', status: 'active', source: 'local', mcp: false, nodes: [{ id: 'n', type: 'shell', command: `n=$(cat ${counter} 2>/dev/null || echo 0); n=$((n+1)); echo $n > ${counter}; echo '<notebook>{"entries":[{"kind":"option","title":"Company '$n'"}]}</notebook>'` }] } as never, 'cli');
    // …and one that only ever finds the same company.
    S.agentStore.createAgent({ id: 'samey', name: 'Samey', status: 'active', source: 'local', mcp: false, nodes: [{ id: 'n', type: 'shell', command: `echo '<notebook>{"entries":[{"kind":"option","title":"Company 1"}]}</notebook>'` }] } as never, 'cli');
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Peers', pipeline: ['sched-agent'] });
    store.setSteps(nb.id, [
      { title: 'Find 3 companies', kind: 'find', agentId: 'finder', target: 3 },
      { title: 'Find 5 companies', kind: 'find', agentId: 'samey', target: 5 },
      { title: 'Pick the final set', kind: 'decide', target: 3 },
    ]);
    const settle = async () => { for (let i = 0; i < 200 && (store.get(nb.id)!.steps ?? []).some((x) => x.status === 'running'); i++) await new Promise((r) => setTimeout(r, 25)); };
    const page = async () => (await request(app).get(`/notebooks/${nb.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;
    const thread = () => InboxStore.fromHandle(S.runStore.databaseHandle()).listResponses(store.get(nb.id)!.conversationId!);

    // The header's main button is the next step (Decide steps aside); no pipeline button while steps are left.
    let p0 = await page();
    expect(p0).toContain('title="Step 1 of 3: Find 3 companies" aria-label="Next step: Step 1 of 3: Find 3 companies">Next step →</button>');
    expect(p0).toContain('<summary class="btn btn--sm">Decide…</summary>');
    expect(p0).not.toContain('Run the pipeline now');
    expect(decodeURIComponent((await post(`/notebooks/${nb.id}/run`)).headers.location)).toContain('Working on Find 3 companies');
    await settle();
    // Three runs, one company each: met, and it waits.
    let steps = store.get(nb.id)!.steps!;
    expect(steps[0]).toMatchObject({ status: 'met', tries: 3, note: '3 of 3 found' });
    expect(steps[1].status).toBe('todo');
    expect(store.entries(nb.id).filter((e) => e.kind === 'option')).toHaveLength(3);
    expect(await page()).toContain('title="Step 1 is done. Next: step 2 of 3, Find 5 companies."');
    let said = thread();
    expect(said.some((r) => r.role === 'triage' && r.body.includes('Step 1 of 3 is done: **Find 3 companies** (3 of 3 found). Next is **Find 5 companies**, with samey.'))).toBe(true);
    const card = said.find((r) => r.role === 'action')!;
    expect(JSON.parse(card.metaJson!)).toMatchObject({ agentId: 'notebook-step', status: 'proposed', ctaLabel: 'Continue', inputs: { NOTEBOOK: nb.id, STEP: 's1', WAS: 'met' } });

    // Continue (the card): step 1 is done, step 2 runs; a run that gets it no closer stops it: stuck.
    const { executeNotebookStep } = await import('./inbox-engine.js');
    const ctx = app.locals as never;
    const cont = await executeNotebookStep((await import('../context.js')).getContext(ctx), JSON.parse(card.metaJson!));
    expect(cont).toMatchObject({ status: 'completed' });
    await settle();
    steps = store.get(nb.id)!.steps!;
    expect(steps[0].status).toBe('done');
    // Its agent found nothing new: the step stalled, and Move on comes first.
    expect(steps[1]).toMatchObject({ status: 'stuck', stalled: true, tries: 1, note: '3 of 5 found' });
    said = thread();
    // It says why, on the step and in its card.
    expect(steps[1].why).toBe('Its last search found no new ones.');
    expect(said.some((r) => r.body.includes(`**Find 5 companies** couldn't get any further (3 of 5 found). ${steps[1].why!} Its agent may not be able to do the rest. Still needed:\n- 2 more\n\n**Move on** keeps what it found and goes on to **Pick the final set**. **Try again** runs it once more.`))).toBe(true);
    const cards = said.filter((r) => r.role === 'action').slice(-2).map((r) => JSON.parse(r.metaJson!) as { ctaLabel: string; inputs: Record<string, string> });
    expect(cards.map((c) => c.ctaLabel)).toEqual(['Move on', 'Try again']);
    expect(cards[0].inputs).toMatchObject({ STEP: 's2', WAS: 'stuck', MOVE: '1' });
    p0 = await page();
    expect(p0).toContain('<p class="nb-steps__why"><strong>Find 5 companies</strong> stopped short. Its last search found no new ones.</p>');
    expect(p0).toContain('>Move on →</button>');
    expect(p0).toContain('<input type="hidden" name="step" value="s2"><button type="submit" class="btn btn--primary btn--sm nb-next"');
    expect(p0).toContain('class="btn btn--sm nb-next" title="Step 2 of 3, Find 5 companies, stopped short. Run it again." aria-label="Try again: Step 2 of 3, Find 5 companies, stopped short. Run it again.">Try again</button>');
    // The old Continue card is stale now: it does nothing.
    expect(await executeNotebookStep((await import('../context.js')).getContext(ctx), JSON.parse(card.metaJson!))).toMatchObject({ status: 'failed', refusalReason: 'It has already moved on from that step.' });

    // Move on (the card): the step is done with what it found, and the next is yours.
    const moved = await executeNotebookStep((await import('../context.js')).getContext(ctx), cards[0] as never);
    expect(moved).toMatchObject({ status: 'completed', summary: 'Moved on from **Find 5 companies**, keeping what it found. Next is yours: pick the final set with Decide.' });
    expect(store.get(nb.id)!.steps![1]).toMatchObject({ status: 'done', movedOn: true, note: '3 of 5 found, moved on' });
    expect(await page()).toContain('<span class="nb-step__count">3 of 5 found</span><span class="nb-step__state nb-step__state--moved">moved on</span>');
    // Its Try again card is stale now too.
    expect(await executeNotebookStep((await import('../context.js')).getContext(ctx), cards[1] as never)).toMatchObject({ status: 'failed' });
    // Deciding is yours: Decide is the main button again, and there's no Next step.
    p0 = await page();
    expect(p0).toContain('Next: Pick the final set, with Decide.');
    expect(p0).toContain('<summary class="btn btn--sm btn--primary">Decide…</summary>');
    expect(p0).not.toContain('class="nb-next__form"');
    expect(decodeURIComponent((await post(`/notebooks/${nb.id}/run`)).headers.location)).toContain('This step is yours');
  });

  it("a check step uses sua's checker: checks met are ticked, an option that fails one is ruled out", async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Peers' });
    store.setFields(nb.id, [{ key: 'employees', label: 'Employees', type: 'number' }]);
    store.setChecks(nb.id, ['Sells enterprise software', 'Founded after 2015']);
    const a = store.upsertOption(nb.id, { title: 'Acme Planning', body: 'Acme sells planning software to enterprise finance teams.', by: 'you', data: { employees: 300 } }).entry;
    const b = store.upsertOption(nb.id, { title: 'Bolt Tools', body: 'Bolt makes hand tools for hobbyists.', by: 'you', data: { employees: 40 } }).entry;
    store.setSteps(nb.id, [{ title: 'Check the peers', kind: 'check' }]);
    const asked: Array<Record<string, string>> = [];
    let round = 0;
    S.checkerReply = (inputs) => {
      asked.push(inputs);
      round++;
      // First run: Acme meets one check, Bolt fails one. Second: Acme meets the other.
      return `<notebook>${JSON.stringify(round === 1
        ? { facts: [{ id: a.id, checked: ['sells enterprise software', 'Not a check'] }, { id: b.id, ruleOut: 'Fails "Sells enterprise software": "hand tools for hobbyists"' }] }
        : { facts: [{ id: a.id, checked: ['Founded after 2015'] }] })}</notebook>`;
    };
    const { startNotebookStep } = await import('../lib/notebook-steps.js');
    const { getContext } = await import('../context.js');
    expect(startNotebookStep(getContext(app.locals), nb.id)).toMatchObject({ started: true });
    for (let i = 0; i < 200 && store.get(nb.id)!.steps![0].status === 'running'; i++) await new Promise((r) => setTimeout(r, 20));

    expect(store.get(nb.id)!.steps![0]).toMatchObject({ status: 'met', tries: 2, note: '1 of 1 checked' });
    const opts = store.entries(nb.id).filter((e) => e.kind === 'option');
    expect(opts.find((e) => e.id === a.id)!.checked).toEqual(['Sells enterprise software', 'Founded after 2015']);
    expect(opts.find((e) => e.id === b.id)!.ruledOut).toMatchObject({ reason: 'Fails "Sells enterprise software": "hand tools for hobbyists"', by: 'agent:notebook-checker' });
    // It was given the checks, and only the options with checks left, with what each still needs.
    expect(JSON.parse(asked[0].CHECKS)).toEqual(['Sells enterprise software', 'Founded after 2015']);
    const first = JSON.parse(asked[0].OPTIONS) as Array<{ id: string; left: string[]; facts: Record<string, unknown>; text: string }>;
    expect(first.map((o) => o.id).sort()).toEqual([a.id, b.id].sort());
    expect(first.find((o) => o.id === a.id)).toMatchObject({ left: ['Sells enterprise software', 'Founded after 2015'], facts: { Employees: 300 }, text: 'Acme sells planning software to enterprise finance teams.' });
    expect(JSON.parse(asked[1].OPTIONS)).toEqual([expect.objectContaining({ id: a.id, left: ['Founded after 2015'] })]);
    expect(asked[0].NOTEBOOK).toContain('This step: Check the peers.');
    expect(store.get(nb.id)!.lastRunNote).toContain('notebook-checker: 0 new, 1 check met, 1 ruled out on a check (filed directly)');
    S.checkerReply = undefined;
  });

  it("a find step without an agent uses sua's finder, which files what its searches found", async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Director of accounting job', statement: 'A director-level accounting job, Austin or remote.' });
    store.setFields(nb.id, [{ key: 'salary', label: 'Salary', type: 'money', role: 'price', better: 'higher', range: true }, { key: 'posting_url', label: 'Posting', type: 'url', role: 'link' }]);
    store.upsertOption(nb.id, { title: 'Controller, Old Co', by: 'you', data: { posting_url: 'https://jobs.lever.co/oldco/9' } });
    store.setSteps(nb.id, [{ title: 'Find 2 roles', kind: 'find', target: 2 }]);

    // The page says who does it.
    const page = await request(app).get(`/notebooks/${nb.id}`).set('Cookie', COOKIE).set('Host', `127.0.0.1:${String(PORT)}`);
    expect(page.text).toContain('with sua’s finder');
    expect(page.text).not.toContain('needs an agent');

    const asked: Array<Record<string, string>> = [];
    S.finderReply = (inputs) => {
      asked.push(inputs);
      return `Found 1 new.\n<notebook>${JSON.stringify({ entries: [
        { kind: 'option', title: 'Controller, Acme: Remote US, $190k–$220k', body: 'Leads a team of 6.', data: { salary: { min: 190000, max: 220000 }, posting_url: 'https://job-boards.greenhouse.io/acme/jobs/1' }, fingerprint: 'https://job-boards.greenhouse.io/acme/jobs/1' },
        { kind: 'note', title: 'Searched 3 places at once: Greenhouse (1), Lever (0), Ashby (0). Nothing new from Lever, Ashby.' },
      ], sources: [{ name: 'Greenhouse', found: 1, status: 'found' }, { name: 'Lever', found: 0, status: 'none' }] })}</notebook>`;
    };
    const { startNotebookStep } = await import('../lib/notebook-steps.js');
    const { getContext } = await import('../context.js');
    expect(startNotebookStep(getContext(app.locals), nb.id)).toMatchObject({ started: true });
    for (let i = 0; i < 200 && store.get(nb.id)!.steps![0].status === 'running'; i++) await new Promise((r) => setTimeout(r, 20));

    expect(store.get(nb.id)!.steps![0]).toMatchObject({ status: 'met', note: '2 of 2 found' });
    expect(store.entries(nb.id).filter((e) => e.kind === 'option').map((e) => e.title)).toContain('Controller, Acme: Remote US, $190k–$220k');
    // It's given the notebook with this step's job, what it already has, and the fields to fill.
    expect(asked[0].NOTEBOOK).toContain('This step: Find 2 roles.');
    expect(JSON.parse(asked[0].OPTIONS)).toEqual([expect.objectContaining({ name: 'Controller, Old Co', sources: ['https://jobs.lever.co/oldco/9'] })]);
    expect(JSON.parse(asked[0].FIELDS).map((f: { key: string }) => f.key)).toEqual(['salary', 'posting_url']);
    expect(store.get(nb.id)!.lastRunNote).toContain('notebook-finder: 1 new, 1 note (filed directly)');
    S.finderReply = undefined;
  });

  it('search again: a done find step runs once more for new ones, as one card, and the steps stay put', async () => {
    const app = await makeApp();
    const { NotebookStore, InboxStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Staff PM roles', statement: 'Staff+ PM roles owning an AI platform.' });
    store.setFields(nb.id, [{ key: 'posting_url', label: 'Posting', type: 'url', role: 'link' }]);
    store.upsertOption(nb.id, { title: 'Staff PM, Old Co', by: 'you', data: { posting_url: 'https://jobs.lever.co/oldco/1' }, fingerprint: 'https://jobs.lever.co/oldco/1' });
    store.setSteps(nb.id, [{ title: 'Find 1 role', kind: 'find', target: 1 }, { title: 'Pick 1', kind: 'decide', target: 1 }]);
    store.updateStep(nb.id, 's1', { status: 'done', note: '1 of 1 found' });
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const post = (path: string, body: Record<string, string> = {}) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const { getContext } = await import('../context.js');
    const ctx = getContext(app.locals);
    const settle = async () => { for (let i = 0; i < 200 && ctx.notebookPipelines?.has(nb.id); i++) await new Promise((r) => setTimeout(r, 20)); };

    // The finished find step offers it on the page; the decide step doesn't.
    expect((await get(`/notebooks/${nb.id}`)).text).toContain(`action="/notebooks/${nb.id}/steps/s1/again"`);
    const asked: Array<Record<string, string>> = [];
    S.finderReply = (inputs) => {
      asked.push(inputs);
      return `<notebook>${JSON.stringify({ entries: [
        { kind: 'option', title: 'Principal PM, New Co', data: { posting_url: 'https://jobs.ashbyhq.com/newco/2' }, fingerprint: 'https://jobs.ashbyhq.com/newco/2' },
        { kind: 'option', title: 'Staff PM, Old Co', data: { posting_url: 'https://jobs.lever.co/oldco/1' }, fingerprint: 'https://jobs.lever.co/oldco/1' },
      ] })}</notebook>`;
    };
    const out = await post(`/notebooks/${nb.id}/steps/s1/again`);
    expect(decodeURIComponent(out.headers.location)).toContain('Searching again: Find 1 role.');
    await settle();
    // Asked for as many again as its goal, knowing what it has.
    expect(asked[0].NOTEBOOK).toContain('Find 1 more options that fit (the notebook wants 2 in the running and has 1)');
    expect(store.entries(nb.id).filter((e) => e.kind === 'option').map((e) => e.title).sort()).toEqual(['Principal PM, New Co', 'Staff PM, Old Co']);
    // The steps stay where they were.
    expect(store.get(nb.id)!.steps!.map((x) => x.status)).toEqual(['done', 'todo']);
    // sua says what's new, in the notebook's conversation.
    const said = InboxStore.fromHandle(S.runStore.databaseHandle()).listResponses(store.get(nb.id)!.conversationId!).map((r) => r.body);
    expect(said.at(-1)).toBe('Searched again (**Find 1 role**, with notebook-finder): 1 new option in the notebook:\n- Principal PM, New Co');

    // Nothing new the second time: it says so.
    S.finderReply = () => '<notebook>{"entries":[{"kind":"option","title":"Staff PM, Old Co","fingerprint":"https://jobs.lever.co/oldco/1"}]}</notebook>';
    await post(`/notebooks/${nb.id}/steps/s1/again`);
    await settle();
    expect(InboxStore.fromHandle(S.runStore.databaseHandle()).listResponses(store.get(nb.id)!.conversationId!).at(-1)!.body).toMatch(/^Searched again \(\*\*Find 1 role\*\*, with notebook-finder\): nothing new/);

    // sua proposes it as one card, and the card runs it.
    const { parseProposedActions } = await import('./inbox-plan.js');
    const { accepted } = parseProposedActions([{ type: 'notebook-step', rationale: 'You asked to search again', inputs: { NOTEBOOK: nb.id, STEP: 's1', AGAIN: '1' } }], [], []);
    expect(accepted[0]).toMatchObject({ agentId: 'notebook-step', ctaLabel: 'Search again', inputs: { NOTEBOOK: nb.id, STEP: 's1', AGAIN: '1' } });
    const { executeNotebookStep } = await import('./inbox-engine.js');
    expect(await executeNotebookStep(ctx, accepted[0] as never)).toMatchObject({ status: 'completed', summary: "Searching again: **Find 1 role**. I'll say here how many are new." });
    await settle();
    // Not a find step: refused, with why.
    expect(await executeNotebookStep(ctx, { ...accepted[0], inputs: { NOTEBOOK: nb.id, STEP: 's2', AGAIN: '1' } } as never)).toMatchObject({ status: 'failed', refusalReason: "Pick 1 isn't a find step, so there's nothing to search again." });
    // sua sees each step's id, to name it in the card.
    const { describeNotebookForTriage } = await import('../lib/notebook-chat.js');
    expect(JSON.parse(describeNotebookForTriage(ctx, store.get(nb.id)!)).steps[0]).toMatchObject({ id: 's1', title: 'Find 1 role', kind: 'find' });
    S.finderReply = undefined;
  });

  it('Check the top N: a check step you moved on from works again on just the best options', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Peers' });
    store.setFields(nb.id, [{ key: 'fit', label: 'Fit', type: 'number', role: 'score' }]);
    store.setChecks(nb.id, ['Sells software']);
    const ids = [90, 80, 70, 60, 50].map((fit) => store.upsertOption(nb.id, { title: `Co ${String(fit)}`, by: 'you', data: { fit } }).entry.id);
    store.setSteps(nb.id, [{ title: 'Check them', kind: 'check' }, { title: 'Pick 2', kind: 'decide', target: 2 }]);
    store.updateStep(nb.id, 's1', { status: 'done', movedOn: true, note: '0 of 5 checked, moved on' });
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const post = (path: string, body: Record<string, string> = {}) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const page = (await get(`/notebooks/${nb.id}`)).text;
    // The decide step's target says how many.
    expect(page).toContain(`action="/notebooks/${nb.id}/steps/s1/top"`);
    expect(page).toContain('Check the top 2 →');
    const asked: Array<Record<string, string>> = [];
    S.checkerReply = (inputs) => { asked.push(inputs); return `<notebook>${JSON.stringify({ facts: [{ id: ids[0], checked: ['Sells software'] }, { id: ids[1], checked: ['Sells software'] }] })}</notebook>`; };
    const out = await post(`/notebooks/${nb.id}/steps/s1/top`, { top: '2' });
    expect(decodeURIComponent(out.headers.location)).toContain('Working on Check them, for the top 2.');
    for (let i = 0; i < 200 && store.get(nb.id)!.steps![0].status === 'running'; i++) await new Promise((r) => setTimeout(r, 20));
    // Only the top two were asked about, and the step's goal was those two.
    expect((JSON.parse(asked[0].OPTIONS) as Array<{ id: string }>).map((o) => o.id)).toEqual([ids[0], ids[1]]);
    expect(store.get(nb.id)!.steps![0]).toMatchObject({ status: 'met', top: 2, note: '2 of 2 checked' });
    const after = (await get(`/notebooks/${nb.id}`)).text;
    expect(after).toContain('2 of 2 checked · top 2');
    expect(after).not.toContain('Check the top');
    expect(decodeURIComponent((await post(`/notebooks/${nb.id}/steps/s2/top`, { top: '2' })).headers.location)).toContain('Only a source or check step');
    S.checkerReply = undefined;
  });

  it('only an agent\'s own block ticks checks; the keeper (a model) cannot', async () => {
    await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { applyKeeperResult, directBlock } = await import('../lib/notebook-pipeline.js');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb0 = store.create({ title: 'Peers' });
    store.setChecks(nb0.id, ['Sells enterprise software']);
    const a = store.upsertOption(nb0.id, { title: 'Acme', by: 'you' }).entry;
    const block = `<notebook>${JSON.stringify({ facts: [{ id: a.id, checked: ['Sells enterprise software'], ruleOut: 'no' }] })}</notebook>`;
    expect(directBlock(`noise ${block}`)).toBe(block);
    expect(directBlock('<notebook>{"facts":[{"id":"x","data":{}}]}</notebook>')).toBeUndefined();
    expect(applyKeeperResult(store, store.get(nb0.id)!, 'notebook-keeper', 'r1', block, { source: '' })).toMatchObject({ added: 0 });
    expect(store.entries(nb0.id)[0].checked ?? []).toEqual([]);
    expect(store.entries(nb0.id)[0].ruledOut).toBeUndefined();
    expect(applyKeeperResult(store, store.get(nb0.id)!, 'notebook-checker', 'r2', block, { trusted: true })).toMatchObject({ checksMet: 1, checksFailed: 1 });
  });

  it('a failed check on an option you chose leaves a note (once), not a ruling', async () => {
    await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { applyKeeperResult } = await import('../lib/notebook-pipeline.js');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb0 = store.create({ title: 'Peers' });
    store.setChecks(nb0.id, ['Founded in 2016 or later']);
    const a = store.upsertOption(nb0.id, { title: 'Prophix', by: 'you' }).entry;
    store.choose(nb0.id, a.id);
    const block = `<notebook>${JSON.stringify({ facts: [{ id: a.id, ruleOut: 'Fails "Founded in 2016 or later": "Founded: 1987"' }] })}</notebook>`;
    const first = applyKeeperResult(store, store.get(nb0.id)!, 'notebook-checker', 'r1', block, { trusted: true });
    expect(first.checksKept).toBe(1);
    expect(first.checksFailed).toBeUndefined();
    applyKeeperResult(store, store.get(nb0.id)!, 'notebook-checker', 'r2', block, { trusted: true });
    const opt = store.entries(nb0.id).find((e) => e.id === a.id)!;
    expect(opt.ruledOut).toBeUndefined();
    expect(opt.chosenAt).toBeTruthy();
    expect(store.entries(nb0.id).filter((e) => e.kind === 'note').map((e) => e.title)).toEqual(['Prophix: Fails "Founded in 2016 or later": "Founded: 1987"']);
    // The failed check is recorded, so a check step counts it as checked and doesn't ask again.
    expect(opt.failedChecks).toEqual({ 'Founded in 2016 or later': 'Fails "Founded in 2016 or later": "Founded: 1987"' });
    const { stepProgress } = await import('@some-useful-agents/core');
    expect(stepProgress(store.get(nb0.id)!, store.entries(nb0.id), { kind: 'check', status: 'running' })).toMatchObject({ met: true, have: 1, want: 1 });
    const { optionsInput } = await import('../lib/notebook-pipeline.js');
    expect(JSON.parse(optionsInput(store.get(nb0.id)!, store.entries(nb0.id), true))).toEqual([]);
    // Another run quoting it differently doesn't note it again.
    const again = `<notebook>${JSON.stringify({ facts: [{ id: a.id, ruleOut: 'Fails "Founded in 2016 or later": "Founded: 1987, Fit: 90"' }] })}</notebook>`;
    applyKeeperResult(store, store.get(nb0.id)!, 'notebook-checker', 'r3', again, { trusted: true });
    expect(store.entries(nb0.id).filter((e) => e.kind === 'note')).toHaveLength(1);
  });

  it('runs from the page: refuses without agents, runs once at a time, and records what happened', async () => {
    const app = await makeApp();
    const post = (path: string, body: Record<string, string> = {}) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    await post('/notebooks', { title: 'Car' });
    expect(decodeURIComponent((await post('/notebooks/car/run')).headers.location)).toContain('Add agents to the pipeline under Edit first');
    await post('/notebooks/car/edit', { title: 'Car', pipeline: 'not-there' });
    expect(decodeURIComponent((await post('/notebooks/car/run')).headers.location)).toContain('Running the pipeline');
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    for (let i = 0; i < 50 && !store.get('car')!.lastRunAt; i++) await new Promise((r) => setTimeout(r, 20));
    expect(store.get('car')!.lastRunNote).toBe('0 new entries · not-there: not installed');
    const page = await request(app).get('/notebooks/car').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(page.text).toContain('Run the pipeline now');
    expect(page.text).toMatch(/Last run .*0 new entries · not-there: not installed/);
    await post('/notebooks/car/decide', { decision: 'done' });
    expect(decodeURIComponent((await post('/notebooks/car/run')).headers.location)).toContain('Reopen the notebook');
  });
});

describe("a step's news reopens a closed conversation", () => {
  it('puts a dismissed or resolved thread back to waiting on you; an open one keeps its status', async () => {
    const app = await makeApp();
    const post = (path: string) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send({});
    S.agentStore.createAgent({ id: 'one-finder', name: 'Finder', status: 'active', source: 'local', mcp: false, nodes: [{ id: 'n', type: 'shell', command: `echo '<notebook>{"entries":[{"kind":"option","title":"Example Co"}]}</notebook>'` }] } as never, 'cli');
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const inbox = InboxStore.fromHandle(S.runStore.databaseHandle());
    const settle = async (id: string) => { for (let i = 0; i < 400 && (store.get(id)!.steps ?? []).some((x) => x.status === 'running'); i++) await new Promise((r) => setTimeout(r, 25)); };
    const ctx = app.locals as never;

    for (const closed of ['dismissed', 'resolved', 'triaged'] as const) {
      const nb = store.create({ title: `Example peers ${closed}` });
      store.setSteps(nb.id, [
        { title: 'Find 1 company', kind: 'find', agentId: 'one-finder', target: 1 },
        { title: 'Pick 1', kind: 'decide', target: 1 },
      ]);
      const thread = inbox.add({ priority: 'medium', source: 'manual', title: `Notebook: ${nb.title}`, body: '(empty)' }).id;
      store.setConversation(nb.id, thread);
      inbox.updateStatus(thread, closed);
      await post(`/notebooks/${nb.id}/run`);
      await settle(nb.id);
      expect(inbox.listResponses(thread).some((r) => r.body.includes('Step 1 of 2 is done: **Find 1 company**'))).toBe(true);
      // Closed: back in "need your reply". Open (sua may be mid-turn): untouched.
      expect(inbox.get(thread)!.status).toBe(closed === 'triaged' ? 'triaged' : 'awaiting_user');
    }
  });
});

describe('the talk box follows the notebook', () => {
  it('suggests the next useful thing to tell sua, step by step', async () => {
    await makeApp();
    const { nextStep } = await import('../views/notebooks.js');
    const base = { id: 'car', title: 'Buy a used commuter car', statement: '', params: [] as string[], criteria: [{ text: 'clean title', met: false }], pipeline: [] as string[], fields: [], stages: [] as string[], checks: [] as string[], cadence: '', status: 'active' as const, createdAt: '', updatedAt: '' };
    const opt = { id: 'e1', notebookId: 'car', kind: 'option' as const, title: '2011 Subaru Forester, 150k, $7,200', body: '', by: 'sua', createdAt: '' };
    expect(nextStep(base, []).placeholder).toContain('what "Buy a used commuter car" is for');
    const withWhy = { ...base, statement: 'Find a reliable car for a new driver.' };
    expect(nextStep(withWhy, []).hint).toBe('Next: your limits (budget, must-haves, deal-breakers).');
    expect(nextStep(withWhy, []).placeholder).toBe('e.g. a budget, the must-haves, the deal-breakers, and where to look');
    const limited = { ...withWhy, params: ['AWD'] };
    expect(nextStep(limited, []).hint).toContain('candidates');
    expect(nextStep(limited, [opt]).hint).toBe('1 option so far. sua can keep looking for you.');
    const piped = { ...limited, pipeline: ['craigslist-car-search'] };
    expect(nextStep(piped, [opt])).toEqual({ hint: 'Next: “clean title”.', placeholder: 'e.g. what you know about “clean title” for the 2011 Subaru Forester, 150k, $7,200' });
    const met = { ...piped, criteria: [{ text: 'clean title', met: true }] };
    expect(nextStep(met, [opt]).hint).toBe('Every criterion is met. Ready to decide?');
    expect(nextStep({ ...met, status: 'decided' }, [opt]).hint).toContain('Decided');
  });
});
