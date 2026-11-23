import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { InboxStore } from '@some-useful-agents/core';
import { S, makeApp, COOKIE, PORT } from './notebooks.test-kit.js';

describe('new notebook: say it, sua drafts it, you check it', () => {
  const form = (app: Awaited<ReturnType<typeof makeApp>>, path: string, body: Record<string, string | string[]>) => request(app).post(path)
    .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
  const get = (app: Awaited<ReturnType<typeof makeApp>>, path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
  const ready = async (app: Awaited<ReturnType<typeof makeApp>>, id: string) => {
    for (let i = 0; i < 250; i++) {
      const r = await get(app, `/notebooks/draft/${id}`);
      if (r.body.status !== 'working') return r.body as { status: string; html?: string; error?: string };
      await new Promise((res) => setTimeout(res, 20));
    }
    return { status: 'working' };
  };

  it('drafts from a sentence, cleans it, changes it on request, and starts it set up', async () => {
    const app = await makeApp();
    expect((await get(app, '/notebooks/new')).text).toContain('Describe it like you\'d tell a friend');
    expect((await get(app, '/notebooks?new=1')).headers.location).toBe('/notebooks/new');
    expect((await form(app, '/notebooks/draft', { text: '  ' })).status).toBe(400);

    const started = await form(app, '/notebooks/draft', { text: 'noise-cancelling headphones under $300' });
    expect(started.status).toBe(202);
    const d = await ready(app, started.body.id);
    expect(d.status).toBe('ready');
    expect(d.html).toContain('value="Pick noise-cancelling headphones"');
    expect(d.html!.match(/name="params" value="under \$300"/g)).toHaveLength(1); // duplicates dropped
    expect(d.html).toContain('value="sched-agent" checked');
    expect(d.html).not.toContain('made-up-agent'); // only agents you have
    expect(d.html).not.toContain('bad key'); // fields cleaned
    expect(d.html).toContain('<option value="" selected>when I ask</option>'); // "every morning" isn't a schedule

    const changed = await form(app, '/notebooks/draft', { text: 'noise-cancelling headphones under $300', from: started.body.id, change: 'only Sony' });
    expect(changed.body.id).toBe(started.body.id); // a change keeps the draft's address
    expect((await ready(app, changed.body.id)).html).toContain('value="Headphones (only Sony)"');

    const made = await form(app, '/notebooks', {
      title: 'Pick noise-cancelling headphones', statement: 'For flights.', params: ['over-ear', 'under $300'], criteria: ['One pair that fits'],
      field: [JSON.stringify({ key: 'price', label: 'Price', type: 'money', role: 'price' }), JSON.stringify({ key: 'rating', label: 'Rating', type: 'number', role: 'measure' })],
      checks: ['Comfortable with glasses'], stages: 'Found → Shortlist → Bought', pipeline: ['sched-agent', 'made-up-agent'], cadence: '0 7 * * *',
    });
    expect(made.status).toBe(303);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const nb = NotebookStore.fromHandle(S.runStore.databaseHandle()).get('pick-noise-cancelling-headphones')!;
    expect(nb).toMatchObject({ params: ['over-ear', 'under $300'], stages: ['Found', 'Shortlist', 'Bought'], checks: ['Comfortable with glasses'], pipeline: ['sched-agent'], cadence: '0 7 * * *' });
    expect(nb.fields.map((f) => f.key)).toEqual(['price', 'rating']);
    expect(nb.criteria.map((c) => c.text)).toEqual(['One pair that fits']);
  });

  it('the draft lays out the work in steps: agents only if installed, editable, kept as you change them, and saved when you start it', async () => {
    const app = await makeApp();
    const started = await form(app, '/notebooks/draft', { text: 'noise-cancelling headphones under $300' });
    const id = started.body.id as string;
    expect((await ready(app, id)).status).toBe('ready');
    let page = (await get(app, `/notebooks/new?draft=${id}`)).text;
    // Four steps; the made-up agent is dropped (its step needs one), a check step can use sua's checker.
    expect(page).toContain('class="nbd-steps"');
    expect(page).toContain('name="step_title" value="Find 5 pairs"');
    expect(page).toMatch(/<option value="sched-agent" selected>sched-agent<\/option>/);
    expect(page).toContain('<option value="">sua’s checker</option>');
    expect(page).toContain('<option value="">needs an agent</option>');
    expect(page).not.toContain('value="made-up-agent"');
    expect(page).toContain('<span class="nbd-step__by">you</span>');

    // You change one and drop one; the draft keeps it.
    await form(app, `/notebooks/draft/${id}/edits`, {
      title: 'Headphones', statement: 'For flights.', cadence: '',
      step_title: ['Find 8 pairs', 'Pick one'], step_kind: ['find', 'decide'], step_agent: ['sched-agent', ''], step_target: ['8', '1'],
    });
    page = (await get(app, `/notebooks/new?draft=${id}`)).text;
    expect(page).toContain('name="step_title" value="Find 8 pairs"');
    expect(page).not.toContain('Check comfort with glasses');

    // Starting it saves the steps (an agent that isn't one of yours is dropped).
    await form(app, '/notebooks', { draft: id, title: 'Headphones', statement: 'For flights.',
      step_title: ['Find 8 pairs', 'Check comfort', 'Pick one'], step_kind: ['find', 'check', 'decide'], step_agent: ['sched-agent', 'made-up-agent', ''], step_target: ['8', '', '1'] });
    const { NotebookStore } = await import('@some-useful-agents/core');
    const nb = NotebookStore.fromHandle(S.runStore.databaseHandle()).list({}).find((n) => n.title === 'Headphones')!;
    expect(nb.steps).toEqual([
      { id: 's1', title: 'Find 8 pairs', kind: 'find', agentId: 'sched-agent', target: 8, status: 'todo', tries: 0 },
      { id: 's2', title: 'Check comfort', kind: 'check', status: 'todo', tries: 0 },
      { id: 's3', title: 'Pick one', kind: 'decide', target: 1, status: 'todo', tries: 0 },
    ]);

    // What a step writes, who it's about and the facts it looks up survive Start (a question kept writing talking points).
    expect(page).toContain('name="step_shape"');
    await form(app, '/notebooks', { title: 'CRM prices', statement: 'What do small teams pay?',
      step_title: ['Learn about Dana Reyes', 'Find sources', 'Source prices', 'Write the answer'], step_kind: ['profile', 'find', 'source', 'write'],
      step_agent: ['', '', '', ''], step_target: ['', '5', '', ''], step_shape: ['', '', '', 'answer'], step_subject: ['Dana Reyes', '', '', ''], step_facts: ['', '', 'price, plan', ''],
      field: [JSON.stringify({ key: 'price', label: 'Price', type: 'money', role: 'price' }), JSON.stringify({ key: 'plan', label: 'Plan', type: 'text' })] });
    const crm = NotebookStore.fromHandle(S.runStore.databaseHandle()).list({}).find((n) => n.title === 'CRM prices')!;
    expect(crm.steps!.map((x) => [x.kind, x.shape, x.subject, x.facts])).toEqual([
      ['profile', undefined, 'Dana Reyes', undefined], ['find', undefined, undefined, undefined], ['source', undefined, undefined, ['price', 'plan']], ['write', 'answer', undefined, undefined],
    ]);
  });

  it('sua proposes steps in the conversation: a card that previews them, refuses agents that aren\'t installed, and can start step 1', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const { withEditorBase, executeNotebookSteps } = await import('./inbox-engine.js');
    const { parseProposedActions } = await import('./inbox-plan.js');
    const ctx = getContext(app.locals);
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Peers' });
    store.setSteps(nb.id, [{ title: 'Old find', kind: 'find' }, { title: 'Old extra', kind: 'source' }]);
    const steps = [{ title: 'Find 10 companies', kind: 'find', agent: 'sched-agent', target: 10 }, { title: 'Check value to customers', kind: 'check' }];

    // The plan's action (STEPS may come as a list): accepted as a card to approve.
    const { accepted } = parseProposedActions([{ type: 'notebook-steps', rationale: 'In stages', inputs: { NOTEBOOK: nb.id, STEPS: steps, RUN: '1' } }], [], []);
    expect(accepted[0]).toMatchObject({ agentId: 'notebook-steps', status: 'proposed', ctaLabel: 'Set them up and start', inputs: { NOTEBOOK: nb.id, STEPS: JSON.stringify(steps) } });
    expect(parseProposedActions([{ type: 'notebook-steps', inputs: { NOTEBOOK: nb.id } }], [], []).rejected[0].reason).toBe('notebook-steps needs inputs.NOTEBOOK and inputs.STEPS');

    // Its preview: each step and its agent, and what it replaces.
    const card = withEditorBase(ctx, accepted[0]);
    expect(card.inputs.NOTEBOOK_TITLE).toBe('Peers');
    expect(card.surfaceChanges).toEqual([
      { what: 'Step 1', before: 'Old find', after: 'Find 10 companies · sched-agent' },
      { what: 'Step 2', before: 'Old extra', after: 'Check value to customers · sua’s checker' },
    ]);

    // An agent that isn't installed: refused, nothing changes.
    const bad = await executeNotebookSteps(ctx, { ...card, inputs: { ...card.inputs, STEPS: JSON.stringify([{ title: 'Find', kind: 'find', agent: 'nope' }]) } });
    expect(bad).toMatchObject({ status: 'failed', refusalReason: 'Not installed: nope.' });
    expect(store.get(nb.id)!.steps!.map((x) => x.title)).toEqual(['Old find', 'Old extra']);

    // Approved without RUN: set, not started.
    const set = await executeNotebookSteps(ctx, { ...card, inputs: { ...card.inputs, RUN: '' } });
    expect(set).toMatchObject({ status: 'completed', summary: "Steps set: 1. Find 10 companies; 2. Check value to customers. Run step 1 from the notebook when you're ready." });
    expect(store.get(nb.id)!.steps!.map((x) => `${x.title}:${x.agentId ?? ''}:${x.status}`)).toEqual(['Find 10 companies:sched-agent:todo', 'Check value to customers::todo']);

    // On a notebook that already has its companies, the card says the find step is done and where it starts.
    const full = store.create({ title: 'Peers with companies' });
    for (let i = 1; i <= 10; i++) store.upsertOption(full.id, { title: `Example Co ${String(i)}`, by: 'you', data: {} });
    const partway = await executeNotebookSteps(ctx, { ...card, inputs: { ...card.inputs, NOTEBOOK: full.id, RUN: '' } });
    expect(partway.summary).toBe('Steps set: 1. Find 10 companies; 2. Check value to customers. The notebook already has what this step needs, so it’s done: step 1, **Find 10 companies** (10 of 10 found). Next is step 2, **Check value to customers** (0 of 10 checked). Run the next step from the notebook when you\'re ready.');
    expect(store.get(full.id)!.steps!.map((x) => x.status)).toEqual(['done', 'todo']);
  });

  it('keeps a draft you leave: its address brings it back with your changes, the lists offer it, starting it clears it', async () => {
    const app = await makeApp();
    const started = await form(app, '/notebooks/draft', { text: 'noise-cancelling headphones under $300' });
    const id = started.body.id as string;
    expect((await ready(app, id)).status).toBe('ready');

    // Your edits are kept (the page posts its form as you change it).
    const edited = await form(app, `/notebooks/draft/${id}/edits`, {
      title: 'Quiet headphones for flights', statement: 'For long flights.', params: ['under $300', 'over-ear'], criteria: ['One pair that fits'],
      field: [JSON.stringify({ key: 'price', label: 'Price', type: 'money', role: 'price' })], checks: ['Comfortable with glasses'], stages: 'Found → Bought', cadence: '',
      // sched-agent unticked: still offered when you come back, just not ticked.
    });
    expect(edited.status).toBe(204);
    expect((await form(app, '/notebooks/draft/no-such/edits', { title: 'x' })).status).toBe(404);

    // Coming back: the sentence and the draft as you left it, ready to start.
    const back = await get(app, `/notebooks/new?draft=${id}`);
    expect(back.text).toContain('>noise-cancelling headphones under $300</textarea>');
    expect(back.text).toContain('value="Quiet headphones for flights"');
    expect(back.text).toContain('name="params" value="over-ear"');
    expect(back.text).toContain('name="stages" value="Found"');
    expect(back.text).toContain('name="stages" value="Bought"');
    expect(back.text).toMatch(/value="sched-agent"><span>/);
    expect(back.text).toContain(`<input type="hidden" name="draft" value="${id}">`);

    // The notebooks list and a fresh New page offer it.
    const list = await get(app, '/notebooks');
    expect(list.text).toContain('A draft you haven’t started');
    expect(list.text).toContain(`href="/notebooks/new?draft=${id}">Quiet headphones for flights</a>`);
    expect((await get(app, '/notebooks/new')).text).toContain(`/notebooks/new?draft=${id}`);

    // Starting it from the draft clears it.
    const made = await form(app, '/notebooks', { draft: id, title: 'Quiet headphones for flights', statement: 'For long flights.' });
    expect(made.status).toBe(303);
    expect((await get(app, '/notebooks')).text).not.toContain('haven’t started');
    expect((await get(app, `/notebooks/new?draft=${id}`)).text).toContain('That draft is gone');
  });

  it('a draft survives a restart, and one cut off mid-draft reads as failed; Discard and drafting again remove it', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    // Left "working" by a dashboard that stopped 20 minutes ago.
    s.saveDraft('cut-off', { status: 'working', text: 'a quiet rental' }, new Date(Date.now() - 20 * 60_000).toISOString());
    const page = await get(app, '/notebooks/new?draft=cut-off');
    expect(page.text).toContain('sua stopped before it finished');
    expect(page.text).not.toContain('data-nbd-resume');
    // Discard.
    const gone = await form(app, '/notebooks/draft/cut-off/discard', { back: 'list' });
    expect(gone.headers.location).toBe('/notebooks');
    expect(s.getDraft('cut-off')).toBeUndefined();
    // Drafting the sentence again replaces the draft you were on.
    const first = await form(app, '/notebooks/draft', { text: 'headphones' });
    await ready(app, first.body.id);
    const again = await form(app, '/notebooks/draft', { text: 'headphones under $200', replace: first.body.id });
    await ready(app, again.body.id);
    expect(s.listDrafts().map((d) => d.id)).toEqual([again.body.id]);
  });

  it('Skip the draft starts it from the sentence alone', async () => {
    const app = await makeApp();
    const made = await form(app, '/notebooks', { statement: 'A quiet 2-bed rental in Fremont under $2,600. Move by December.' });
    expect(made.status).toBe(303);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const nb = NotebookStore.fromHandle(S.runStore.databaseHandle()).list()[0];
    expect(nb.title).toBe('A quiet 2-bed rental in Fremont under $2,600');
  });
});

describe("new notebook's suggestions from your conversations", () => {
  it('reads your own conversations (not notebook or fix threads), keeps three clean pills, and caches them', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const inbox = InboxStore.fromHandle(S.runStore.databaseHandle());
    const say = (title: string, first: string, status?: 'resolved' | 'dismissed') => {
      const m = inbox.add({ priority: 'medium', source: 'manual', title, body: '(empty)' });
      inbox.addResponse(m.id, 'user', first);
      if (status) inbox.updateStatus(m.id, status);
      return m;
    };
    say('tires?', 'can you help me research some good tires for my 2012 rav4', 'dismissed');
    say('jobs', 'find me remote ai senior product manager roles', 'resolved');
    say('Fix Apple reminder demo', 'it failed');
    const { NotebookStore } = await import('@some-useful-agents/core');
    const nbThread = say('Notebook: Car', 'hello');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    s.setConversation(s.create({ title: 'Car' }).id, nbThread.id);

    let page = await get('/notebooks/new');
    expect(page.text).toContain('data-nbd-pills data-nbd-pills-refreshing');
    let j: { refreshing: boolean; html: string } = { refreshing: true, html: '' };
    for (let i = 0; i < 100 && j.refreshing; i++) { j = (await get('/notebooks/suggestions')).body; if (j.refreshing) await new Promise((r) => setTimeout(r, 20)); }
    expect(S.suggesterSaw).toContain('tires? — can you help me research some good tires');
    expect(S.suggesterSaw).toContain('jobs — find me remote ai senior product manager roles');
    expect(S.suggesterSaw).not.toContain('Fix Apple');
    expect(S.suggesterSaw).not.toContain('Notebook: Car');
    const pills = j.html.match(/data-nbd-pill="([^"]+)"/g) ?? [];
    expect(pills).toEqual(['data-nbd-pill="Good tires for my 2012 RAV4, wet and dry"', 'data-nbd-pill="A remote senior AI PM job over $200k"', 'data-nbd-pill="A 2-bed rental"']);
    expect(j.html).toContain('From your conversations');
    // Cached: the next visit shows them at once and doesn't ask again.
    S.suggesterSaw = '';
    page = await get('/notebooks/new');
    expect(page.text).toContain('>Tires for the RAV4</button>');
    expect(page.text).not.toContain('data-nbd-pills-refreshing');
    expect(S.suggesterSaw).toBe('');
  });
});

describe('how a notebook was made (Workflow)', () => {
  it("shares what's new: a CSV and a brief of only the last run's new options", async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.setFields(s.create({ title: 'Car' }).id, [{ key: 'url', label: 'Listing', type: 'url', role: 'link' }]);
    const tick = () => new Promise((r) => setTimeout(r, 3));
    const search = async (run: string, cars: string[]) => {
      const at = new Date().toISOString(); await tick();
      for (const n of cars) s.upsertOption(nb.id, { title: `Car ${n}`, by: 'agent:sweep', runId: run, data: { url: `https://cars.example/${n}` } });
      s.recordSearch(nb.id, 'sweep', run, cars.length, at); await tick();
    };
    await search('r1', ['a', 'b']);
    expect((await get('/notebooks/car')).text).not.toContain('brief.html?latest=1'); // all new: nothing to pick out
    await search('r2', ['b', 'c', 'd']);
    s.ruleOut(nb.id, s.findOption(nb.id, 'Car d')!.id, 'Salvage title', 'you');
    const page = (await get('/notebooks/car')).text;
    expect(page).toMatch(/href="\/notebooks\/car\/shortlist.csv\?rows=new"[^>]*>New in the last run <span class="nb-csv__n">1<\/span>/);
    expect(page).toContain('href="/notebooks/car/brief.html?latest=1"');
    const csv = await get('/notebooks/car/shortlist.csv?rows=new');
    expect(csv.headers['content-disposition']).toContain('car-new.csv');
    expect(csv.text).toContain('Car c');
    expect(csv.text).not.toMatch(/Car [abd]/);
    const brief = (await get('/notebooks/car/brief.html?latest=1')).text;
    expect(brief).toContain('What&#39;s new · Notebook brief');
    expect(brief).toContain('1 new in the running from the last run that found options');
    expect(brief).toContain('1 more it found was ruled out.');
    expect(brief).toContain('New in the last run<span class="count">1 new</span>');
    expect(brief).toContain('Salvage title');
    expect(brief).not.toContain('Car a');
  });

  it('links to the options the last run added, once some are new and some are not', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.setFields(s.create({ title: 'Car' }).id, [{ key: 'url', label: 'Listing', type: 'url', role: 'link' }]);
    const tick = () => new Promise((r) => setTimeout(r, 3));
    const search = async (run: string, cars: string[]) => {
      const at = new Date().toISOString(); await tick();
      for (const n of cars) s.upsertOption(nb.id, { title: `Car ${n}`, by: 'agent:sweep', runId: run, data: { url: `https://cars.example/${n}` } });
      s.recordSearch(nb.id, 'sweep', run, cars.length, at); await tick();
    };
    await search('r1', ['a', 'b']);
    expect((await get('/notebooks/car')).text).not.toContain('new in the last run'); // all new: nothing to pick out
    await search('r2', ['b', 'c', 'd']);
    const page = (await get('/notebooks/car')).text;
    expect(page).toContain('<a class="nb-hero__new" href="?added=new">2 new in the last run →</a>');
    expect(page).toContain('"added":"new"');
    expect(page).toContain('"filters":["added","seen"]');
  });

  it('draws its runs and their sub-runs, links them, and run pages link back; sub-runs are never offered to file', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.create({ title: 'Car' });
    const now = Date.now();
    const run = (id: string, agentName: string, msAgo: number, parent?: [string, string]) => S.runStore.createRun({
      id, agentName, status: 'completed', startedAt: new Date(now - msAgo).toISOString(), completedAt: new Date(now - msAgo + 1000).toISOString(),
      triggeredBy: 'dashboard', result: 'found things', ...(parent ? { parentRunId: parent[0], parentNodeId: parent[1] } : {}),
    } as never);
    run('sweep-1', 'car-sweep', 120_000);
    run('cl-a', 'craigslist-search', 110_000, ['sweep-1', 'seattle']);
    s.recordSearch(nb.id, 'craigslist-search', 'old-direct', 0, new Date(now - 900_000).toISOString()); // makes craigslist-search a source
    s.recordSearch(nb.id, 'car-sweep', 'sweep-1', 1, new Date(now - 100_000).toISOString());
    s.upsertOption(nb.id, { title: 'RAV4', by: 'agent:car-sweep', runId: 'sweep-1' });

    // Once something ran, the meta line's link says who made it (one place, no box under the steps).
    const nbPage = (await get('/notebooks/car')).text;
    expect(nbPage).toContain('<a class="nb-hero__madeby" href="/notebooks/car/workflow">Made by 2 agents in 2 runs →</a>');
    expect(nbPage).not.toContain('class="nb-madeby"');
    expect(nbPage).not.toContain('>How it was made →</a>');
    const page = await get('/notebooks/car/workflow');
    expect(page.status).toBe(200);
    expect(page.text).toContain('How this notebook was made');
    const data = JSON.parse(/<script id="dag-data" type="application\/json">([\s\S]*?)<\/script>/.exec(page.text)![1]) as { elements: Array<{ data: Record<string, string> }> };
    const ids = data.elements.map((e) => e.data.id);
    expect(ids).toEqual(expect.arrayContaining(['nb', 'sweep-1', 'cl-a', 'nb->sweep-1', 'sweep-1->cl-a', 'left:sweep-1']));
    expect(data.elements.find((e) => e.data.id === 'cl-a')!.data.href).toBe('/runs/cl-a');
    expect(data.elements.find((e) => e.data.id === 'left:sweep-1')!.data.label).toBe('1 option');
    expect(page.text).toContain('data-layout="lr"');
    expect(page.text).toContain('1 run it started');
    expect((await get('/notebooks/nope/workflow')).status).toBe(404);

    // The sub-run is part of the sweep's search: not offered to Add to notebook.
    expect((await get('/notebooks/car')).text).not.toContain('/runs/cl-a/add');
    // Run pages link back, the sub-run through its parent.
    expect((await get('/runs/sweep-1')).text).toContain('<a href="/notebooks/car">Car</a> · <a href="/notebooks/car/workflow">how it was made</a>');
    expect((await get('/runs/cl-a')).text).toContain('(through the run that started this one)');

    // A step's pass is named for it, and the step's card links to it (How →).
    s.setSteps(nb.id, [{ title: 'Find 5 cars', kind: 'find', agentId: 'car-sweep', target: 5, status: 'done', tries: 1 }]);
    const stepId = s.get(nb.id)!.steps![0].id;
    run('sweep-2', 'car-sweep', 50_000);
    const passId = s.startPass(nb.id, 'pipeline', new Date(now - 50_000).toISOString(), { stepId });
    s.addRunToPass(passId, 'sweep-2');
    s.finishPass(passId, 'car-sweep: 0 new');
    expect(s.passes(nb.id)[0]).toMatchObject({ id: passId, stepId });
    expect((await get('/notebooks/car')).text).toContain(`href="/notebooks/car/workflow?step=${stepId}" title="The runs this step made, the agents they called, and what each left">How →</a>`);
    const byStep = (await get(`/notebooks/car/workflow?step=${stepId}`)).text;
    expect(byStep).toContain('Step 1 · Find 5 cars');
    expect(byStep).toContain(`aria-current="true"`);
  });
});

describe('a run that files its own structured block', () => {
  it('is filed directly, without the keeper model, and can add more than a keeper would', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { directBlock } = await import('../lib/notebook-pipeline.js');
    expect(directBlock('no block here')).toBeUndefined();
    expect(directBlock('<notebook>{"entries": []}</notebook>')).toBeUndefined(); // nothing to file: the keeper reads it
    expect(directBlock('<notebook>{not json</notebook>')).toBeUndefined();

    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.setFields(store.create({ title: 'Accounts' }).id, [
      { key: 'company', label: 'Company', type: 'text', role: 'org' }, { key: 'website', label: 'Website', type: 'url', role: 'link' },
      { key: 'fit', label: 'Fit', type: 'number', role: 'score' },
    ]);
    store.addEntry(nb.id, { kind: 'note', title: 'started', by: 'agent:acct', runId: 'seed-run' }); // makes acct a source
    const entries: unknown[] = Array.from({ length: 20 }, (_, i) => ({ kind: 'option', title: `Company ${String(i + 1)}`, data: { company: `Company ${String(i + 1)}`, website: `https://c${String(i + 1)}.example.com`, fit: { value: 50 + i, estimate: true } } }));
    // The agent's code checked this quote; and it rules one company out itself.
    (entries[0] as { data: Record<string, unknown> }).data.fit = { value: 50, source: 'https://c1.example.com/jobs/1', quote: 'migrating our billing to Kafka', checked: true };
    entries.push({ kind: 'option', title: 'Initech', ruleOut: 'Unfit (12): sells printers', data: { company: 'Initech', website: 'https://initech.example.com', fit: 12 } });
    // Prose around the block: the test keeper only answers when output STARTS with <notebook>, so only direct filing can file this.
    const output = `Found 20 accounts.\n<notebook>${JSON.stringify({ entries })}</notebook>\nDone.`;
    S.runStore.createRun({ id: 'acct-run', agentName: 'acct', status: 'completed', startedAt: new Date(Date.now() - 60_000).toISOString(), completedAt: new Date().toISOString(), triggeredBy: 'dashboard', result: output } as never);
    const res = await request(app).post(`/notebooks/${nb.id}/runs/acct-run/add`).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(303);
    for (let i = 0; i < 100 && store.entries(nb.id).filter((e) => e.kind === 'option').length < 21; i++) await new Promise((r) => setTimeout(r, 20));
    const options = store.entries(nb.id).filter((e) => e.kind === 'option');
    expect(options.filter((e) => !e.ruledOut)).toHaveLength(20); // a keeper pass would stop at 12
    expect(options.find((e) => e.title === 'Company 1')!.factMeta!.fit).toEqual({ source: 'https://c1.example.com/jobs/1', quote: 'migrating our billing to Kafka', checked: true });
    expect(options.find((e) => e.title === 'Initech')!.ruledOut).toMatchObject({ reason: 'Unfit (12): sells printers', by: 'agent:acct' });
    expect(options.find((e) => e.title === 'Company 20')!.factMeta).toEqual({ fit: { estimate: true } });
    for (let i = 0; i < 50 && !store.passes(nb.id)[0]?.note; i++) await new Promise((r) => setTimeout(r, 20));
    expect(store.passes(nb.id)[0].note).toContain('acct: 21 new (filed directly)');
  });
});

describe('a brief to share', () => {
  it('is one self-contained page: the goal, where it stands, the options with facts, own page and checks; the CSV says own page vs search page', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Car for Nadia', statement: 'A reliable used car for a new driver', params: ['under $6,000'], criteria: ['A decision recorded'] });
    store.setFields(nb.id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'miles', label: 'Miles', type: 'number', role: 'measure', unit: 'mi' }, { key: 'listing_url', label: 'Listing URL', type: 'url', role: 'link' }]);
    store.setChecks(nb.id, ['Clean title', 'Accident history']);
    const a = store.upsertOption(nb.id, { title: '2010 Subaru Forester <b>', by: 'x', fingerprint: 'a', data: { price: 4999, miles: 164988, listing_url: 'https://www.craigslist.org/view/d/lynnwood-2010-subaru-forester/BDo6' } }).entry;
    store.upsertOption(nb.id, { title: '2009 Forester', by: 'x', fingerprint: 'b', data: { price: 4700, listing_url: 'https://www.cargurus.com/Cars/l-Used-Subaru-Forester-c1' } });
    store.checkOption(nb.id, a.id, 'Clean title', true);
    const res = await get(`/notebooks/${nb.id}/brief.html`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    const t = res.text;
    expect(t.startsWith('<!doctype html>')).toBe(true);
    expect(t).toContain('<title>Car for Nadia</title>');
    expect(t).toContain('A reliable used car for a new driver');
    expect(t).toContain('<strong>2 in the running</strong>');
    // Where it stands, in words, then the picture's bars: how the options compare. The lead and the numbers are said once, in the words.
    expect(t.indexOf('<p class="stands">')).toBeGreaterThan(-1);
    expect(t.indexOf('<p class="stands">')).toBeLessThan(t.indexOf('<figure class="tl tl--chart"'));
    expect(t).toContain('<figcaption class="tl__label">Price, lowest first</figcaption>');
    expect(t).not.toContain('class="tl__stat"');
    expect(t).not.toContain('>Best lead<');
    expect(t).toContain('2010 Subaru Forester &lt;b&gt;'); // escaped
    expect(t).toContain('<dd>$4,999</dd>');
    expect(t).toContain('<dd>164,988 mi</dd>');
    expect(t).toContain('href="https://www.craigslist.org/view/d/lynnwood-2010-subaru-forester/BDo6" data-site="craigslist.org" target="_blank" rel="noopener noreferrer">Own page ↗</a>');
    expect(t).toContain('Found on a search page');
    expect(t).toContain('1/2 checks');
    // An option with nothing checked doesn't say "0/2 checks".
    expect(t).not.toContain('0/2 checks');
    expect(t).toContain('<span class="chip">under $6,000</span>');
    // Key findings, computed: the pool and the price span.
    expect(t).toMatch(/<h2 data-n="\d+" id="b-find">Key findings<\/h2>/);
    expect(t).toContain('<strong>2 options looked at</strong>: 2 in the running.');
    expect(t).toContain('Price in the running: <span class="num">$4,700–$4,999</span>.');
    // Side by side, then in detail; nothing folded away (a closed details is missing from a PDF).
    expect(t).toContain('<div class="tbl"><table>');
    // A name with its own page links to it in the table; one found only on a search page doesn't.
    expect(t).toContain('<th scope="row"><a class="tbl__link" href="https://www.craigslist.org/view/d/lynnwood-2010-subaru-forester/BDo6" target="_blank" rel="noopener noreferrer">2010 Subaru Forester &lt;b&gt;</a>');
    expect(t).toContain('<th scope="row">2009 Forester');
    expect(t).not.toContain('<details');
    expect(t).not.toMatch(/<script/);
    // The extended brief (an option): the summary, then each option in full.
    expect(t).not.toContain('Each option in full');
    const full = (await get(`/notebooks/${nb.id}/brief.html?full=1`)).text;
    expect(full).toContain('Extended notebook brief');
    expect(full).toMatch(/<h2 data-n="\d+" id="b-full">Each option in full<span class="count">2<\/span><\/h2>/);
    expect(full).toMatch(/<dl class="full__facts"><div><dt>Price<\/dt><dd>\$4,999<\/dd><\/div>/);
    expect(full).toContain('<li class="crit is-met"><i>✓</i><span>Clean title</span></li>');
    expect(full).toContain('<li class="crit"><i>○</i><span>Accident history</span></li>');
    expect(full).toContain('<h4>What happened</h4>');
    // "In detail" would repeat them: the extended brief has the table, then each in full.
    expect(full).not.toContain('id="b-opts"');
    expect(full).toContain('<div class="tbl"><table>');
    expect(full).not.toMatch(/<script/);
    expect((await get(`/notebooks/${nb.id}/brief.html?full=1&download=1`)).headers['content-disposition']).toContain(`${nb.id}-brief-extended.html`);
    expect((await get(`/notebooks/${nb.id}/brief.html?full=1&print=1`)).text).toContain('print()');
    const menu = (await get(`/notebooks/${nb.id}`)).text;
    expect(menu).toContain(`href="/notebooks/${nb.id}/brief.html?full=1"`);
    expect(menu).toContain(`href="/notebooks/${nb.id}/brief.pdf?full=1" download`);
    expect(menu).toContain(`href="/notebooks/${nb.id}/brief.pdf" download`);
    // The print dialog still works by address (and is where a PDF falls back to with no browser here).
    expect((await get(`/notebooks/${nb.id}/brief.html?print=1`)).text).toContain('print()');

    // Download as PDF: a file made here from the brief, named after the notebook, with its own footer.
    const made: Array<{ html: string; opts: { footer?: string; paper?: string } }> = [];
    S.ctx!.notebookPdf = async (html, opts) => { made.push({ html, opts }); return { available: true, data: Buffer.from('%PDF-1.7 stand-in') }; };
    const pdf = await get(`/notebooks/${nb.id}/brief.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toBe(`attachment; filename="${nb.title}.pdf"; filename*=UTF-8''${encodeURIComponent(`${nb.title}.pdf`)}`);
    expect(Buffer.from(pdf.body as Buffer).toString()).toBe('%PDF-1.7 stand-in');
    // What's printed: the brief in the light theme, no print script, Letter, the title and date at the foot.
    expect(made[0].html).toContain('<main class="brief">');
    expect(made[0].html).toContain('data-theme="light"');
    expect(made[0].html).not.toMatch(/<script/);
    expect(made[0].opts.paper).toBe('Letter');
    expect(made[0].opts.footer).toMatch(new RegExp(`^${nb.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · \\w+ \\d+, \\d{4}$`));
    // On paper "Own page" prints no site after it (a PDF viewer would link that text to the bare site); the paper is white.
    expect(made[0].html).not.toContain('attr(data-site)');
    expect(made[0].html).toContain('html, body { background: #fff !important; }');
    // The extended one and A4, by address.
    const ext = await get(`/notebooks/${nb.id}/brief.pdf?full=1&paper=a4`);
    expect(ext.headers['content-disposition']).toContain(`filename="${nb.title} (extended).pdf"`);
    expect(made[1].opts.paper).toBe('A4');
    expect(made[1].html).toContain('id="b-full"');
    // No browser on this machine: the brief opens as its print view and says so (on screen, never in print), with no dialog opened unasked.
    S.ctx!.notebookPdf = async () => ({ available: false, reason: 'no browser' });
    const none = await get(`/notebooks/${nb.id}/brief.pdf?full=1`);
    expect(none.status).toBe(303);
    expect(none.headers.location).toBe(`/notebooks/${nb.id}/brief.html?full=1&nopdf=1&theme=light`);
    const said = (await get(none.headers.location)).text;
    expect(said).toContain('sua couldn\'t make the PDF here, so this is the print view.');
    expect(said).toContain('npx playwright install chromium');
    expect(said).toContain('@media print{.no-pdf{display:none!important}}');
    expect(said).not.toContain('setTimeout(() => print()');
    expect((await get(`/notebooks/${nb.id}/brief.html`)).text).not.toContain('class="no-pdf"');
    expect((await get('/notebooks/nope/brief.pdf')).status).toBe(404);

    // The TL;DR picture: the card as a page, and a PNG made from it (its lead's picture inside it), in the menu too.
    const card = await get(`/notebooks/${nb.id}/tldr.html`);
    expect(card.status).toBe(200);
    expect(card.text).toContain('<article class="tl"');
    expect(card.text).toContain(`<h1 class="tl__title">${nb.title}</h1>`);
    const shot: Array<{ html: string; opts: { width?: number; scale?: number; selector?: string } }> = [];
    S.ctx!.notebookPng = async (html, opts) => { shot.push({ html, opts }); return { available: true, data: Buffer.from('PNG stand-in') }; };
    const png = await get(`/notebooks/${nb.id}/tldr.png`);
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.headers['content-disposition']).toBeUndefined();
    expect(shot[0].opts).toEqual({ width: 1080, scale: 2, selector: '.tl' });
    expect(shot[0].html).not.toContain('src="/notebooks/');
    expect((await get(`/notebooks/${nb.id}/tldr.png?download=1`)).headers['content-disposition']).toContain(`filename="${nb.title} (TLDR).png"`);
    S.ctx!.notebookPng = async () => ({ available: false, reason: 'no browser' });
    // (A picture already made is served from memory; one not made yet, here the dark one, has to fall back.)
    expect((await get(`/notebooks/${nb.id}/tldr.png`)).headers['content-type']).toBe('image/png');
    expect((await get(`/notebooks/${nb.id}/tldr.png?theme=dark`)).headers.location).toBe(`/notebooks/${nb.id}/tldr.html?theme=dark`);
    expect((await get('/notebooks/nope/tldr.png')).status).toBe(404);
    // Redrawn: the notebook's kept spec decides the picture and its width; ?standard=1 is the standard one; a spec by address tries one without keeping it.
    const kept: Array<{ html: string; opts: { width?: number } }> = [];
    S.ctx!.notebookPng = async (html, opts) => { kept.push({ html, opts }); return { available: true, data: Buffer.from('PNG') }; };
    store.setTldr(nb.id, { size: 'landscape', tone: 'editorial', layout: 'split', headline: 'A headline written for it' });
    S.ctx!.tldrPngs?.clear(); // the pictures made above are in memory; make these afresh
    await get(`/notebooks/${nb.id}/tldr.png`);
    expect(kept[0].opts.width).toBe(1200);
    expect(kept[0].html).toContain('<article class="tl tl--landscape tl--editorial tl--split"');
    expect(kept[0].html).toContain('<h1 class="tl__title">A headline written for it</h1>');
    await get(`/notebooks/${nb.id}/tldr.png?standard=1`);
    expect(kept[1].opts.width).toBe(1080);
    expect(kept[1].html).toContain('<article class="tl" aria-label');
    await get(`/notebooks/${nb.id}/tldr.png?size=square&tone=bold&layout=hero`);
    expect(kept[2].opts.width).toBe(1080);
    // The same picture again is served from memory (a page that leads with it asks often), and with ?v= a browser may keep it.
    const again = await get(`/notebooks/${nb.id}/tldr.png?size=square&tone=bold&layout=hero&v=abc`);
    expect(kept).toHaveLength(3);
    expect(again.headers['cache-control']).toBe('private, max-age=300');
    expect((await get(`/notebooks/${nb.id}/tldr.png`)).headers['cache-control']).toBe('private, no-store');
    expect(kept[2].html).toContain('<article class="tl tl--square tl--bold tl--hero"');
    expect(store.get(nb.id)!.tldr).toMatchObject({ size: 'landscape' });
    expect((await get(`/notebooks/${nb.id}/tldr.html?size=portrait`)).text).toContain('tl--portrait');
    S.ctx!.notebookPng = async () => ({ available: false, reason: 'no browser' });
    expect((await get(`/notebooks/${nb.id}/tldr.png?size=square&download=1`)).headers.location).toBe(`/notebooks/${nb.id}/tldr.html?size=square`);
    store.setTldr(nb.id, null);
    expect(menu).toContain(`href="/notebooks/${nb.id}/tldr.png?download=1" download`);
    // The brief carries the picture's bars after its "where it stands" paragraph.
    const withCard = (await get(`/notebooks/${nb.id}/brief.html`)).text;
    expect(withCard).toContain('<figure class="tl tl--chart"');
    expect(withCard).toContain('<p class="stands">');
    expect((await get(`/notebooks/${nb.id}/brief.html?latest=1`)).text).not.toContain('<figure class="tl');
    // Set to Always, the whole card leads the shortlist's brief ("In short"), drawn as redrawn; its bars aren't repeated below.
    const { renderNotebookBrief: shortlistBrief } = await import('../views/notebook-brief.js');
    const always = shortlistBrief({ nb: { ...store.get(nb.id)!, tldrCard: 'always', tldr: { size: 'landscape', tone: 'editorial', layout: 'split', parts: ['lead', 'stats', 'bars'], headline: 'A headline written for it' } }, entries: store.entries(nb.id) });
    expect(always).toMatch(/<section class="in-short" aria-labelledby="b-short"><h2 [^>]*id="b-short">In short<\/h2><article class="tl tl--landscape tl--editorial tl--split"/);
    expect(always).toContain('A headline written for it');
    expect(always).not.toContain('<figure class="tl tl--chart"');
    expect(always.indexOf('id="b-short"')).toBeLessThan(always.indexOf('<p class="stands">'));
    expect(shortlistBrief({ nb: { ...store.get(nb.id)!, tldrCard: 'always' }, entries: store.entries(nb.id), latest: true })).not.toContain('In short');
    expect((await get(`/notebooks/${nb.id}/brief.html?download=1`)).headers['content-disposition']).toContain(`${nb.id}-brief.html`);
    expect((await get(`/notebooks/${nb.id}`)).text).toContain(`href="/notebooks/${nb.id}/brief.html"`);
    const csv = (await get(`/notebooks/${nb.id}/shortlist.csv?rows=running`)).text.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
    expect(csv[0]).toMatch(/^Rank,Option,Stage,Own page,Found on,Price,Miles \(mi\),Listing URL,/);
    expect(csv.find((l) => l.includes('2010 Subaru'))).toContain(',https://www.craigslist.org/view/d/lynnwood-2010-subaru-forester/BDo6,,');
    expect(csv.find((l) => l.includes('2009 Forester'))).toContain(',,https://www.cargurus.com/Cars/l-Used-Subaru-Forester-c1,');
    const { renderNotebookBrief } = await import('../views/notebook-brief.js');
    const frag = renderNotebookBrief({ nb: store.get(nb.id)!, entries: store.entries(nb.id) , fragment: true });
    expect(frag.startsWith('<title>')).toBe(true);
    expect(frag).not.toContain('<html');
  });
});

describe('a brief with pictures', () => {
  it('shows each option’s picture by its name and atop it in full; a saved file carries them inside', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Find a controller job', statement: 'A controller role, remote' });
    store.setFields(nb.id, [{ key: 'salary', label: 'Salary', type: 'money', role: 'price' }, { key: 'company', label: 'Company', type: 'text', role: 'org' }]);
    const logo = store.upsertOption(nb.id, { title: 'Controller, Acme Pay', by: 'x', fingerprint: 'a', data: { salary: 190000, company: 'Acme Pay' } }).entry;
    const drawn = store.upsertOption(nb.id, { title: 'Controller, Birch Labs', by: 'x', fingerprint: 'b', data: { salary: 180000, company: 'Birch Labs' } }).entry;
    const bare = store.upsertOption(nb.id, { title: 'Controller, Cedar Co', by: 'x', fingerprint: 'c', data: { salary: 170000, company: 'Cedar Co' } }).entry;
    const word = store.upsertOption(nb.id, { title: 'Controller, Dune Inc', by: 'x', fingerprint: 'd', data: { salary: 160000, company: 'Dune Inc' } }).entry;
    const WIDE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0xf4, 0, 0, 0, 0x91]);
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 180, 0, 0, 0, 180]);
    store.savePhoto(nb.id, logo.id, 'https://acmepay.example/apple-touch-icon.png', { contentType: 'image/png', bytes: PNG }, { kind: 'logo', what: 'acmepay.example logo' });
    store.savePhoto(nb.id, word.id, 'https://dune.example/wordmark.png', { contentType: 'image/png', bytes: WIDE }, { kind: 'logo', what: 'dune.example logo' });
    store.savePhoto(nb.id, drawn.id, 'illustration', { contentType: 'image/svg+xml', bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>') }, { kind: 'illustration' });
    const photoPath = (id: string) => `/notebooks/${nb.id}/entries/${id}/photo`;
    const t = (await get(`/notebooks/${nb.id}/brief.html`)).text;
    // Opened on the dashboard: from its own addresses; a row with none keeps the names lined up.
    expect(t).toContain(`<span class="pic pic--thumb is-tile is-logo"><img src="${photoPath(logo.id)}" alt=""></span>`);
    expect(t).toContain(`<span class="pic pic--thumb is-tile"><img src="${photoPath(drawn.id)}" alt=""></span>`);
    expect(t).toContain('<span class="pic pic--thumb is-empty" aria-hidden="true"></span>');
    // A picture can change at the same address: the browser asks again and gets a 304 while it hasn't.
    const first = await get(photoPath(logo.id));
    expect(first.headers['cache-control']).toBe('private, no-cache');
    expect((await get(photoPath(logo.id)).set('If-None-Match', first.headers.etag)).status).toBe(304);
    store.savePhoto(nb.id, logo.id, 'https://acmepay.example/new.png', { contentType: 'image/png', bytes: PNG }, { kind: 'logo' });
    expect((await get(photoPath(logo.id)).set('If-None-Match', first.headers.etag)).status).toBe(200);
    // A wordmark (500×145) is marked wide, so it fills the thumbnail's width.
    expect(t).toContain(`<span class="pic pic--thumb is-tile is-logo is-wide"><img src="${photoPath(word.id)}" alt=""></span>`);
    expect(t).not.toContain(photoPath(bare.id));
    const full = (await get(`/notebooks/${nb.id}/brief.html?full=1`)).text;
    expect(full).toContain(`<span class="pic pic--hero is-tile is-logo"><img src="${photoPath(logo.id)}" alt=""></span>`);
    // A drawing says so; a logo needs no word.
    expect(full).toContain(`<img src="${photoPath(drawn.id)}" alt=""><span class="pic__kind">illustration</span>`);
    // Saved as a file: the pictures go inside it (the dashboard's addresses need you signed in).
    const saved = (await get(`/notebooks/${nb.id}/brief.html?full=1&download=1`)).text;
    expect(saved).not.toContain('/photo"');
    expect(saved).toContain(`<img src="data:image/png;base64,${Buffer.from(PNG).toString('base64')}" alt="">`);
    expect(saved).toMatch(/<img src="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+" alt="">/);
    // Logos show whole on a tile on the option's own page too, with no "example photo" word.
    const page = (await get(`/notebooks/${nb.id}/entries/${logo.id}`)).text;
    expect(page).toContain(`<img src="${photoPath(logo.id)}" alt="" class="is-drawn is-logo">`);
    expect(page).not.toContain('example photo');
    expect((await get(`/notebooks/${nb.id}/entries/${word.id}`)).text).toContain(`<img src="${photoPath(word.id)}" alt="" class="is-drawn is-logo is-wide">`);
  });
});

describe('a brief as a summary of findings', () => {
  it('says what was found: pay span with ranges, what is missing, how they split, why the rest were ruled out; a decision once, as a list', async () => {
    await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { renderNotebookBrief } = await import('../views/notebook-brief.js');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Director of accounting job', statement: 'Austin or remote', params: ['$180k minimum'] });
    store.setFields(nb.id, [
      { key: 'salary', label: 'Salary', type: 'money', role: 'price', better: 'higher', range: true },
      { key: 'company', label: 'Company', type: 'text', role: 'org' },
      { key: 'remote', label: 'Remote', type: 'text' },
    ]);
    const a = store.upsertOption(nb.id, { title: 'Controller, Acme: remote', by: 'x', fingerprint: 'a', data: { salary: { min: 180000, max: 220000 }, company: 'Acme', remote: 'Remote' }, body: 'Leads a team of 6 across tax and accounting. More detail here.' }).entry;
    const b = store.upsertOption(nb.id, { title: 'Director of Accounting, Hooli', by: 'x', fingerprint: 'b', data: { salary: { min: 145000, max: 300000 }, company: 'Hooli', remote: 'Remote' } }).entry;
    store.upsertOption(nb.id, { title: 'Controller, Initech', by: 'x', fingerprint: 'c', data: { company: 'Initech', remote: 'On-site' } });
    for (const [i, why] of ['Unfit: pays $150k–$160k, under the floor', 'Unfit: not director level', 'Posting closed: page not found'].entries()) {
      const e = store.upsertOption(nb.id, { title: `Old role ${String(i)}`, by: 'x', fingerprint: `o${String(i)}` }).entry;
      store.ruleOut(nb.id, e.id, why, 'you');
    }
    store.addEntry(nb.id, { kind: 'note', title: 'Ashby pages need a browser to load', by: 'agent:x' });
    store.addEntry(nb.id, { kind: 'note', title: 'Searched 4 places at once: Greenhouse (1), Lever (0).', by: 'agent:notebook-finder' });
    let t = renderNotebookBrief({ nb: store.get(nb.id)!, entries: store.entries(nb.id, 1000), fragment: true });
    expect(t).toContain('<strong>6 options looked at</strong>: 3 in the running, 3 ruled out.');
    expect(t).toContain('Salary in the running: <span class="num">$145,000–$300,000</span>; 1 doesn&#39;t list it.');
    expect(t).toContain('Remote: 2 Remote, 1 On-site.');
    expect(t).toContain('Most often ruled out for: unfit (2).');
    expect(t).toContain('Leads a team of 6 across tax and accounting.');
    expect(t).not.toContain('More detail here');
    expect(t).toContain('Ashby pages need a browser to load');
    expect(t).not.toContain('Searched 4 places at once');
    expect(t).toContain('<strong>Old role 2</strong> <span class="why">· Posting closed: page not found</span>');

    // Decided: the decision once, its picks as a list; no "Decided: N chosen" box besides.
    store.decide(nb.id, 'Both lead a team.', 'you', [a.id, b.id]);
    t = renderNotebookBrief({ nb: store.get(nb.id)!, entries: store.entries(nb.id, 1000), fragment: true });
    expect(t).toContain('<section class="decision" aria-label="Decision">');
    expect(t).toContain('· 2 chosen of 3 in the running');
    expect(t).toContain('<p>Both lead a team.</p>');
    expect(t).not.toContain('class="stands"');
    expect(t).toContain('The final set, and the rest in the running');
  });
});

describe('notebook templates', () => {
  it('save a notebook’s setup from Edit, list it on New notebook, and remove it', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const post = (path: string, body: string) => request(app).post(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const nb = store.create({ title: 'Find a controller job', statement: 'Austin or remote', params: ['Remote or Austin, TX'] });
    store.setFields(nb.id, [{ key: 'salary', label: 'Salary', type: 'money', role: 'price' }]);
    store.setSteps(nb.id, [{ title: 'Find 5 roles', kind: 'find', target: 5 }, { title: 'Pick one', kind: 'decide', target: 1 }]);
    store.archive(nb.id);

    // Edit has it (an archived notebook too).
    expect((await get(`/notebooks/${nb.id}/edit`)).text).toContain(`href="/notebooks/${nb.id}/template"`);
    const saved = await post(`/notebooks/${nb.id}/template`, 'name=Job+search');
    expect(saved.status).toBe(303);
    expect(decodeURIComponent(saved.headers.location)).toContain('Saved as the template “Job search” (1 field · 2 steps · 1 limit).');
    expect(store.getTemplate('job-search')).toMatchObject({ name: 'Job search', fromNotebook: nb.id });

    const page = (await get('/notebooks/new')).text;
    expect(page).toContain('Or start from one of your templates');
    expect(page).toContain('<span class="nbd-tpl__name">Job search</span>');
    // A row says what it's for (its steps, with no statement), Start is the one button, and Archive and Delete are under ⋯.
    const row = page.slice(page.indexOf('<li class="nbd-tpl__item">'), page.indexOf('</li>', page.indexOf('<li class="nbd-tpl__item">')));
    expect(row).toMatch(/class="nbd-tpl__what"[^>]*>[^<]+</);
    expect(row).toContain('>Start →</button>');
    expect(row).not.toContain('btn--primary');
    expect(row).toMatch(/<details class="nbd-tpl__more">[\s\S]*Archive[\s\S]*Delete…/);
    expect(page).toContain('value="Start a new notebook from my “Job search” template."');

    // Archive: off the list and away from sua, in a folded Archived list; restore brings it back.
    const archived = await post('/notebooks/templates/job-search/archive', 'archived=1');
    expect(decodeURIComponent(archived.headers.location)).toContain('Archived the template “Job search”.');
    let newPage = (await get('/notebooks/new')).text;
    expect(newPage).not.toContain('Or start from one of your templates');
    expect(newPage).toContain('Archived templates <span class="nbd-tpl__n">1</span>');
    expect(newPage).not.toContain('value="Start a new notebook from my “Job search” template."');
    const { getContext } = await import('../context.js');
    const { executeNotebookCreate } = await import('./inbox-engine.js');
    expect(executeNotebookCreate(getContext(app.locals), { kind: 'action', status: 'proposed', agentId: 'notebook-create', inputs: { TEMPLATE: 'job-search', TITLE: 'x' } }))
      .toMatchObject({ status: 'failed', refusalReason: 'The template "Job search" is archived. Restore it from New notebook → Archived templates first.' });
    await post('/notebooks/templates/job-search/archive', 'archived=0');
    newPage = (await get('/notebooks/new')).text;
    expect(newPage).toContain('Or start from one of your templates');
    expect(newPage).not.toContain('Archived templates');

    const gone = await post('/notebooks/templates/job-search/delete', '');
    expect(decodeURIComponent(gone.headers.location)).toContain('Template removed.');
    expect(store.getTemplate('job-search')).toBeUndefined();
    expect((await get('/notebooks/new')).text).not.toContain('nbd-tpl__name');
  });

  it('sua proposes a notebook from a template after asking: a card that previews it, and approving creates it empty with the setup', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const { withEditorBase, executeNotebookCreate } = await import('./inbox-engine.js');
    const { parseProposedActions } = await import('./inbox-plan.js');
    const ctx = getContext(app.locals);
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const seed = store.create({ title: 'Find a controller job', statement: 'Controller roles, Austin or remote', params: ['Remote or Austin, TX', '$180k minimum comp'], criteria: ['At least five open roles that fit', 'A decision recorded'] });
    store.setFields(seed.id, [{ key: 'salary', label: 'Salary', type: 'money', role: 'price', range: true }, { key: 'posting_url', label: 'Posting', type: 'url', role: 'link' }]);
    store.setChecks(seed.id, ['Pays at least $180k']);
    store.setStages(seed.id, ['Found', 'Applied']);
    store.setSteps(seed.id, [{ title: 'Find 5 roles', kind: 'find', target: 5, status: 'done' }, { title: 'Source pay', kind: 'source', agentId: 'gone-agent' }, { title: 'Pick one', kind: 'decide', target: 1 }]);
    store.upsertOption(seed.id, { title: 'Controller, Acme', by: 'you', data: {} });
    const page = [{ id: 'root', component: 'Column', children: ['t'] }, { id: 't', component: 'Timeline', events: { path: '/notebook/timeline' } }];
    store.setLayout(seed.id, { components: page });
    store.saveTemplate('Job search', seed.id);

    const params = ['Remote or Denver, CO', '$180k minimum comp'];
    const { accepted } = parseProposedActions([{ type: 'notebook-create', rationale: 'A Denver job search', inputs: { TEMPLATE: 'job-search', TITLE: 'Find a controller job in Denver', STATEMENT: 'Controller roles, Denver or remote', PARAMS: params, CHECKS: ['Pays at least $180k', 'Remote or based in Denver, CO'], TARGET: 8 } }], [], []);
    expect(accepted[0]).toMatchObject({ agentId: 'notebook-create', status: 'proposed', ctaLabel: 'Create notebook', inputs: { TEMPLATE: 'job-search', PARAMS: JSON.stringify(params), TARGET: '8' } });
    expect(parseProposedActions([{ type: 'notebook-create', inputs: { TEMPLATE: 'job-search' } }], [], []).rejected[0].reason).toBe('notebook-create needs inputs.TEMPLATE (a template id) or inputs.LIKE (a notebook id), and inputs.TITLE');

    // The preview: the template, the title, the limits as they change, the done-whens and steps.
    const card = withEditorBase(ctx, accepted[0]);
    expect(card.inputs.TEMPLATE_NAME).toBe('Job search');
    expect(card.surfaceChanges).toEqual([
      { what: 'template', before: '—', after: 'Job search (2 fields · 3 steps · 1 check · 2 limits)' },
      { what: 'title', before: '—', after: 'Find a controller job in Denver' },
      { what: "what it's for", before: 'Controller roles, Austin or remote', after: 'Controller roles, Denver or remote' },
      { what: 'limits', before: 'Remote or Austin, TX; $180k minimum comp', after: 'Remote or Denver, CO; $180k minimum comp' },
      { what: 'done when', before: '—', after: 'At least five open roles that fit; A decision recorded' },
      { what: 'checks', before: 'Pays at least $180k', after: 'Pays at least $180k; Remote or based in Denver, CO' },
      { what: 'steps', before: '—', after: '1. Find 5 roles; 2. Source pay; 3. Pick one' },
    ]);

    const done = executeNotebookCreate(ctx, card);
    expect(done.status).toBe('completed');
    const made = store.list().find((n) => n.title === 'Find a controller job in Denver')!;
    expect(done.summary).toBe(`Created [Find a controller job in Denver](/notebooks/${made.id}) from your Job search template (2 fields · 3 steps · 1 check · 2 limits). It starts empty; its first step is **Find 5 roles**: press Next step on the notebook when you're ready.`);
    expect(made).toMatchObject({ statement: 'Controller roles, Denver or remote', params, checks: ['Pays at least $180k', 'Remote or based in Denver, CO'], stages: ['Found', 'Applied'] });
    expect(made.criteria.map((c) => `${c.text}:${String(c.met)}`)).toEqual(['At least five open roles that fit:false', 'A decision recorded:false']);
    expect(made.fields.map((f) => f.key)).toEqual(['salary', 'posting_url']);
    // Its page is laid out like the template's.
    expect(made.layout).toEqual({ components: page });
    // Steps fresh; the find step wants 8; an agent that's gone is dropped (the step needs one again).
    expect(made.steps!.map((x) => `${x.title}:${x.status}:${x.agentId ?? ''}:${String(x.target ?? '')}`)).toEqual(['Find 5 roles:todo::8', 'Source pay:todo::', 'Pick one:todo::1']);
    expect(store.entries(made.id).filter((e) => e.kind === 'option')).toHaveLength(0);
    expect(store.getTemplate('job-search')!.uses).toBe(1);

    expect(executeNotebookCreate(ctx, { ...card, inputs: { ...card.inputs, TEMPLATE: 'nope' } })).toMatchObject({ status: 'failed', refusalReason: 'There\'s no template "nope". Save a notebook as a template from its Edit panel first.' });
  });

  it('a template for meeting prep: save it with what changes each time, then start one for someone else', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const { withEditorBase, executeNotebookCreate } = await import('./inbox-engine.js');
    const ctx = getContext(app.locals);
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const post = (path: string, body: Record<string, string>) => request(app).post(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const nb = store.create({ title: 'Prepare for meeting with Dana Reyes', statement: 'Help me understand what matters to Dana Reyes before we meet.', params: ['Dana Reyes', 'upcoming meeting', 'focus on what matters to her'], criteria: ['Talking points chosen for the meeting'] });
    store.setFields(nb.id, [{ key: 'theme', label: 'Theme', type: 'text' }, { key: 'source_url', label: 'Source', type: 'url', role: 'link' }]);
    store.setChecks(nb.id, ['Evidence relates to Dana Reyes, not someone with a similar name']);
    store.setSteps(nb.id, [{ title: 'Find 5 conversation themes', kind: 'find', target: 5 }, { title: 'Choose talking points', kind: 'decide', target: 3 }]);

    // The review page: its name without who, who prefilled, and the texts say {subject}.
    const page = (await get(`/notebooks/${nb.id}/template`)).text;
    expect(page).toContain('name="name" value="Prepare for meeting"');
    expect(page).toContain('name="subject_example" value="Dana Reyes"');
    expect(page).toContain('Help me understand what matters to {subject} before we meet.');
    expect(page).toContain('Evidence relates to {subject}, not someone with a similar name');
    expect(page).toContain('name="field_theme" value="Theme"');
    expect((await get('/notebooks/nope/template')).status).toBe(303);

    const saved = await post(`/notebooks/${nb.id}/template`, {
      review: '1', name: 'Prepare for a meeting', subject_label: 'Who you’re meeting (a person or company)', subject_example: 'Dana Reyes',
      statement: 'Help me understand what matters to {subject} before we meet.',
      params: '{subject}\nupcoming meeting\nfocus on what matters to them', criteria: 'Talking points chosen for the meeting',
      checks: 'Evidence relates to Dana Reyes, not someone with a similar name', step_s1: 'Find 5 conversation themes', step_s2: 'Choose talking points',
      field_theme: 'What matters to {subject}',
    });
    expect(decodeURIComponent(saved.headers.location)).toContain('Saved as the template “Prepare for a meeting”');
    const t = store.getTemplate('prepare-for-a-meeting')!;
    expect(t.setup).toMatchObject({
      subject: { label: 'Who you’re meeting (a person or company)', example: 'Dana Reyes' },
      // A limit that's only the subject says nothing; it's dropped.
      params: ['upcoming meeting', 'focus on what matters to them'],
      checks: ['Evidence relates to {subject}, not someone with a similar name'],
    });
    expect(t.setup.fields.map((f) => f.label)).toEqual(['What matters to {subject}', 'Source']);

    // New notebook asks who, beside Start.
    const newPage = (await get('/notebooks/new')).text;
    expect(newPage).toContain('data-nbt-start="Start a new notebook from my “Prepare for a meeting” template for "');
    expect(newPage).toContain('placeholder="Who you’re meeting (a person or company)"');

    // Starting one needs who; with it, every text names them.
    const base = { kind: 'action' as const, status: 'proposed' as const, agentId: 'notebook-create', inputs: { TEMPLATE: 'prepare-for-a-meeting', TITLE: 'Prepare for meeting with {subject}' } };
    expect(executeNotebookCreate(ctx, base)).toMatchObject({ status: 'failed', refusalReason: 'The template "Prepare for a meeting" needs to know who you’re meeting (a person or company) (SUBJECT).' });
    const card = withEditorBase(ctx, { ...base, inputs: { ...base.inputs, SUBJECT: 'Acme Corp' } });
    expect(card.surfaceChanges).toContainEqual({ what: 'Who you’re meeting (a person or company)', before: '—', after: 'Acme Corp' });
    expect(card.surfaceChanges).toContainEqual({ what: 'title', before: '—', after: 'Prepare for meeting with Acme Corp' });
    expect(executeNotebookCreate(ctx, card).status).toBe('completed');
    const made = store.list().find((n) => n.title === 'Prepare for meeting with Acme Corp')!;
    expect(made.fields.map((f) => f.label)).toEqual(['What matters to Acme Corp', 'Source']);
    expect(made).toMatchObject({ statement: 'Help me understand what matters to Acme Corp before we meet.', params: ['upcoming meeting', 'focus on what matters to them'], checks: ['Evidence relates to Acme Corp, not someone with a similar name'] });

    // A profile step's subject changes each time too: kept as {subject}, filled in when one starts (not the title).
    const co = store.create({ title: 'Create a briefing on Arrive', statement: 'Create a company briefing for Arrive.' });
    store.setSteps(co.id, [{ title: 'Learn about Arrive', kind: 'profile', subject: 'Arrive' }, { title: 'Write the company briefing', kind: 'write', shape: 'answer' }]);
    const ct = store.saveTemplate('Company briefing', co.id, undefined, { subject: { label: 'The company', example: 'Arrive' } });
    expect(ct.setup.steps.map((x) => [x.title, x.subject, x.shape])).toEqual([['Learn about {subject}', '{subject}', undefined], ['Write the company briefing', undefined, 'answer']]);
    expect(executeNotebookCreate(ctx, { ...base, inputs: { TEMPLATE: 'company-briefing', TITLE: 'Create a briefing on {subject}', SUBJECT: 'Ramp' } }).status).toBe('completed');
    expect(store.list().find((n) => n.title === 'Create a briefing on Ramp')!.steps?.[0]).toMatchObject({ title: 'Learn about Ramp', kind: 'profile', subject: 'Ramp' });

    // Its page's words name the subject too: kept as {subject}, filled in (a template saved before that still names Arrive).
    const { layoutPreset } = await import('@some-useful-agents/core');
    const coPage = { ...layoutPreset('company')!.layout, about: 'a company briefing: who Arrive is and what it offers' };
    store.setLayout(co.id, coPage);
    const withPage = store.saveTemplate('Company briefing', co.id, undefined, { subject: { label: 'The company', example: 'Arrive' } });
    expect(withPage.setup.layout?.about).toBe('a company briefing: who {subject} is and what it offers');
    expect(executeNotebookCreate(ctx, { ...base, inputs: { TEMPLATE: 'company-briefing', TITLE: 'Brief Hex', SUBJECT: 'Hex' } }).status).toBe('completed');
    expect(store.list().find((n) => n.title === 'Brief Hex')!.layout?.about).toBe('a company briefing: who Hex is and what it offers');
    // One saved before: Arrive still in its page.
    const db = S.runStore.databaseHandle();
    db.prepare('UPDATE notebook_templates SET setup_json = ? WHERE id = ?').run(JSON.stringify({ ...withPage.setup, layout: coPage }), 'company-briefing');
    expect(executeNotebookCreate(ctx, { ...base, inputs: { TEMPLATE: 'company-briefing', TITLE: 'Brief Pipe', SUBJECT: 'Pipe' } }).status).toBe('completed');
    expect(store.list().find((n) => n.title === 'Brief Pipe')!.layout?.about).toBe('a company briefing: who Pipe is and what it offers');

    // What it asks you for: what a notebook was given becomes asks (labels, never the text); a new one shows a box for each.
    const dana = store.create({ title: 'Prepare for a meeting with Dana Reyes', statement: 'Prepare me to meet Dana Reyes.' });
    store.addGiven(dana.id, { label: 'Dana Reyes\'s LinkedIn profile', text: 'Dana ran operations at two logistics firms before this one.' });
    store.addGiven(dana.id, { label: 'the agenda', why: 'Points are matched to it.' });
    const mt = store.saveTemplate('Meeting asks', dana.id, undefined, { subject: { label: 'Who', example: 'Dana Reyes' } });
    expect(mt.setup.asks).toEqual([{ label: '{subject}\'s LinkedIn profile', optional: true }, { label: 'the agenda', why: 'Points are matched to it.' }]);
    expect(JSON.stringify(mt.setup)).not.toContain('logistics');
    expect(mt.description).toContain('asks for 2');
    expect(executeNotebookCreate(ctx, { ...base, inputs: { TEMPLATE: 'meeting-asks', TITLE: 'Meet Lee', SUBJECT: 'Lee Park' } }).status).toBe('completed');
    const lee = store.list().find((n) => n.title === 'Meet Lee')!;
    expect(lee.given).toMatchObject([{ label: 'Lee Park\'s LinkedIn profile', state: 'missing', optional: true }, { label: 'the agenda', state: 'missing' }]);
    const leePage = (await request(app).get(`/notebooks/${lee.id}`).set('Cookie', COOKIE).set('Host', `127.0.0.1:${String(PORT)}`)).text;
    // What it could use is a line in the header's add row; what it needs is a card above the title.
    expect(leePage).toContain('<summary>If you have Lee Park&#39;s LinkedIn profile</summary>');
    expect(leePage).toContain('sua needs the agenda.');
    expect(leePage.indexOf('sua needs the agenda.')).toBeLessThan(leePage.indexOf('id="nb-title"'));
    expect(leePage.indexOf('If you have Lee Park')).toBeGreaterThan(leePage.indexOf('id="nb-title"'));
    // Edited: the asks as given replace them; none asks for nothing. sua's card takes labels (wanted) or {label, optional}.
    expect(store.saveTemplate('Meeting asks', dana.id, undefined, { asks: [] }).setup.asks).toBeUndefined();
    const { templateEditsFromInputs } = await import('../lib/notebook-template-action.js');
    expect(templateEditsFromInputs({ ASKS: '["Their résumé", {"label": "The job description"}]' }).asks).toEqual([{ label: 'Their résumé', optional: true }, { label: 'The job description' }]);
    const { templateEditsFrom } = await import('../views/notebook-template.js');
    expect(templateEditsFrom({ asks_wait: 'Your résumé', asks_optional: 'Their profile\n' }, dana).asks).toEqual([{ label: 'Your résumé' }, { label: 'Their profile', optional: true }]);
  });
});

describe('a notebook\'s page, drawn by sua', () => {
  it('sua proposes a page; the card previews it, applying draws it, a stale card refuses, and Edit undoes it', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const { withEditorBase } = await import('./inbox-engine.js');
    const { executeNotebookLayout } = await import('../lib/notebook-layout-action.js');
    const { parseProposedActions } = await import('./inbox-plan.js');
    const ctx = getContext(app.locals);
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Prepare for meeting with Dana Reyes', statement: 'What matters to Dana Reyes' });
    const page = [
      { id: 'root', component: 'Column', children: ['who', 'time'] },
      { id: 'who', component: 'Callout', label: 'Who they are', text: { path: '/notebook/statement' } },
      { id: 'time', component: 'Timeline', events: { path: '/notebook/timeline' } },
    ];
    const { accepted, rejected } = parseProposedActions([
      { type: 'notebook-layout', rationale: 'A briefing, not a shortlist', inputs: { NOTEBOOK: nb.id, COMPONENTS: page } },
      { type: 'notebook-layout', inputs: { NOTEBOOK: nb.id, COMPONENTS: [{ id: 'root', component: 'Column', children: ['x'] }, { id: 'x', component: 'Nope' }] } },
      { type: 'notebook-layout', inputs: { NOTEBOOK: nb.id } },
    ], [], []);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ agentId: 'notebook-layout', ctaLabel: 'Change the page', inputs: { NOTEBOOK: nb.id, COMPONENTS: JSON.stringify(page) } });
    expect(rejected.map((r) => r.reason)).toEqual([
      expect.stringContaining("notebook-layout COMPONENTS can't be drawn"),
      'notebook-layout needs inputs.NOTEBOOK and one of COMPONENTS, PRESET or UNDO "1"',
    ]);

    const card = withEditorBase(ctx, accepted[0]);
    expect(card.inputs.NOTEBOOK_TITLE).toBe(nb.title);
    expect(card.surfaceChanges).toContainEqual({ what: 'top to bottom', before: 'top → mid → shortlist_panel → head_p → writeup_p → rests_p → low → ctx', after: 'who → time' });
    expect(card.surfaceChanges).toContainEqual({ what: 'adds', before: '—', after: 'Callout “Who they are”, Timeline' });

    expect(executeNotebookLayout(ctx, card)).toMatchObject({ status: 'completed' });
    expect(store.get(nb.id)!.layout).toEqual({ components: page });
    // Drawn even with no fields or options yet: it shows what the notebook has.
    const html = (await request(app).get(`/notebooks/${nb.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;
    expect(html).toContain('Who they are');
    expect(html).not.toContain('"OptionGrid"');
    // The same card again is against a page that changed: refused.
    expect(executeNotebookLayout(ctx, card)).toMatchObject({ status: 'failed', refusalReason: expect.stringContaining('changed since this was proposed') });

    // Edit: what the page is, undo, back to the shortlist.
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const post = (path: string, body: string) => request(app).post(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const edit = (await get(`/notebooks/${nb.id}/edit?tab=looks`)).text;
    expect(edit).toMatch(/aria-label="Made for this notebook, how it looks">[\s\S]*?<span class="look-card__badge">Now<\/span>/);
    expect(edit).toContain('Undo the last saved change to how it looks');
    const undone = await post(`/notebooks/${nb.id}/layout`, 'undo=1');
    expect(decodeURIComponent(undone.headers.location)).toContain('Put the page back how it was before the last change.');
    expect(store.get(nb.id)!.layout).toBeUndefined();
    store.setLayout(nb.id, { components: page });
    store.setLayout(nb.id, null, 'you');
    expect((await get(`/notebooks/${nb.id}/edit?tab=looks`)).text).toContain('aria-label="Shortlist, how it looks"');
  });
});
