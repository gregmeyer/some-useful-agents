import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InboxStore } from '@some-useful-agents/core';
import { S, makeApp, COOKIE, PORT } from './notebooks.test-kit.js';

describe('a profile step', () => {
  afterEach(() => { S.researchReply = undefined; S.researchAsked.length = 0; });

  it('learns about the person, then their company, keeps their photo and logo, and the page, card and cover show them', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const { startNotebookStep } = await import('../lib/notebook-steps.js');
    const { notebookWidgetData } = await import('../lib/notebook-widgets.js');
    const ctx = getContext(app.locals);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const fetched: string[] = [];
    ctx.notebookLogoDeps = { fetchImage: async (u) => { fetched.push(u); return { bytes: png, contentType: 'image/png' }; }, siteIcons: async (u) => [`${u}apple-touch-icon.png`] };
    // Only the team page shows the research's photo as hers.
    const checked: string[] = [];
    ctx.notebookPersonPhotoCheck = async (page, name, want) => { checked.push(`${page}|${want ?? ''}`); return page === 'https://northwind.example/team' && want ? { image: want, page, why: 'captioned with their name on a page about them' } : { why: 'no' }; };
    S.researchReply = (inputs) => JSON.stringify(inputs.SUBJECT === 'Dana Reyes'
      ? { subject: 'Dana Reyes', summary: 'Dana runs operations at Northwind.', not_found: ['location'], found: {
        kind: { value: 'person' }, role: { value: 'VP Operations', source: 'https://northwind.example/team', quote: 'Dana Reyes, VP Operations' },
        organization: { value: 'Northwind' }, company_website: { value: 'https://northwind.example' }, linkedin: { value: 'https://www.linkedin.com/in/dana' },
        known_for: { value: 'Writes about scaling ops teams' }, photo_url: { value: 'https://northwind.example/dana.png', source: 'https://northwind.example/team' },
        other_companies: { value: [{ name: 'Northwind' }, { name: 'Freight Founders', role: 'co-founder', website: 'https://freightfounders.example', source: 'https://dana.example/about' }] } } }
      : { subject: 'Northwind', found: { what_they_do: { value: 'Freight software' }, website: { value: 'https://northwind.example' }, size: { value: 'about 200', source: 'https://northwind.example/about' } }, not_found: ['stage'] });
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Prepare for a call with Dana Reyes', statement: 'What matters to Dana' });
    store.setSteps(nb.id, [{ title: 'Learn about Dana Reyes', kind: 'profile' }, { title: 'Find 5 themes', kind: 'find', target: 5 }]);
    expect(startNotebookStep(ctx, nb.id)).toMatchObject({ started: true });
    for (let i = 0; i < 200 && store.get(nb.id)!.steps![0].status === 'running'; i++) await new Promise((r) => setTimeout(r, 25));

    const after = store.get(nb.id)!;
    // Them, a quick look at each other company of theirs, then their company.
    expect(S.researchAsked.map((x) => x.SUBJECT)).toEqual(['Dana Reyes', 'Freight Founders (https://freightfounders.example)', 'Northwind']);
    expect(JSON.parse(S.researchAsked[0].ASK).map((a: { key: string }) => a.key)).toContain('photo_url');
    expect(S.researchAsked[1]).toMatchObject({ DEPTH: 'quick', CONTEXT: expect.stringContaining('A company Dana Reyes is co-founder of') });
    expect(JSON.parse(S.researchAsked[1].ASK).map((a: { key: string }) => a.key)).toEqual(['what_they_do', 'website', 'industry', 'stage']);
    expect(after.steps![0]).toMatchObject({ status: 'met', note: '4 of 4 facts learned' });
    expect(after.about!.person!.facts.map((f) => f.key)).toEqual(['role', 'organization', 'company_website', 'known_for', 'linkedin']);
    expect(after.about!.person!.facts[0]).toMatchObject({ value: 'VP Operations', source: 'https://northwind.example/team', quote: 'Dana Reyes, VP Operations' });
    expect(after.about!.person!.notFound).toEqual(['Based in']);
    // Their other companies: a list of its own (not a fact), never their main one.
    expect(after.about!.person!.affiliations).toMatchObject([{ name: 'Freight Founders', role: 'co-founder', website: 'https://freightfounders.example', source: 'https://dana.example/about', what: 'Freight software' }]);
    expect(after.about!.company).toMatchObject({ name: 'Northwind', notFound: ['Stage'] });
    expect(fetched).toEqual(['https://northwind.example/dana.png', 'https://northwind.example/apple-touch-icon.png']);
    expect(checked[0]).toBe('https://northwind.example/team|https://northwind.example/dana.png');
    expect(store.aboutPhoto(nb.id, 'person')).toMatchObject({ page: 'https://northwind.example/team', why: 'captioned with their name on a page about them' });

    const d = notebookWidgetData(after, [], store).notebook;
    expect(d.person).toEqual({
      name: 'Dana Reyes', role: 'VP Operations', org: 'Northwind', about: 'Dana runs operations at Northwind.', image: `/notebooks/${nb.id}/about/person/photo`,
      imageFrom: 'https://northwind.example/team', imageWhy: 'captioned with their name on a page about them', rejectHref: `/notebooks/${nb.id}/about/person/photo/reject`,
      links: [{ label: 'LinkedIn', url: 'https://www.linkedin.com/in/dana' }], asOf: expect.any(String),
    });
    expect(d.company).toMatchObject({ name: 'Northwind', role: 'Freight software', image: `/notebooks/${nb.id}/about/company/photo`, links: [{ label: 'northwind.example', url: 'https://northwind.example' }] });
    expect(d.facts.map((f) => `${f.group}: ${f.label}`)).toEqual(['Dana Reyes: Role', 'Dana Reyes: Company', 'Dana Reyes: Known for', 'Northwind: What they do', 'Northwind: Size']);
    expect(d.notFound).toEqual(['Based in', 'Stage']);

    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const photo = await get(`/notebooks/${nb.id}/about/person/photo`);
    expect(photo.status).toBe(200);
    expect(photo.headers['content-type']).toBe('image/png');
    expect((await get(`/notebooks/${nb.id}/about/nobody/photo`)).status).toBe(404);
    // The header's cover is their photo.
    expect((await get(`/notebooks/${nb.id}`)).text).toContain(`src="/notebooks/${nb.id}/about/person/photo"`);
    // A page drawn with who they are shows them once learned.
    store.setLayout(nb.id, { components: [
      { id: 'root', component: 'Column', children: ['who', 'facts'] },
      { id: 'who', component: 'ProfileCard', name: { path: '/notebook/person/name' }, role: { path: '/notebook/person/role' }, image: { path: '/notebook/person/image' }, links: { path: '/notebook/person/links' }, when: 'about' },
      { id: 'facts', component: 'FactSheet', facts: { path: '/notebook/facts' }, missing: { path: '/notebook/notFound' }, when: 'about' },
    ] });
    const html = (await get(`/notebooks/${nb.id}`)).text;
    expect(html).toContain('"component":"ProfileCard"');
    expect(html).toContain('VP Operations');

    // Not them: the photo goes, and that picture isn't kept for her again.
    const post = (path: string, body: Record<string, string> = {}) => request(app).post(path).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const res = await post(`/notebooks/${nb.id}/about/person/photo/reject`);
    expect(decodeURIComponent(res.headers.location)).toContain('Removed that photo');
    expect(store.aboutPhoto(nb.id, 'person')).toBeUndefined();
    expect(store.get(nb.id)!.about!.person!.rejectedPhotos).toEqual(['https://northwind.example/dana.png']);
    expect((await get(`/notebooks/${nb.id}`)).text).not.toContain(`src="/notebooks/${nb.id}/about/person/photo"`);
    // Learning again doesn't bring it back, and keeps what you said.
    store.updateStep(nb.id, store.get(nb.id)!.steps![0].id, { status: 'todo', tries: 0 });
    startNotebookStep(ctx, nb.id);
    for (let i = 0; i < 200 && store.get(nb.id)!.steps![0].status === 'running'; i++) await new Promise((r) => setTimeout(r, 25));
    expect(store.aboutPhoto(nb.id, 'person')).toBeUndefined();
    expect(store.get(nb.id)!.about!.person!.rejectedPhotos).toEqual(['https://northwind.example/dana.png']);

    // Edit offers the Meeting briefing look, as a picture to pick.
    const edit = (await get(`/notebooks/${nb.id}/edit?tab=looks`)).text;
    expect(edit).toContain('aria-label="Look like: Meeting brief"');
    await post(`/notebooks/${nb.id}/edit/look`, { look: 'dossier' });
    await post(`/notebooks/${nb.id}/edit/save`);
    // A ready-made page you picked: sua still composes it around what's written, so it's "picked", not yours.
    expect(store.get(nb.id)).toMatchObject({ layoutBy: 'picked', layout: { preset: 'dossier' } });
    expect((await get(`/notebooks/${nb.id}/edit?tab=looks`)).text).toContain('aria-label="Meeting brief, how it looks"');
  });

  it('decides its page again once its first step is done, unless you changed the page', async () => {
    const app = await makeApp();
    const { NotebookStore, InboxStore } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const { startNotebookStep } = await import('../lib/notebook-steps.js');
    const ctx = getContext(app.locals);
    ctx.notebookLogoDeps = { fetchImage: async () => { throw new Error('offline'); }, siteIcons: async () => [] };
    S.researchReply = () => JSON.stringify({ found: { kind: { value: 'person' }, role: { value: 'COO' }, location: { value: 'Austin' }, background: { value: 'Ops' }, known_for: { value: 'Scaling' } } });
    const page = [
      { id: 'root', component: 'Column', children: ['who'] },
      { id: 'who', component: 'ProfileCard', name: { path: '/notebook/person/name' }, when: 'about' },
    ];
    S.pageAsked.length = 0;
    S.pageReply = () => `<page>${JSON.stringify({ about: 'a briefing: who they are', components: page })}</page>`;
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const run = async (title: string, layoutBy?: 'you' | 'picked') => {
      const nb = store.create({ title });
      store.setSteps(nb.id, [{ title: 'Learn about them', kind: 'profile', subject: 'Dana Reyes' }, { title: 'Find 5 themes', kind: 'find', target: 5 }]);
      if (layoutBy) store.setLayout(nb.id, null, layoutBy);
      startNotebookStep(ctx, nb.id);
      for (let i = 0; i < 200 && store.get(nb.id)!.steps![0].status === 'running'; i++) await new Promise((r) => setTimeout(r, 25));
      for (let i = 0; i < 100 && ctx.notebookPages?.has(nb.id); i++) await new Promise((r) => setTimeout(r, 25));
      await new Promise((r) => setTimeout(r, 50));
      return store.get(nb.id)!;
    };
    const own = await run('Prepare for a call with Dana');
    expect(own.steps![0].status).toBe('met');
    expect(S.pageAsked).toHaveLength(1);
    expect(JSON.parse(S.pageAsked[0].NOTEBOOK).steps[0]).toMatchObject({ kind: 'profile' });
    expect(own).toMatchObject({ layoutBy: 'notebook', layout: { about: 'a briefing: who they are' } });
    const said = InboxStore.fromHandle(S.runStore.databaseHandle()).listResponses(own.conversationId!).map((r) => r.body).join('\n');
    expect(said).toContain('Now that it knows more, I redrew its page: a briefing: who they are.');

    // You went back to the shortlist: that stands.
    S.pageAsked.length = 0;
    const yours = await run('Prepare for a call with Sam', 'you');
    expect(yours.steps![0].status).toBe('met');
    expect(S.pageAsked).toHaveLength(0);
    expect(yours.layout).toBeUndefined();
    // A ready-made page you picked: never swapped for another kind either.
    const picked = await run('Prepare for a call with Lee', 'picked');
    expect(picked.steps![0].status).toBe('met');
    expect(S.pageAsked).toHaveLength(0);
    expect(picked.layoutBy).toBe('picked');
    S.pageReply = undefined;
  });

  it('composes a ready-made page you picked around what was written, keeping its kind; one you asked for stays', async () => {
    const app = await makeApp();
    const { NotebookStore, layoutPreset } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const { pageAfterWritten } = await import('../lib/notebook-steps.js');
    const { KEEP_AND_COMPOSE } = await import('../lib/notebook-page.js');
    const ctx = getContext(app.locals);
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const composed = { about: 'the ladder first, then the rubric', components: [...layoutPreset('answer')!.layout.components] };
    S.pageAsked.length = 0;
    S.pageReply = () => `<page>${JSON.stringify(composed)}</page>`;
    const written = (title: string, by: 'picked' | 'you') => {
      const nb = store.create({ title });
      store.setLayout(nb.id, layoutPreset('answer')!.layout, by);
      store.setAnswer(nb.id, { text: 'Ladder it.', confidence: 'medium', basis: 'x', findings: [], open: [], sections: [], askedAt: new Date().toISOString(), by: 'agent:notebook-writer' } as never);
      return nb.id;
    };
    const picked = written('Research CD ladders', 'picked');
    await pageAfterWritten(ctx, store, picked);
    expect(S.pageAsked).toHaveLength(1);
    expect(S.pageAsked[0].ASK).toBe(KEEP_AND_COMPOSE);
    expect(JSON.parse(S.pageAsked[0].CURRENT)[0]).toMatchObject({ id: 'root' });
    expect(store.get(picked)).toMatchObject({ layoutBy: 'picked', layout: { about: 'the ladder first, then the rubric' } });
    // Yours: not touched.
    S.pageAsked.length = 0;
    const yours = written('Research CD ladders again', 'you');
    await pageAfterWritten(ctx, store, yours);
    expect(S.pageAsked).toHaveLength(0);
    expect(store.get(yours)).toMatchObject({ layoutBy: 'you', layout: { preset: 'answer' } });
    S.pageReply = undefined;
  });

  it('looks again from a done profile step (Look again): new facts and a photo, the steps where they were', async () => {
    const app = await makeApp();
    const { NotebookStore, InboxStore } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const ctx = getContext(app.locals);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    ctx.notebookLogoDeps = { fetchImage: async () => ({ bytes: png, contentType: 'image/png' }), siteIcons: async () => [] };
    ctx.notebookPersonPhotoCheck = async (page, _name, want) => (page === 'https://conf.example/speakers/dana-reyes' ? { image: want ?? 'https://conf.example/dana.png', page, why: 'captioned with their name on a page about them' } : { why: 'no' });
    S.researchReply = () => JSON.stringify({ found: { kind: { value: 'person' }, role: { value: 'COO' }, photo_url: { value: 'https://conf.example/dana.png', source: 'https://conf.example/speakers/dana-reyes' } } });
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Prepare for a call with Dana Reyes' });
    store.setSteps(nb.id, [{ title: 'Learn about Dana', kind: 'profile', subject: 'Dana Reyes' }, { title: 'Choose', kind: 'decide', target: 2 }]);
    const s1 = store.get(nb.id)!.steps![0].id;
    store.updateStep(nb.id, s1, { status: 'done' });
    const { greetNotebook } = await import('../lib/notebook-chat.js');
    greetNotebook(ctx, nb.id);
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect((await get(`/notebooks/${nb.id}`)).text).toContain('Look again →');
    const res = await request(app).post(`/notebooks/${nb.id}/steps/${s1}/again`).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send({});
    expect(res.status).toBe(303);
    for (let i = 0; i < 200 && ctx.notebookPipelines?.has(nb.id); i++) await new Promise((r) => setTimeout(r, 25));
    const after = store.get(nb.id)!;
    expect(after.steps!.map((x) => x.status)).toEqual(['done', 'todo']);
    expect(after.about!.person!.facts.map((f) => f.key)).toEqual(['role']);
    expect(store.aboutPhoto(nb.id, 'person')).toMatchObject({ page: 'https://conf.example/speakers/dana-reyes' });
    const said = InboxStore.fromHandle(S.runStore.databaseHandle()).listResponses(after.conversationId!).map((r) => r.body).join('\n');
    expect(said).toContain('Looked again (**Learn about Dana**): learned 1 about Dana Reyes; kept a photo (captioned with their name on a page about them)');
  });

  it('updates it all (Update all, or sua\'s card): Look again then Write again, one run, then what\'s new in the conversation', async () => {
    const app = await makeApp();
    const { NotebookStore, InboxStore } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const ctx = getContext(app.locals);
    ctx.notebookLogoDeps = { fetchImage: async () => { throw new Error('offline'); }, siteIcons: async () => [] };
    S.researchReply = () => JSON.stringify({ found: { kind: { value: 'person' }, role: { value: 'COO' } } });
    S.writerReply = () => `<briefing>${JSON.stringify({ points: [{ text: 'Ask about the new role', from: [] }] })}</briefing>`;
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Prepare for a call with Dana Reyes' });
    store.setSteps(nb.id, [{ title: 'Learn about Dana', kind: 'profile', subject: 'Dana Reyes' }, { title: 'Write the talking points', kind: 'write' }]);
    const [s1, s2] = store.get(nb.id)!.steps!.map((x) => x.id);
    store.upsertOption(nb.id, { title: 'Hiring for ops', body: 'She is hiring an ops lead.', by: 'you' });
    // Each ran once before.
    for (const id of [s1, s2]) { store.updateStep(nb.id, id, { status: 'done' }); store.finishPass(store.startPass(nb.id, 'pipeline', undefined, { stepId: id }), 'ran'); }
    const { layoutPreset } = await import('@some-useful-agents/core');
    store.setLayout(nb.id, layoutPreset('dossier')!.layout);
    const { greetNotebook } = await import('../lib/notebook-chat.js');
    greetNotebook(ctx, nb.id);
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    // Nothing running: the steps as chips, each with its own action in the steps' order, then Update all.
    const page = (await get(`/notebooks/${nb.id}`)).text;
    const acts = page.slice(page.indexOf('<div class="nb-chips"'), page.indexOf('class="nb-chips__all"'));
    expect(acts.indexOf('Look again →')).toBeGreaterThan(-1);
    expect(acts.indexOf('Look again →')).toBeLessThan(acts.indexOf('Write again →'));
    expect(acts.indexOf('Write again →')).toBeLessThan(acts.indexOf('Update all →'));
    // A moment on, so the update's runs come after the ones before.
    await new Promise((r) => setTimeout(r, 5));
    const res = await request(app).post(`/notebooks/${nb.id}/update`).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send({});
    expect(decodeURIComponent(res.headers.location)).toContain('Updating it: Learn about Dana, then Write the talking points.');
    for (let i = 0; i < 200 && ctx.notebookPipelines?.has(nb.id); i++) await new Promise((r) => setTimeout(r, 25));
    const after = store.get(nb.id)!;
    expect(after.steps!.map((x) => x.status)).toEqual(['done', 'done']);
    expect(after.briefing!.points.map((p) => p.text)).toEqual(['Ask about the new role']);
    const said = InboxStore.fromHandle(S.runStore.databaseHandle()).listResponses(after.conversationId!).map((r) => r.body);
    const update = said.find((x) => x.startsWith('Updated **Prepare for a call with Dana Reyes**'))!;
    expect(update).toContain('(Learn about Dana, then Write the talking points).');
    expect(update).toMatch(/\*\*What's new since \w+ \d+:\*\*\n- 1 new fact: Role/);
    expect(update).toContain('- Looked again (**Learn about Dana**)');
    expect(update).toContain('- Wrote again (**Write the talking points**)');
    // One message for the update: Look again's own note isn't said as well.
    expect(said.filter((x) => x.startsWith('Looked again'))).toEqual([]);

    // sua's card asks the same, and one step alone isn't an update.
    const { pinStepAction } = await import('../lib/notebook-step-queue.js');
    const { parseProposedActions } = await import('./inbox-plan.js');
    const { accepted } = parseProposedActions([{ type: 'notebook-step', rationale: 'You asked what is new', inputs: { NOTEBOOK: nb.id, STEP: s1, UPDATE: '1' } }], [], []);
    expect(accepted[0]).toMatchObject({ agentId: 'notebook-step', ctaLabel: 'Update it', inputs: { NOTEBOOK: nb.id, UPDATE: '1' } });
    const card = accepted[0];
    expect(pinStepAction(ctx, card as never)).toEqual({ action: card });
    const { executeNotebookStep } = await import('./inbox-engine.js');
    expect(await executeNotebookStep(ctx, card as never)).toMatchObject({ status: 'completed', summary: "Updating it: **Learn about Dana**, then **Write the talking points**. I'll say here what's new since the last run." });
    for (let i = 0; i < 200 && ctx.notebookPipelines?.has(nb.id); i++) await new Promise((r) => setTimeout(r, 25));
    store.updateStep(nb.id, s2, { status: 'todo' });
    expect(pinStepAction(ctx, card as never).reason).toContain('two or more');
    expect((await get(`/notebooks/${nb.id}`)).text).not.toContain('Update all →');
    S.researchReply = undefined;
    S.writerReply = undefined;
  });

  it('updates a shortlist: Search again, then sources and checks only the new ones; picks stay', async () => {
    const app = await makeApp();
    const read = join(S.dir, 'read');
    S.agentStore.createAgent({ id: 'posting-reader', name: 'Posting reader', status: 'active', source: 'local', mcp: false,
      inputs: { PAGE_URL: { type: 'string', default: '' }, WANT: { type: 'string', default: 'level' } },
      nodes: [{ id: 'n', type: 'shell', command: `echo "$PAGE_URL|$WANT" >> ${read}; echo '{"url":"x","status":"ok","level":"Principal"}'` }] } as never, 'cli');
    const { NotebookStore, InboxStore } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const ctx = getContext(app.locals);
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Staff PM roles' });
    store.setFields(nb.id, [{ key: 'posting_url', label: 'Posting', type: 'url', role: 'link' }, { key: 'level', label: 'Level', type: 'text' }]);
    store.setChecks(nb.id, ['Remote OK']);
    // One it has, never sourced or checked: the update leaves it to those steps' own buttons.
    // (Its short name, "Staff PM", is the new one's too: they're told apart by id.)
    const old = store.upsertOption(nb.id, { title: 'Staff PM, Old Co, $200k', by: 'you', data: { posting_url: 'https://jobs.lever.co/oldco/1' }, fingerprint: 'https://jobs.lever.co/oldco/1' }).entry;
    store.setSteps(nb.id, [{ title: 'Find 2 roles', kind: 'find', target: 2 }, { title: 'Read each posting', kind: 'source', agentId: 'posting-reader', facts: ['level'] }, { title: 'Check them', kind: 'check' }, { title: 'Pick 1', kind: 'decide', target: 1 }]);
    const [s1, s2, s3] = store.get(nb.id)!.steps!.map((x) => x.id);
    store.updateStep(nb.id, s1, { status: 'done' });
    store.updateStep(nb.id, s2, { status: 'done', movedOn: true });
    store.updateStep(nb.id, s3, { status: 'done', movedOn: true });
    // Its search before, from before passes kept their step.
    store.finishPass(store.startPass(nb.id, 'pipeline'), 'notebook-finder: 1 new');
    await new Promise((r) => setTimeout(r, 5));
    const { greetNotebook } = await import('../lib/notebook-chat.js');
    greetNotebook(ctx, nb.id);
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect((await get(`/notebooks/${nb.id}`)).text).toContain('Update all →');
    S.finderReply = () => `<notebook>${JSON.stringify({ entries: [{ kind: 'option', title: 'Staff PM, New Co, $250k', data: { posting_url: 'https://jobs.ashbyhq.com/newco/2' }, fingerprint: 'https://jobs.ashbyhq.com/newco/2' }] })}</notebook>`;
    const asked: Array<Record<string, string>> = [];
    S.checkerReply = (inputs) => {
      asked.push(inputs);
      const id = (JSON.parse(inputs.OPTIONS) as Array<{ id: string }>)[0].id;
      return `<notebook>${JSON.stringify({ facts: [{ id, checked: ['Remote OK'] }] })}</notebook>`;
    };
    const res = await request(app).post(`/notebooks/${nb.id}/update`).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send({});
    expect(decodeURIComponent(res.headers.location)).toContain('Updating it: Find 2 roles, then Read each posting, then Check them.');
    for (let i = 0; i < 200 && ctx.notebookPipelines?.has(nb.id); i++) await new Promise((r) => setTimeout(r, 25));
    // Its page was read, and the checker asked about it: the new one only.
    expect(readFileSync(read, 'utf-8').trim().split('\n')).toEqual(['https://jobs.ashbyhq.com/newco/2|Level']);
    const fresh = store.entries(nb.id).find((e) => e.title === 'Staff PM, New Co, $250k')!;
    expect(fresh.data).toMatchObject({ level: 'Principal' });
    expect(fresh.factMeta?.level?.source).toBe('https://jobs.ashbyhq.com/newco/2');
    expect(store.entries(nb.id).find((e) => e.id === old.id)!.data?.level).toBeUndefined();
    expect(asked).toHaveLength(1);
    expect((JSON.parse(asked[0].OPTIONS) as Array<{ id: string }>).map((o) => o.id)).toEqual([fresh.id]);
    expect(store.entries(nb.id).find((e) => e.id === fresh.id)!.checked).toEqual(['Remote OK']);
    expect(store.entries(nb.id).find((e) => e.id === old.id)!.checked ?? []).toEqual([]);
    expect(store.get(nb.id)!.steps!.map((x) => x.status)).toEqual(['done', 'done', 'done', 'todo']);
    const said = InboxStore.fromHandle(S.runStore.databaseHandle()).listResponses(store.get(nb.id)!.conversationId!).map((r) => r.body);
    const update = said.find((x) => x.startsWith('Updated **Staff PM roles**'))!;
    expect(update).toContain('- Sourced the new ones (**Read each posting**, with posting-reader): read 1 of 1 new page, 1 fact.');
    expect(update).toContain('- Checked the new ones (**Check them**, with notebook-checker): 1 of 1 new checked.');
    expect(said.filter((x) => x.startsWith('Searched again'))).toEqual([]);
    // The search's list on its line; and what's new, against the search before passes kept their step.
    expect(update).toContain('1 new option in the notebook: Staff PM, New Co, $250k');
    expect(update).toContain('- 1 new finding from the search: Staff PM');
    S.finderReply = undefined;
    S.checkerReply = undefined;
  });

  it('an update of a notebook that writes an answer traces the sources it found, and any not traced yet', async () => {
    const app = await makeApp();
    const { NotebookStore, InboxStore } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const ctx = getContext(app.locals);
    const read: string[] = [];
    ctx.notebookTrace = async (url: string) => { read.push(url); return url.includes('missing') ? 'missing' : 'found'; };
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Settle whether a hot dog is a sandwich' });
    // A page from before this update, never traced (its options were checked, not its pages).
    store.addEntry(nb.id, { kind: 'evidence', title: 'Dictionary', body: '"a sandwich is two slices of bread with a filling" Dictionary (found by the Web search)', by: 'x', source: 'https://dictionary.example/sandwich' });
    store.setSteps(nb.id, [{ title: 'Find sources', kind: 'find', target: 1 }, { title: 'Check the sources', kind: 'check' }, { title: 'Write the answer', kind: 'write', shape: 'answer' }]);
    const [s1, s2] = store.get(nb.id)!.steps!.map((x) => x.id);
    store.updateStep(nb.id, s1, { status: 'done' });
    store.updateStep(nb.id, s2, { status: 'done', note: '1 of 1 sources traced' });
    const { greetNotebook } = await import('../lib/notebook-chat.js');
    greetNotebook(ctx, nb.id);
    S.finderReply = () => `<notebook>${JSON.stringify({ entries: [
      { kind: 'evidence', title: 'A food writer', body: '"a hot dog is its own thing" Food writer (found by the Web search)', source: 'https://food.example/hot-dog', fingerprint: 'https://food.example/hot-dog' },
      { kind: 'evidence', title: 'A council', body: '"we do not call it a sandwich" Council (found by the Web search)', source: 'https://council.example/missing', fingerprint: 'https://council.example/missing' },
    ] })}</notebook>`;
    let checkerAsked = 0;
    S.checkerReply = () => { checkerAsked++; return '<notebook>{}</notebook>'; };
    const res = await request(app).post(`/notebooks/${nb.id}/update`).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send({});
    expect(decodeURIComponent(res.headers.location)).toContain('Updating it: Find sources, then Check the sources.');
    for (let i = 0; i < 200 && ctx.notebookPipelines?.has(nb.id); i++) await new Promise((r) => setTimeout(r, 25));
    // Every page traced once: the two it found and the one from before.
    expect(read.sort()).toEqual(['https://council.example/missing', 'https://dictionary.example/sandwich', 'https://food.example/hot-dog']);
    expect(store.entries(nb.id, 1000).filter((e) => e.kind === 'evidence').every((e) => e.trace)).toBe(true);
    // No checks of its own: the checker isn't run; the step says where it stands now.
    expect(checkerAsked).toBe(0);
    expect(store.get(nb.id)!.steps![1].note).toBe('3 of 3 sources traced');
    const said = InboxStore.fromHandle(S.runStore.databaseHandle()).listResponses(store.get(nb.id)!.conversationId!).map((r) => r.body);
    expect(said.find((x) => x.startsWith('Updated **Settle whether'))).toContain('- Traced the new sources (**Check the sources**): 2 quotes found on their pages · 1 not found word for word.');
    S.finderReply = undefined;
    S.checkerReply = undefined;
    ctx.notebookTrace = undefined;
  });

  it('looks up a company alone as a company, and is stuck without an answer', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const { startNotebookStep } = await import('../lib/notebook-steps.js');
    const ctx = getContext(app.locals);
    ctx.notebookLogoDeps = { fetchImage: async () => { throw new Error('offline'); }, siteIcons: async () => [] };
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Prepare for a meeting with Acme Robotics' });
    store.setSteps(nb.id, [{ title: 'Learn about Acme', kind: 'profile' }, { title: 'Find 5 themes', kind: 'find', target: 5 }]);
    S.researchReply = () => undefined;
    startNotebookStep(ctx, nb.id);
    for (let i = 0; i < 200 && store.get(nb.id)!.steps![0].status === 'running'; i++) await new Promise((r) => setTimeout(r, 25));
    expect(S.researchAsked.map((x) => x.SUBJECT)).toEqual(['Acme Robotics']);
    expect(store.get(nb.id)!.steps![0]).toMatchObject({ status: 'stuck', stalled: true });

    S.researchReply = (inputs) => JSON.stringify(inputs.ASK.includes('photo_url')
      ? { found: { kind: { value: 'company' }, website: { value: 'https://acme.example' } } }
      : { found: { what_they_do: { value: 'Warehouse robots' }, website: { value: 'https://acme.example' }, size: { value: '80' }, founded: { value: '2019' }, headquarters: { value: 'Austin' },
        competitors: { value: [{ name: 'Locus Robotics', website: 'https://locusrobotics.com', how: 'Warehouse picking robots' }, { name: 'Acme Robotics' }], source: 'https://g2.example/acme-alternatives' } } });
    S.researchAsked.length = 0;
    startNotebookStep(ctx, nb.id);
    for (let i = 0; i < 200 && store.get(nb.id)!.steps![0].status === 'running'; i++) await new Promise((r) => setTimeout(r, 25));
    const after = store.get(nb.id)!;
    expect(S.researchAsked.map((x) => x.SUBJECT)).toEqual(['Acme Robotics', 'Acme Robotics']);
    expect(after.about!.person).toBeUndefined();
    expect(after.about!.company!.facts.map((f) => f.key)).toEqual(['what_they_do', 'website', 'size', 'founded', 'headquarters']);
    // Its competitors are their own list (not a fact), never the company itself, each with the page that names it.
    expect(after.about!.company!.competitors).toMatchObject([{ name: 'Locus Robotics', website: 'https://locusrobotics.com', how: 'Warehouse picking robots', source: 'https://g2.example/acme-alternatives' }]);
    // A company alone is looked up thoroughly, for its industry, model and competitors too.
    const asked = S.researchAsked[1];
    expect(asked.DEPTH).toBe('thorough');
    expect(JSON.parse(asked.ASK).map((a: { key: string }) => a.key)).toEqual(['what_they_do', 'website', 'industry', 'business_model', 'competitors', 'size', 'revenue', 'stage', 'founded', 'headquarters', 'recent_news']);
    expect(after.steps![0].status).toBe('met');
    // No picture could be fetched: their initials stand in.
    expect(store.aboutPhotos(nb.id).size).toBe(0);
  });
});

describe('a step added in front of done ones', () => {
  it('offers the next step still to do, and never posts a card it would retire (no card after card)', async () => {
    const app = await makeApp();
    const { NotebookStore, InboxStore } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const { postStepCard, stepCards } = await import('../lib/notebook-steps.js');
    const { reconcileStepCards } = await import('../lib/notebook-step-queue.js');
    const ctx = getContext(app.locals);
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb0 = store.create({ title: 'Prepare for a call' });
    store.setSteps(nb0.id, [
      { title: 'Learn about Dana', kind: 'profile' },
      { title: 'Find 5 themes', kind: 'find', target: 5, status: 'done' },
      { title: 'Check them', kind: 'check', status: 'done' },
      { title: 'Choose talking points', kind: 'decide', target: 3 },
    ]);
    const s1 = store.get(nb0.id)!.steps![0].id;
    let nb = store.updateStep(nb0.id, s1, { status: 'met' });
    const { greetNotebook } = await import('../lib/notebook-chat.js');
    greetNotebook(ctx, nb.id);
    nb = store.get(nb.id)!;
    // Next after it is yours (Decide): no Continue card for a step that's done.
    expect(stepCards(nb, s1, { have: 4, want: 4, met: true })).toEqual([]);
    postStepCard(ctx, nb, s1, { have: 4, want: 4, met: true, missing: [] });
    const thread = nb.conversationId!;
    const said = InboxStore.fromHandle(S.runStore.databaseHandle()).listResponses(thread).map((r) => r.body).join('\n');
    expect(said).toContain('One step is yours: **Choose talking points**.');
    expect(said).toContain(`[Open the answer →](/notebooks/${nb.id})`);
    expect(said).not.toContain('Next is **Find 5 themes**');
    const cards = () => InboxStore.fromHandle(S.runStore.databaseHandle()).listResponses(thread).filter((r) => r.role === 'action' && r.body.startsWith('Start step')).length;
    const before = cards();
    for (let i = 0; i < 5; i++) reconcileStepCards(ctx, nb.id);
    expect(cards()).toBe(before);

    // With a step of sua's still to do after done ones, Continue names it.
    store.setSteps(nb.id, [...store.get(nb.id)!.steps!.slice(0, 3), { title: 'Source evidence', kind: 'source' }, { title: 'Choose talking points', kind: 'decide', target: 3 }]);
    nb = store.get(nb.id)!;
    expect(stepCards(nb, s1, { have: 4, want: 4, met: true }).map((c) => c.rationale)).toEqual(['Start step 4: Source evidence.']);
  });
});

describe('a drawn page\'s brief', () => {
  it('prints the notebook\'s own page (its parts, in order), the extended brief adds everything behind it, and a saved one carries its pictures', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Prepare for a call with Dana Reyes', statement: 'What matters to Dana' });
    store.setFields(nb.id, [{ key: 'theme', label: 'Theme', type: 'text' }, { key: 'evidence', label: 'Evidence', type: 'text' }, { key: 'source_url', label: 'Source', type: 'url', role: 'link' }, { key: 'conversation_question', label: 'Question', type: 'text' }]);
    for (let i = 1; i <= 10; i++) store.upsertOption(nb.id, { title: `Theme ${String(i)}`, by: 'agent:x', data: { theme: `t${String(i)}`, evidence: `She said thing ${String(i)}.`, source_url: `https://example.com/${String(i)}`, conversation_question: `Question ${String(i)}?` } });
    store.setAbout(nb.id, 'person', { name: 'Dana Reyes', facts: [{ key: 'role', label: 'Role', value: 'VP Ops', source: 'https://northwind.example/team' }] });
    store.saveAboutPhoto(nb.id, 'person', 'https://northwind.example/dana.png', { contentType: 'image/png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }, 'photo', { page: 'https://northwind.example/team', why: 'captioned' });
    store.setLayout(nb.id, 'dossier', 'you');
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const brief = (await get(`/notebooks/${nb.id}/brief.html`)).text;
    expect(brief).toContain('Meeting brief · ');
    expect(brief).toContain('class="profile profile--cover"');
    expect(brief).toContain(`src="/notebooks/${nb.id}/about/person/photo"`);
    expect(brief).toContain('Photo: <a href="https://northwind.example/team">northwind.example</a>');
    // In the page's order: who they are, what we know, what to talk about, in their words.
    const at = (s: string) => brief.indexOf(s);
    // A meeting's brief leads with what to say: who (the document's head), the talking points, then the facts.
    expect(at('class="doc-cover"')).toBeGreaterThan(0);
    expect(at('class="doc-cover"')).toBeLessThan(at('What to talk about'));
    expect(at('What to talk about')).toBeLessThan(at('What we know'));
    expect(at('What we know')).toBeLessThan(at('In their words'));
    expect(brief).toContain('And 5 more in the extended brief.');
    expect(brief).not.toContain('The shortlist');
    const full = (await get(`/notebooks/${nb.id}/brief.html?full=1`)).text;
    for (const s2 of ['Everything they said', 'Every fact, with its page', 'Each one in full', 'She said thing 10.', 'https://northwind.example/team']) expect(full).toContain(s2);
    const saved = (await get(`/notebooks/${nb.id}/brief.html?download=1`)).text;
    expect(saved).toContain('src="data:image/png;base64,');
    expect(saved).not.toContain('/about/person/photo"');
    // A shortlist keeps the shortlist brief.
    store.setLayout(nb.id, null, 'you');
    expect((await get(`/notebooks/${nb.id}/brief.html`)).text).toContain('Key findings');
  });
});

describe('a drawn page\'s header', () => {
  it('follows the layout\'s NotebookHeader: subtitle, no statement, step chips, a drawn side part; without one, the usual header', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Prepare for a call with Dana', statement: 'What matters to Dana before we talk' });
    store.setSteps(nb.id, [{ title: 'Find 5 themes', kind: 'find', target: 5 }, { title: 'Choose talking points', kind: 'decide', target: 3 }]);
    const get = () => request(app).get(`/notebooks/${nb.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    let html = (await get()).text;
    expect(html).toContain('What matters to Dana before we talk');
    expect(html).not.toContain('nb-hero__subtitle');

    store.setLayout(nb.id, { components: [
      { id: 'root', component: 'Column', children: ['header', 'note'] },
      { id: 'header', component: 'NotebookHeader', subtitle: 'Meeting briefing', statement: false, steps: 'fold', cover: 'none', side: 'glance' },
      { id: 'glance', component: 'Callout', label: 'At a glance', text: 'Three themes to raise' },
      { id: 'note', component: 'Callout', label: 'The page', text: { path: '/notebook/title' } },
    ] });
    html = (await get()).text;
    expect(html).toContain('<p class="nb-hero__subtitle">Meeting brief</p>');
    expect(html).not.toContain('<p class="nb-hero__statement">What matters to Dana before we talk</p>');
    // Nothing running: one chip per step.
    expect(html).toContain('<div class="nb-chips" role="list" aria-label="Steps">');
    expect(html).toMatch(/<summary class="nb-chip-step__chip" title="Find 5 themes: 0 of 5 found"><span aria-hidden="true">○<\/span> Find <span class="nb-chip-step__count">0\/5<\/span>/);
    // Done, its chip offers what it can do (in its card).
    const s1 = store.get(nb.id)!.steps![0].id;
    store.updateStep(nb.id, s1, { status: 'done' });
    html = (await get()).text;
    expect(html.slice(html.indexOf('nb-chip-step--done'), html.indexOf('class="nb-chips__all"'))).toContain('Search again →');
    // The decide step is next and yours: its chip says so; the chips stay folded.
    expect(html).toMatch(/nb-chip-step--yours[\s\S]*?○<\/span> Choose <span class="nb-chip-step__count">3<\/span> <span class="nb-chip-step__tag">· yours<\/span>/);
    // A step stuck: the full strip, no chips.
    store.updateStep(nb.id, s1, { status: 'stuck' });
    const stuck = (await get()).text;
    expect(stuck).not.toContain('<div class="nb-chips"');
    expect(stuck).toContain('nb-step nb-step--stuck');
    store.updateStep(nb.id, s1, { status: 'todo' });
    expect(html).toContain('data-a2ui-surface');
    expect(html).toContain(`notebook-${nb.id}-header`);
    expect(html).toContain('Three themes to raise');
    // The header and its side part aren't drawn again in the page below it.
    const main = html.slice(html.indexOf('data-nb-main'));
    expect(main).not.toContain('NotebookHeader');
    expect(main).not.toContain('Three themes to raise');
    expect(main).toContain('The page');
  });
});

describe('a new notebook decides its page', () => {
  afterEach(() => { S.pageReply = undefined; S.pageAsked.length = 0; });
  const BRIEFING = [
    { id: 'root', component: 'Column', children: ['agenda_panel', 'said_panel'] },
    { id: 'agenda_panel', component: 'Panel', title: 'What to talk about', child: 'agenda' },
    { id: 'agenda', component: 'Agenda', points: { path: '/notebook/talkingPoints' }, questions: { path: '/notebook/questions' } },
    { id: 'said_panel', component: 'Panel', title: 'What they care about', child: 'said' },
    { id: 'said', component: 'QuoteList', items: { path: '/notebook/quotes' } },
  ];

  it('draws one that fits once it\'s set up (one more try when the first doesn\'t check out), says so, and Undo puts the shortlist back', async () => {
    const app = await makeApp();
    S.pageAsked.length = 0;
    S.pageReply = (inputs) => (inputs.ERRORS
      ? `<page>${JSON.stringify({ about: 'a briefing: what to talk about, what they said', components: BRIEFING })}</page>`
      : `<page>${JSON.stringify({ components: [{ id: 'root', component: 'Column', children: ['x'] }, { id: 'x', component: 'Nope' }] })}</page>`);
    const post = (path: string, body: Record<string, string> = {}) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    await post('/notebooks', { title: 'Prepare for a meeting with Dana Reyes', statement: 'What matters to Dana before we meet' });
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const id = 'prepare-for-a-meeting-with-dana-reyes';
    for (let i = 0; i < 200 && !store.get(id)!.conversationId; i++) await new Promise((r) => setTimeout(r, 25));
    const nb = store.get(id)!;
    expect(S.pageAsked).toHaveLength(2);
    expect(JSON.parse(S.pageAsked[0].NOTEBOOK)).toMatchObject({ title: nb.title, for: 'What matters to Dana before we meet' });
    expect(S.pageAsked[0].PRESETS).toContain('shortlist: ');
    expect(S.pageAsked[0].GUIDE).toContain('/notebook/quotes');
    expect(S.pageAsked[1].ERRORS).not.toBe('');
    expect(nb.layout).toEqual({ components: BRIEFING, about: 'a briefing: what to talk about, what they said' });
    const { InboxStore } = await import('@some-useful-agents/core');
    const said = InboxStore.fromHandle(S.runStore.databaseHandle()).listResponses(nb.conversationId!).map((r) => r.body).join('\n');
    expect(said).toContain("Its page is drawn for what it's for: a briefing: what to talk about, what they said.");
    const edit = (await request(app).get(`/notebooks/${id}/edit?tab=looks`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;
    expect(edit).toContain('A briefing: what to talk about, what they said.');
    expect(edit).toContain('Let sua pick');
    await post(`/notebooks/${id}/layout`, { undo: '1' });
    expect(store.get(id)!.layout).toBeUndefined();

  });

  it('gives a page that reads like a grid one more try, and keeps it when that try can\'t be drawn', async () => {
    const app = await makeApp();
    const { getContext } = await import('../context.js');
    const { decideNotebookPage } = await import('../lib/notebook-page.js');
    const { NotebookStore } = await import('@some-useful-agents/core');
    const ctx = getContext(app.locals);
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const grid = [
      { id: 'root', component: 'Column', children: ['r1', 'r2'] },
      { id: 'r1', component: 'Columns', children: ['a', 'b'], widths: [1, 1] },
      { id: 'r2', component: 'Columns', children: ['c', 'd'], widths: [1, 1] },
      ...['a', 'b', 'c', 'd'].map((id) => ({ id, component: 'Panel', title: id, child: `t${id}` })),
      ...['a', 'b', 'c', 'd'].map((id) => ({ id: `t${id}`, component: 'Text', text: 'x' })),
    ];
    const nb = store.create({ title: 'Prepare for a call with Dana' });
    S.pageAsked.length = 0;
    S.pageReply = (inputs) => (inputs.ERRORS ? `<page>${JSON.stringify({ preset: 'dossier', about: 'a meeting briefing' })}</page>` : `<page>${JSON.stringify({ components: grid })}</page>`);
    expect(await decideNotebookPage(ctx, nb.id)).toBe('drawn');
    expect(S.pageAsked).toHaveLength(2);
    expect(S.pageAsked[0].PRESETS).toContain('dossier: Getting ready to meet');
    expect(S.pageAsked[1].ERRORS).toContain('It can be drawn, but it reads like a grid: 4 parts are framed');
    expect(store.get(nb.id)!.layout).toMatchObject({ preset: 'dossier', about: 'a meeting briefing' });

    // The second try can't be drawn: the first, readable if grid-like, stands.
    const nb2 = store.create({ title: 'Prepare for a call with Sam' });
    S.pageReply = (inputs) => (inputs.ERRORS ? 'no page' : `<page>${JSON.stringify({ components: grid })}</page>`);
    expect(await decideNotebookPage(ctx, nb2.id)).toBe('drawn');
    expect(store.get(nb2.id)!.layout!.components).toEqual(grid);
    S.pageReply = undefined;
  });

  it('keeps the shortlist when sua says so or can\'t draw one, and never replaces a page it came with', async () => {
    const app = await makeApp();
    const { getContext } = await import('../context.js');
    const { createNotebookFrom } = await import('../lib/notebook-create.js');
    const { decideNotebookPage } = await import('../lib/notebook-page.js');
    const { NotebookStore } = await import('@some-useful-agents/core');
    const ctx = getContext(app.locals);
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Buy a used car' });
    S.pageReply = () => `<page>${JSON.stringify({ preset: 'shortlist', about: 'choosing among many' })}</page>`;
    expect(await decideNotebookPage(ctx, nb.id)).toBe('kept');
    S.pageReply = () => 'no page';
    expect(await decideNotebookPage(ctx, nb.id)).toBe('failed');
    expect(store.get(nb.id)!.layout).toBeUndefined();

    // A template's page stands: the agent isn't asked.
    S.pageAsked.length = 0;
    const made = createNotebookFrom(ctx, { title: 'Prepare for a call', statement: 'x', params: [], criteria: [], fields: [{ key: 'theme', label: 'Theme', type: 'text' }], layout: { components: BRIEFING } });
    for (let i = 0; i < 200 && !store.get(made.id)!.conversationId; i++) await new Promise((r) => setTimeout(r, 25));
    expect(S.pageAsked).toHaveLength(0);
    expect(store.get(made.id)!.layout?.components).toEqual(BRIEFING);
    expect(await decideNotebookPage(ctx, made.id)).toBe('skipped');
  });
});

describe("choosing a notebook's picture in its conversation", () => {
  it("sua's card fetches the picture, keeps it, and it leads the page credited; a page address gives its preview picture; CLEAR goes back", async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const { executeNotebookPhoto } = await import('../lib/notebook-photo-action.js');
    const { parseProposedActions } = await import('./inbox-plan.js');
    const { notebookWidgetData } = await import('../lib/notebook-widgets.js');
    const ctx = getContext(app.locals);
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const nb = store.create({ title: 'Settle whether a hot dog is a sandwich' });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const fetched: string[] = [];
    const deps = {
      fetchImage: async (u: string) => { fetched.push(u); if (!u.endsWith('.jpg')) throw new Error('Unsupported content type "text/html".'); return { bytes: png, contentType: 'image/png' }; },
      pagePreview: async () => ({ image: 'https://upload.wikimedia.org/x/Hotdog.jpg' }),
    };

    const { accepted, rejected } = parseProposedActions([
      { type: 'notebook-photo', rationale: 'A hot dog in a split bun', inputs: { NOTEBOOK: nb.id, IMAGE: 'https://upload.wikimedia.org/x/Hotdog.jpg', PAGE: 'https://commons.wikimedia.org/wiki/File:Hotdog.jpg', CREDIT: '“Hotdog” by Evan Swigart, CC BY 2.0', ALT: 'A hot dog in a split bun' } },
      { type: 'notebook-photo', inputs: { NOTEBOOK: nb.id, IMAGE: 'not a link' } },
    ], [], []);
    expect(rejected[0].reason).toMatch(/^notebook-photo needs inputs.NOTEBOOK and IMAGE/);
    expect(accepted[0]).toMatchObject({ agentId: 'notebook-photo', ctaLabel: 'Use this picture', effect: 'write' });

    expect(await executeNotebookPhoto(ctx, accepted[0], deps)).toMatchObject({ status: 'completed' });
    const chosen = store.get(nb.id)!.photo!;
    expect(chosen).toMatchObject({ image: 'https://upload.wikimedia.org/x/Hotdog.jpg', page: 'https://commons.wikimedia.org/wiki/File:Hotdog.jpg', credit: '“Hotdog” by Evan Swigart, CC BY 2.0' });
    const photo = notebookWidgetData(store.get(nb.id)!, store.entries(nb.id, 1000)).notebook.photo!;
    expect(photo).toMatchObject({ src: `/notebooks/${nb.id}/photo?v=${encodeURIComponent(chosen.at)}`, href: 'https://commons.wikimedia.org/wiki/File:Hotdog.jpg', caption: '“Hotdog” by Evan Swigart, CC BY 2.0', alt: 'A hot dog in a split bun' });
    const served = await get(`/notebooks/${nb.id}/photo`);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');

    // The brief leads with it too: on screen from the dashboard, and saved, inside the file (a PDF can't load the dashboard's address).
    store.setLayout(nb.id, { components: [{ id: 'root', component: 'Column', children: ['pic_p'] }, { id: 'pic_p', component: 'Panel', title: '', child: 'pic', treatment: 'lede', hero: true }, { id: 'pic', component: 'Picture', picture: { path: '/notebook/photo' } }] });
    const screen = (await get(`/notebooks/${nb.id}/brief.html`)).text;
    expect(screen).toContain(`<section class="part part--lede part--hero"><figure class="photo"><img src="/notebooks/${nb.id}/photo?v=`);
    expect(screen).toContain('“Hotdog” by Evan Swigart, CC BY 2.0');
    const saved = (await get(`/notebooks/${nb.id}/brief.html?download=1`)).text;
    expect(saved).toContain('<figure class="photo"><img src="data:image/png;base64,');

    // The file's page, not the image: its preview picture is fetched.
    fetched.length = 0;
    expect(await executeNotebookPhoto(ctx, { ...accepted[0], inputs: { NOTEBOOK: nb.id, IMAGE: 'https://en.wikipedia.org/wiki/Hot_dog' } }, deps)).toMatchObject({ status: 'completed' });
    expect(fetched).toEqual(['https://en.wikipedia.org/wiki/Hot_dog', 'https://upload.wikimedia.org/x/Hotdog.jpg']);
    expect(store.get(nb.id)!.photo!.image).toBe('https://upload.wikimedia.org/x/Hotdog.jpg');

    const failing = { fetchImage: async () => { throw new Error('HTTP 404'); }, pagePreview: async () => ({}) };
    expect(await executeNotebookPhoto(ctx, accepted[0], failing)).toMatchObject({ status: 'failed', refusalReason: "That picture couldn't be fetched (HTTP 404). Find another, or send its address." });

    expect(await executeNotebookPhoto(ctx, { ...accepted[0], inputs: { NOTEBOOK: nb.id, CLEAR: '1' } }, deps)).toMatchObject({ status: 'completed' });
    expect(store.get(nb.id)!.photo).toBeUndefined();
    expect((await get(`/notebooks/${nb.id}/photo`)).status).toBe(404);
  });
});

describe('making a template with sua', () => {
  it('the page previews sua\'s first guess; sua\'s card saves the template; the preview follows it', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const { withEditorBase } = await import('./inbox-engine.js');
    const { executeNotebookTemplate } = await import('../lib/notebook-template-action.js');
    const { parseProposedActions } = await import('./inbox-plan.js');
    const ctx = getContext(app.locals);
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const nb = store.create({ title: 'Prepare for meeting with Dana Reyes', statement: 'Help me understand what matters to Dana Reyes before we meet.', params: ['Dana Reyes', 'LinkedIn profile provided', 'focus on what matters to her'], criteria: ['Talking points chosen'] });
    store.setFields(nb.id, [{ key: 'theme', label: 'Theme', type: 'text' }, { key: 'evidence', label: 'What suggests it matters to her', type: 'text' }]);
    store.setSteps(nb.id, [{ title: 'Find 5 conversation themes', kind: 'find', target: 5 }, { title: 'Choose talking points', kind: 'decide', target: 3 }]);

    // Before anything is saved: sua's first guess, with what changes each time marked.
    let page = (await get(`/notebooks/${nb.id}/template`)).text;
    expect(page).toContain('Make a template from this notebook');
    expect(page).toContain('Not saved yet: this is sua');
    expect(page).toContain('Help me understand what matters to <mark class="nbt-subj" title="Filled in each time">Who or what it’s about</mark> before we meet.');
    expect(page).toContain('name="template" value="1"');
    expect(page).toContain('Edit the words yourself');

    const inputs = {
      NOTEBOOK: nb.id, NAME: 'Prepare for a meeting', SUBJECT_LABEL: 'Who you’re meeting (a person or company)', SUBJECT_EXAMPLE: 'Dana Reyes',
      STATEMENT: 'Help me understand what matters to Dana Reyes before we meet.',
      PARAMS: ['Dana Reyes', 'focus on what matters to them'], CRITERIA: ['Talking points chosen'],
      STEP_TITLES: { s1: 'Find 5 things Dana Reyes cares about' }, FIELD_LABELS: { evidence: 'What suggests it matters to them' },
    };
    const { accepted, rejected } = parseProposedActions([{ type: 'notebook-template', rationale: 'Works for anyone', inputs }, { type: 'notebook-template', inputs: { NOTEBOOK: nb.id } }], [], []);
    expect(rejected[0].reason).toBe('notebook-template needs inputs.NOTEBOOK and inputs.NAME');
    expect(accepted[0]).toMatchObject({ agentId: 'notebook-template', ctaLabel: 'Save the template', inputs: { PARAMS: JSON.stringify(inputs.PARAMS) } });
    const card = withEditorBase(ctx, accepted[0]);
    expect(card.surfaceChanges).toContainEqual({ what: 'asks each time', before: '—', after: 'Who you’re meeting (a person or company) (this time: Dana Reyes)' });
    expect(card.surfaceChanges).toContainEqual({ what: 'limits', before: '—', after: 'focus on what matters to them' });
    expect(card.surfaceChanges).toContainEqual({ what: 'steps', before: '—', after: '1. Find 5 things {subject} cares about; 2. Choose talking points' });
    expect(executeNotebookTemplate(ctx, card)).toMatchObject({ status: 'completed' });
    expect(store.getTemplate('prepare-for-a-meeting')!.setup).toMatchObject({
      statement: 'Help me understand what matters to {subject} before we meet.', params: ['focus on what matters to them'],
      subject: { label: 'Who you’re meeting (a person or company)', example: 'Dana Reyes' },
    });

    // The page and its live preview show the saved one.
    page = (await get(`/notebooks/${nb.id}/template`)).text;
    expect(page).toContain('Saved as a template.');
    const pv = (await get(`/notebooks/${nb.id}/template/preview`)).text;
    expect(pv).toMatch(/^<div class="nbt-pv" data-nbt-preview-body>/);
    expect(pv).toContain('<h2 class="nbt-pv__name">Prepare for a meeting</h2>');
    expect(pv).toContain('What suggests it matters to them');
    // A change from the template page reaches sua as being about the template.
    const sent = await request(app).post(`/notebooks/${nb.id}/ask`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE).set('X-Requested-With', 'fetch').type('form').send('template=1&text=call+it+Meeting+prep');
    expect(sent.status).toBe(204);
    const thread = store.get(nb.id)!.conversationId!;
    expect(ctx.inboxStore!.listResponses(thread).some((r) => r.role === 'user' && r.body === "About this notebook's template: call it Meeting prep")).toBe(true);
  });
});

describe('download the shortlist', () => {
  it('sends a CSV attachment best first, and the header links to it once there are options', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.setFields(store.create({ title: 'Accounts to call' }).id, [{ key: 'fit', label: 'Fit', type: 'number', role: 'score' }]);
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect((await get(`/notebooks/${nb.id}`)).text).not.toContain('shortlist.csv');
    const low = store.upsertOption(nb.id, { title: 'Low', by: 'agent:x', data: { fit: 40 } }).entry;
    const high = store.upsertOption(nb.id, { title: 'High', by: 'agent:x', data: { fit: 90 } }).entry;
    expect((await get(`/notebooks/${nb.id}`)).text).toContain(`href="/notebooks/${nb.id}/shortlist.csv?rows=running"`);
    const res = await get(`/notebooks/${nb.id}/shortlist.csv`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${nb.id}-shortlist.csv"`);
    const rows = res.text.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
    expect(rows.slice(1).map((r) => r.split(',').slice(0, 2).join(','))).toEqual(['1,High', '2,Low']);
    expect((await get(`/notebooks/${nb.id}/shortlist.csv?all=1`)).headers['content-disposition']).toContain('-all.csv');
    expect((await get('/notebooks/nope/shortlist.csv')).status).toBe(404);

    // Decided: the CSV is the final set unless you ask for more; ids take exactly those.
    store.decide(nb.id, '', 'you', [low.id]);
    const page = (await get(`/notebooks/${nb.id}`)).text;
    expect(page).toMatch(/shortlist\.csv\?rows=chosen" download[^>]*>Chosen <span class="nb-csv__n">1</);
    expect(page).toContain('"csvHref":"/notebooks/');
    const chosen = await get(`/notebooks/${nb.id}/shortlist.csv`);
    expect(chosen.headers['content-disposition']).toContain('-chosen.csv');
    const crows = chosen.text.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
    expect(crows[0]).toContain(',Fit,Chosen,');
    expect(crows.slice(1).map((r) => r.split(',').slice(0, 2).join(','))).toEqual(['1,Low']);
    const running = (await get(`/notebooks/${nb.id}/shortlist.csv?rows=running`)).text.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
    expect(running.slice(1).map((r) => r.split(',').slice(0, 2).join(','))).toEqual(['1,Low', '2,High']); // chosen first
    const picked = await get(`/notebooks/${nb.id}/shortlist.csv?rows=all&ids=${high.id}`);
    expect(picked.headers['content-disposition']).toContain('-selection.csv');
    expect(picked.text.replace(/^\uFEFF/, '').trimEnd().split('\r\n').slice(1).map((r) => r.split(',')[1])).toEqual(['High']);
  });
});

describe('the catalog knows which agents fill notebooks', () => {
  it('badges and filters the agents list, shows the notebooks on the agent page, and the drafter sees them first', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { searchAgents } = await import('../lib/notebook-draft.js');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    S.agentStore.createAgent({ id: 'car-sweep', name: 'Car sweep', description: 'Sweeps car listings', status: 'active', source: 'local', mcp: false, nodes: [{ id: 'n', type: 'shell', command: 'echo hi' }] } as never, 'cli');
    S.agentStore.createAgent({ id: 'zz-idle', name: 'Idle', description: 'Never filed', status: 'active', source: 'local', mcp: false, nodes: [{ id: 'n', type: 'shell', command: 'echo hi' }] } as never, 'cli');
    const cars = store.create({ title: 'Buy a car', pipeline: ['car-sweep'] });
    const bikes = store.create({ title: 'Buy a bike' });
    store.addEntry(bikes.id, { kind: 'note', title: 'found one', by: 'agent:car-sweep', runId: 'r1' });
    store.addEntry(bikes.id, { kind: 'note', title: 'set up', by: 'agent:notebook-keeper', runId: 'r2' });

    const byAgent = store.notebooksByAgent(new Set(['notebook-keeper']));
    expect(byAgent.get('car-sweep')!.map((n) => n.title).sort()).toEqual(['Buy a bike', 'Buy a car']);
    expect(byAgent.has('notebook-keeper')).toBe(false);

    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const list = (await get('/agents')).text;
    expect(list).toContain('feeds 2 notebooks');
    expect(list).toContain('Feeds notebooks (1)');
    const only = (await get('/agents?feeds=1')).text;
    expect(only).toContain('car-sweep');
    expect(only).not.toContain('zz-idle');

    const page = (await get('/agents/car-sweep')).text;
    expect(page).toContain('Fills notebooks');
    expect(page).toContain(`href="/notebooks/${cars.id}"`);
    expect(page).toContain(`href="/notebooks/${bikes.id}/workflow"`);
    expect((await get('/agents/zz-idle')).text).not.toContain('Fills notebooks');

    const agents = searchAgents(app.locals as never);
    expect(agents[0]).toMatchObject({ id: 'car-sweep' });
    expect(agents[0].feeds!.sort()).toEqual(['Buy a bike', 'Buy a car']);
    expect(agents.find((a) => a.id === 'zz-idle')!.feeds).toBeUndefined();
  });
});

describe("a notebook's schedule", () => {
  it('runs the pipeline once per slot, waits on a new schedule, catches up once, and marks the pass', async () => {
    const app = await makeApp();
    const ctx = app.locals as never as Parameters<typeof import('../lib/notebook-cadence.js')['runNotebookCadenceOnce']>[0];
    const { runNotebookCadenceOnce } = await import('../lib/notebook-cadence.js');
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Cars every morning', pipeline: ['sched-agent'], cadence: '0 7 * * *' });
    const at = (s: string) => new Date(s);
    const idle = async () => { for (let i = 0; i < 200 && ctx.notebookPipelines?.size; i++) await new Promise((r) => setTimeout(r, 20)); };

    // First sight: the 7:00 already past isn't owed.
    expect(runNotebookCadenceOnce(ctx, at('2026-10-07T08:00:00')).get(nb.id)).toBe('first-seen');
    expect(runNotebookCadenceOnce(ctx, at('2026-10-07T08:30:00')).get(nb.id)).toBe('waiting');
    // Next morning: runs once.
    expect(runNotebookCadenceOnce(ctx, at('2026-10-08T07:01:00')).get(nb.id)).toBe('started');
    await idle();
    expect(runNotebookCadenceOnce(ctx, at('2026-10-08T07:02:00')).get(nb.id)).toBe('waiting');
    expect(store.passes(nb.id)[0]).toMatchObject({ kind: 'pipeline', scheduled: true });
    // Down for three days: one catch-up run, not three.
    expect(runNotebookCadenceOnce(ctx, at('2026-10-11T09:00:00')).get(nb.id)).toBe('started');
    await idle();
    expect(runNotebookCadenceOnce(ctx, at('2026-10-11T09:01:00')).get(nb.id)).toBe('waiting');
    expect(store.passes(nb.id).filter((p) => p.scheduled)).toHaveLength(2);
    // Someone pressed Run: busy, retried next tick.
    store.markCadenceFired(nb.id, '2026-10-11T07:00:00.000Z');
    ctx.notebookPipelines ??= new Map();
    ctx.notebookPipelines.set(nb.id, { agentId: 'sched-agent', step: 1, of: 1, startedAt: Date.now() });
    expect(runNotebookCadenceOnce(ctx, at('2026-10-12T07:00:30')).get(nb.id)).toBe('busy');
    ctx.notebookPipelines.delete(nb.id);
    // A changed schedule starts fresh.
    store.update(nb.id, { cadence: '0 9 * * 1' });
    expect(store.get(nb.id)!.cadenceFiredAt).toBeUndefined();
    expect(runNotebookCadenceOnce(ctx, at('2026-10-12T10:00:00')).get(nb.id)).toBe('first-seen');
    // Closed, or nothing to run: left alone.
    store.setStatus(nb.id, 'stopped');
    expect(runNotebookCadenceOnce(ctx, at('2026-10-20T10:00:00')).has(nb.id)).toBe(false);
  });

  it('a watch with no pipeline searches again with its find step on its schedule, and the header says it runs', async () => {
    const app = await makeApp();
    const ctx = app.locals as never as Parameters<typeof import('../lib/notebook-cadence.js')['runNotebookCadenceOnce']>[0];
    const { runNotebookCadenceOnce } = await import('../lib/notebook-cadence.js');
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Watch for an X100V', cadence: '0 8 * * *' });
    store.setSteps(nb.id, [{ title: 'Find X100V listings', kind: 'find', target: 1, status: 'done' }]);
    const asked: string[] = [];
    S.finderReply = (inputs) => { asked.push(inputs.NOTEBOOK ?? 'asked'); return `<notebook>${JSON.stringify({ entries: [{ kind: 'option', title: 'X100V, silver', data: {} }] })}</notebook>`; };
    const at = (x: string) => new Date(x);
    expect(runNotebookCadenceOnce(ctx, at('2026-10-07T09:00:00')).get(nb.id)).toBe('first-seen');
    expect(runNotebookCadenceOnce(ctx, at('2026-10-08T08:01:00')).get(nb.id)).toBe('started');
    for (let i = 0; i < 200 && ctx.notebookPipelines?.size; i++) await new Promise((r) => setTimeout(r, 20));
    expect(asked).toHaveLength(1);
    expect(store.entries(nb.id).some((e) => e.title === 'X100V, silver')).toBe(true);
    S.finderReply = undefined;
    const page = (await request(app).get(`/notebooks/${nb.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;
    expect(page).not.toContain('once it has a search');
  });

  it('says when it runs next in the header', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Weekly accounts', pipeline: ['sched-agent'], cadence: '0 7 * * 1' });
    const page = (await request(app).get(`/notebooks/${nb.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;
    expect(page).toMatch(/runs [^<]*, next (today|tomorrow|Mon) 7:00 am/);
    const idle = store.create({ title: 'No searches yet', cadence: '0 7 * * 1' });
    expect((await request(app).get(`/notebooks/${idle.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text).toContain('once it has a search (add one under Edit)');
  });
});

describe("an option's own page", () => {
  it('shows every fact with its source, the price over time, its checks and its history; its controls come back to it', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const post = (path: string, body: Record<string, string> = {}) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Commuter car' });
    store.setFields(nb.id, [
      { key: 'price', label: 'Price', type: 'money', role: 'price' },
      { key: 'miles', label: 'Miles', type: 'number', unit: 'mi', role: 'measure' },
      { key: 'link', label: 'Listing', type: 'url', role: 'link' },
    ]);
    store.setStages(nb.id, ['Found', 'Checked', 'Test drive']);
    store.setChecks(nb.id, ['Clean title', 'Service records']);
    const link = 'https://example.com/listing/1';
    const wagon = store.upsertOption(nb.id, { title: '2010 Example Wagon', by: 'agent:car-search', runId: 'run-aaaa1111', data: { price: 4800, miles: { value: 150000, source: 'https://example.com/report', quote: 'odometer reads 150,000 miles' }, link } }).entry;
    store.upsertOption(nb.id, { title: '2010 Example Wagon', by: 'agent:car-search', runId: 'run-bbbb2222', data: { price: 4500, link } });
    store.upsertOption(nb.id, { title: '2012 Example Hatch', by: 'you', data: { price: 5200 } });
    store.checkOption(nb.id, wagon.id, 'Clean title', true);
    const note = store.addEntry(nb.id, { kind: 'note', title: 'Ask about rust', by: 'you' });

    const page = await get(`/notebooks/${nb.id}/entries/${wagon.id}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('2010 Example Wagon');
    expect(page.text).toContain('best price'); // the cheaper of the two
    expect(page.text).toContain('Move to Checked →');
    expect(page.text).toContain('name="back" value="option"');
    expect(page.text).toContain(`href="/notebooks/${nb.id}"`);
    // The widgets: facts with the source and quote, the price over time, checks, its own history.
    expect(page.text).toContain('“odometer reads 150,000 miles”');
    expect(page.text).toContain('https://example.com/report');
    expect(page.text).toContain('"priceSeries":[4800,4500]');
    expect(page.text).toContain('Price dropped');
    expect(page.text).toContain('$4,800 → $4,500');
    // Found links the run that found it; seen again links the later one.
    expect(page.text).toMatch(/"title":"Found"[^}]*run-aaaa1111/);
    expect(page.text).toMatch(/"title":"Price dropped"[^}]*run-bbbb2222/);
    expect(page.text).toContain('{"text":"Clean title","done":true}');
    // Its widgets carry only this option; the other is named once, by Next.
    const widgets = /data-a2ui-surface[^>]*><script type="application\/json">([\s\S]*?)<\/script>/.exec(page.text)![1];
    expect(widgets).not.toContain('2012 Example Hatch');
    expect(page.text).toMatch(/data-nbo-(?:next|prev)[^>]*>[^<]*<span class="nbo-nav__name" data-nbo-name>#\d 2012 Example Hatch/);

    // Its controls come back here; the notebook's cards still go to the notebook.
    const moved = await post(`/notebooks/${nb.id}/entries/${wagon.id}/stage`, { stage: 'Checked', back: 'option' });
    expect(moved.headers.location).toMatch(new RegExp(`^/notebooks/${nb.id}/entries/${wagon.id}\\?flash=`));
    const out = await post(`/notebooks/${nb.id}/entries/${wagon.id}/rule-out`, { quick: 'No reply', back: 'option' });
    expect(out.headers.location).toMatch(new RegExp(`^/notebooks/${nb.id}/entries/${wagon.id}\\?flash=`));
    const outPage = await get(`/notebooks/${nb.id}/entries/${wagon.id}`);
    expect(outPage.text).toContain('Ruled out at Checked: No reply');
    expect(outPage.text).toContain('Moved to Checked');
    expect(outPage.text).not.toContain('best price');
    // Ruled out, it still steps on to the next one (→ too), from where it ranked.
    expect(outPage.text).toMatch(/data-nbo-next[^>]*>[^<]*<span class="nbo-nav__name" data-nbo-name>#1 2012 Example Hatch/);
    expect(outPage.text).toContain('ruled out · 1 in the running');
    const nextAsked = await post(`/notebooks/${nb.id}/ask`, { text: 'next', option: wagon.id });
    expect(nextAsked.headers.location).toMatch(new RegExp(`^/notebooks/${nb.id}/entries/(?!${wagon.id})`));
    expect((await post(`/notebooks/${nb.id}/entries/${wagon.id}/reinstate`)).headers.location).toMatch(new RegExp(`^/notebooks/${nb.id}\\?flash=.*#entry-${wagon.id}$`));

    // A note has no page: it goes to its place in the notebook. Nothing there is a 404.
    expect((await get(`/notebooks/${nb.id}/entries/${note.id}`)).headers.location).toBe(`/notebooks/${nb.id}#entry-${note.id}`);
    expect((await get(`/notebooks/${nb.id}/entries/nope`)).status).toBe(404);
    expect((await get(`/notebooks/nope/entries/${wagon.id}`)).status).toBe(404);
  });
});

describe('a correction in the conversation', () => {
  it("changes the option itself (not a note beside it), and its page shows what it replaced", async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { parseNotebookAdd, applyNotebookAdd } = await import('../lib/notebook-chat.js');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Cabinet' });
    store.setFields(nb.id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'width', label: 'Width', type: 'number', unit: 'in', role: 'measure' }]);
    const c = store.upsertOption(nb.id, { title: 'Example cabinet, 24" wide', by: 'agent:x', runId: 'r1', data: { price: 4023, width: 24 } }).entry;
    const before = store.entries(nb.id).length;

    const { add, error } = parseNotebookAdd(JSON.stringify({ update: [{ option: 'Example cabinet', data: { price: 136.64 } }, { option: 'Nope', data: { price: 1 } }, { option: 'x', data: {} }] }));
    expect(error).toBeUndefined();
    expect(add!.update).toHaveLength(2); // the empty one is dropped
    const out = applyNotebookAdd(store, nb.id, add!);
    expect(out.added).toEqual(['corrected: Example cabinet, 24" wide (Price $4,023 → $136.64)', 'couldn\'t find an option matching "Nope"']);
    expect(store.findOption(nb.id, 'Example')!.data).toEqual({ price: 136.64, width: 24 });
    expect(store.entries(nb.id)).toHaveLength(before); // no evidence entry beside it

    const page = await request(app).get(`/notebooks/${nb.id}/entries/${c.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(page.text).toContain('$136.64');
    expect(page.text).toMatch(/"who":"sua","title":"Corrected","body":"Price \$4,023 → \$136.64"/);
  });
});

describe('archiving and deleting a notebook from its page', () => {
  it('archive hides it from the list (Archived shows it, the page offers Restore); delete removes it and its pages', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const post = (path: string, body: Record<string, string> = {}) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.setFields(store.create({ title: 'Old cabinet search' }).id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }]);
    const o = store.upsertOption(nb.id, { title: 'Example cabinet', by: 'you', data: { price: 90 } }).entry;
    store.create({ title: 'Another notebook' });

    const page = await get(`/notebooks/${nb.id}/edit`);
    expect(page.text).toContain(`action="/notebooks/${nb.id}/archive"`);
    expect(page.text).toContain('Delete…');

    const archived = await post(`/notebooks/${nb.id}/archive`, { archived: '1' });
    expect(decodeURIComponent(archived.headers.location)).toContain('Archived “Old cabinet search”');
    const list = await get('/notebooks?status=all');
    expect(list.text).not.toContain('Old cabinet search');
    expect(list.text).toContain('Archived <span class="nb-tabs__n">1</span>');
    expect((await get('/notebooks?status=archived')).text).toContain('Old cabinet search');
    const archivedPage = await get(`/notebooks/${nb.id}`);
    expect(archivedPage.text).toContain('class="nb-archived"');
    expect(archivedPage.text).toContain('Restore');

    await post(`/notebooks/${nb.id}/archive`, { archived: '0' });
    expect((await get('/notebooks?status=all')).text).toContain('Old cabinet search');

    // Delete needs the confirm field naming it.
    expect(decodeURIComponent((await post(`/notebooks/${nb.id}/delete`)).headers.location)).toContain('Confirm the delete');
    expect(store.get(nb.id)).toBeDefined();
    const deleted = await post(`/notebooks/${nb.id}/delete`, { confirm: nb.id });
    expect(decodeURIComponent(deleted.headers.location)).toBe('/notebooks?flash=Deleted “Old cabinet search”.');
    expect(store.get(nb.id)).toBeUndefined();
    expect((await get(`/notebooks/${nb.id}/entries/${o.id}`)).status).toBe(404);
    expect(decodeURIComponent((await get(`/notebooks/${nb.id}`)).headers.location)).toContain('No such notebook');
    expect((await get('/notebooks?status=all')).text).toContain('Another notebook');
  });
});

describe("the keeper's numbers are checked against what the run said", () => {
  it('leaves out a number the output never states (the run note says so); trusted blocks and setup text are respected', async () => {
    await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { applyKeeperResult, passNote } = await import('../lib/notebook-pipeline.js');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.setFields(store.create({ title: 'Cabinet' }).id, [
      { key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'width', label: 'Width', type: 'number', unit: 'in', role: 'measure' },
      { key: 'link', label: 'Product', type: 'url', role: 'link' },
    ]);
    const block = (o: unknown) => `<notebook>${JSON.stringify(o)}</notebook>`;
    const output = 'Found: Example wall cabinet, 24" wide, one side hook. https://shop.example/c-1 (no price listed)';
    const cab = { kind: 'option', title: 'Example wall cabinet', body: 'Wall-mounted.', data: { price: 4023, width: 24, link: 'https://shop.example/c-1' } };

    const out = applyKeeperResult(store, nb, 'starter-research', 'run-1', block({ entries: [cab] }), { source: output });
    expect(out).toMatchObject({ added: 1, factsDropped: 1 });
    expect(store.findOption(nb.id, 'Example')!.data).toEqual({ width: 24, link: 'https://shop.example/c-1' });
    expect(passNote('starter-research', out)).toBe('starter-research: 1 new, 1 number not in its output left out');

    // A later run that states the price fills it in.
    const again = applyKeeperResult(store, store.get(nb.id)!, 'starter-research', 'run-2', block({ entries: [{ ...cab, data: { price: 136.64, link: 'https://shop.example/c-1' } }] }), { source: `${output} Now $136.64.` });
    expect(again.factsDropped).toBeUndefined();
    expect(store.findOption(nb.id, 'Example')!.data!.price).toBe(136.64);

    // An agent's own block (code, not a model) isn't second-guessed.
    const direct = applyKeeperResult(store, store.get(nb.id)!, 'account-research', 'run-3', block({ entries: [{ kind: 'option', title: 'Other cabinet', data: { price: 99, link: 'https://shop.example/c-2' } }] }), { trusted: true, source: 'x' });
    expect(direct.factsDropped).toBeUndefined();
    expect(store.findOption(nb.id, 'Other')!.data!.price).toBe(99);
  });
});

describe('short filter labels for long facts', () => {
  const get = (app: Awaited<ReturnType<typeof makeApp>>, path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
  const settle = () => new Promise((r) => setTimeout(r, 50));

  it("groups a fact's sentences into short labels the shortlist's chips use; new values ask again with the labels in use", async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.create({ title: 'Comp set' });
    s.setFields(nb.id, [
      { key: 'fit', label: 'Fit', type: 'number', role: 'score' },
      { key: 'company', label: 'Company', type: 'text' },
      { key: 'value', label: 'Value to customers', type: 'text' },
    ]);
    const cfo = 'Office-of-CFO suite: close, consolidation, compliance, disclosure';
    const fpa = 'Finance-led FP&A that keeps Excel-centered workflows';
    s.upsertOption(nb.id, { title: 'Acme', by: 'you', data: { fit: 90, company: 'Acme', value: cfo } });
    s.upsertOption(nb.id, { title: 'Beta', by: 'you', data: { fit: 80, company: 'Beta', value: fpa } });
    s.upsertOption(nb.id, { title: 'Gamma', by: 'you', data: { fit: 70, company: 'Gamma', value: `${cfo} ` } });
    S.facetsAsked.length = 0;
    S.facetsReply = (inputs) => {
      const f = (JSON.parse(inputs.FIELDS) as Array<{ key: string; values: string[] }>)[0];
      return `<facets>${JSON.stringify({ fields: { [f.key]: f.values.map((v, i) => ({ label: v.startsWith('Office') ? 'Office of the CFO' : 'Finance-led FP&A', values: [i] })) } })}</facets>`;
    };
    await get(app, `/notebooks/${nb.id}`);
    await settle();
    // Only the long fact is asked about (company names are short), each value once.
    expect(S.facetsAsked).toHaveLength(1);
    expect(JSON.parse(S.facetsAsked[0].FIELDS)).toEqual([{ key: 'value', label: 'Value to customers', existing: [], values: [cfo, fpa] }]);
    const { notebookWidgetData } = await import('../lib/notebook-widgets.js');
    const options = () => notebookWidgetData(s.get(nb.id)!, s.entries(nb.id)).notebook.options;
    expect(options().map((o) => o.facets?.value)).toEqual(['Office of the CFO', 'Finance-led FP&A', 'Office of the CFO']);
    // The page's grid gets them.
    expect((await get(app, `/notebooks/${nb.id}`)).text).toContain('"facets":{"value":"Office of the CFO"}');

    // Opening it again asks nothing: every value has a label.
    await get(app, `/notebooks/${nb.id}`);
    await settle();
    expect(S.facetsAsked).toHaveLength(1);

    // A new value: asked alone, with the labels already in use; until then it has no chip.
    s.upsertOption(nb.id, { title: 'Delta', by: 'you', data: { fit: 60, company: 'Delta', value: 'Real-time planning across departments with governed models' } });
    S.facetsReply = () => undefined; // this time sua fails
    await get(app, `/notebooks/${nb.id}`);
    await settle();
    expect(JSON.parse(S.facetsAsked[1].FIELDS)[0]).toMatchObject({ existing: ['Office of the CFO', 'Finance-led FP&A'], values: ['Real-time planning across departments with governed models'] });
    expect(options().find((o) => o.name === 'Delta')!.facets).toEqual({ value: '' });
    // A failed try waits a day.
    await get(app, `/notebooks/${nb.id}`);
    await settle();
    expect(S.facetsAsked).toHaveLength(2);
    S.facetsReply = undefined;
  });
});

describe('editing a notebook on its own page', () => {
  it('shows the whole setup filled in, saves it from chips and rows, and keeps how far steps and done-whens got', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const post = (path: string, body: Record<string, string | string[]>) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.create({ title: 'Buy used speakers', statement: 'A set that works.', params: ['within 30 miles', 'shipped is fine'], criteria: ['Three listings', 'A decision'] });
    s.setFields(nb.id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'seller', label: 'Seller', type: 'text' }]);
    s.setChecks(nb.id, ['Works and resets', 'Fair price']);
    s.setStages(nb.id, ['Found', 'Shortlist', 'Bought']);
    s.update(nb.id, { pipeline: ['sched-agent', 'gone-agent'] });
    s.setSteps(nb.id, [{ id: 's1', title: 'Find 3 sets', kind: 'find', target: 3 }, { id: 's2', title: 'Check them', kind: 'check' }, { id: 's3', title: 'Pick one', kind: 'decide' }]);
    s.updateStep(nb.id, 's1', { status: 'done' });
    s.markCriterion(nb.id, 0, true);

    // The header's Edit is a link to the page.
    expect((await get(`/notebooks/${nb.id}`)).text).toContain(`<a class="btn btn--sm btn--ghost nb-edit" href="/notebooks/${nb.id}/edit">Edit</a>`);
    const page = (await get(`/notebooks/${nb.id}/edit?tab=prompt`)).text;
    expect(page).toContain('Edit this answer');
    expect(page).toContain('data-nbd-editor');
    expect(page).toContain('<input name="params" value="within 30 miles"');
    expect(page).toMatch(/is-met" aria-hidden="true">☑<\/span><textarea name="criteria"[^>]*>Three listings/);
    expect(page).toContain('<input type="hidden" name="step_id" value="s1">');
    expect(page).toContain('<span class="nbd-step__state">done</span>');
    expect(page).toMatch(/name="pipeline" value="sched-agent" checked/);
    expect(page).toContain('gone-agent</span> <span class="nbd-agent__note">not installed</span>');
    expect(page).toContain('<option value="" selected>when I ask</option>');
    expect(page).toContain('>Seller<button');
    // Tags and Manage sit in a rail beside the editing, not under every tab.
    expect(page).toMatch(/<aside class="nbe-rail" aria-label="This answer">[\s\S]*id="nbe-tags"[\s\S]*<h2 class="nbe-card__h" id="nbe-manage-h">Manage<\/h2>/);
    expect(page.indexOf('<aside class="nbe-rail"')).toBeGreaterThan(page.indexOf('class="nbe-work"'));
    // Each starter carries what can finish it for this notebook, shown when it's picked.
    const talkTab = (await get(`/notebooks/${nb.id}/edit`)).text;
    expect(talkTab).toContain('data-nbe-start="Make the page lead with " aria-controls="nbe-opts-1" aria-expanded="false">Make the page lead with…</button>');
    expect(talkTab).toMatch(/<div class="nbe-talk__options" id="nbe-opts-0" data-nbe-options hidden>\s*<span class="nbe-talk__ask">A step to:<\/span>\s*<button type="button" class="nbd-chip" data-nbe-fill="Add a step to find more options"/);
    expect(page).toMatch(/<button type="submit" class="btn btn--sm">Stop<\/button><\/form><span class="nbe-manage__what">Pause it/);

    // Change a limit, drop a check and a field, retitle a step, drop the gone search, run every morning.
    const saved = await post(`/notebooks/${nb.id}/edit`, {
      setup: '1', title: 'Buy used speakers', statement: 'A set that works.',
      params: ['within 50 miles', 'shipped is fine'], criteria: ['Three listings', 'A decision'],
      field: [JSON.stringify({ key: 'price', label: 'Price' })], checks: ['Works and resets'], stages: ['Found', 'Shortlist', 'Bought'],
      pipeline: ['sched-agent'], cadence: '0 7 * * *',
      step_id: ['s1', 's2', 's3'], step_title: ['Find 3 sets', 'Check each', 'Pick one'], step_kind: ['find', 'check', 'decide'], step_agent: ['', '', ''], step_target: ['3', '', ''],
    });
    expect(decodeURIComponent(saved.headers.location)).toContain('Saved.');
    const after = s.get(nb.id)!;
    expect(after).toMatchObject({ params: ['within 50 miles', 'shipped is fine'], checks: ['Works and resets'], pipeline: ['sched-agent'], cadence: '0 7 * * *' });
    expect(after.fields.map((f) => f.key)).toEqual(['price']);
    expect(after.fields[0]).toMatchObject({ type: 'money', role: 'price' });
    expect(after.criteria).toEqual([{ text: 'Three listings', met: true, held: true }, { text: 'A decision', met: false }]);
    expect(after.steps?.map((x) => [x.id, x.title, x.status])).toEqual([['s1', 'Find 3 sets', 'done'], ['s2', 'Check each', 'todo'], ['s3', 'Pick one', 'todo']]);
    expect(after.steps?.[0]?.target).toBe(3);

    // The step that's running can't be removed.
    s.updateStep(nb.id, 's2', { status: 'running' });
    const refused = await post(`/notebooks/${nb.id}/edit`, {
      setup: '1', title: 'Buy used speakers', step_id: ['s1'], step_title: ['Find 3 sets'], step_kind: ['find'], step_agent: [''], step_target: ['3'],
    });
    expect(refused.headers.location).toMatch(new RegExp(`^/notebooks/${nb.id}/edit\\?tab=prompt&error=`));
    expect(decodeURIComponent(refused.headers.location)).toContain('“Check each” is running'.replace(/[“”]/g, '"'));
    expect(s.get(nb.id)!.steps).toHaveLength(3);
  });
});
