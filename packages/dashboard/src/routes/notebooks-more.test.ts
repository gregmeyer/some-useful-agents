import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { join } from 'node:path';
import { S, makeApp, COOKIE, PORT } from './notebooks.test-kit.js';

describe('a notebook that depends on something you have to give it', () => {
  const post = (app: Awaited<ReturnType<typeof makeApp>>, path: string, body: Record<string, string>) => request(app).post(path).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
  const get = (app: Awaited<ReturnType<typeof makeApp>>, path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
  const PROFILE = 'Staff accountant, 6 years in nonprofit audit. Based in Conway, Arkansas. CPA licensed 2021. Looking for controller roles.';
  const draft = {
    title: 'Find jobs matched to my profile', statement: 'A job search matched to my LinkedIn profile.', params: [], criteria: ['Five openings found'],
    fields: [{ key: 'url', label: 'Posting', type: 'url', role: 'link' }], checks: ['Required qualifications match the profile'], stages: ['Found'], pipeline: [], cadence: '',
    steps: [{ id: 's1', title: 'Find 5 matching jobs', kind: 'find', status: 'todo', tries: 0, target: 5 }, { id: 's2', title: 'Pick', kind: 'decide', status: 'todo', tries: 0, target: 3 }],
    needs: [{ key: 'linkedin-profile', label: 'your LinkedIn profile', link: 'https://www.linkedin.com/in/someone/', why: 'The jobs are matched to it.' }],
  };
  async function started(app: Awaited<ReturnType<typeof makeApp>>, extra: Record<string, string> = {}) {
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const id = `d-${String(Math.random()).slice(2, 8)}`;
    store.saveDraft(id, { status: 'ready', text: 'Give me a job search matched to my LinkedIn profile https://www.linkedin.com/in/someone/', draft });
    const res = await post(app, '/notebooks', { draft: id, title: draft.title, statement: draft.statement, criteria: 'Five openings found', field: JSON.stringify(draft.fields[0]), stages: 'Found', checks: draft.checks[0], step_title: ['Find 5 matching jobs', 'Pick'], step_kind: ['find', 'decide'], step_agent: ['', ''], step_target: ['5', '3'], ...extra } as never);
    const nbId = decodeURIComponent(res.headers.location).split('/notebooks/')[1].split('?')[0];
    return { store, nbId, flash: decodeURIComponent(res.headers.location) };
  }

  it('"Teach me how to…" has the Runbook page at once, kept as its kind; a question gets its page decided', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const make = async (title: string) => {
      const res = await post(app, '/notebooks', { title, statement: title, step_title: ['Find 4 guides', 'Write the answer'], step_kind: ['find', 'write'], step_agent: ['', ''], step_target: ['4', ''], step_shape: ['', 'answer'] } as unknown as Record<string, string>);
      return store.get(decodeURIComponent(res.headers.location).split('/notebooks/')[1].split('?')[0])!;
    };
    const teach = await make('Teach me how to make a peanut butter and jelly sandwich');
    expect(teach.layout?.preset).toBe('runbook');
    expect(teach.layoutBy).toBe('picked');
    const question = await make('How do I choose a CRM for a small team?');
    expect(question.layout?.preset).not.toBe('runbook');
  });

  it('"Tell me about X" is a briefing on that subject: the draft says who or what, the notebook keeps it with its site, searches stay on it, and it has its page', async () => {
    const app = await makeApp();
    const { parseNotebookDraft } = await import('../lib/notebook-draft.js');
    const { notebookBrief, subjectBrief } = await import('../lib/notebook-pipeline.js');
    const { rerunSetup } = await import('../lib/notebook-create.js');
    const { NotebookStore, cleanSubject, subjectHost } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const steps = [{ title: 'Learn about Acme Trails', kind: 'profile', subject: 'Acme Trails' }, { title: 'Find 8 sources on Acme Trails', kind: 'find', target: 8 }, { title: 'Check the sources', kind: 'check' }, { title: 'Write the briefing on Acme Trails', kind: 'write', shape: 'answer' }];
    const raw = (extra: Record<string, unknown>) => `<draft>${JSON.stringify({ title: 'Learn about Acme Trails', statement: 'A briefing on Acme Trails.', steps, ...extra })}</draft>`;
    // The drafter names the subject; a profile step makes it an organization whatever it was called.
    const d = parseNotebookDraft(raw({ about: { name: ' Acme  Trails ', kind: 'product' } }), new Set());
    expect('error' in d ? d.error : d.about).toEqual({ name: 'Acme Trails', kind: 'organization' });
    // No subject named, or nothing written at the end: it isn't one.
    expect((parseNotebookDraft(raw({}), new Set()) as { about?: unknown }).about).toBeUndefined();
    expect((parseNotebookDraft(`<draft>${JSON.stringify({ title: 'Pick a trail app', steps: [{ title: 'Find 5', kind: 'find' }, { title: 'Pick', kind: 'decide' }], about: { name: 'Trail apps', kind: 'topic' } })}</draft>`, new Set()) as { about?: unknown }).about).toBeUndefined();
    expect(cleanSubject({ name: 'Roadschooling', kind: 'nonsense', site: 'not a link' })).toEqual({ name: 'Roadschooling', kind: 'topic' });
    // Started from that draft: the notebook keeps who it's on, and the link in what you typed as its site.
    const id = 'd-subject';
    store.saveDraft(id, { status: 'ready', text: 'Tell me about acme trails https://www.acmetrails.example/', draft: d });
    const res = await post(app, '/notebooks', { draft: id, title: 'Learn about Acme Trails', statement: 'A briefing on Acme Trails.', step_title: steps.map((x) => x.title), step_kind: steps.map((x) => x.kind), step_agent: steps.map(() => ''), step_target: ['', '8', '', ''], step_shape: ['', '', '', 'answer'], step_subject: ['Acme Trails', '', '', ''] } as unknown as Record<string, string>);
    const nb = store.get(decodeURIComponent(res.headers.location).split('/notebooks/')[1].split('?')[0])!;
    expect(nb.briefOn).toEqual({ name: 'Acme Trails', kind: 'organization', site: 'https://www.acmetrails.example/' });
    expect(subjectHost(nb.briefOn)).toBe('acmetrails.example');
    // It has its page at once, kept as its kind.
    expect(nb.layout?.preset).toBe('subject');
    expect(nb.layoutBy).toBe('picked');
    // Its agents are told to stay on it and to look beyond its own site, and are not sent for general guidance.
    const brief = notebookBrief(nb);
    expect(brief).toContain('This is a briefing on ONE subject: Acme Trails (an organization). Its own site is https://www.acmetrails.example/.');
    expect(brief).toContain('at least 3 sources that are NOT its own site');
    expect(brief).toContain('A page that doesn\'t name Acme Trails is not a result.');
    expect(brief).not.toContain('sources that explain how it works and what to weigh');
    // A topic has no site of its own to cover; any other notebook is told none of this.
    expect(subjectBrief({ briefOn: { name: 'Roadschooling', kind: 'topic' } }).join('\n')).toContain('no more than two from one site');
    expect(subjectBrief({})).toEqual([]);
    const plain = store.create({ title: 'What do teams pay for X' });
    store.setSteps(plain.id, [{ title: 'Find', kind: 'find' }, { title: 'Write the answer', kind: 'write', shape: 'answer' }]);
    expect(notebookBrief(store.get(plain.id)!)).toContain('sources that explain how it works and what to weigh');
    // Run again keeps who it's on.
    expect(rerunSetup(nb).briefOn).toEqual(nb.briefOn);
    // Its writer is given the parts and told whose page each source is; "what others say" may rest only on someone else's.
    const { writerInputs, briefingRules } = await import('../lib/notebook-write.js');
    store.setFields(nb.id, [{ key: 'source_url', label: 'Source', type: 'url', role: 'link' }]);
    const own = store.upsertOption(nb.id, { title: 'About Acme Trails', data: { source_url: 'https://acmetrails.example/about' }, by: 'agent:notebook-finder' }).entry;
    const out = store.upsertOption(nb.id, { title: 'Acme Trails on a podcast directory', data: { source_url: 'https://casts.example/acme-trails' }, by: 'agent:notebook-finder' }).entry;
    const now = store.get(nb.id)!;
    const inputs = writerInputs(now, store.entries(nb.id, 100), now.steps!.find((x) => x.kind === 'write')!);
    const told = JSON.parse(inputs.NOTEBOOK) as { briefingOn: { name: string; ownSite: string; parts: Array<{ part: string; title: string }> } };
    expect(told.briefingOn).toMatchObject({ name: 'Acme Trails', ownSite: 'acmetrails.example' });
    expect(told.briefingOn.parts.map((x) => x.part)).toEqual(['is', 'offers', 'works', 'others']);
    const themes = JSON.parse(inputs.THEMES) as Array<{ id: string; whose?: string }>;
    expect(themes.find((t) => t.id === own.id)!.whose).toBe('its own site');
    expect(themes.find((t) => t.id === out.id)!.whose).toBe('not its own');
    expect([...briefingRules(now, store.entries(nb.id, 100)).outside!]).toEqual([out.id]);
  });

  it('reads what a draft needs, never any text for it', async () => {
    await makeApp();
    const { parseNotebookDraft } = await import('../lib/notebook-draft.js');
    const d = parseNotebookDraft(`<draft>${JSON.stringify({ title: 'Jobs for me', statement: 'x', needs: [{ label: 'Your LinkedIn profile.', link: 'https://www.linkedin.com/in/someone/', why: 'The jobs are matched to it.', text: 'made up', state: 'given' }, { label: '' }, 'junk'] })}</draft>`, new Set());
    expect('needs' in d && d.needs).toEqual([{ key: 'linkedin-profile', label: 'Your LinkedIn profile', link: 'https://www.linkedin.com/in/someone/', why: 'The jobs are matched to it.' }]);
    expect('needs' in parseNotebookDraft('<draft>{"title":"Buy a car","needs":[]}</draft>', new Set())).toBe(false);
  });

  it('keeps what you asked (its link with it), asks for what it needs, and starts nothing until you answer', async () => {
    const app = await makeApp();
    const { getContext } = await import('../context.js');
    const { startNotebookStep } = await import('../lib/notebook-steps.js');
    const { notebookGivenLinks } = await import('@some-useful-agents/core');
    const ctx = getContext(app.locals);
    const { store, nbId } = await started(app);
    const nb = store.get(nbId)!;
    expect(nb.asked).toBe('Give me a job search matched to my LinkedIn profile https://www.linkedin.com/in/someone/');
    expect(notebookGivenLinks(nb)).toEqual(['https://www.linkedin.com/in/someone/']);
    expect(nb.given).toMatchObject([{ key: 'linkedin-profile', label: 'your LinkedIn profile', state: 'missing' }]);
    // Nothing starts: not its step, not a search again.
    let asked = 0;
    S.finderReply = () => { asked++; return 'Found none.'; };
    expect(startNotebookStep(ctx, nbId)).toMatchObject({ started: false, reason: "It's waiting on your LinkedIn profile. Paste it at the top of the notebook's page, or choose Go on without it." });
    expect(asked).toBe(0);
    // Its page asks, with a box and a way on; the header says it's waiting on you.
    const page = (await get(app, `/notebooks/${nbId}`)).text;
    expect(page).toContain('<strong>sua needs your LinkedIn profile.</strong>');
    expect(page).toContain('linkedin.com</a>');
    expect(page).toContain(`action="/notebooks/${nbId}/given/linkedin-profile"`);
    expect(page).toContain('Go on without it');
    expect(page).toContain('Waiting on you: paste your LinkedIn profile above, or go on without it.');
    // Its conversation says so too, and offers no Start.
    const thread = ctx.inboxStore!.listResponses(store.get(nbId)!.conversationId!).map((r) => r.body).join('\n');
    expect(thread).toContain('Before I start, I need **your LinkedIn profile**');
    expect(thread).not.toContain('Press **Start**');
    // Too little isn't it.
    expect(decodeURIComponent((await post(app, `/notebooks/${nbId}/given/linkedin-profile`, { text: 'see link' })).headers.location)).toContain('Paste the text itself');
    S.finderReply = undefined;
  });

  it('pasting it starts the step, and every search reads it', async () => {
    const app = await makeApp();
    const { getContext } = await import('../context.js');
    const ctx = getContext(app.locals);
    const { store, nbId } = await started(app);
    let brief = '';
    S.finderReply = (inputs) => { brief = inputs.NOTEBOOK; return 'Found none.'; };
    const res = await post(app, `/notebooks/${nbId}/given/linkedin-profile`, { text: PROFILE });
    expect(decodeURIComponent(res.headers.location)).toContain('Got your LinkedIn profile. Find 5 matching jobs is running.');
    for (let i = 0; i < 200 && ctx.notebookPipelines?.has(nbId); i++) await new Promise((r) => setTimeout(r, 10));
    expect(store.get(nbId)!.given).toMatchObject([{ state: 'given', text: PROFILE }]);
    expect(brief).toContain('What they gave you, your LinkedIn profile (this is all you know of it; use nothing else for it):');
    expect(brief).toContain(PROFILE);
    // The page no longer asks (with no reader here, it says the text is used as pasted); Edit shows it, to replace or remove.
    const page = (await get(app, `/notebooks/${nbId}`)).text;
    expect(page).not.toContain('<strong>sua needs');
    expect(page).toContain('sua hasn\'t read your LinkedIn profile yet.');
    const edit = (await get(app, `/notebooks/${nbId}/edit`)).text;
    expect(edit).toContain('What you gave it');
    expect(edit).toContain('characters, given to every step as pasted');
    // Run again keeps it: it's the notebook's setup, not what it found.
    const { rerunSetup } = await import('../lib/notebook-create.js');
    expect(rerunSetup(store.get(nbId)!)).toMatchObject({ asked: expect.stringContaining('linkedin.com/in/someone'), given: [{ state: 'given', text: PROFILE }] });
    S.finderReply = undefined;
  });

  it('pasted on the draft page, it never has to ask', async () => {
    const app = await makeApp();
    const { store, nbId } = await started(app, { 'need_linkedin-profile': PROFILE });
    expect(store.get(nbId)!.given).toMatchObject([{ state: 'given', text: PROFILE }]);
    expect((await get(app, `/notebooks/${nbId}`)).text).not.toContain('<strong>sua needs');
  });

  it('pasted on the draft page with a reader, the notebook says it is reading it first', async () => {
    const app = await makeApp();
    const { getContext } = await import('../context.js');
    const ctx = getContext(app.locals);
    let letGo: (v: string) => void = () => {};
    ctx.notebookGivenReaderRun = () => new Promise((r) => { letGo = r; });
    const { nbId, flash } = await started(app, { 'need_linkedin-profile': PROFILE });
    expect(flash).toContain('Notebook started. sua is reading your LinkedIn profile first, about a minute.');
    const page = (await get(app, `/notebooks/${nbId}`)).text;
    expect(page).toContain('Reading your LinkedIn profile');
    expect(page).not.toContain('class="nb-run"');
    letGo('nothing');
    letGo('nothing');
    for (let i = 0; i < 200 && [...(ctx.notebookGivenReads?.values() ?? [])].some((x) => x.status === 'working'); i++) { letGo('nothing'); await new Promise((r) => setTimeout(r, 10)); }
  });

  it('a paste is read into a short profile first: the step waits for it, then works from the reading, and you can fix it', async () => {
    const app = await makeApp();
    const { getContext } = await import('../context.js');
    const { startNotebookStep } = await import('../lib/notebook-steps.js');
    const ctx = getContext(app.locals);
    const { store, nbId } = await started(app);
    const paste = `Home My Network Jobs Messaging\n${PROFILE}\nPeople also viewed\nSomeone Else, Plumber in Reno\n`;
    let brief = '';
    S.finderReply = (inputs) => { brief = inputs.NOTEBOOK; return 'Found none.'; };
    // The reader answers when let go; one fact's quote isn't in the paste.
    let letGo: (v: string) => void = () => {};
    let readerInputs: Record<string, string> = {};
    ctx.notebookGivenReaderRun = (inputs) => { readerInputs = inputs; return new Promise((r) => { letGo = r; }); };
    const res = await post(app, `/notebooks/${nbId}/given/linkedin-profile`, { text: paste });
    expect(decodeURIComponent(res.headers.location)).toContain('Got your LinkedIn profile. sua is reading it; its next step starts when that’s done.');
    expect(readerInputs).toMatchObject({ LABEL: 'your LinkedIn profile', TEXT: paste.trim() });
    // Nothing starts on a paste that's half read; the page says it's reading.
    expect(startNotebookStep(ctx, nbId)).toMatchObject({ started: false, reason: expect.stringContaining('sua is reading your LinkedIn profile') });
    const whileReading = (await get(app, `/notebooks/${nbId}`)).text;
    expect(whileReading).toContain('sua is reading your LinkedIn profile into a short form.</span> Nothing searches until that\'s done');
    // The header shows it as work, and offers no Start while it is.
    expect(whileReading).toContain('Reading your LinkedIn profile');
    expect(whileReading).not.toContain('class="nb-run"');
    const words = PROFILE.split(/\s+/).slice(0, 6).join(' ');
    letGo(`<read>${JSON.stringify({ summary: 'An accountant.', facts: [{ label: 'Current role', value: 'Accountant', quote: words }, { label: 'Hobby', value: 'Plumbing in Reno', quote: 'loves plumbing and lives in Reno' }] })}</read>`);
    for (let i = 0; i < 200 && (ctx.notebookGivenReads?.size || ctx.notebookPipelines?.has(nbId) || !brief); i++) await new Promise((r) => setTimeout(r, 10));
    // Only the fact the paste says is kept; the step started and read the reading, not the paste.
    expect(store.get(nbId)!.given![0].read).toMatchObject({ summary: 'An accountant.', facts: [{ label: 'Current role', value: 'Accountant' }] });
    expect(store.get(nbId)!.given![0].read!.facts).toHaveLength(1);
    // Its history says so.
    expect(store.entries(nbId, 50).find((e) => e.title === 'Read your LinkedIn profile: 1 fact')).toMatchObject({ kind: 'note', by: 'sua', body: expect.stringContaining('An accountant.') });
    expect(brief).toContain('your LinkedIn profile, as read from what they pasted');
    expect(brief).toContain('Current role: Accountant');
    expect(brief).not.toContain('People also viewed');
    // The page shows what was read; Edit lets you fix it, and a line you change is yours.
    const page = (await get(app, `/notebooks/${nbId}`)).text;
    expect(page).toContain('Your LinkedIn profile, as sua read it:</span> An accountant.');
    expect(page).toContain('<dt>Current role</dt><dd>Accountant</dd>');
    expect((await get(app, `/notebooks/${nbId}/edit`)).text).toContain('Current role: Accountant</textarea>');
    const saved = await post(app, `/notebooks/${nbId}/given/linkedin-profile`, { facts: 'Current role: Accountant\nWants: A controller role\nnot a line' });
    expect(decodeURIComponent(saved.headers.location)).toContain('Saved what your LinkedIn profile says.');
    expect(store.get(nbId)!.given![0].read!.facts).toEqual([{ label: 'Current role', value: 'Accountant', quote: words }, { label: 'Wants', value: 'A controller role', byYou: true }]);
    expect((await get(app, `/notebooks/${nbId}`)).text).toContain('A controller role <span class="nb-given__yours">yours</span>');
    // Read it again asks the reader once more.
    ctx.notebookGivenReaderRun = async () => `<read>${JSON.stringify({ summary: 'Read again.', facts: [{ label: 'Current role', value: 'Accountant', quote: words }] })}</read>`;
    expect(decodeURIComponent((await post(app, `/notebooks/${nbId}/given/linkedin-profile`, { reread: '1' })).headers.location)).toContain('sua is reading your LinkedIn profile.');
    for (let i = 0; i < 200 && ctx.notebookGivenReads?.size; i++) await new Promise((r) => setTimeout(r, 10));
    expect(store.get(nbId)!.given![0].read!.summary).toBe('Read again.');
    S.finderReply = undefined;
  });

  it('a PDF chosen in place of a paste comes back as its text, for the box; each box offers the choice', async () => {
    const app = await makeApp();
    const { makePdf } = await import('../lib/pdf-text.fixture.js');
    const send = (body: Buffer, type = 'application/pdf') => request(app).post('/notebooks/given-file').set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).set('Content-Type', type).send(body);
    const ok = await send(Buffer.from(makePdf([['Dana Rivers', 'Director of Partnerships at Riverbend Trust'], ['Education', 'State University']])));
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ pages: 2, said: expect.stringMatching(/^2 pages, \d+ characters\.$/) });
    expect(ok.body.text).toContain('Director of Partnerships at Riverbend Trust');
    expect((await send(Buffer.from('not a pdf at all'))).body).toEqual({ error: "That isn't a PDF file." });
    expect((await send(Buffer.from('text'), 'application/octet-stream')).status).toBe(415);
    // Nothing is stored by it: the notebook still waits until the box's form is sent.
    const { store, nbId } = await started(app);
    expect(store.get(nbId)!.given).toMatchObject([{ state: 'missing' }]);
    const page = (await get(app, `/notebooks/${nbId}`)).text;
    expect(page).toContain('data-given-file="nb-given-linkedin-profile"');
    expect(page).toContain('Choose a file');
    expect(page).toContain('data-file-types="pdf,txt,md,docx"');
    expect((await request(app).get('/assets/dashboard.js').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text).toContain("fetch('/notebooks/given-file'");
  });

  it('a paste that can\'t be read never blocks: the step starts on the text as pasted', async () => {
    const app = await makeApp();
    const { getContext } = await import('../context.js');
    const ctx = getContext(app.locals);
    const { store, nbId } = await started(app);
    let brief = '';
    let tries = 0;
    S.finderReply = (inputs) => { brief = inputs.NOTEBOOK; return 'Found none.'; };
    ctx.notebookGivenReaderRun = async () => { tries++; return 'no block here'; };
    await post(app, `/notebooks/${nbId}/given/linkedin-profile`, { text: PROFILE });
    for (let i = 0; i < 200 && (ctx.notebookPipelines?.has(nbId) || !brief); i++) await new Promise((r) => setTimeout(r, 10));
    expect(tries).toBe(2);
    expect(store.get(nbId)!.given![0].read).toBeUndefined();
    expect(brief).toContain(PROFILE);
    expect(store.entries(nbId, 50).some((e) => e.title === 'Couldn\'t read your LinkedIn profile into a short form')).toBe(true);
    expect((await get(app, `/notebooks/${nbId}`)).text).toContain('sua couldn\'t read your LinkedIn profile into a short form.');
    S.finderReply = undefined;
  });

  it('any notebook takes a file or a paste it never asked for: read at once, nothing reruns until you say, and the profile is then told it', async () => {
    const app = await makeApp();
    const { getContext } = await import('../context.js');
    const { NotebookStore } = await import('@some-useful-agents/core');
    const ctx = getContext(app.locals);
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Prepare for a meeting with Dana Reyes', statement: 'Help me prepare.' });
    const [profile, write] = store.setSteps(nb.id, [{ title: 'Learn about Dana Reyes', kind: 'profile', subject: 'Dana Reyes' }, { title: 'Write talking points', kind: 'write' }]).steps!;
    // It asked for nothing, and still offers the box: on its page and under Edit.
    let page = (await get(app, `/notebooks/${nb.id}`)).text;
    expect(page).toContain(`action="/notebooks/${nb.id}/given"`);
    expect(page).toContain('Add a file or paste');
    expect(page).toContain('data-given-file="nb-given-new-text" data-given-file-name="nb-given-new-label"');
    expect((await get(app, `/notebooks/${nb.id}/edit`)).text).toContain('data-given-file="nbe-given-new-text"');
    // Both steps ran before anything was added.
    for (const st of [profile, write]) { const id = store.startPass(nb.id, 'pipeline', '2026-10-26T10:00:00.000Z', { stepId: st.id }); store.finishPass(id, 'ran', '2026-10-26T10:05:00.000Z'); store.updateStep(nb.id, st.id, { status: 'done' }); }
    store.setAbout(nb.id, 'person', { name: 'Dana Reyes', facts: [{ key: 'role', value: 'VP Ops', source: 'https://old.example/dana' }, { key: 'organization', value: 'Oldco' }, { key: 'company_website', value: 'https://oldco.example' }] });
    store.setAbout(nb.id, 'company', { name: 'Oldco', facts: [{ key: 'size', value: '15000', source: 'https://oldco.example/about' }] });
    // Too little is refused; a name is needed.
    expect(decodeURIComponent((await post(app, `/notebooks/${nb.id}/given`, { label: 'Their LinkedIn profile', text: 'see link' })).headers.location)).toContain('Paste the text itself');
    expect(decodeURIComponent((await post(app, `/notebooks/${nb.id}/given`, { label: ' ', text: PROFILE })).headers.location)).toContain('Say what it is');
    expect(store.get(nb.id)!.given).toBeUndefined();
    ctx.notebookGivenReaderRun = async () => `<read>${JSON.stringify({ summary: 'An accountant in Conway.', facts: [{ label: 'Role', value: 'Staff accountant', quote: 'Staff accountant' }] })}</read>`;
    const before = S.researchAsked.length;
    const res = await post(app, `/notebooks/${nb.id}/given`, { label: 'Their LinkedIn profile', text: PROFILE });
    expect(decodeURIComponent(res.headers.location)).toContain('Added Their LinkedIn profile. sua is reading it. Steps that already ran don’t use it yet');
    for (let i = 0; i < 200 && !store.get(nb.id)!.given?.[0]?.read; i++) await new Promise((r) => setTimeout(r, 10));
    expect(store.get(nb.id)!.given).toMatchObject([{ key: 'linkedin-profile', state: 'given', text: PROFILE, read: { summary: 'An accountant in Conway.' } }]);
    // Nothing ran again because of it; the page offers to.
    expect(S.researchAsked.length).toBe(before);
    page = (await get(app, `/notebooks/${nb.id}`)).text;
    expect(page).toContain('Their LinkedIn profile was added after Learn about Dana Reyes and Write talking points last ran,');
    expect(page).toContain(`action="/notebooks/${nb.id}/given-update"`);
    expect(page).toContain('Update the profile and brief with this');
    // Pressed: the researcher is given the reading, and a fact it took from it says so (no page to link).
    S.researchReply = (inputs) => (inputs.SUBJECT === 'Dana Reyes' ? JSON.stringify({ found: { kind: { value: 'person' }, role: { value: 'Staff accountant', source: 'given', quote: 'Staff accountant' }, organization: { value: 'Northwind', source: 'given' }, location: { value: 'Conway, Arkansas', source: 'https://x.example/dana' } }, not_found: [] })
      : inputs.SUBJECT === 'Northwind' ? JSON.stringify({ found: { what_they_do: { value: 'Audits nonprofits', source: 'https://northwind.example' } }, not_found: [] }) : undefined);
    S.writerReply = () => `<briefing>${JSON.stringify({ points: [{ text: 'Ask about audit work', from: [] }] })}</briefing>`;
    const up = await post(app, `/notebooks/${nb.id}/given-update`, {});
    expect(decodeURIComponent(up.headers.location)).toContain('Running Learn about Dana Reyes, then Write talking points again with what you added.');
    for (let i = 0; i < 300 && ctx.notebookPipelines?.has(nb.id); i++) await new Promise((r) => setTimeout(r, 10));
    const asked = S.researchAsked.find((x) => x.SUBJECT === 'Dana Reyes' && x.GIVEN);
    expect(asked!.GIVEN).toContain('Their LinkedIn profile:\nAn accountant in Conway.\nRole: Staff accountant');
    const facts = store.get(nb.id)!.about!.person!.facts;
    expect(facts.find((f) => f.key === 'role')).toMatchObject({ value: 'Staff accountant', from: 'Their LinkedIn profile' });
    expect(facts.find((f) => f.key === 'role')!.source).toBeUndefined();
    expect(facts.find((f) => f.key === 'location')).toMatchObject({ source: 'https://x.example/dana' });
    // What you gave says they're at another company: the old one's site and facts don't stay under the new name.
    expect(facts.find((f) => f.key === 'company_website')).toBeUndefined();
    expect(store.get(nb.id)!.about!.company).toMatchObject({ name: 'Northwind', facts: [{ key: 'what_they_do', value: 'Audits nonprofits' }] });
    expect(store.get(nb.id)!.about!.person!.affiliations).toMatchObject([{ name: 'Oldco' }]);
    const { notebookWidgetData } = await import('../lib/notebook-widgets.js');
    expect(notebookWidgetData(store.get(nb.id)!, [], store).notebook.facts.find((f) => f.label === 'Role')).toMatchObject({ from: 'Their LinkedIn profile' });
    // Used now: the offer is gone.
    expect((await get(app, `/notebooks/${nb.id}`)).text).not.toContain('given-update');
    // An archived notebook and an experiment's copy take nothing.
    store.setExperimentRun(nb.id, { experimentId: 'e1', label: 'A · run 1' });
    expect(decodeURIComponent((await post(app, `/notebooks/${nb.id}/given`, { label: 'Notes', text: PROFILE })).headers.location)).toContain('experiment’s copy');
    // Starting a notebook with something added on the draft page: kept as given, wanted not needed, and read.
    const made = await post(app, '/notebooks', { title: 'Meet Lee Park', statement: 'Prepare me to meet Lee Park.', add_label: 'Their LinkedIn profile', add_text: PROFILE });
    const lee = store.list().find((n) => n.title === 'Meet Lee Park')!;
    expect(lee.given).toMatchObject([{ label: 'Their LinkedIn profile', state: 'given', text: PROFILE, optional: true }]);
    expect(decodeURIComponent(made.headers.location)).toContain('sua is reading Their LinkedIn profile first');
    S.researchReply = undefined; S.writerReply = undefined;
  });

  it('a file attached to a message is filed on the conversation\'s notebook in code; elsewhere it stays with the conversation until a notebook starts from it', async () => {
    const app = await makeApp();
    const { getContext } = await import('../context.js');
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { takeAttachments, contextWithAttachments, fileThreadAttachments, withoutAttachMarkers } = await import('../lib/conversation-attach.js');
    const ctx = getContext(app.locals);
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    ctx.notebookGivenReaderRun = async () => `<read>${JSON.stringify({ summary: 'An accountant.', facts: [] })}</read>`;
    const attach = (label: string, text: string) => request(app).post('/notebooks/attach').set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).send({ label, text });
    // Kept as text under an id; the page puts the marker in the message. Too little text is refused.
    expect((await attach('Dana Reyes Profile', 'short')).status).toBe(422);
    const kept = (await attach('Dana [Reyes] Profile', PROFILE)).body as { id: string; marker: string; label: string };
    expect(kept.marker).toBe(`[file: Dana Reyes Profile · ${kept.id}]`);
    expect(withoutAttachMarkers(`Use this ${kept.marker}`)).toBe('Use this');
    // The page has the control beside Send.
    const nb = store.create({ title: 'Prepare for a meeting with Dana Reyes', statement: 'Help me prepare.' });
    expect((await get(app, `/notebooks/${nb.id}`)).text).toContain('data-attach-file');
    // Sent in the notebook's conversation: filed on the notebook before sua's turn, and the message says so.
    await post(app, `/notebooks/${nb.id}/ask`, { text: `Here is their profile.\n${kept.marker}` });
    const now = store.get(nb.id)!;
    expect(now.given).toMatchObject([{ label: 'Dana Reyes Profile', state: 'given', text: PROFILE, optional: true }]);
    const said = ctx.inboxStore!.listResponses(now.conversationId!).filter((r) => r.role === 'user').pop()!.body;
    expect(said).toBe('Here is their profile.\nAttached: Dana Reyes Profile (added to this notebook under What you gave it)');
    // sua is told what was attached and where it went.
    const told = JSON.parse(contextWithAttachments(ctx, now.conversationId!, JSON.stringify({ page: { kind: 'notebook', id: nb.id } }))) as { page: unknown; attached: Array<Record<string, unknown>> };
    expect(told.page).toEqual({ kind: 'notebook', id: nb.id });
    expect(told.attached).toEqual([{ name: 'Dana Reyes Profile', characters: PROFILE.length, startsWith: PROFILE, filedOnNotebook: 'Prepare for a meeting with Dana Reyes' }]);
    // In a conversation about nothing yet: it stays with the conversation.
    const thread = ctx.inboxStore!.add({ priority: 'medium', source: 'manual', title: 'A question', body: '(empty)' });
    const other = (await attach('Resume', `${PROFILE} Second page.`)).body as { marker: string };
    expect(takeAttachments(ctx, thread.id, `What roles fit this? ${other.marker}`)).toBe('What roles fit this? Attached: Resume');
    expect(takeAttachments(ctx, thread.id, 'Nothing attached.')).toBe('Nothing attached.');
    expect(takeAttachments(ctx, thread.id, 'Gone: [file: Old · 0123456789]')).toBe('Gone: Attached: Old (it wasn\'t kept; attach it again)');
    expect(contextWithAttachments(ctx, thread.id, '')).toContain('"name":"Resume"');
    expect(contextWithAttachments(ctx, 'no-such-thread', '{"a":1}')).toBe('{"a":1}');
    // A notebook started from that conversation gets it, once.
    const job = store.create({ title: 'Find a controller role' });
    expect(fileThreadAttachments(ctx, thread.id, job.id)).toEqual(['Resume']);
    expect(store.get(job.id)!.given).toMatchObject([{ label: 'Resume', state: 'given' }]);
    expect(fileThreadAttachments(ctx, thread.id, job.id)).toEqual([]);
  });

  it('takes only the kinds of file allowed in Settings: a Word file is read, a kind turned off is refused, and the pickers follow', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { makeZip } = await import('../lib/docx-test-zip.js');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const send = (body: Buffer, type: string) => request(app).post('/notebooks/given-file').set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).set('Content-Type', type).send(body);
    const word = makeZip([{ name: 'word/document.xml', data: `<w:document><w:p><w:r><w:t>${PROFILE}</w:t></w:r></w:p></w:document>` }]);
    // Every kind sua can read is allowed to start with.
    expect(store.attachFileTypes()).toEqual(['pdf', 'txt', 'md', 'docx']);
    const read = await send(word, DOCX);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ text: PROFILE, chars: PROFILE.length });
    expect((await send(Buffer.from('not a zip, not a zip, not a zip, not a zip'), DOCX)).status).toBe(422);
    // Settings → General lists them; saving keeps the ticked ones.
    const settings = (await get(app, '/settings/general')).text;
    expect(settings).toContain('Files sua takes');
    expect(settings).toMatch(/name="types" value="docx" checked>\s*Word \(\.docx\)/);
    const saved = await request(app).post('/settings/general/file-types').set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send('types=pdf&types=txt&types=exe');
    expect(decodeURIComponent(String(saved.headers.location).replace(/\+/g, ' '))).toContain('sua takes PDF or plain text (.txt) files.');
    expect(store.attachFileTypes()).toEqual(['pdf', 'txt']);
    // A kind turned off is refused, with where to change it; the pickers offer only what's left.
    const refused = await send(word, DOCX);
    expect(refused.status).toBe(415);
    expect((refused.body as { error: string }).error).toContain('sua isn\'t set to take Word (.docx) files (it takes PDF or plain text (.txt)). Change it under Settings → General');
    const nb = store.create({ title: 'Prepare for a meeting with Dana Reyes' });
    const page = (await get(app, `/notebooks/${nb.id}`)).text;
    expect(page).toContain('data-file-types="pdf,txt" data-file-words="PDF or plain text (.txt)"');
    expect(page).toContain('accept=".pdf,application/pdf,.txt,text/plain"');
    expect((await get(app, '/settings/general')).text).not.toMatch(/value="docx" checked/);
    // None allowed: no picker at all; the paste box stays.
    await request(app).post('/settings/general/file-types').set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send('');
    const bare = (await get(app, `/notebooks/${nb.id}`)).text;
    expect(bare).not.toContain('type="file"');
    expect(bare).toContain('name="text"');
    store.setAttachFileTypes(['pdf', 'txt', 'md', 'docx']);
  });

  it('the page carries where each entry came from, so a printed or saved copy links to sources, not to the dashboard', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Prepare for a meeting with Dana Reyes' });
    store.setFields(nb.id, [{ key: 'link', label: 'Link', type: 'url', role: 'link' }]);
    const sourced = store.upsertOption(nb.id, { title: 'Her talk on scaling', data: { link: 'https://talks.example/dana?x=<1>' }, by: 'you' }).entry;
    const bare = store.addEntry(nb.id, { kind: 'option', title: 'Something said in passing', by: 'you' });
    const page = (await get(app, `/notebooks/${nb.id}`)).text;
    const m = /<script type="application\/json" data-nb-print-links>([^<]*)<\/script>/.exec(page);
    expect(m).not.toBeNull();
    const map = JSON.parse(m![1]) as Record<string, string>;
    expect(map[sourced.id]).toBe('https://talks.example/dana?x=<1>');
    expect(map[bare.id]).toBeUndefined();
    // The swap runs when the page prints (and is put back after).
    const js = (await request(app).get('/assets/dashboard.js').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;
    expect(js).toContain("window.addEventListener('beforeprint', before)");
    expect(js).toContain("window.addEventListener('afterprint', after)");
  });

  it('going on without it is recorded, told to every step, and shown on the page', async () => {
    const app = await makeApp();
    const { getContext } = await import('../context.js');
    const ctx = getContext(app.locals);
    const { store, nbId } = await started(app);
    let brief = '';
    S.finderReply = (inputs) => { brief = inputs.NOTEBOOK; return 'Found none.'; };
    const res = await post(app, `/notebooks/${nbId}/given/linkedin-profile`, { skip: '1' });
    expect(decodeURIComponent(res.headers.location)).toContain('Going on without your LinkedIn profile. Results won’t be matched to it. Find 5 matching jobs is running.');
    for (let i = 0; i < 200 && ctx.notebookPipelines?.has(nbId); i++) await new Promise((r) => setTimeout(r, 10));
    expect(store.get(nbId)!.given).toMatchObject([{ state: 'skipped' }]);
    expect(brief).toContain('NOT given: your LinkedIn profile. They chose to go on without it');
    expect(brief).toContain('never say anything matches it');
    const page = (await get(app, `/notebooks/${nbId}`)).text;
    expect(page).toContain('Not matched to your LinkedIn profile:');
    expect(page).not.toContain('<strong>sua needs');
    // A search that asks for it again doesn't put the ask back.
    expect(store.addGiven(nbId, { label: 'Your LinkedIn profile' }).given).toMatchObject([{ state: 'skipped' }]);
    S.finderReply = undefined;
  });
});

describe('run a notebook again as a new notebook', () => {
  const post = (app: Awaited<ReturnType<typeof makeApp>>, path: string, body: Record<string, string>) => request(app).post(path).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
  const get = (app: Awaited<ReturnType<typeof makeApp>>, path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
  it('copies the setup and the page, none of the content, archives the old one, links the two and starts the first step', async () => {
    const app = await makeApp();
    const { NotebookStore, layoutPreset } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const { rerunSetup } = await import('../lib/notebook-create.js');
    const { parseProposedActions } = await import('./inbox-plan.js');
    const { executeNotebookRerun } = await import('./inbox-engine.js');
    const ctx = getContext(app.locals);
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb0 = store.create({ title: 'Research CD ladders for $25,000', statement: 'Where to put $25,000 in CDs', params: ['$25,000', 'FDIC insured'], criteria: ['A simple rubric written'], pipeline: [], cadence: '' });
    store.setFields(nb0.id, [{ key: 'apy', label: 'APY', type: 'number', unit: '%', better: 'higher' }, { key: 'url', label: 'Page', type: 'url', role: 'link' }]);
    store.setStages(nb0.id, ['Found', 'Checked']);
    store.setChecks(nb0.id, ['FDIC insured']);
    store.setSteps(nb0.id, [{ title: 'Find 5 CDs', kind: 'find', target: 5 }, { title: 'Write the answer', kind: 'write', shape: 'answer' }]);
    store.setLayout(nb0.id, layoutPreset('answer')!.layout, 'picked');
    store.upsertOption(nb0.id, { title: 'Marcus 12-month', by: 'agent:x', data: { apy: 4.4 } });
    store.addEntry(nb0.id, { kind: 'note', title: 'A note', by: 'you' });
    store.setAnswer(nb0.id, { text: 'Ladder it.', confidence: 'medium', basis: 'x', findings: [], open: [], sections: [], askedAt: new Date().toISOString(), by: 'agent:notebook-writer' } as never);
    store.updateStep(nb0.id, store.get(nb0.id)!.steps![0].id, { status: 'met' });
    const nb = store.get(nb0.id)!;

    // The setup, and nothing it found.
    const setup = rerunSetup(nb);
    expect(setup).toMatchObject({ title: nb.title, statement: nb.statement, params: nb.params, criteria: ['A simple rubric written'], checks: ['FDIC insured'], stages: ['Found', 'Checked'], layoutBy: 'picked' });
    expect(setup.steps!.map((s) => [s.title, s.status, s.tries])).toEqual([['Find 5 CDs', 'todo', 0], ['Write the answer', 'todo', 0]]);
    expect(setup.fields!.map((f) => (f as { key: string }).key)).toEqual(['apy', 'url']);
    expect(Object.keys(setup)).not.toEqual(expect.arrayContaining(['answer', 'about', 'entries']));

    // The Edit page offers it; an archived one doesn't.
    const edit = (await get(app, `/notebooks/${nb.id}/edit`)).text;
    expect(edit).toContain('Clear and run again…');
    expect(edit).toContain(`action="/notebooks/${nb.id}/rerun"`);

    S.finderReply = () => `Found 1.\n<notebook>${JSON.stringify({ entries: [{ kind: 'option', title: 'Ally 24-month', data: { apy: 4.3 } }] })}</notebook>`;
    const res = await post(app, `/notebooks/${nb.id}/rerun`, {});
    const where = decodeURIComponent(res.headers.location);
    expect(where).toContain('Started again as a new notebook; its first step, Find 5 CDs, is running. The one before is archived');
    const newId = where.split('/notebooks/')[1].split('?')[0];
    expect(newId).not.toBe(nb.id);
    const made = store.get(newId)!;
    expect(made).toMatchObject({ title: nb.title, statement: nb.statement, params: nb.params, checks: ['FDIC insured'], stages: ['Found', 'Checked'], layoutBy: 'picked', layout: { preset: 'answer' } });
    expect(made.criteria.map((c) => `${c.text}:${String(c.met)}`)).toEqual(['A simple rubric written:false']);
    expect(made.fields.map((f) => f.key)).toEqual(['apy', 'url']);
    expect(made.steps!.map((s) => [s.title, s.kind])).toEqual([['Find 5 CDs', 'find'], ['Write the answer', 'write']]);
    // Its first step was started (the stubbed finder may already have finished it).
    expect(made.steps![0].status).not.toBe('todo');
    expect(made.answer).toBeUndefined();
    for (let i = 0; i < 200 && store.get(newId)!.steps![0].status === 'running'; i++) await new Promise((r) => setTimeout(r, 20));
    const after = store.entries(newId);
    // Its own note of where it came from, and then what its own search found: nothing from the old one.
    expect(after.filter((e) => e.kind === 'note').map((e) => e.title)).toContain('Started again');
    expect(after.some((e) => e.kind === 'option' && e.title === 'Marcus 12-month')).toBe(false);
    expect(after.find((e) => e.title === 'Started again')!.body).toContain(`[${nb.title}](/notebooks/${nb.id})`);
    // The old one: archived, with a note of the new one, everything it found still there.
    const old = store.get(nb.id)!;
    expect(old.archivedAt).toBeTruthy();
    expect(store.entries(nb.id).find((e) => e.title === 'Run again')!.body).toContain(`/notebooks/${newId}`);
    expect(store.entries(nb.id).some((e) => e.title === 'Marcus 12-month')).toBe(true);
    // Archived, it can still be run again (a fresh copy); it stays archived.
    expect((await get(app, `/notebooks/${nb.id}/edit`)).text).toContain('this one stays archived');
    const again = await post(app, `/notebooks/${nb.id}/rerun`, {});
    const where2 = decodeURIComponent(again.headers.location);
    expect(where2).toContain('Started again as a new notebook');
    expect(store.get(nb.id)!.archivedAt).toBeTruthy();
    expect(store.get(where2.split('/notebooks/')[1].split('?')[0])!.title).toBe(nb.title);

    // Said to sua: a card that does the same.
    const { accepted, rejected } = parseProposedActions([{ type: 'notebook-rerun', rationale: 'Start over', inputs: { NOTEBOOK: newId } }, { type: 'notebook-rerun', inputs: {} }], [], []);
    expect(accepted[0]).toMatchObject({ agentId: 'notebook-rerun', effect: 'write', ctaLabel: 'Run it again', inputs: { NOTEBOOK: newId } });
    expect(rejected[0].reason).toBe('notebook-rerun needs inputs.NOTEBOOK');
    const done = executeNotebookRerun(ctx, accepted[0]);
    expect(done.status).toBe('completed');
    expect(done.summary).toMatch(/^Started again as \[Research CD ladders for \$25,000\]\(\/notebooks\/[^)]+\): the same setup, none of what the old one found\. Its first step, \*\*Find 5 CDs\*\*, is running\. The one before is archived/);
    expect(store.get(newId)!.archivedAt).toBeTruthy();
    expect(executeNotebookRerun(ctx, { ...accepted[0], inputs: { NOTEBOOK: 'nope' } })).toMatchObject({ status: 'failed', refusalReason: 'No such notebook.' });
    S.finderReply = undefined;
  });

  it('an archived notebook stops: its steps do not start or move on, and archiving stops the step that is running', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const { startNotebookStep, moveOnFromStep, focusStepOnTop } = await import('../lib/notebook-steps.js');
    const { startNotebookPipeline } = await import('../lib/notebook-pipeline.js');
    const ctx = getContext(app.locals);
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const make = (title: string) => {
      const nb = store.create({ title, statement: 'Find a job', params: [], criteria: [], pipeline: [], cadence: '' });
      store.setFields(nb.id, [{ key: 'url', label: 'Page', type: 'url', role: 'link' }]);
      store.setChecks(nb.id, ['Still open']);
      store.setSteps(nb.id, [{ title: 'Find 5 jobs', kind: 'find', target: 5 }, { title: 'Check them', kind: 'check' }]);
      return store.get(nb.id)!;
    };

    // Its first step met, then run again: Continue on the old one (a tab left open, a card in its conversation) does nothing.
    const old = make('Find a job');
    store.updateStep(old.id, old.steps![0].id, { status: 'met' });
    S.finderReply = () => 'Found none.';
    await post(app, `/notebooks/${old.id}/rerun`, {});
    expect(store.get(old.id)!.archivedAt).toBeTruthy();
    const archived = 'This notebook is archived. Restore it on its Edit page to';
    expect(startNotebookStep(ctx, old.id)).toMatchObject({ started: false, reason: `${archived} work on its steps.` });
    expect(moveOnFromStep(ctx, old.id)).toMatchObject({ moved: false, reason: `${archived} move on from its step.` });
    expect(focusStepOnTop(ctx, old.id, old.steps![1].id, 3)).toMatchObject({ started: false, reason: `${archived} work on its steps.` });
    expect(startNotebookPipeline(ctx, old.id)).toMatchObject({ started: false, reason: `${archived} run its pipeline.` });
    expect(store.get(old.id)!.steps!.map((s) => s.status)).toEqual(['met', 'todo']);
    // Its page says so in place of a Next step button.
    const page = (await get(app, `/notebooks/${old.id}`)).text;
    expect(page).toContain('Archived: restore it on its Edit page to work on its steps.');
    // Restored, it works again.
    await post(app, `/notebooks/${old.id}/archive`, { archived: '0' });
    expect(startNotebookStep(ctx, old.id).started).toBe(true);
    for (let i = 0; i < 200 && ctx.notebookPipelines?.has(old.id); i++) await new Promise((r) => setTimeout(r, 10));

    // Archived while a step runs: the step is stopped.
    const busy = make('Find another job');
    let release: (() => void) | undefined;
    S.finderReply = (() => new Promise<string>((r) => { release = () => r('Found none.'); })) as never;
    expect(startNotebookStep(ctx, busy.id)).toMatchObject({ started: true });
    for (let i = 0; i < 100 && !release; i++) await new Promise((r) => setTimeout(r, 10));
    await post(app, `/notebooks/${busy.id}/archive`, {});
    expect(ctx.notebookPipelines?.get(busy.id)?.stopped).toBe(true);
    release?.();
    for (let i = 0; i < 200 && ctx.notebookPipelines?.has(busy.id); i++) await new Promise((r) => setTimeout(r, 10));
    expect(store.get(busy.id)!.steps![0].status).toBe('stuck');
    expect(store.get(busy.id)!.steps![1].status).toBe('todo');
    S.finderReply = undefined;
  });
});

describe('notebook tags', () => {
  const get = (app: Awaited<ReturnType<typeof makeApp>>, path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
  const setup = async () => {
    const app = await makeApp();
    const { NotebookStore, notebookTags } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const ctx = getContext(app.locals);
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const asked: Array<Record<string, string>> = [];
    const settle = async () => { for (let i = 0; i < 200 && ctx.notebookTagging; i++) await new Promise((r) => setTimeout(r, 10)); };
    return { app, ctx, store, asked, settle, notebookTags };
  };
  type Asked = Array<{ id: string; title: string; for: string; limits: string[] }>;

  it('tags untagged notebooks when the list opens (archived too), reusing tags in use; the list filters and searches by tag', async () => {
    const { app, ctx, store, asked, settle, notebookTags } = await setup();
    const car = store.create({ title: 'Find a used SUV', statement: 'A reliable used SUV under $26,000', params: ['under $26,000', 'AWD'], criteria: [], pipeline: [], cadence: '' });
    const meet = store.create({ title: 'Prepare for my meeting with Dana Reyes', statement: 'A brief on Dana Reyes', params: [], criteria: [], pipeline: [], cadence: '' });
    const old = store.create({ title: 'Winter tires', statement: 'Tires for the SUV', params: [], criteria: [], pipeline: [], cadence: '' });
    store.archive(old.id);

    // Not installed and no stand-in: the list opens and nothing is asked.
    expect((await get(app, '/notebooks')).status).toBe(200);
    expect(ctx.notebookTagging).toBeFalsy();
    expect(store.get(car.id)!.tags).toBeUndefined();

    ctx.notebookTaggerRun = async (inputs) => {
      asked.push(inputs);
      const nbs = JSON.parse(inputs.NOTEBOOKS) as Asked;
      return `<tags>${JSON.stringify({ items: nbs.map((n) => /meeting/i.test(n.title)
        ? { id: n.id, tags: ['Sales', 'logistics'], subject: 'Dana Reyes' }
        : { id: n.id, tags: ['cars', /tires/i.test(n.title) ? 'tires' : 'family'], subject: 'Somebody Else' }) })}</tags>`;
    };
    const first = (await get(app, '/notebooks')).text;
    expect(first).not.toContain('nbl-tags');
    await settle();
    // One run for all three, with what each is for and no tags in use yet.
    expect(asked).toHaveLength(1);
    expect((JSON.parse(asked[0].NOTEBOOKS) as Asked).map((n) => n.id).sort()).toEqual([car.id, meet.id, old.id].sort());
    expect((JSON.parse(asked[0].NOTEBOOKS) as Asked).find((n) => n.id === car.id)).toEqual({ id: car.id, title: 'Find a used SUV', for: 'A reliable used SUV under $26,000', limits: ['under $26,000', 'AWD'] });
    expect(JSON.parse(asked[0].VOCABULARY)).toEqual([]);
    expect(notebookTags(store.get(car.id)!)).toEqual(['cars', 'family']);
    expect(notebookTags(store.get(old.id)!)).toEqual(['cars', 'tires']);
    // A subject is kept only when it's in the notebook's own words.
    expect(store.get(meet.id)!.tags).toMatchObject({ auto: ['sales', 'logistics'], subject: 'Dana Reyes' });
    expect(store.get(car.id)!.tags!.subject).toBeUndefined();

    // The list: a tag row with counts for this tab (the archived one's tag isn't on Active), and chips on cards.
    const list = (await get(app, '/notebooks')).text;
    expect(list).toContain('aria-label="Notebooks by tag"');
    expect(list).toMatch(/href="\/notebooks\?tag=cars">cars <span class="nbl-tag__n">1<\/span>/);
    expect(list).not.toContain('tag=tires');
    expect(list).toContain('<span class="nbl-card__tag">family</span>');
    await settle();
    expect(asked).toHaveLength(1); // nothing is stale: not asked again

    // Filtered by a tag: only its notebooks; the tag in the row clears it; search keeps it.
    const cars = (await get(app, '/notebooks?tag=cars')).text;
    expect(cars).toContain('Find a used SUV');
    expect(cars).not.toContain('Dana Reyes');
    expect(cars).toMatch(/class="nbl-tag is-on" href="\/notebooks"/);
    expect(cars).toContain('<input type="hidden" name="tag" value="cars">');
    expect((await get(app, '/notebooks?status=archived&tag=tires')).text).toContain('Winter tires');
    // A tag only an archived notebook has: Active says where it is.
    const tires = (await get(app, '/notebooks?tag=tires')).text;
    expect(tires).toContain('notebooks tagged “tires”');
    expect(tires).toContain('<a href="/notebooks?tag=tires&amp;status=archived">1 under Archived</a>');
    // Search matches a tag and who it's about.
    const bySales = (await get(app, '/notebooks?q=logist')).text;
    expect(bySales).toContain('Dana Reyes');
    expect(bySales).not.toContain('Find a used SUV');
    // A tag nothing has: says so, with a way out.
    const none = (await get(app, '/notebooks?tag=boats')).text;
    expect(none).toContain('notebooks tagged “boats”');
    expect(none).toContain('Clear the tag');

    // A changed goal: tagged again, alone, with the tags in use (most used first).
    store.update(car.id, { statement: 'A reliable used SUV under $30,000' });
    await get(app, '/notebooks');
    await settle();
    expect(asked).toHaveLength(2);
    expect((JSON.parse(asked[1].NOTEBOOKS) as Asked).map((n) => n.id)).toEqual([car.id]);
    expect((JSON.parse(asked[1].VOCABULARY) as string[])[0]).toBe('cars');
  });

  it('a failed try waits; a notebook run again keeps its tags (yours too) and is not tagged again', async () => {
    const { app, ctx, store, asked, settle, notebookTags } = await setup();
    const { rerunNotebook, createNotebookFrom } = await import('../lib/notebook-create.js');
    let reply: string | undefined;
    ctx.notebookTaggerRun = async (inputs) => { asked.push(inputs); return reply; };

    // Made through the one way to start a notebook: tagged in the background, here with no answer.
    const nb = createNotebookFrom(ctx, { title: 'CD ladders', statement: 'Where to put $25,000 in CDs', params: ['FDIC insured'], criteria: [] });
    await settle();
    expect(asked).toHaveLength(1);
    expect(store.get(nb.id)!.tags).toMatchObject({ auto: [] });
    expect(store.get(nb.id)!.tags!.failedAt).toBeTruthy();
    await get(app, '/notebooks');
    await settle();
    expect(asked).toHaveLength(1); // waiting

    // Tags with no usable word are a failed try too, not "tagged with nothing".
    S.runStore.databaseHandle().prepare('UPDATE notebooks SET tags_json = NULL WHERE id = ?').run(nb.id);
    reply = `<tags>${JSON.stringify({ items: [{ id: nb.id, tags: ['!!!', 'this one has far too many words'] }] })}</tags>`;
    await get(app, '/notebooks');
    await settle();
    expect(asked).toHaveLength(2);
    expect(store.get(nb.id)!.tags!.at).toBeUndefined();

    S.runStore.databaseHandle().prepare('UPDATE notebooks SET tags_json = NULL WHERE id = ?').run(nb.id);
    reply = `<tags>${JSON.stringify({ items: [{ id: nb.id, tags: ['savings', 'banking'] }, { id: 'nope', tags: ['x'] }] })}</tags>`;
    await get(app, '/notebooks');
    await settle();
    expect(notebookTags(store.get(nb.id)!)).toEqual(['savings', 'banking']);

    // Yours, then run again: the new notebook has the same tags and isn't asked about.
    const t = store.get(nb.id)!.tags!;
    S.runStore.databaseHandle().prepare('UPDATE notebooks SET tags_json = ? WHERE id = ?').run(JSON.stringify({ ...t, added: ['retirement'], removed: ['banking'] }), nb.id);
    const before = asked.length;
    const made = rerunNotebook(ctx, nb.id).notebook;
    await settle();
    expect(made.id).not.toBe(nb.id);
    expect(notebookTags(store.get(made.id)!)).toEqual(['savings', 'retirement']);
    expect(store.get(made.id)!.tags).toMatchObject({ added: ['retirement'], removed: ['banking'] });
    expect(asked).toHaveLength(before);
    // Let both notebooks finish setting up (sua's hello is the last of it) before the test's database closes.
    for (let i = 0; i < 400 && [nb.id, made.id].some((id) => !store.get(id)!.conversationId); i++) await new Promise((r) => setTimeout(r, 10));
  });

  it('Edit → Tags: remove one, add your own, put one back; sua tagging again keeps your changes', async () => {
    const { app, ctx, store, settle, notebookTags } = await setup();
    const post = (path: string, body: Record<string, string>) => request(app).post(path).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const nb = store.create({ title: 'Find a used SUV', statement: 'A reliable used SUV', params: [], criteria: [], pipeline: [], cadence: '' });
    const other = store.create({ title: 'Winter tires', statement: 'Tires', params: [], criteria: [], pipeline: [], cadence: '' });
    store.setAutoTags(nb.id, { tags: ['used cars', 'suvs'] });
    store.setAutoTags(other.id, { tags: ['tires', 'used cars'] });

    // The Edit page lists its tags with a remove button each, and suggests tags in use it doesn't have.
    const page = (await get(app, `/notebooks/${nb.id}/edit`)).text;
    expect(page).toContain('id="nbe-tags"');
    expect(page).toContain('aria-label="Remove the tag used cars"');
    expect(page).toContain('<option value="tires"></option>');
    expect(page).not.toContain('<option value="suvs"></option>');
    expect(page).not.toContain('You removed:');

    // Remove one of sua's, add one of yours (on a tab: back to that tab, at the tags).
    const removed = await post(`/notebooks/${nb.id}/tags`, { remove: 'suvs', tab: 'looks' });
    expect(removed.status).toBe(303);
    expect(removed.headers.location).toBe(`/notebooks/${nb.id}/edit?tab=looks#nbe-tags`);
    expect((await post(`/notebooks/${nb.id}/tags`, { add: 'Family Car' })).headers.location).toBe(`/notebooks/${nb.id}/edit#nbe-tags`);
    expect(notebookTags(store.get(nb.id)!)).toEqual(['used cars', 'family car']);
    const after = (await get(app, `/notebooks/${nb.id}/edit`)).text;
    expect(after).toContain('<span class="nbe-tag__name">family car</span><span class="nbe-tag__by">yours</span>');
    expect(after).toContain('You removed:');
    expect(after).toContain('<input type="hidden" name="restore" value="suvs">');
    // The list filters by yours, and no longer by the removed one.
    expect((await get(app, '/notebooks?tag=family+car')).text).toContain('Find a used SUV');
    expect((await get(app, '/notebooks?tag=suvs')).text).toContain('notebooks tagged “suvs”');

    // Not a tag: said on the page, nothing kept.
    const bad = await post(`/notebooks/${nb.id}/tags`, { add: 'far too many words here' });
    expect(decodeURIComponent(bad.headers.location)).toContain('A tag is 1 to 3 plain words');
    expect((await post('/notebooks/nope/tags', { add: 'x' })).status).toBe(303);

    // Its goal changes: sua tags it again, and your changes are still there.
    ctx.notebookTaggerRun = async (inputs) => `<tags>${JSON.stringify({ items: (JSON.parse(inputs.NOTEBOOKS) as Array<{ id: string }>).map((n) => ({ id: n.id, tags: ['used cars', 'suvs', 'awd'] })) })}</tags>`;
    store.update(nb.id, { statement: 'A reliable used SUV with AWD' });
    await get(app, '/notebooks');
    await settle();
    expect(store.get(nb.id)!.tags).toMatchObject({ auto: ['used cars', 'suvs', 'awd'], added: ['family car'], removed: ['suvs'] });
    expect(notebookTags(store.get(nb.id)!)).toEqual(['used cars', 'awd', 'family car']);

    // Put it back.
    await post(`/notebooks/${nb.id}/tags`, { restore: 'suvs' });
    expect(notebookTags(store.get(nb.id)!)).toEqual(['used cars', 'suvs', 'awd', 'family car']);
    expect((await get(app, `/notebooks/${nb.id}/edit`)).text).not.toContain('You removed:');
  });
});

describe('a notebook like the one you ask for', () => {
  const setup = async () => {
    const app = await makeApp();
    const { NotebookStore, layoutPreset } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const ctx = getContext(app.locals);
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    return { app, ctx, store, layoutPreset };
  };

  it('triage is given the notebooks an ask could be: the same topic, or the same kind for someone else, with a template when one was saved', async () => {
    const { ctx, store } = await setup();
    const { notebookCandidates } = await import('./inbox-engine.js');
    const suv = store.create({ title: 'Find a used SUV', statement: 'A reliable used SUV under $26,000', params: ['AWD'], criteria: [], pipeline: [], cadence: '' });
    store.setAutoTags(suv.id, { tags: ['used cars', 'family'] });
    store.archive(suv.id);
    const dana = store.create({ title: 'Prepare for my meeting with Dana Reyes', statement: 'A brief on Dana Reyes', params: ['30 minutes'], criteria: ['Talking points chosen'], pipeline: [], cadence: '' });
    store.setAutoTags(dana.id, { tags: ['sales'], subject: 'Dana Reyes' });

    expect(notebookCandidates(ctx, 'How is the weather?')).toBe('');
    expect(JSON.parse(notebookCandidates(ctx, 'Start a notebook to find a used SUV with AWD'))).toEqual([
      { id: suv.id, title: 'Find a used SUV', match: 'same-topic', kind: 'choose', for: 'A reliable used SUV under $26,000', tags: ['used cars', 'family'], status: 'active', archived: true, link: `/notebooks/${suv.id}` },
    ]);
    expect(JSON.parse(notebookCandidates(ctx, 'Prepare for my meeting with Sam Ortiz'))).toEqual([
      { id: dana.id, title: 'Prepare for my meeting with Dana Reyes', match: 'same-kind', kind: 'meeting', for: 'A brief on Dana Reyes', subject: 'Dana Reyes', tags: ['sales'], status: 'active', archived: false, link: `/notebooks/${dana.id}`, limits: ['30 minutes'], doneWhen: ['Talking points chosen'], checks: [] },
    ]);
    // Saved as a template: the candidate says which, so sua starts from the template instead.
    const t = store.saveTemplate('Meeting prep', dana.id);
    expect((JSON.parse(notebookCandidates(ctx, 'Prepare for my meeting with Sam Ortiz')) as Array<{ template?: string }>)[0].template).toBe(t.id);
  });

  it('"set it up like that one": a card that makes a new notebook with its setup and page, who it is about swapped, and leaves the other alone', async () => {
    const { ctx, store, layoutPreset } = await setup();
    const { withEditorBase, executeNotebookCreate } = await import('./inbox-engine.js');
    const { parseProposedActions } = await import('./inbox-plan.js');
    const nb0 = store.create({ title: 'Prepare for my meeting with Dana Reyes', statement: 'Help me understand what matters to Dana Reyes before we meet.', params: ['30 minutes'], criteria: ['Talking points chosen'], pipeline: [], cadence: '' });
    store.setFields(nb0.id, [{ key: 'topic', label: 'Topic', type: 'text' }, { key: 'url', label: 'Source', type: 'url', role: 'link' }]);
    store.setChecks(nb0.id, ['Says something Dana Reyes said herself']);
    store.setSteps(nb0.id, [{ title: 'Learn who Dana Reyes is', kind: 'profile', subject: 'Dana Reyes', status: 'done' }, { title: 'Find 8 topics', kind: 'find', target: 8 }, { title: 'Write talking points', kind: 'write' }]);
    store.setLayout(nb0.id, layoutPreset('dossier')!.layout, 'picked');
    store.upsertOption(nb0.id, { title: 'Her talk on routing', by: 'agent:x', data: {} });
    store.setAutoTags(nb0.id, { tags: ['sales', 'logistics'], subject: 'Dana Reyes' });

    // A card needs who it's for, and one or the other of TEMPLATE and LIKE.
    expect(parseProposedActions([{ type: 'notebook-create', inputs: { LIKE: nb0.id, TITLE: 'x' } }], [], []).rejected[0].reason).toBe('notebook-create with inputs.LIKE needs inputs.SUBJECT: who or what the new notebook is about');
    const { accepted } = parseProposedActions([{ type: 'notebook-create', rationale: 'Set up like the Dana Reyes one, for Sam Ortiz', inputs: { LIKE: nb0.id, TEMPLATE: 'ignored', SUBJECT: 'Sam Ortiz', TITLE: 'Prepare for my meeting with {subject}' } }], [], []);
    expect(accepted[0]).toMatchObject({ agentId: 'notebook-create', ctaLabel: 'Create notebook', inputs: { LIKE: nb0.id, SUBJECT: 'Sam Ortiz' } });
    expect(accepted[0].inputs.TEMPLATE).toBeUndefined();

    // The preview says which notebook, who it's for, and the steps with the name swapped.
    const card = withEditorBase(ctx, accepted[0]);
    expect(card.inputs.LIKE_TITLE).toBe('Prepare for my meeting with Dana Reyes');
    expect(card.surfaceChanges!.slice(0, 3)).toEqual([
      { what: 'set up like', before: '—', after: 'Prepare for my meeting with Dana Reyes (2 facts · 3 steps)' },
      { what: 'Who or what it’s about', before: '—', after: 'Sam Ortiz' },
      { what: 'title', before: '—', after: 'Prepare for my meeting with Sam Ortiz' },
    ]);
    expect(card.surfaceChanges!.at(-1)).toEqual({ what: 'steps', before: '—', after: '1. Learn who Sam Ortiz is; 2. Find 8 topics; 3. Write talking points' });

    const done = executeNotebookCreate(ctx, card);
    expect(done.status).toBe('completed');
    const made = store.list().find((x) => x.title === 'Prepare for my meeting with Sam Ortiz')!;
    expect(done.summary).toContain(`Created [Prepare for my meeting with Sam Ortiz](/notebooks/${made.id}) set up like [Prepare for my meeting with Dana Reyes](/notebooks/${nb0.id}) (2 facts · 3 steps). It starts empty`);
    // Sam's all through it, Dana nowhere: goal, checks, steps.
    expect(made.statement).toBe('Help me understand what matters to Sam Ortiz before we meet.');
    expect(made.checks).toEqual(['Says something Sam Ortiz said herself']);
    expect(made.steps!.map((x) => `${x.title}:${x.status}:${x.subject ?? ''}`)).toEqual(['Learn who Sam Ortiz is:todo:Sam Ortiz', 'Find 8 topics:todo:', 'Write talking points:todo:']);
    expect(JSON.stringify({ ...made, id: '' })).not.toContain('Dana');
    expect(made.fields.map((f) => f.key)).toEqual(['topic', 'url']);
    // Its page, kept whose it was; none of what the other found; a note says where it came from.
    expect(made.layout?.preset).toBe('dossier');
    expect(made.layoutBy).toBe('picked');
    expect(store.entries(made.id).filter((e) => e.kind === 'option')).toHaveLength(0);
    expect(store.entries(made.id).find((e) => e.title === 'Set up like another notebook')!.body).toContain(`(/notebooks/${nb0.id})`);
    // The other one is as it was: not archived, its option still there.
    expect(store.get(nb0.id)!.archivedAt).toBeUndefined();
    expect(store.entries(nb0.id).filter((e) => e.kind === 'option')).toHaveLength(1);

    // A notebook that names no one can't be set up for someone else; nor one that isn't there.
    const plain = store.create({ title: 'Find a used SUV', statement: 'A reliable used SUV', params: ['AWD'], criteria: [], pipeline: [], cadence: '' });
    expect(executeNotebookCreate(ctx, { ...card, inputs: { LIKE: plain.id, SUBJECT: 'a truck', TITLE: 'Find a used truck' } })).toMatchObject({ status: 'failed', refusalReason: expect.stringContaining("doesn't say who or what it's about") });
    expect(executeNotebookCreate(ctx, { ...card, inputs: { LIKE: 'nope', SUBJECT: 'x', TITLE: 'x' } })).toMatchObject({ status: 'failed', refusalReason: 'There\'s no notebook "nope" to set this one up like.' });
    // Let the new notebook finish setting up before the test's database closes.
    for (let i = 0; i < 400 && !store.get(made.id)!.conversationId; i++) await new Promise((r) => setTimeout(r, 10));
  });

  it('New notebook says so above the draft: open or run the same one again, or set this one up like one about someone else', async () => {
    const { app, store } = await setup();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const post = (path: string, body: Record<string, string>) => request(app).post(path).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const suv = store.create({ title: 'Find a used SUV', statement: 'A reliable used SUV under $26,000', params: ['AWD'], criteria: [], pipeline: [], cadence: '' });
    store.setAutoTags(suv.id, { tags: ['used cars', 'family'] });
    const dana = store.create({ title: 'Prepare for my meeting with Dana Reyes', statement: 'A brief on Dana Reyes', params: [], criteria: ['Talking points chosen'], pipeline: [], cadence: '' });
    store.setFields(dana.id, [{ key: 'topic', label: 'Topic', type: 'text' }]);
    store.setSteps(dana.id, [{ title: 'Learn who Dana Reyes is', kind: 'profile', subject: 'Dana Reyes' }, { title: 'Write talking points', kind: 'write' }]);
    store.setAutoTags(dana.id, { tags: ['sales'], subject: 'Dana Reyes' });

    // Nothing typed, or nothing like it: no hint.
    expect((await get('/notebooks/new')).text).not.toContain('nbd-like__h');
    expect((await get(`/notebooks/new?text=${encodeURIComponent('A standing desk under $600')}`)).text).not.toContain('nbd-like__h');

    // The same thing: its link, Open it, and Run it again (the route Edit's "Clear and run again" uses).
    const same = (await get(`/notebooks/new?text=${encodeURIComponent('Find me a used SUV with AWD')}`)).text;
    expect(same).toContain('You may already have this');
    expect(same).toContain(`<a href="/notebooks/${suv.id}">Find a used SUV</a>`);
    expect(same).toContain(`<form method="POST" action="/notebooks/${suv.id}/rerun">`);
    expect(same).toContain('and archives this one');

    // Drafting it answers with the same hint for the page to show; a change to the draft doesn't.
    const drafted = await post('/notebooks/draft', { text: 'Find me a used SUV with AWD' });
    expect(drafted.status).toBe(202);
    expect((drafted.body as { like: string }).like).toContain('You may already have this');
    const changed = await post('/notebooks/draft', { text: 'Find me a used SUV with AWD', from: (drafted.body as { id: string }).id, change: 'under $20k' });
    expect((changed.body as { like?: string }).like).toBeUndefined();
    expect((await post('/notebooks/draft', { text: 'A standing desk under $600' })).body).toMatchObject({ like: '' });
    // Back to the draft later: the hint is there again, from its sentence.
    expect((await get(`/notebooks/new?draft=${(drafted.body as { id: string }).id}`)).text).toContain('You may already have this');

    // The same kind for someone else: says who that one is about, and asks who this one is.
    const kind = (await get(`/notebooks/new?text=${encodeURIComponent('Prepare for my meeting with Sam Ortiz')}`)).text;
    expect(kind).toContain('You have one like this, about Dana Reyes');
    expect(kind).toContain(`<form method="POST" action="/notebooks/${dana.id}/like"`);
    expect(kind).toContain('placeholder="Instead of Dana Reyes"');

    // Set it up like that: a new notebook for them, the name swapped, the other as it was.
    expect((await post(`/notebooks/${dana.id}/like`, { subject: ' ' })).headers.location).toContain('/notebooks/new?flash=Say%20who');
    const made = await post(`/notebooks/${dana.id}/like`, { subject: 'Sam Ortiz' });
    expect(made.status).toBe(303);
    const nb = store.list().find((x) => x.title === 'Prepare for my meeting with Sam Ortiz')!;
    expect(made.headers.location).toContain(`/notebooks/${nb.id}?flash=`);
    expect(decodeURIComponent(made.headers.location)).toContain('Set up like Prepare for my meeting with Dana Reyes, for Sam Ortiz.');
    expect(nb.statement).toBe('A brief on Sam Ortiz');
    expect(nb.steps!.map((x) => x.title)).toEqual(['Learn who Sam Ortiz is', 'Write talking points']);
    expect(store.get(dana.id)!.archivedAt).toBeUndefined();
    // A notebook that names no one can't be copied; nor one that isn't there.
    expect(decodeURIComponent((await post(`/notebooks/${suv.id}/like`, { subject: 'a truck' })).headers.location)).toContain("doesn't say who or what it's about");
    expect(decodeURIComponent((await post('/notebooks/nope/like', { subject: 'x' })).headers.location)).toContain('no notebook "nope"');

    // Saved as a template: the template is the way, so the page doesn't offer to copy the notebook.
    store.saveTemplate('Meeting prep', dana.id);
    expect((await get(`/notebooks/new?text=${encodeURIComponent('Prepare for my meeting with Lee Park')}`)).text).not.toContain('You have one like this');
    for (let i = 0; i < 400 && !store.get(nb.id)!.conversationId; i++) await new Promise((r) => setTimeout(r, 10));
  });
});

describe("redrawing a notebook's TL;DR picture", () => {
  const setup = async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const ctx = getContext(app.locals);
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const post = (path: string, body: Record<string, string> = {}) => request(app).post(path).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const nb = store.create({ title: 'Choose batteries', statement: 'Good battery options', params: [], criteria: [], pipeline: [], cadence: '' });
    store.setFields(nb.id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }]);
    store.upsertOption(nb.id, { title: 'Werker 220Ah', by: 'x', data: { price: 139.99 } });
    store.upsertOption(nb.id, { title: 'Eco bundle', by: 'x', data: { price: 2130.99 } });
    const settle = async () => { for (let i = 0; i < 300 && ctx.notebookTldrRedraws?.get(nb.id)?.status === 'working'; i++) await new Promise((r) => setTimeout(r, 10)); };
    return { ctx, store, get, post, nb, settle };
  };
  const answer = (o: unknown) => `<tldr>${JSON.stringify(o)}</tldr>`;
  const barsView = [{ id: 'root', component: 'Columns', children: ['lead', 'bars'], widths: [5, 7] }, { id: 'lead', component: 'TldrPart', part: 'lead' }, { id: 'bars', component: 'TldrPart', part: 'bars' }];

  it('the Redraw page shows the picture and how it is drawn; an ask redraws it and keeps the result; Undo and the standard picture bring the others back', async () => {
    const { ctx, store, get, post, nb, settle } = await setup();
    const asked: Array<Record<string, string>> = [];
    let release: (() => void) | undefined;
    ctx.notebookTldrRun = async (inputs) => { asked.push(inputs); await new Promise<void>((r) => { release = r; }); return answer({ size: 'landscape', tone: 'editorial', headline: 'Two ways, from $139.99', about: 'Wide for LinkedIn, with a headline.', view: barsView }); };

    // The share menu links it; the page starts on the standard picture with one-press starters.
    expect((await get(`/notebooks/${nb.id}`)).text).toContain(`<a href="/notebooks/${nb.id}/tldr" title="Say how you want the picture drawn: for LinkedIn, more editorial, more creative" aria-label="Redraw the TL;DR picture">Redraw…</a>`);
    const page = (await get(`/notebooks/${nb.id}/tldr`)).text;
    expect(page).toContain(`<img src="/notebooks/${nb.id}/tldr.png?v=standard"`);
    expect(page).toContain('The standard picture: as tall as it needs, plain, everything in one column.');
    expect(page).toContain('<button type="submit" name="ask" value="Make it suitable for sharing on LinkedIn" class="nbd-chip nbd-chip--add"');
    expect(page).not.toContain('Back to the standard picture');
    expect(page).not.toContain('>Undo<');
    // What this page prefers (a shortlist: its bars), and a one-press way to ask for it.
    expect(page).toContain('This page prefers: Landscape 1200×627, leading with the options as ranked bars (a shortlist).');
    expect(page).toContain('value="Draw it the way this page prefers"');

    // Nothing asked: said, nothing run.
    expect(decodeURIComponent((await post(`/notebooks/${nb.id}/tldr/redraw`, { ask: '  ' })).headers.location)).toContain('Say how you want it drawn.');
    expect(asked).toHaveLength(0);

    // An ask: it works in the background; the page says so, in your words, and a second ask waits.
    expect((await post(`/notebooks/${nb.id}/tldr/redraw`, { ask: 'Make it suitable for sharing on LinkedIn' })).headers.location).toBe(`/notebooks/${nb.id}/tldr`);
    for (let i = 0; i < 100 && !release; i++) await new Promise((r) => setTimeout(r, 5));
    expect((await get(`/notebooks/${nb.id}/tldr/state`)).body).toEqual({ status: 'working' });
    const working = (await get(`/notebooks/${nb.id}/tldr`)).text;
    expect(working).toContain(`data-nbt-working="/notebooks/${nb.id}/tldr/state"`);
    expect(working).toContain('sua is redrawing the picture');
    expect(working).toContain('Make it suitable for sharing on LinkedIn');
    expect(decodeURIComponent((await post(`/notebooks/${nb.id}/tldr/redraw`, { ask: 'again' })).headers.location)).toContain('already redrawing it');
    // sua was given the picture in words, the choices and the ask.
    expect(asked[0].ASK).toBe('Make it suitable for sharing on LinkedIn');
    expect(JSON.parse(asked[0].CARD)).toMatchObject({ lead: { label: 'Best lead', text: 'Werker 220Ah', picture: 'none' }, bars: { by: 'Price', topOptionsWithPictures: 0 } });
    expect(asked[0].CURRENT).toBe('');
    expect(asked[0].PREFER).toContain('prefers size "landscape" leading with the options as ranked bars');
    release!();
    await settle();
    expect((await get(`/notebooks/${nb.id}/tldr/state`)).body).toEqual({ status: 'done' });

    // Kept: the notebook's picture is the redrawn one, and the page says how it's drawn and what sua did.
    expect(store.get(nb.id)!.tldr).toMatchObject({ size: 'landscape', tone: 'editorial', headline: 'Two ways, from $139.99', ask: 'Make it suitable for sharing on LinkedIn', view: barsView });
    const done = (await get(`/notebooks/${nb.id}/tldr`)).text;
    expect(done).toContain('Landscape 1200×627 · editorial · composed: the options as bars · with a headline');
    expect(done).toContain('Wide for LinkedIn, with a headline.');
    expect(done).toContain('You asked: “Make it suitable for sharing on LinkedIn”');
    expect(done).not.toContain('data-nbt-working="');
    expect(done).toContain('>Undo<');
    expect(done).toContain('Back to the standard picture');
    expect((await get(`/notebooks/${nb.id}/tldr.html`)).text).toContain('tl--view');

    // The standard picture again, then Undo back to the redrawn one, then Undo to the standard.
    expect(decodeURIComponent((await post(`/notebooks/${nb.id}/tldr/reset`)).headers.location)).toContain('Back to the standard picture.');
    expect(store.get(nb.id)!.tldr).toBeUndefined();
    await post(`/notebooks/${nb.id}/tldr/undo`);
    expect(store.get(nb.id)!.tldr).toMatchObject({ size: 'landscape' });
    await post(`/notebooks/${nb.id}/tldr/undo`);
    expect(store.get(nb.id)!.tldr).toBeUndefined();
    expect(decodeURIComponent((await post(`/notebooks/${nb.id}/tldr/undo`)).headers.location)).toContain('Nothing to undo.');
    expect((await get('/notebooks/nope/tldr')).status).toBe(303);
  });

  it("an answer that can't be used is asked for once more with why; words with sua's own number are left out; two failures leave the picture as it was, with Try again", async () => {
    const { ctx, store, get, post, nb, settle } = await setup();
    const asked: Array<Record<string, string>> = [];
    let replies: Array<string | undefined> = [];
    ctx.notebookTldrRun = async (inputs) => { asked.push(inputs); return replies.shift(); };

    // A tone that isn't one of the choices, then a good answer.
    replies = [answer({ size: 'square', tone: 'neon', view: barsView }), answer({ size: 'square', tone: 'bold', view: barsView })];
    await post(`/notebooks/${nb.id}/tldr/redraw`, { ask: 'bolder' });
    await settle();
    expect(asked).toHaveLength(2);
    expect(asked[1].ERRORS).toContain('"neon" is not a tone (use one of: plain, editorial, bold).');
    expect(store.get(nb.id)!.tldr).toMatchObject({ size: 'square', tone: 'bold', view: barsView });
    // The next ask is told how it's drawn now; a headline with a number of sua's own is left out, the card kept.
    replies = [answer({ size: 'square', tone: 'bold', headline: 'Batteries from $140', view: barsView })];
    await post(`/notebooks/${nb.id}/tldr/redraw`, { ask: 'add a headline' });
    await settle();
    expect(JSON.parse(asked[2].CURRENT)).toMatchObject({ size: 'square', tone: 'bold', view: barsView });
    expect(asked).toHaveLength(3);
    expect(store.get(nb.id)!.tldr).toMatchObject({ size: 'square', tone: 'bold', ask: 'add a headline', view: barsView });
    expect(store.get(nb.id)!.tldr!.headline).toBeUndefined();

    // A fixed layout with no view, twice: never drawn as a fixed layout; the picture stays.
    const kept = store.get(nb.id)!.tldr;
    replies = [answer({ size: 'landscape', tone: 'plain', layout: 'split' }), answer({ size: 'landscape', tone: 'plain', layout: 'split' })];
    await post(`/notebooks/${nb.id}/tldr/redraw`, { ask: 'wider' });
    await settle();
    expect(asked[4].ERRORS).toContain('It has no "view": compose the card as a view.');
    expect(store.get(nb.id)!.tldr).toEqual(kept);
    const noView = (await get(`/notebooks/${nb.id}/tldr`)).text;
    expect(noView).toContain('The picture is as it was.');
    expect(noView).toContain('<input type="hidden" name="ask" value="wider"><button type="submit" class="btn btn--sm">Try again</button>');

    // No usable answer twice: the picture stays, and the page says why, once.
    const before = store.get(nb.id)!.tldr;
    replies = [undefined, 'no block here'];
    await post(`/notebooks/${nb.id}/tldr/redraw`, { ask: 'something else' });
    await settle();
    expect(store.get(nb.id)!.tldr).toEqual(before);
    expect((await get(`/notebooks/${nb.id}/tldr/state`)).body).toEqual({ status: 'failed' });
    const failed = (await get(`/notebooks/${nb.id}/tldr`)).text;
    expect(failed).toContain('sua couldn&#39;t redraw it: It has no &lt;tldr&gt; JSON object. The picture is as it was.');
    expect((await get(`/notebooks/${nb.id}/tldr`)).text).not.toContain('redraw it: It has no');
  });
});


describe('notebooks asked for over MCP (notebook-create)', () => {
  const waitFor = async (ok: () => boolean) => { for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 20)); };

  it('makes a queued template request with its subject, and a queued ask as a briefing on who it names; start runs the first step', async () => {
    const app = await makeApp();
    const { NotebookStore, NotebookRequestStore } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const { startQueuedNotebookRequests } = await import('../lib/notebook-request.js');
    const ctx = getContext(app.locals);
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const seed = s.create({ title: 'Briefing on Northwind', statement: 'Learn about Northwind' });
    s.setSteps(seed.id, [{ title: 'Find news on Northwind', kind: 'find', target: 3 }]);
    s.saveTemplate('Company briefing', seed.id, undefined, { statement: 'Learn about {subject}', subject: { label: 'The company', example: 'Northwind' } });
    const requests = new NotebookRequestStore(S.runStore.databaseHandle());

    // From a template: made at once, its subject filled in, the template counted as used; left waiting.
    const t = requests.create({ template: 'company-briefing', subject: 'Acme', origin: 'mcp' });
    await Promise.all(startQueuedNotebookRequests(ctx));
    const made = requests.get(t.id)!;
    expect(made.phase).toBe('ready');
    expect(made.detail).toContain('waits for the person to start it');
    const nb = s.get(made.notebookId!)!;
    expect(nb.statement).toBe('Learn about Acme');
    expect(nb.steps?.[0]).toMatchObject({ title: 'Find news on Acme', status: 'todo' });
    expect(s.getTemplate('company-briefing')!.uses).toBe(1);
    expect(nb.title).toBe('Company briefing: Acme');
    expect(nb.briefOn).toBeUndefined();
    // Given with its website: the name alone in its texts, the site kept as the organization's own.
    S.pageReply = () => `<page>${JSON.stringify({ preset: 'company', about: 'a company on its own' })}</page>`;
    const w = requests.create({ template: 'company-briefing', subject: 'Duolingo, duolingo.com', origin: 'mcp' });
    await Promise.all(startQueuedNotebookRequests(ctx));
    const duo = s.get(requests.get(w.id)!.notebookId!)!;
    expect(duo.title).toBe('Company briefing: Duolingo');
    expect(duo.statement).toBe('Learn about Duolingo');
    expect(duo.steps?.[0]?.title).toBe('Find news on Duolingo');
    expect(duo.briefOn).toEqual({ name: 'Duolingo', kind: 'organization', site: 'https://duolingo.com' });
    // Its page is decided as a template's is (Company briefing here), not forced to the subject briefing.
    await waitFor(() => s.get(duo.id)?.layout?.preset === 'company');
    expect(s.get(duo.id)!.layout?.preset).toBe('company');
    S.pageReply = undefined;
    // Claimed once: running the queue again makes nothing more.
    expect(startQueuedNotebookRequests(ctx)).toHaveLength(0);
    // The person hears about it.
    expect(ctx.inboxStore!.list({}).some((m) => m.title === `A notebook was started for you: ${nb.title}`)).toBe(true);

    // An ask: drafted, then a briefing on what it names (its link as the site), and its first step started.
    const was = ctx.notebookDrafterRun;
    ctx.notebookDrafterRun = async () => `<draft>${JSON.stringify({
      title: 'Tell me about Acme', statement: 'A briefing on Acme.', params: [], criteria: ['A briefing written'],
      fields: [], checks: [], stages: [], pipeline: [], cadence: '',
      about: { name: 'Acme', kind: 'organization' },
      steps: [{ title: 'Find news on Acme', kind: 'find', target: 3 }, { title: 'Write the briefing', kind: 'write', shape: 'answer' }],
    })}</draft>`;
    try {
      const a = requests.create({ ask: 'Tell me about Acme, https://acme.example', start: true, origin: 'mcp' });
      await Promise.all(startQueuedNotebookRequests(ctx));
      await waitFor(() => requests.get(a.id)!.phase === 'ready');
      const r = requests.get(a.id)!;
      expect(r.phase).toBe('ready');
      expect(r.detail).toMatch(/first step(, Find news on Acme,)? is running|first step didn’t start/);
      const brief = s.get(r.notebookId!)!;
      expect(brief.briefOn).toMatchObject({ name: 'Acme', kind: 'organization', site: 'https://acme.example' });
      expect(brief.asked).toBe('Tell me about Acme, https://acme.example');
    } finally {
      ctx.notebookDrafterRun = was;
    }

    // A template gone since it was queued: failed, with why.
    const gone = requests.create({ template: 'no-such-template', subject: 'Acme' });
    await Promise.all(startQueuedNotebookRequests(ctx));
    expect(requests.get(gone.id)).toMatchObject({ phase: 'failed', error: expect.stringContaining('no template') });
  });
});

describe('a notebook\'s steps fold to chips while nothing runs', () => {
  it('a shortlist with no fold in its layout: done steps, one moved on short, a decide step next; all of it in chips, the strip one click away', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Find jobs', statement: 'Jobs that match' });
    store.setSteps(nb.id, [{ title: 'Find five matching jobs', kind: 'find', target: 5 }, { title: 'Check each job\'s fit', kind: 'check' }, { title: 'Pick jobs to pursue', kind: 'decide', target: 3 }]);
    const [a, b] = store.get(nb.id)!.steps!.map((x) => x.id);
    for (const t of ['Acme', 'Globex', 'Initech', 'Umbrella']) store.upsertOption(nb.id, { title: t, body: '', by: 'you' });
    store.updateStep(nb.id, a, { status: 'done' });
    store.updateStep(nb.id, b, { status: 'done', movedOn: true, why: 'It was still getting closer after 3 tries.' } as never);
    const html = (await request(app).get(`/notebooks/${nb.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;
    const chips = html.slice(html.indexOf('<div class="nb-chips"'), html.indexOf('class="nb-chips__all"'));
    expect(chips).toContain('✓</span> Find <span class="nb-chip-step__count">4/5</span>');
    expect(chips).toMatch(/nb-chip-step--short[\s\S]*?Check[\s\S]*?· short/);
    expect(chips).toContain('It was still getting closer after 3 tries.');
    expect(chips).toMatch(/nb-chip-step--yours[\s\S]*?Pick <span class="nb-chip-step__count">3<\/span>[\s\S]*?Pick 3… →/);
    // The full strip is still there, folded under All steps.
    expect(html).toMatch(/<details class="nb-chips__all"><summary>All steps<\/summary><ol class="nb-steps/);
  });
});
