import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { join } from 'node:path';
import { InboxStore } from '@some-useful-agents/core';
import { S, makeApp, COOKIE, PORT } from './notebooks.test-kit.js';

describe('notebook steps: one queue for the header and the conversation (ADR-0055)', () => {
  async function setup(steps: unknown[]) {
    const app = await makeApp();
    const post = (path: string, body: Record<string, string> = {}) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    // One new company a run; and one that only ever finds the same company.
    const counter = join(S.dir, 'n');
    S.agentStore.createAgent({ id: 'finder', name: 'Finder', status: 'active', source: 'local', mcp: false, nodes: [{ id: 'n', type: 'shell', command: `n=$(cat ${counter} 2>/dev/null || echo 0); n=$((n+1)); echo $n > ${counter}; echo '<notebook>{"entries":[{"kind":"option","title":"Company '$n'"}]}</notebook>'` }] } as never, 'cli');
    S.agentStore.createAgent({ id: 'samey', name: 'Samey', status: 'active', source: 'local', mcp: false, nodes: [{ id: 'n', type: 'shell', command: `echo '<notebook>{"entries":[{"kind":"option","title":"Company 1"}]}</notebook>'` }] } as never, 'cli');
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const ctx = getContext(app.locals as never);
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const inbox = InboxStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Peers' });
    store.setSteps(nb.id, steps);
    const threadId = inbox.add({ priority: 'medium', source: 'manual', title: 'Notebook: Peers', body: '(empty)' }).id;
    store.setConversation(nb.id, threadId);
    // Until the step's run is over and its lock let go (its card comes after).
    const settle = async () => { for (let i = 0; i < 400 && ((store.get(nb.id)!.steps ?? []).some((x) => x.status === 'running') || ctx.notebookPipelines?.has(nb.id)); i++) await new Promise((r) => setTimeout(r, 25)); };
    const cards = () => inbox.listResponses(threadId).filter((r) => r.role === 'action').map((r) => JSON.parse(r.metaJson!) as Record<string, any>);
    const waiting = () => cards().filter((m) => m.status === 'proposed');
    const page = async () => (await request(app).get(`/notebooks/${nb.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;
    return { app, post, ctx, store, inbox, nb, threadId, settle, cards, waiting, page };
  }

  it('a header press uses the card waiting in the conversation; each pause leaves one card, and stale ones go with why', async () => {
    const t = await setup([
      { title: 'Find 1 company', kind: 'find', agentId: 'finder', target: 1 },
      { title: 'Find 5 companies', kind: 'find', agentId: 'samey', target: 5 },
      { title: 'Pick the final set', kind: 'decide', target: 1 },
    ]);
    // Opening the notebook gives the current step its card, once.
    await t.page();
    await t.page();
    expect(t.waiting()).toEqual([expect.objectContaining({ ctaLabel: 'Start', inputs: { NOTEBOOK: t.nb.id, STEP: 's1', WAS: 'todo' } })]);

    // Next step on the header: that card is used (you, from the notebook), with what it did.
    const flash = decodeURIComponent((await t.post(`/notebooks/${t.nb.id}/run`)).headers.location);
    expect(flash).toContain('Working on Find 1 company');
    expect(flash).not.toContain('**');
    expect(t.cards()[0]).toMatchObject({ status: 'completed', approvedBy: 'operator', from: 'notebook', resultSummary: expect.stringContaining('Working on **Find 1 company**') });
    await t.settle();
    // Met: one Continue waits.
    expect(t.waiting()).toEqual([expect.objectContaining({ ctaLabel: 'Continue', inputs: { NOTEBOOK: t.nb.id, STEP: 's1', WAS: 'met' } })]);

    // Continue from the header: step 2 can't get far (the same company each run), so it's stuck.
    await t.post(`/notebooks/${t.nb.id}/run`);
    await t.settle();
    expect(t.store.get(t.nb.id)!.steps![1]).toMatchObject({ status: 'stuck', stalled: true });
    expect(t.waiting().map((m) => m.ctaLabel)).toEqual(['Move on', 'Try again']);

    // Try again from the header: the round's Move on goes as it starts; stuck again, one new pair waits.
    await t.post(`/notebooks/${t.nb.id}/run`);
    expect(t.cards().filter((m) => m.skippedBy === 'notebook').map((m) => m.skipReason)).toEqual(['The notebook is already working on it.']);
    await t.settle();
    expect(t.waiting().map((m) => m.ctaLabel)).toEqual(['Move on', 'Try again']);
    // Two cards asking the same (sua's and the step's): only the newest stays.
    const { addStepCard: add } = await import('../lib/notebook-steps.js');
    add(t.ctx, t.threadId, { ...t.waiting()[0], status: 'proposed' } as never);
    await t.page();
    expect(t.waiting().map((m) => m.ctaLabel)).toEqual(['Try again', 'Move on']);
    expect(t.cards().filter((m) => m.skippedBy === 'notebook').map((m) => m.skipReason)).toContain('A newer card asks the same.');

    // A card from an earlier step (left from before) is retired when the notebook is opened.
    const { addStepCard } = await import('../lib/notebook-steps.js');
    addStepCard(t.ctx, t.threadId, { kind: 'action', status: 'proposed', agentId: 'notebook-step', effect: 'write', inputs: { NOTEBOOK: t.nb.id, STEP: 's1', WAS: 'met' }, rationale: 'Start step 2.', ctaLabel: 'Continue' });
    await t.page();
    expect(t.cards().at(-1)).toMatchObject({ status: 'skipped', skippedBy: 'notebook', skipReason: 'The notebook has moved on from this.' });

    // Move on from the header: the next step is yours (Decide), so nothing waits in the conversation.
    expect(decodeURIComponent((await t.post(`/notebooks/${t.nb.id}/steps/move-on`, { step: 's2' })).headers.location)).toContain('Moved on from Find 5 companies');
    expect(t.waiting()).toEqual([]);
    expect(t.cards().filter((m) => m.status === 'completed').at(-1)).toMatchObject({ ctaLabel: 'Move on', from: 'notebook' });
  });

  it("a Continue that can't start the next step leaves the step met, and says why in both places", async () => {
    const t = await setup([
      { title: 'Find 1 company', kind: 'find', agentId: 'finder', target: 1 },
      { title: 'Check them', kind: 'check' },
    ]);
    await t.post(`/notebooks/${t.nb.id}/run`);
    await t.settle();
    // The check step has no checks: Continue is refused, and step 1 stays met (it used to be marked done).
    const flash = decodeURIComponent((await t.post(`/notebooks/${t.nb.id}/run`)).headers.location);
    expect(flash).toContain('The notebook has no checks yet.');
    expect(t.store.get(t.nb.id)!.steps!.map((s) => s.status)).toEqual(['met', 'todo']);
    expect(t.cards().at(-1)).toMatchObject({ status: 'failed', ctaLabel: 'Continue', refusalReason: expect.stringContaining('The notebook has no checks yet.') });
    // Opening the page doesn't put the same refused card back each time.
    await t.page();
    expect(t.waiting()).toEqual([]);
  });

  it('the page reloads when the steps move from the conversation: /main carries the key the page started with', async () => {
    const t = await setup([
      { title: 'Find 1 company', kind: 'find', agentId: 'finder', target: 1 },
      { title: 'Pick one', kind: 'decide', target: 1 },
    ]);
    const main = async () => (await request(t.app).get(`/notebooks/${t.nb.id}/main`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).headers['x-notebook-steps'];
    const key = /data-nb-steps="([0-9a-f]+)"/.exec(await t.page())![1];
    expect(await main()).toBe(key);
    // Started from the conversation's card (not the header): the key moves, so the header catches up.
    const { executeNotebookStep } = await import('./inbox-engine.js');
    await executeNotebookStep(t.ctx, t.waiting()[0] as never);
    expect(await main()).not.toBe(key);
    await t.settle();
    expect(/data-nb-steps="([0-9a-f]+)"/.exec(await t.page())![1]).toBe(await main());
  });

  it('a step a restart left running stops short there, with Try again and Move on waiting', async () => {
    const t = await setup([
      { title: 'Find 1 company', kind: 'find', agentId: 'finder', target: 1 },
      { title: 'Pick one', kind: 'decide', target: 1 },
    ]);
    t.store.updateStep(t.nb.id, 's1', { status: 'running' });
    const { reconcileStepsOnBoot } = await import('../lib/notebook-step-queue.js');
    expect(reconcileStepsOnBoot(t.ctx)).toBe(1);
    expect(t.store.get(t.nb.id)!.steps![0]).toMatchObject({ status: 'stuck', note: 'stopped by a restart' });
    expect(t.inbox.listResponses(t.threadId).some((r) => r.body.includes('sua restarted while **Find 1 company** was running'))).toBe(true);
    expect(t.waiting().map((m) => m.ctaLabel)).toEqual(['Try again', 'Move on']);
    // A step that's really running (its lock is held) is left alone.
    t.store.updateStep(t.nb.id, 's1', { status: 'running' });
    t.ctx.notebookPipelines = new Map([[t.nb.id, { agentId: 'finder', step: 1, of: 2, startedAt: Date.now() }]]);
    expect(reconcileStepsOnBoot(t.ctx)).toBe(0);
    t.ctx.notebookPipelines.clear();
  });

  it("sua's step cards are pinned to the step as it is now, and refused while one runs or when one already waits", async () => {
    const t = await setup([
      { title: 'Find 1 company', kind: 'find', agentId: 'finder', target: 1 },
      { title: 'Pick one', kind: 'decide', target: 1 },
    ]);
    const { pinStepAction } = await import('../lib/notebook-step-queue.js');
    const proposed = { kind: 'action' as const, status: 'proposed' as const, agentId: 'notebook-step', effect: 'write' as const, inputs: { NOTEBOOK: t.nb.id } };
    expect(pinStepAction(t.ctx, proposed).action?.inputs).toEqual({ NOTEBOOK: t.nb.id, STEP: 's1', WAS: 'todo' });
    expect(pinStepAction(t.ctx, { ...proposed, inputs: { NOTEBOOK: t.nb.id, STEP: 's2' } }).reason).toContain('only the current step');
    await t.page();
    expect(pinStepAction(t.ctx, proposed).reason).toBe('that step card is already waiting on the operator');
    t.ctx.notebookPipelines = new Map([[t.nb.id, { agentId: 'finder', step: 1, of: 2, startedAt: Date.now() }]]);
    expect(pinStepAction(t.ctx, proposed).reason).toContain('already running');
    t.ctx.notebookPipelines.clear();
  });
});

describe('changing a notebook by saying what to change, or as a document', () => {
  it('shows the change in a preview before anything is saved, then saves it or drops it', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const post = (path: string, body: Record<string, string | string[]>) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.create({ title: 'Prepare for a meeting with Dana Reyes', statement: 'What matters to Dana', criteria: ['Talking points chosen'] });
    s.setFields(nb.id, [{ key: 'theme', label: 'Theme', type: 'text' }, { key: 'evidence', label: 'What she said', type: 'text' }]);
    s.setSteps(nb.id, [{ title: 'Find what Dana has said', kind: 'find', target: 5 }]);
    const waitReady = async () => { for (let i = 0; i < 50; i++) { if ((await get(`/notebooks/${nb.id}/edit/state`)).body.status !== 'working') return; await new Promise((r) => setTimeout(r, 20)); } };

    const first = (await get(`/notebooks/${nb.id}/edit`)).text;
    expect(first).toContain('>Talk<');
    expect(first).toContain('>Prompt<');
    expect(first).toContain('as it is now');
    expect(first).not.toContain('not saved yet');

    // Said: the drafter changes the setup (the test drafter puts what was said in the title).
    expect((await post(`/notebooks/${nb.id}/edit/talk`, { text: 'call it a briefing on Dana' })).status).toBe(303);
    await waitReady();
    let page = (await get(`/notebooks/${nb.id}/edit`)).text;
    expect(page).toContain('call it a briefing on Dana');
    expect(page).toContain('with your changes, not saved');
    expect(page).toMatch(/Title: “Prepare for a meeting with Dana Reyes” → “Headphones \(call it a briefing on Dana/);
    expect(page).toContain('not saved yet');
    // A request about the page asks the page agent too, with what was said and the page it changes.
    expect(S.pageAsked.at(-1)).toMatchObject({ ASK: 'call it a briefing on Dana', CURRENT: '' });
    // Nothing changed yet.
    expect(s.get(nb.id)!.title).toBe('Prepare for a meeting with Dana Reyes');
    // The new-notebook drafts don't list it.
    expect((await get('/notebooks/new')).text).not.toContain('call it a briefing on Dana');

    // Dropped: as it was.
    await post(`/notebooks/${nb.id}/edit/discard`, {});
    expect((await get(`/notebooks/${nb.id}/edit`)).text).toContain('as it is now');

    // The document: a page by name, a new done-when; then saved.
    const md = (await get(`/notebooks/${nb.id}/edit?tab=prompt`)).text;
    expect(md).toContain('## Done when');
    const doc = `# Prepare for a meeting with Dana Reyes\n\nWhat matters to Dana\n\n## Done when\n- [ ] Talking points chosen\n- [ ] Questions ready\n\n## Steps\n1. Learn about Dana Reyes (profile; about Dana Reyes)\n2. Find what Dana has said (find 5)\n\n## How it looks\nMeeting briefing\n`;
    const shown = await post(`/notebooks/${nb.id}/edit/prompt`, { markdown: doc });
    expect(decodeURIComponent(shown.headers.location)).toContain('3 changes in the preview');
    // It opens the preview (a dialog over the editor) once, as the page loads.
    expect(shown.headers.location).toContain('preview=1');
    // The box around the page scrolls (only the page inside it is inert: an inert box would pass the wheel to the page behind).
    expect((await get(shown.headers.location)).text).toMatch(/<div class="nbe-preview__page" tabindex="0"[^>]*><div class="nbe-preview__inner" inert>/);
    expect((await get(shown.headers.location)).text).toMatch(/<dialog class="nbe-preview" id="nbe-preview" aria-label="Preview" data-open>/);
    expect((await get(`/notebooks/${nb.id}/edit?tab=prompt`)).text).not.toContain('data-open>');
    page = (await get(`/notebooks/${nb.id}/edit?tab=prompt`)).text;
    expect(page).toContain('Added done when “Questions ready”');
    expect(page).toContain('Added step 1: Learn about Dana Reyes (profile; about Dana Reyes)');
    expect(page).toContain('How it looks: Shortlist → Meeting briefing');
    const saved = await post(`/notebooks/${nb.id}/edit/save`, {});
    expect(decodeURIComponent(saved.headers.location)).toContain('Saved 3 changes.');
    const after = s.get(nb.id)!;
    expect(after.criteria.map((c) => c.text)).toEqual(['Talking points chosen', 'Questions ready']);
    expect(after.steps!.map((x) => [x.id, x.kind])).toEqual([['s2', 'profile'], ['s1', 'find']]);
    expect(after.layout?.preset).toBe('dossier');
    expect(after.layoutBy).toBe('picked');
    // The notebook says it was saved.
    expect((await get(saved.headers.location)).text).toContain('Saved 3 changes.');
    expect((await get(`/notebooks/${nb.id}/edit`)).text).toContain('as it is now');
  });
});

describe('who they are now, when what was found disagrees', () => {
  afterEach(() => { S.reconcilerReply = undefined; S.researchReply = undefined; S.researchAsked.length = 0; });

  it('says so at the top; the writer states neither side; you pick one, or sua checks it as of today', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const post = (path: string, body: Record<string, string> = {}) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const { reconcileAbout } = await import('../lib/notebook-reconcile.js');
    const { writerInputs } = await import('../lib/notebook-write.js');
    const ctx = getContext(app.locals);
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.create({ title: 'Prepare for a call with Dana Reyes', statement: 'What matters to Dana' });
    s.setFields(nb.id, [{ key: 'said', label: 'What she said', type: 'text' }, { key: 'link', label: 'Source', type: 'url', role: 'link' }, { key: 'when', label: 'Date', type: 'date', role: 'when' }]);
    s.setAbout(nb.id, 'person', { name: 'Dana Reyes', facts: [{ key: 'organization', label: 'Company', value: 'Northwind', source: 'https://northwind.example/team' }, { key: 'role', label: 'Role', value: 'Founder' }] });
    const post1 = s.upsertOption(nb.id, { title: 'Her move to Globex', by: 'agent:x', data: { said: 'I joined Globex to lead their content work.', link: 'https://social.example/dana/1', when: '2026-10-01' } }).entry;

    // What it reads: who she is (with sources) and what was found (with ids).
    let asked: Record<string, string> | undefined;
    S.reconcilerReply = (inputs) => { asked = inputs; return `<conflicts>${JSON.stringify({ conflicts: [{ about: 'person', fact: 'organization', question: 'Is she at Globex now, or still running Northwind?', claims: [{ value: 'Northwind', source: 'https://northwind.example/team' }, { value: 'Globex', source: 'https://social.example/dana/1', when: '2026-10', from: [post1.id] }] }] })}</conflicts>`; };
    expect(await reconcileAbout(ctx, s, nb.id)).toBe('1 thing found disagrees with who they are');
    expect(JSON.parse(asked!.PEOPLE).person.facts[0]).toMatchObject({ key: 'organization', value: 'Northwind', source: 'https://northwind.example/team' });
    expect(JSON.parse(asked!.FOUND)[0]).toMatchObject({ id: post1.id, title: 'Her move to Globex', source: 'https://social.example/dana/1', when: '2026-10-01' });

    // At the top: the question, each side with its source and date, Check it, and a button per side.
    let page = (await get(`/notebooks/${nb.id}`)).text;
    expect(page).toContain('<span class="nb-conflict__tag">Not settled</span> Is she at Globex now, or still running Northwind?');
    expect(page).toContain('<strong>Globex</strong> <span class="nb-conflict__src"><a href="https://social.example/dana/1" target="_blank" rel="noopener">social.example ↗</a> · 2026-10</span>');
    expect(page).toContain('>Check it</button>');
    expect(page).toContain(">It's Northwind</button>");

    // The writer is told both sides and states neither.
    const person = JSON.parse(writerInputs(s.get(nb.id)!, s.entries(nb.id), {}).NOTEBOOK).person;
    expect(person.facts).toEqual(['Role: Founder']);
    expect(person.unsettled).toEqual([{ fact: 'Company', sides: ['Northwind', 'Globex (2026-10)'], question: 'Is she at Globex now, or still running Northwind?' }]);

    // You pick: the fact takes it, with that side's source; it's gone from the top.
    const picked = await post(`/notebooks/${nb.id}/about/person/conflicts/organization/settle`, { value: 'Globex' });
    expect(decodeURIComponent(picked.headers.location)).toContain('Kept: Company is Globex.');
    expect(s.get(nb.id)!.about!.person!.facts.find((f) => f.key === 'organization')).toMatchObject({ value: 'Globex', source: 'https://social.example/dana/1' });
    expect((await get(`/notebooks/${nb.id}`)).text).not.toContain('Not settled');

    // Check it: sua looks it up as of today with both sides as leads; a sourced answer settles it.
    s.setAbout(nb.id, 'person', { facts: [{ key: 'role', label: 'Role', value: 'Founder' }] });
    S.reconcilerReply = () => `<conflicts>${JSON.stringify({ conflicts: [{ about: 'person', fact: 'role', question: 'Is she still a founder?', claims: [{ value: 'Founder', source: 'https://northwind.example/team' }, { value: 'Head of Content', from: [post1.id] }] }] })}</conflicts>`;
    await reconcileAbout(ctx, s, nb.id);
    S.researchReply = () => JSON.stringify({ subject: 'Dana Reyes', found: { role: { value: 'Head of Content at Globex', source: 'https://globex.example/team', quote: 'Dana Reyes, Head of Content' } } });
    const checked = await post(`/notebooks/${nb.id}/about/person/conflicts/role/check`);
    expect(decodeURIComponent(checked.headers.location)).toContain('sua is checking it.');
    for (let i = 0; i < 50 && ctx.notebookConflictChecks?.size; i++) await new Promise((r) => setTimeout(r, 20));
    expect(JSON.parse(S.researchAsked.at(-1)!.ASK)[0].hint).toContain('"Founder" (https://northwind.example/team) vs "Head of Content"');
    const role = s.get(nb.id)!.about!.person!;
    expect(role.facts.find((f) => f.key === 'role')).toMatchObject({ value: 'Head of Content', source: 'https://globex.example/team' });
    expect(role.conflicts!.find((c) => c.fact === 'role')!.settled).toMatchObject({ by: 'research', why: '“Dana Reyes, Head of Content”' });
    expect(s.entries(nb.id).some((e) => e.title === 'Checked: Role is Head of Content')).toBe(true);
    page = (await get(`/notebooks/${nb.id}`)).text;
    expect(page).not.toContain('Not settled');
  });
});

describe('the meeting a notebook prepares for', () => {
  it('asks for it, keeps it, shows when and your goal, and the finder and writer aim at it', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const post = (path: string, body: Record<string, string>) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.create({ title: 'Prepare for a meeting with Dana Reyes', statement: 'What matters to Dana' });
    s.setSteps(nb.id, [{ title: 'Find what she said', kind: 'find', target: 3 }, { title: 'Write the talking points', kind: 'write', target: 3 }]);

    // No meeting yet: the page asks, and so does sua's greeting.
    let page = (await get(`/notebooks/${nb.id}`)).text;
    expect(page).toContain('<span class="nb-meeting__add">＋ Add the meeting</span> <span class="nb-meeting__why">when, and what you want from it</span>');
    const { notebookGreeting } = await import('../lib/notebook-chat.js');
    expect(notebookGreeting(s.get(nb.id)!)).toContain('When is the meeting, and what do you want out of it?');

    // Saved as you said it.
    // A local date 3 days ahead (not UTC: in the evening UTC is already tomorrow).
    const ahead = new Date(Date.now() + 3 * 86_400_000);
    const day = `${String(ahead.getFullYear())}-${String(ahead.getMonth() + 1).padStart(2, '0')}-${String(ahead.getDate()).padStart(2, '0')}`;
    const res = await post(`/notebooks/${nb.id}/meeting`, { meeting_date: day, meeting_time: '14:00', meeting_goal: 'Explore a partnership on onboarding', meeting_notes: 'We met at a conference' });
    expect(decodeURIComponent(res.headers.location)).toContain('Saved the meeting');
    expect(s.get(nb.id)!.meeting).toEqual({ when: `${day}T14:00`, goal: 'Explore a partnership on onboarding', notes: 'We met at a conference' });
    page = (await get(`/notebooks/${nb.id}`)).text;
    expect(page).toMatch(/Meeting <strong>[^<]*2:00 PM<\/strong> · in 3 days/);
    expect(page).toContain('Your goal: Explore a partnership on onboarding');
    expect(page).toMatch(/<details class="nb-meeting__edit">\s*<summary>Edit<\/summary>/);
    // A date that isn't one is refused, and the meeting stays.
    expect(decodeURIComponent((await post(`/notebooks/${nb.id}/meeting`, { meeting_date: 'soon' })).headers.location)).toContain("That date didn't read as a date.");
    expect(s.get(nb.id)!.meeting?.when).toBe(`${day}T14:00`);

    // The finder is told the goal; the writer gets the meeting with how soon it is.
    const { notebookBrief } = await import('../lib/notebook-pipeline.js');
    expect(notebookBrief(s.get(nb.id)!)).toContain('The meeting is for: Explore a partnership on onboarding.');
    const { writerInputs } = await import('../lib/notebook-write.js');
    expect(JSON.parse(writerInputs(s.get(nb.id)!, [], { target: 3 }).NOTEBOOK).meeting).toEqual({ when: `${day}T14:00`, daysAway: 3, goal: 'Explore a partnership on onboarding', notes: 'We met at a conference' });

    // Talking points written days before the meeting say so, with Write again.
    s.setBriefing(nb.id, { points: [{ text: 'Ask about onboarding', from: [] }], questions: [], watch: [], at: new Date(Date.now() - 4 * 86_400_000).toISOString(), by: 'notebook-writer' });
    s.updateStep(nb.id, 's2', { status: 'done' });
    expect((await get(`/notebooks/${nb.id}`)).text).toContain('The talking points are 4 days old.');

    // In the conversation, sua sets it (merged with what's there, saved straight away), and its card says what it set.
    const { getContext } = await import('../context.js');
    const { parseProposedActions } = await import('./inbox-plan.js');
    const engine = await import('./inbox-engine.js');
    const ctx = getContext(app.locals);
    const parsed = parseProposedActions([{ type: 'notebook-add', rationale: 'the meeting', inputs: { NOTEBOOK: nb.id, CHANGES: { meeting: { goal: 'Agree on a pilot' } } } }], []);
    const card = engine.withEditorBase(ctx, parsed.accepted[0]);
    expect(card.surfaceChanges).toEqual([{ what: 'your goal', before: 'Explore a partnership on onboarding', after: 'Agree on a pilot' }]);
    expect(engine.executeNotebookAdd(ctx, card)).toMatchObject({ status: 'completed' });
    expect(s.get(nb.id)!.meeting).toMatchObject({ when: `${day}T14:00`, goal: 'Agree on a pilot', notes: 'We met at a conference' });
    // The same again changes nothing, and says so.
    expect(engine.executeNotebookAdd(ctx, card)).toMatchObject({ summary: 'The notebook already has all of that.' });

    // The document has it, and reads it back.
    const { notebookToMarkdown, notebookFromMarkdown, setupOf } = await import('../lib/notebook-edit.js');
    const md = notebookToMarkdown(setupOf(s.get(nb.id)!), s.get(nb.id)!.layout);
    expect(md).toContain(`## The meeting\n- When: ${day} 14:00\n- Goal: Agree on a pilot\n- Notes: We met at a conference`);
    const back = notebookFromMarkdown(md.replace('Agree on a pilot', 'Sign the pilot'), setupOf(s.get(nb.id)!), undefined, new Set());
    expect('setup' in back && back.setup.meeting).toEqual({ when: `${day}T14:00`, goal: 'Sign the pilot', notes: 'We met at a conference' });
    expect(notebookFromMarkdown(md.replace(`${day} 14:00`, 'Thursday'), setupOf(s.get(nb.id)!), undefined, new Set())).toMatchObject({ error: expect.stringContaining("isn't a date") });

    // The brief says it too.
    expect((await get(`/notebooks/${nb.id}/brief.html`)).text).toContain('Your goal: Agree on a pilot');
  });

  it("a draft's limits leave out filler: the person's name, what you gave it, what the meeting is", async () => {
    const { parseNotebookDraft } = await import('../lib/notebook-draft.js');
    await makeApp(); // this block's afterEach shuts one down
    const params = ['Brendan Short', 'LinkedIn profile provided', 'upcoming meeting', 'focus on what matters to him'];
    const meet = parseNotebookDraft(`<draft>${JSON.stringify({ title: 'Prepare for meeting with Brendan Short', statement: 'Help me understand what matters to Brendan Short before our upcoming meeting.', params, steps: [{ title: 'Learn about Brendan Short', kind: 'profile' }] })}</draft>`, new Set());
    expect('params' in meet && meet.params).toEqual(['focus on what matters to him']);
    // Not about someone: a limit the title repeats is still a limit; a note on what you gave isn't.
    const car = parseNotebookDraft(`<draft>${JSON.stringify({ title: 'Buy an AWD wagon', params: ['AWD', 'under $12k', 'Budget not specified'] })}</draft>`, new Set());
    expect('params' in car && car.params).toEqual(['AWD', 'under $12k']);
  });

  it('a draft keeps the meeting the drafter heard, and starting it saves it', async () => {
    const { parseNotebookDraft } = await import('../lib/notebook-draft.js');
    const d = parseNotebookDraft(`<draft>${JSON.stringify({ title: 'Meet Dana', steps: [{ title: 'Write the talking points', kind: 'write' }], meeting: { when: '2026-11-05T10:00', goal: 'Hire her team', notes: '' } })}</draft>`, new Set());
    expect('meeting' in d && d.meeting).toEqual({ when: '2026-11-05T10:00', goal: 'Hire her team' });
    const { renderDraftReview } = await import('../views/notebook-new.js');
    const { render } = await import('../views/html.js');
    const html = render(renderDraftReview('d1', d as never, []));
    expect(html).toContain('name="meeting_date" value="2026-11-05"');
    expect(html).toContain('>Hire her team</textarea>');
    const app = await makeApp();
    await request(app).post('/notebooks').set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form')
      .send({ title: 'Meet Dana', statement: 'Prepare', step_title: 'Write the talking points', step_kind: 'write', step_agent: '', step_target: '', meeting_date: '2026-11-05', meeting_time: '10:00', meeting_goal: 'Hire her team', meeting_notes: '' });
    const { NotebookStore } = await import('@some-useful-agents/core');
    const nb = NotebookStore.fromHandle(S.runStore.databaseHandle()).list({}).find((n) => n.title === 'Meet Dana')!;
    expect(nb.meeting).toEqual({ when: '2026-11-05T10:00', goal: 'Hire her team' });
  });
});

describe('enhancing the prompt', () => {
  it('sharpens what is in the box (your edits first), comes back as a change to preview with what it made sharper, and saves nothing', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const post = (path: string, body: Record<string, string>) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const { ENHANCE_ASK } = await import('../lib/notebook-edit.js');
    const ctx = getContext(app.locals);
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.create({ title: 'Buy a WRX wagon', statement: 'a wrx wagon', params: ['cheap'] });
    s.setSteps(nb.id, [{ title: 'Find wagons', kind: 'find', target: 5 }]);
    const asked: Array<Record<string, string>> = [];
    const was = ctx.notebookDrafterRun;
    ctx.notebookDrafterRun = async (inputs) => { asked.push(inputs); return `<draft>${JSON.stringify({
      title: 'Buy a WRX wagon', statement: 'Find a 2002–2008 Subaru WRX wagon under $5,000 within 50 miles, by December.',
      params: ['under $5,000', 'within 50 miles', '2002–2008'], criteria: ['5 wagons found', 'One test-driven', 'One bought'],
      fields: [{ key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'miles', label: 'Miles', type: 'number', unit: 'mi', role: 'measure', better: 'lower' }],
      checks: ['Clean title'], stages: [], pipeline: [], cadence: '',
      steps: [{ title: 'Find 5 wagons', kind: 'find', agent: '', target: 5 }, { title: 'Pick the wagon', kind: 'decide', target: 1 }],
      why: 'Made what it\'s for and the limits specific, and added a decide step.',
    })}</draft>`; };
    try {
      // The box, as you edited it: that's what sua enhances.
      const md = (await get(`/notebooks/${nb.id}/edit?tab=prompt`)).text.match(/<textarea name="markdown"[^>]*>([\s\S]*?)<\/textarea>/)![1]
        .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      expect((await get(`/notebooks/${nb.id}/edit?tab=prompt`)).text).toContain('✦ Enhance this prompt');
      const res = await post(`/notebooks/${nb.id}/edit/enhance`, { markdown: md.replace('a wrx wagon', 'a wrx wagon for winter') });
      expect(res.headers.location).toContain('tab=prompt');
      for (let i = 0; i < 50 && (await get(`/notebooks/${nb.id}/edit/state`)).body.status === 'working'; i++) await new Promise((r) => setTimeout(r, 20));
      expect(asked).toHaveLength(1);
      expect(asked[0].CHANGE).toBe(ENHANCE_ASK);
      expect(JSON.parse(asked[0].CURRENT).statement).toBe('a wrx wagon for winter');
      const page = (await get(`/notebooks/${nb.id}/edit?tab=prompt`)).text;
      expect(page).toContain('<strong>✦ Enhanced.</strong> Made what it&#39;s for and the limits specific, and added a decide step.');
      expect(page).toContain('Find a 2002–2008 Subaru WRX wagon under $5,000 within 50 miles, by December.');
      // A proposal: nothing saved until you save.
      expect(s.get(nb.id)!.statement).toBe('a wrx wagon');
      // A long list of changes folds (the preview shows them all).
      expect(page).toMatch(/<details class="nbe-enhanced__all"><summary>\d+ changes<\/summary>/);
      // sua's word on it ends at a sentence, never mid-word.
      const { clipSentence } = await import('../lib/notebook-draft.js');
      expect(clipSentence('Set the limits back. Fixed the cut-off check. Replaced the research step with a check that reads title status straight from each listing.', 60)).toBe('Set the limits back. Fixed the cut-off check.');
      expect(clipSentence('One long sentence without a stop that runs on and on past the limit', 30)).toBe('One long sentence without a…');
    } finally {
      ctx.notebookDrafterRun = was;
    }
  });
});

describe('"do it better", with nothing more said', () => {
  it('sharpens the whole notebook (Enhance) and draws its page again, as one proposal', async () => {
    const app = await makeApp();
    const post = (path: string, body: Record<string, string>) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const { ENHANCE_ASK, VAGUE_IMPROVE } = await import('../lib/notebook-edit.js');
    const ctx = getContext(app.locals);
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.create({ title: 'Prepare for a call with Dana Reyes', statement: 'a call with dana' });
    s.setSteps(nb.id, [{ title: 'Find what she said', kind: 'find', target: 3 }]);
    const asked: string[] = [];
    const was = ctx.notebookDrafterRun;
    ctx.notebookDrafterRun = async (inputs) => { asked.push(inputs.CHANGE); return `<draft>${JSON.stringify({ title: 'Prepare for a call with Dana Reyes', statement: 'Get ready for a 30-minute call with Dana Reyes about her team.', params: [], criteria: ['Talking points ready'], fields: [], checks: [], stages: [], pipeline: [], cadence: '', steps: [{ title: 'Find what she said', kind: 'find', target: 3 }], why: 'Made what it is for specific.' })}</draft>`; };
    S.pageAsked.length = 0;
    S.pageReply = () => `<page>${JSON.stringify({ preset: 'dossier', about: 'a briefing before the call' })}</page>`;
    try {
      await post(`/notebooks/${nb.id}/edit/talk`, { text: 'Do it better!' });
      for (let i = 0; i < 50 && (await get(`/notebooks/${nb.id}/edit/state`)).body.status === 'working'; i++) await new Promise((r) => setTimeout(r, 20));
      expect(asked).toEqual([ENHANCE_ASK]);
      expect(S.pageAsked.at(-1)!.ASK).toContain('Draw the page that best fits what this notebook is for now');
      const page = (await get(`/notebooks/${nb.id}/edit`)).text;
      expect(page).toContain('Get ready for a 30-minute call with Dana Reyes about her team.');
      expect(page).toContain('Meeting briefing');
      // A request that says what to change is taken as it is.
      expect(['make it better for the launch', 'improve the talking points'].map((t) => VAGUE_IMPROVE.test(t))).toEqual([false, false]);
      expect(['do it better', 'redraw it and do it better', 'please improve it', 'clean it up'].every((t) => VAGUE_IMPROVE.test(t))).toBe(true);
    } finally {
      ctx.notebookDrafterRun = was;
      S.pageReply = undefined;
    }
  });
});

describe('how a notebook looks, picked from pictures', () => {
  it('a look goes in your changes and opens the preview; sua can pick one; back to how it is drops it', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const post = (path: string, body: Record<string, string>) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.create({ title: 'Meet Dana Reyes', statement: 'Before our call' });
    s.setFields(nb.id, [{ key: 'theme', label: 'Theme', type: 'text' }]);

    // A tab beside Talk and Prompt.
    expect((await get(`/notebooks/${nb.id}/edit`)).text).toContain(`href="/notebooks/${nb.id}/edit?tab=looks"`);
    expect((await get(`/notebooks/${nb.id}/edit`)).text).not.toContain('class="lk-thumb"');
    let page = (await get(`/notebooks/${nb.id}/edit?tab=looks`)).text;
    expect(page).toMatch(/aria-label="Shortlist, how it looks">[\s\S]*?look-card__badge">Now</);
    expect(page).toContain('class="lk-thumb"');

    const picked = await post(`/notebooks/${nb.id}/edit/look`, { look: 'dossier' });
    expect(picked.headers.location).toContain('tab=looks&preview=1');
    page = (await get(`/notebooks/${nb.id}/edit?tab=looks`)).text;
    expect(page).toMatch(/aria-label="Meeting briefing, how it looks">[\s\S]*?look-card__badge">In your changes</);
    expect(page).toMatch(/aria-label="Look like: Shortlist">[\s\S]*?look-card__badge">Saved</);
    expect(page).toContain('How it looks: Shortlist → Meeting briefing');
    expect(s.get(nb.id)!.layout).toBeUndefined();

    // Back to the look it has: nothing to save about it.
    await post(`/notebooks/${nb.id}/edit/look`, { look: 'shortlist' });
    page = (await get(`/notebooks/${nb.id}/edit`)).text;
    expect(page).not.toContain('not saved yet');
    expect(page).toContain('Look like: Shortlist.');

    // sua picks (the page agent, as a change to preview).
    S.pageReply = () => `<page>${JSON.stringify({ preset: 'dossier', about: 'a briefing before the call' })}</page>`;
    await post(`/notebooks/${nb.id}/edit/look`, { look: 'pick' });
    for (let i = 0; i < 50 && (await get(`/notebooks/${nb.id}/edit/state`)).body.status === 'working'; i++) await new Promise((r) => setTimeout(r, 20));
    page = (await get(`/notebooks/${nb.id}/edit`)).text;
    expect(page).toContain('Let sua pick how it looks.');
    expect(page).toContain('It fits as a briefing before the call.');
    expect(page).toContain('How it looks: Shortlist → Meeting briefing');
    S.pageReply = undefined;
    await post(`/notebooks/${nb.id}/edit/save`, {});
    // sua's own pick, saved: the notebook's, as at setup (decided again and composed as sua sees fit).
    expect(s.get(nb.id)).toMatchObject({ layoutBy: 'notebook', layout: { preset: 'dossier' } });
  });
});


describe('a write step', () => {
  it('writes the talking points from what they said: the agenda and the brief show them, each with the themes it rests on', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const { NotebookStore, layoutPreset } = await import('@some-useful-agents/core');
    const { startNotebookStep } = await import('../lib/notebook-steps.js');
    const { notebookWidgetData } = await import('../lib/notebook-widgets.js');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.create({ title: 'Prepare for a meeting with Dana Reyes', statement: 'What matters to Dana' });
    s.setFields(nb.id, [
      { key: 'theme', label: 'Theme', type: 'text' },
      { key: 'evidence', label: 'What she said', type: 'text' },
      { key: 'source_url', label: 'Source', type: 'url', role: 'link' },
      { key: 'conversation_question', label: 'Question to ask', type: 'text' },
    ]);
    const add = (title: string, said: string) => s.upsertOption(nb.id, { title, by: 'agent:x', data: { theme: title, evidence: said, source_url: `https://example.com/${title.length}`, conversation_question: `About ${title}?` } }).entry;
    const a = add('Human work', 'She writes her first drafts herself.');
    const b = add('Small campaigns', 'She ran a masterclass on micro-campaigns.');
    s.setSteps(nb.id, [{ title: 'Find what she said', kind: 'find', target: 2, status: 'done' }, { title: 'Write the talking points', kind: 'write', target: 2 }]);
    s.setLayout(nb.id, layoutPreset('dossier')!.layout, 'notebook');
    S.writerReply = (inputs) => {
      const themes = JSON.parse(inputs.THEMES) as Array<{ id: string; said?: string }>;
      expect(themes.map((t) => t.said)).toEqual(expect.arrayContaining(['She writes her first drafts herself.']));
      return `<briefing>${JSON.stringify({
        points: [
          { text: 'Ask what she never hands to AI', why: 'She writes her first drafts herself.', ask: 'Where does AI stop for you?', from: [a.id] },
          { text: 'Talk about small, targeted campaigns', why: 'She teaches micro-campaigns.', from: [b.id, 'made-up'] },
        ],
        questions: ['What would you change about outbound?'], watch: ['Don\'t pitch volume'],
      })}</briefing>`;
    };
    const started = startNotebookStep(S.ctx! as never, nb.id);
    expect(started).toMatchObject({ started: true, step: { kind: 'write' } });
    for (let i = 0; i < 50 && s.get(nb.id)!.steps![1].status === 'running'; i++) await new Promise((r) => setTimeout(r, 20));
    const after = s.get(nb.id)!;
    expect(S.writerAsked.at(-1)!.COUNT).toBe('3');
    expect(after.briefing!.points.map((p) => [p.text, p.from])).toEqual([['Ask what she never hands to AI', [a.id]], ['Talk about small, targeted campaigns', [b.id]]]);
    expect(after.steps![1].status).toBe('met');
    const d = notebookWidgetData(after, s.entries(nb.id)).notebook;
    expect(d.talkingPoints[0]).toEqual({ text: 'Ask what she never hands to AI', note: 'She writes her first drafts herself. Ask: Where does AI stop for you?', refs: [{ label: 'Human work', href: `/notebooks/${nb.id}/entries/${a.id}` }] });
    expect(d.questions).toEqual([{ text: 'What would you change about outbound?' }]);
    expect(d.watch).toEqual(['Don\'t pitch volume']);
    // A briefing page saved before agendas had what to watch for shows it too.
    const { notebookWidgetComponents } = await import('../lib/notebook-widgets.js');
    const oldAgenda = { components: [{ id: 'root', component: 'Column', children: ['agenda'] }, { id: 'agenda', component: 'Agenda', points: { path: '/notebook/talkingPoints' } }] };
    expect(notebookWidgetComponents({ ...after, layout: oldAgenda }).find((c) => c.id === 'agenda')).toMatchObject({ watch: { path: '/notebook/watch' } });
    // A theme ruled out since: its link goes from the point.
    s.ruleOut(nb.id, b.id, 'old');
    expect(notebookWidgetData(s.get(nb.id)!, s.entries(nb.id)).notebook.talkingPoints[1].refs).toEqual([]);
    // Nothing to pick from: its steps end in sua writing, so the header has no Decide….
    expect((await get(`/notebooks/${nb.id}`)).text).not.toContain('Decide…</summary>');
    const { offersDecide } = await import('../views/notebooks.js');
    expect([offersDecide({}), offersDecide({ steps: [] }), offersDecide({ steps: [{ kind: 'find' }, { kind: 'decide' }] as never }), offersDecide({ steps: [{ kind: 'find' }, { kind: 'write' }] as never })]).toEqual([true, true, true, false]);
    // Done, its card offers Write again, which writes them once more.
    s.updateStep(nb.id, s.get(nb.id)!.steps![1].id, { status: 'done' });
    expect((await get(`/notebooks/${nb.id}`)).text).toContain('Write again →');
    S.writerReply = () => `<briefing>${JSON.stringify({ points: [{ text: 'A fresh opener', from: [a.id] }] })}</briefing>`;
    const again = await request(app).post(`/notebooks/${nb.id}/steps/${s.get(nb.id)!.steps![1].id}/again`).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(decodeURIComponent(again.headers.location)).toContain('Writing again: Write the talking points.');
    for (let i = 0; i < 50 && s.get(nb.id)!.briefing!.points[0].text !== 'A fresh opener'; i++) await new Promise((r) => setTimeout(r, 20));
    expect(s.get(nb.id)!.briefing!.points.map((p) => p.text)).toEqual(['A fresh opener']);
    expect(s.get(nb.id)!.steps![1].status).toBe('done');
    S.writerReply = () => `<briefing>${JSON.stringify({ points: [{ text: 'Ask what she never hands to AI', from: [a.id] }], watch: ['Don\'t pitch volume'] })}</briefing>`;
    await request(app).post(`/notebooks/${nb.id}/steps/${s.get(nb.id)!.steps![1].id}/again`).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    for (let i = 0; i < 50 && s.get(nb.id)!.briefing!.points[0].text !== 'Ask what she never hands to AI'; i++) await new Promise((r) => setTimeout(r, 20));
    const brief = (await get(`/notebooks/${nb.id}/brief.html`)).text;
    expect(brief).toContain('Ask what she never hands to AI');
    // Its pictures sit in a frame, whole, however big the file (the extended brief shows each theme's).
    expect(brief).toMatch(/\.pic img \{[^}]*width: 100%; height: 100%; object-fit: contain;/);
    expect(brief).toMatch(/\.pic--hero \{[^}]*max-width: 18rem; aspect-ratio: 4 \/ 3;/);
    expect(brief).toContain('Don&#39;t pitch volume');
    S.writerReply = undefined;
  });

  it('writes the answer for a question: the Answer page shows it, how sure, the findings with their sources, and what is open', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const { NotebookStore, layoutPreset } = await import('@some-useful-agents/core');
    const { startNotebookStep } = await import('../lib/notebook-steps.js');
    const { notebookWidgetData } = await import('../lib/notebook-widgets.js');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.create({ title: 'What do small teams pay for a CRM?', statement: 'What do 10-person sales teams pay for a CRM in 2026?' });
    s.setFields(nb.id, [{ key: 'price', label: 'Price per seat', type: 'text' }, { key: 'source_url', label: 'Source', type: 'url', role: 'link' }]);
    const a = s.upsertOption(nb.id, { title: 'Pricing page: Northwind CRM', by: 'agent:x', data: { price: '$25/seat', source_url: 'https://northwind.example/pricing' } }).entry;
    const b = s.upsertOption(nb.id, { title: 'Survey of 200 teams', by: 'agent:x', data: { price: '$20–40/seat', source_url: 'https://survey.example/crm' } }).entry;
    s.addEntry(nb.id, { kind: 'note', title: 'Searched 3 places at once: vendor pages (2), reviews (1)', by: 'agent:x' });
    s.setSteps(nb.id, [{ title: 'Find sources', kind: 'find', target: 2, status: 'done' }, { title: 'Write the answer', kind: 'write', shape: 'answer' }]);
    s.setLayout(nb.id, layoutPreset('answer')!.layout, 'notebook');

    // Before the answer: where it stands, and the step says there's none yet.
    let page = (await get(`/notebooks/${nb.id}`)).text;
    expect(page).toContain('"label":"Where it stands"');
    expect(page).toContain('no answer yet');

    S.writerReply = (inputs) => `<answer>${JSON.stringify({
      answer: 'Most pay **$20–40 a seat a month**; a 10-person team spends about $250–400.',
      confidence: 'medium', basis: 'A vendor page and one survey agree; no invoices.',
      findings: [{ text: 'Northwind lists $25 a seat.', from: [a.id] }, { text: 'Teams surveyed pay $20–40.', from: [b.id, 'made-up'] }],
      open: ['Do annual plans cut it further?'],
    })}</answer>${inputs.SHAPE}`;
    expect(startNotebookStep(S.ctx! as never, nb.id)).toMatchObject({ started: true, step: { kind: 'write', shape: 'answer' } });
    for (let i = 0; i < 50 && s.get(nb.id)!.steps![1].status === 'running'; i++) await new Promise((r) => setTimeout(r, 20));
    // The writer was asked for an answer, with the notes its research left.
    expect(S.writerAsked.at(-1)!.SHAPE).toBe('answer');
    expect(JSON.parse(S.writerAsked.at(-1)!.NOTEBOOK).notes).toEqual(['Searched 3 places at once: vendor pages (2), reviews (1)']);
    const after = s.get(nb.id)!;
    expect(after.steps![1]).toMatchObject({ status: 'met', note: 'answer written' });
    expect(after.answer).toMatchObject({ question: 'What do 10-person sales teams pay for a CRM in 2026?', confidence: 'medium', open: ['Do annual plans cut it further?'], by: 'notebook-writer' });
    expect(after.answer!.findings.map((f) => f.from)).toEqual([[a.id], [b.id]]);

    const d = notebookWidgetData(after, s.entries(nb.id)).notebook;
    expect(d.answer).toEqual({ question: 'What do 10-person sales teams pay for a CRM in 2026?', label: 'Answer · fairly sure', text: 'Most pay **$20–40 a seat a month**; a 10-person team spends about $250–400.', next: 'A vendor page and one survey agree; no invoices.', nextLabel: 'How sure:', cover: expect.stringMatching(/^data:image\/svg\+xml;base64,/) });
    expect(d.findings[1]).toEqual({ text: 'Teams surveyed pay $20–40.', refs: [{ label: 'Survey of 200 teams', href: `/notebooks/${nb.id}/entries/${b.id}` }] });
    expect(d.openQuestions).toEqual([{ text: 'Do annual plans cut it further?' }]);
    page = (await get(`/notebooks/${nb.id}`)).text;
    expect(page).toContain('"label":"Answer · fairly sure"');
    expect(page).toContain('"component":"Agenda"');
    // The brief prints the answer, its findings by source, and what's open.
    const brief = (await get(`/notebooks/${nb.id}/brief.html`)).text;
    expect(brief).toContain('<b>How sure:</b> A vendor page and one survey agree; no invoices.');
    // What a finding rests on is a numbered note, its page listed once under Source notes.
    expect(brief).toMatch(/<sup class="note"><a href="#note-\d+">\d+<\/a>/);
    expect(brief).toMatch(/<li id="note-\d+"><span>Survey of 200 teams<\/span>/);
    expect(brief).toContain('Still open');
    // Done, it offers Answer again (not talking-point edits).
    s.updateStep(nb.id, after.steps![1].id, { status: 'done' });
    page = (await get(`/notebooks/${nb.id}`)).text;
    expect(page).toContain('Answer again →');
    expect(page).not.toContain('Edit the points →');
    // The document form keeps what the step writes.
    const { notebookToMarkdown, notebookFromMarkdown, setupOf } = await import('../lib/notebook-edit.js');
    const md = notebookToMarkdown(setupOf(s.get(nb.id)!), s.get(nb.id)!.layout);
    expect(md).toContain('2. Write the answer (write; answer)');
    const back = notebookFromMarkdown(md, setupOf(s.get(nb.id)!), s.get(nb.id)!.layout, new Set());
    expect('setup' in back && back.setup.steps[1].shape).toBe('answer');
    // The drafter's steps keep it too.
    const { draftSteps } = await import('../lib/notebook-draft.js');
    expect(draftSteps([{ title: 'Find sources', kind: 'find', agent: '' }, { title: 'Write the answer', kind: 'write', agent: '', shape: 'answer' }], new Set()).steps!.map((x) => x.shape)).toEqual([undefined, 'answer']);
    S.writerReply = undefined;
  });

  it('an answer rests on the pages its research found that explain: the writer reads and cites them, each linked to its page', async () => {
    await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { startNotebookStep } = await import('../lib/notebook-steps.js');
    const { notebookWidgetData } = await import('../lib/notebook-widgets.js');
    const { applyKeeperResult } = await import('../lib/notebook-pipeline.js');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.create({ title: 'How do CD ladders work?', statement: 'How does a CD ladder work for $25,000?' });
    s.setSteps(nb.id, [{ title: 'Find sources', kind: 'find', target: 2, status: 'done' }, { title: 'Write the answer', kind: 'write', shape: 'answer' }]);
    // The finder files a learn search's page as evidence with its page; the same page again is a repeat.
    const block = (title: string, url: string) => `<notebook>${JSON.stringify({ entries: [{ kind: 'evidence', title, body: '"Staggered maturity dates." (found by the Ladder guidance search)', fingerprint: url }] })}</notebook>`;
    applyKeeperResult(s, s.get(nb.id)!, 'notebook-finder', 'run-1', block('A ladder staggers maturities so part comes due each year.', 'https://regulator.example/cd-ladders'));
    applyKeeperResult(s, s.get(nb.id)!, 'notebook-finder', 'run-2', block('Ladders stagger when CDs come due.', 'https://www.regulator.example/cd-ladders/'));
    const evidence = s.entries(nb.id).filter((e) => e.kind === 'evidence');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].fingerprint).toBe('https://regulator.example/cd-ladders');

    S.writerReply = () => `<answer>${JSON.stringify({ answer: 'Split it into **five CDs** that come due a year apart.', confidence: 'medium', findings: [{ text: 'A ladder staggers maturities.', from: [evidence[0].id] }], open: [] })}</answer>`;
    expect(startNotebookStep(S.ctx! as never, nb.id)).toMatchObject({ started: true });
    for (let i = 0; i < 50 && s.get(nb.id)!.steps![1].status === 'running'; i++) await new Promise((r) => setTimeout(r, 20));
    // With no options at all, it still answers: from what explains.
    const themes = JSON.parse(S.writerAsked.at(-1)!.THEMES) as Array<Record<string, unknown>>;
    expect(themes).toEqual([{ id: evidence[0].id, title: 'A ladder staggers maturities so part comes due each year.', said: '"Staggered maturity dates." (found by the Ladder guidance search)', source: 'https://regulator.example/cd-ladders', explains: true, publisher: 'regulator.example', whose: 'from outside the subjects' }]);
    const after = s.get(nb.id)!;
    expect(after.answer!.findings[0].from).toEqual([evidence[0].id]);
    expect(notebookWidgetData(after, s.entries(nb.id)).notebook.findings[0].refs).toEqual([{ label: 'regulator.example', href: 'https://regulator.example/cd-ladders' }]);
    S.writerReply = undefined;
  });

  it("an answer's sources say who publishes them: the finder's word checked against the address, a caution when they're all the subjects' own (ADR-0081)", async () => {
    await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { notebookWidgetData } = await import('../lib/notebook-widgets.js');
    const { writerInputs } = await import('../lib/notebook-write.js');
    const { applyKeeperResult } = await import('../lib/notebook-pipeline.js');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.create({ title: 'Understand A2UI vs AG-UI vs CopilotKit', statement: 'Help me understand the difference.' });
    s.setSteps(nb.id, [{ title: 'Find sources', kind: 'find', target: 3 }, { title: 'Write the answer', kind: 'write', shape: 'answer' }]);
    const page = (title: string, url: string, origin?: Record<string, string>) => ({ kind: 'evidence', title, body: '"A quote."', fingerprint: url, ...(origin ? { origin } : {}) });
    applyKeeperResult(s, s.get(nb.id)!, 'notebook-finder', 'run-1', `<notebook>${JSON.stringify({ entries: [
      page('A2UI describes it, AG-UI carries it', 'https://www.copilotkit.ai/ag-ui-and-a2ui', { publisher: 'CopilotKit', kind: 'vendor', whose: 'none' }),
      page('CopilotKit is a three-layer stack', 'https://docs.copilotkit.ai/concepts/architecture'),
      page('A2UI works with AG-UI agents', 'https://developers.googleblog.com/a2ui', { publisher: 'Google', kind: 'vendor', whose: 'A2UI' }),
      page('AG-UI is an event protocol', 'https://docs.ag-ui.com/introduction'),
    ] })}</notebook>`);
    const ev = s.entries(nb.id).filter((e) => e.kind === 'evidence');
    const by = (url: string) => ev.find((e) => e.fingerprint === url)!;
    // Its site is CopilotKit's, whatever the finder said; Google's post is A2UI's own because the finder said so.
    expect(by('https://www.copilotkit.ai/ag-ui-and-a2ui').origin).toEqual({ publisher: 'CopilotKit', kind: 'vendor', whose: 'CopilotKit' });
    expect(by('https://developers.googleblog.com/a2ui').origin).toEqual({ publisher: 'Google', kind: 'vendor', whose: 'A2UI' });
    expect(by('https://docs.ag-ui.com/introduction').origin).toEqual({ publisher: 'AG-UI', kind: 'primary', whose: 'AG-UI' });
    // The writer reads who each one is from.
    const themes = JSON.parse(writerInputs(s.get(nb.id)!, s.entries(nb.id), { shape: 'answer' }).THEMES) as Array<Record<string, unknown>>;
    expect(themes.find((t) => t.source === 'https://developers.googleblog.com/a2ui')).toMatchObject({ publisher: 'Google', kind: 'vendor', whose: "A2UI's own" });

    s.setAnswer(nb.id, { question: 'q', text: 'A2UI describes, AG-UI carries, CopilotKit renders.', confidence: 'high', findings: [
      { text: 'They are layers.', from: [by('https://www.copilotkit.ai/ag-ui-and-a2ui').id, by('https://docs.copilotkit.ai/concepts/architecture').id] },
      { text: 'AG-UI is a protocol.', from: [by('https://docs.ag-ui.com/introduction').id] },
    ], open: ['Who governs AG-UI.'], at: new Date().toISOString(), by: 'agent:notebook-writer' });
    const view = notebookWidgetData(s.get(nb.id)!, s.entries(nb.id)).notebook;
    // Refs are named for their publisher, a second page of one numbered.
    expect(view.findings[0].refs.map((r) => r.label)).toEqual(['CopilotKit', 'CopilotKit (2)']);
    // Every cited page is the subjects' own: said first under Still open, and under the sources.
    const caution = "All 3 sources it rests on are the subjects' own pages (CopilotKit 2, AG-UI 1); none from outside them confirms what they say.";
    expect(view.openQuestions.map((q) => q.text)).toEqual([caution, 'Who governs AG-UI.']);
    expect(view.sourceCautions).toEqual([{ text: caution }]);
    // Each publisher once, most pages first, linked to its pages.
    expect(view.sources.map((p) => p.text)).toEqual(['CopilotKit · its own pages · primary source and vendor · 2 pages', 'AG-UI · its own pages · primary source · 1 page', "Google · A2UI's own pages · vendor · 1 page"]);
    expect(view.sources[0].refs).toEqual([{ label: 'docs.copilotkit.ai', href: 'https://docs.copilotkit.ai/concepts/architecture' }, { label: 'copilotkit.ai', href: 'https://www.copilotkit.ai/ag-ui-and-a2ui' }]);

    // Two outside publishers cited: nothing to weigh.
    applyKeeperResult(s, s.get(nb.id)!, 'notebook-finder', 'run-2', `<notebook>${JSON.stringify({ entries: [page('An outside explainer', 'https://thenewstack.io/a2ui'), page('Another outside view', 'https://infoq.com/ag-ui')] })}</notebook>`);
    const out = s.entries(nb.id).filter((e) => e.kind === 'evidence' && /thenewstack|infoq/.test(e.fingerprint!)).map((e) => e.id);
    s.setAnswer(nb.id, { ...s.get(nb.id)!.answer!, findings: [{ text: 'Outside views agree.', from: out }] });
    expect(notebookWidgetData(s.get(nb.id)!, s.entries(nb.id)).notebook.sourceCautions).toEqual([]);
  });

  it('an answer gives the parts it was asked for: a rubric and steps, on the page and in the brief, and its done-when ticks', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const { NotebookStore, layoutPreset } = await import('@some-useful-agents/core');
    const { startNotebookStep } = await import('../lib/notebook-steps.js');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.create({ title: 'CD ladders for $25,000', statement: 'A report on CD ladders and a simple rubric for $25,000', criteria: ['A simple decision rubric written for the $25,000'] });
    const cd = s.upsertOption(nb.id, { title: 'Example Bank 12-month CD', by: 'agent:x' }).entry;
    s.setSteps(nb.id, [{ title: 'Find', kind: 'find', target: 1, status: 'done' }, { title: 'Write the report and rubric', kind: 'write', shape: 'answer' }]);
    // A page saved before answers had parts: it gets them anyway.
    const old = layoutPreset('answer')!.layout;
    s.setLayout(nb.id, { ...old, components: old.components.filter((c) => c.component !== 'AnswerSections' && c.id !== 'sections_p').map((c) => (c.id === 'answer_col' ? { ...c, children: ['answer', 'findings_p'] } : c)) }, 'notebook');
    S.writerReply = () => `<answer>${JSON.stringify({
      answer: 'Split it into **five CDs**.', confidence: 'medium', findings: [{ text: 'A 12-month CD pays 4.4%.', from: [cd.id] }], open: [],
      sections: [
        { kind: 'table', title: 'Rubric for the $25,000', delivers: 'A simple decision rubric written for the $25,000', columns: ['If…', 'Then…', 'Why'], rows: [{ cells: ['You may need it within a year', '**No-penalty CD**', 'You can take it out'], from: [cd.id] }] },
        { kind: 'steps', title: 'Open the ladder', items: [{ text: 'Check each bank is insured', from: [] }, { text: 'Open five CDs', detail: '$5,000 each', from: [cd.id] }] },
        { kind: 'diagram', title: 'The ladder', diagram: { type: 'ladder', rungs: [{ label: '12-month CD', start: 0, end: 12, amount: 5000 }, { label: '24-month CD', start: 0, end: 24, amount: 5000 }] }, caption: 'One comes due each year.' },
      ],
    })}</answer>`;
    expect(startNotebookStep(S.ctx! as never, nb.id)).toMatchObject({ started: true });
    for (let i = 0; i < 50 && s.get(nb.id)!.steps![1].status === 'running'; i++) await new Promise((r) => setTimeout(r, 20));
    expect(JSON.parse(S.writerAsked.at(-1)!.NOTEBOOK).doneWhen).toEqual(['A simple decision rubric written for the $25,000']);
    const page = (await get(`/notebooks/${nb.id}`)).text;
    expect(page).toContain('"component":"AnswerSections"');
    expect(page).toContain('"title":"Rubric for the $25,000"');
    // The rubric written, its done-when ticked itself.
    expect(s.get(nb.id)!.criteria[0].met).toBe(true);
    const brief = (await get(`/notebooks/${nb.id}/brief.html`)).text;
    expect(brief).toContain('<div class="eyebrow">Rubric for the $25,000</div>');
    expect(brief).toContain('<td><strong>No-penalty CD</strong></td>');
    expect(brief).toContain('<ol class="steps">');
    expect(brief).toMatch(/<li id="note-\d+"><span>Example Bank 12-month CD<\/span>/);
    // The ladder, drawn from its own numbers, and a drawing beside the answer (on a page saved before either).
    expect(page).toContain('"type":"ladder"');
    expect(page).toContain('"cover":"data:image/svg+xml;base64,');
    expect(brief).toContain('<span class="lad-lab">24-month CD</span>');
    expect(brief).toContain('<i style="left:0%;width:50%"></i>');
    expect(brief).toMatch(/<img class="art" src="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+" alt="">/);
    S.writerReply = undefined;
  });

  it('writes the plan for a trip: the Plan page shows it day by day with what it uses, what to book first and what is open', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const { NotebookStore, layoutPreset } = await import('@some-useful-agents/core');
    const { startNotebookStep } = await import('../lib/notebook-steps.js');
    const { notebookWidgetData } = await import('../lib/notebook-widgets.js');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.create({ title: 'Plan 2 days in Porto', statement: 'Two easy days in Porto for two', params: ['$600'], criteria: ['The Porto plan written', 'Costs for two written'] });
    s.setFields(nb.id, [{ key: 'area', label: 'Area', type: 'text', role: 'place' }, { key: 'link', label: 'Link', type: 'url', role: 'link' }]);
    const a = s.upsertOption(nb.id, { title: 'Ribeira walk', by: 'agent:x', data: { area: 'Ribeira', link: 'https://example.com/ribeira' } }).entry;
    const b = s.upsertOption(nb.id, { title: 'Port cellar tour', by: 'agent:x', data: { area: 'Gaia', link: 'https://example.com/cellar' } }).entry;
    s.setSteps(nb.id, [{ title: 'Find things to do', kind: 'find', target: 2, status: 'done' }, { title: 'Write the plan', kind: 'write', shape: 'plan' }]);
    s.setLayout(nb.id, layoutPreset('plan')!.layout, 'notebook');
    let page = (await get(`/notebooks/${nb.id}`)).text;
    expect(page).toContain('no plan yet');

    S.writerReply = () => `<plan>${JSON.stringify({
      summary: 'The river first, then **port across the bridge**.',
      items: [{ when: 'Day 1', title: 'Walk the Ribeira', from: [a.id] }, { when: 'Day 1', title: 'Dinner by the river' }, { when: 'Day 2', title: 'Port cellar tour', detail: 'Book a 3pm slot.', from: [b.id, 'made-up'] }],
      before: ['Book the cellar tour'], open: ['Rain plan?'],
      sections: [
        { kind: 'table', title: 'Costs for two', delivers: 'Costs for two written', columns: ['What', 'Cost'], rows: [{ cells: ['Cellar tour', '$60'], from: [b.id, a.id] }, { cells: ['Ribeira walk', 'Free'], from: [a.id] }] },
        { kind: 'diagram', title: 'The $600', diagram: { type: 'split', total: 600, parts: [{ label: 'Hotel', amount: 400 }, { label: 'Food and tours', amount: 200 }] } },
        { kind: 'diagram', title: 'Made-up total', diagram: { type: 'split', parts: [{ label: 'Hotel', amount: 900 }, { label: 'Food', amount: 300 }] } },
      ],
    })}</plan>`;
    expect(startNotebookStep(S.ctx! as never, nb.id)).toMatchObject({ started: true, step: { kind: 'write', shape: 'plan' } });
    for (let i = 0; i < 50 && s.get(nb.id)!.steps![1].status === 'running'; i++) await new Promise((r) => setTimeout(r, 20));
    expect(S.writerAsked.at(-1)!.SHAPE).toBe('plan');
    const after = s.get(nb.id)!;
    expect(after.steps![1]).toMatchObject({ status: 'met', note: 'plan written' });
    const d = notebookWidgetData(after, s.entries(nb.id)).notebook;
    expect(d.planIntro).toEqual({ label: 'The plan', text: 'The river first, then **port across the bridge**.', cover: expect.stringMatching(/^data:image\/svg\+xml;base64,/) });
    // Its parts besides the days: the cost table (the source every row cites, said once) and the $600 split; a split off the $600 isn't drawn.
    expect(d.planSections.map((x) => x.title)).toEqual(['Costs for two', 'The $600']);
    expect(d.planSections[0].refs).toEqual([{ label: 'Ribeira walk', href: `/notebooks/${nb.id}/entries/${a.id}` }]);
    expect(d.planSections[0].rows!.map((r) => r.refs.map((f) => f.label))).toEqual([['Port cellar tour'], []]);
    expect(d.planSections[1].diagram).toMatchObject({ type: 'split', total: '$600' });
    // Both done-whens tick: the plan is written, and the part that gives the costs.
    expect(s.autoMeetCriteria(nb.id).nb.criteria.map((c) => c.met)).toEqual([true, true]);
    expect(d.planDays).toEqual([
      { when: 'Day 1', items: [{ text: 'Walk the Ribeira', refs: [{ label: 'Ribeira walk', href: `/notebooks/${nb.id}/entries/${a.id}` }] }, { text: 'Dinner by the river', refs: [] }] },
      { when: 'Day 2', items: [{ text: 'Port cellar tour', note: 'Book a 3pm slot.', refs: [{ label: 'Port cellar tour', href: `/notebooks/${nb.id}/entries/${b.id}` }] }] },
    ]);
    expect(d.planBefore).toEqual([{ text: 'Book the cellar tour' }]);
    page = (await get(`/notebooks/${nb.id}`)).text;
    expect(page).toContain('"component":"Itinerary"');
    expect(page).toContain('"title":"Also for the plan"');
    const brief = (await get(`/notebooks/${nb.id}/brief.html`)).text;
    expect(brief).toContain('<div class="eyebrow">Costs for two</div>');
    expect(brief).toMatch(/Every row<sup class="note">/);
    expect(brief).toMatch(/<li id="note-\d+"><span>Ribeira walk<\/span>/);
    expect(brief).toContain('<div class="split-bar">');
    expect(brief).toContain('<b>Port cellar tour</b> <span class="muted">Book a 3pm slot.</span> <span class="muted">(Port cellar tour)</span>');
    expect(brief).toContain('Before you start');
    s.updateStep(nb.id, after.steps![1].id, { status: 'done' });
    expect((await get(`/notebooks/${nb.id}`)).text).toContain('Plan again →');
    const { notebookToMarkdown, notebookFromMarkdown, setupOf } = await import('../lib/notebook-edit.js');
    const md = notebookToMarkdown(setupOf(s.get(nb.id)!), s.get(nb.id)!.layout);
    expect(md).toContain('2. Write the plan (write; plan)');
    const back = notebookFromMarkdown(md, setupOf(s.get(nb.id)!), s.get(nb.id)!.layout, new Set());
    expect('setup' in back && back.setup.steps[1].shape).toBe('plan');
    S.writerReply = undefined;
  });

  it('writes up a shortlist: the field ranked with what failed and what was ruled out, kept as the answer, read as the write-up, and written again when you decide', async () => {
    const app = await makeApp();
    const ctx = S.ctx!;
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const post = (path: string, body: Record<string, unknown>) => request(app).post(path).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const { NotebookStore, notebookReadoutText, criterionMet } = await import('@some-useful-agents/core');
    const { startNotebookStep } = await import('../lib/notebook-steps.js');
    const { notebookWidgetData, notebookWidgetComponents } = await import('../lib/notebook-widgets.js');
    const { written } = await import('../lib/notebook-page.js');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.create({ title: 'Staff PM roles', statement: 'Find the 3 best Staff PM roles owning an AI platform' });
    s.setFields(nb.id, [{ key: 'company', label: 'Company', type: 'text' }, { key: 'fit', label: 'Fit', type: 'number', role: 'score' }, { key: 'posting_url', label: 'Posting', type: 'url', role: 'link' }]);
    s.setChecks(nb.id, ['Open to U.S. remote']);
    s.setCriteria(nb.id, ['A final list of 3 roles recorded']);
    const low = s.upsertOption(nb.id, { title: 'Staff PM, Low Co', by: 'agent:x', data: { company: 'Low Co', fit: 60, posting_url: 'https://jobs.example/low' } }).entry;
    const top = s.upsertOption(nb.id, { title: 'Principal PM, Top Co', by: 'agent:x', data: { company: 'Top Co', fit: 98, posting_url: 'https://jobs.example/top' } }).entry;
    const mid = s.upsertOption(nb.id, { title: 'Staff PM, Mid Co', by: 'agent:x', data: { company: 'Mid Co', fit: 80, posting_url: 'https://jobs.example/mid' } }).entry;
    s.failCheck(nb.id, mid.id, 'Open to U.S. remote', 'Hybrid, Austin');
    const out = s.upsertOption(nb.id, { title: 'PM, Out Co', by: 'agent:x', data: { company: 'Out Co', fit: 40, posting_url: 'https://jobs.example/out' } }).entry;
    s.ruleOut(nb.id, out.id, 'Senior, not Staff', 'you');
    s.addEntry(nb.id, { kind: 'evidence', title: 'Empowered product teams', body: 'The team decides how to solve the problems it is assigned.', by: 'agent:x', source: 'https://guide.example/empowered' });
    s.setSteps(nb.id, [{ title: 'Find roles', kind: 'find', target: 3, status: 'done' }, { title: 'Write up the field', kind: 'write', shape: 'writeup' }, { title: 'Pick 2', kind: 'decide', target: 2 }]);
    const wid = s.get(nb.id)!.steps![1].id;

    let page = (await get(`/notebooks/${nb.id}`)).text;
    expect(page).toContain('no write-up yet');
    S.writerReply = (inputs) => `<answer>${JSON.stringify({
      answer: 'Three roles in the running, **two of them platform ownership**; one is hybrid.',
      confidence: 'medium', basis: 'Two checked with sources.',
      findings: [{ text: 'The two strongest own an agent platform outright.', from: [top.id, mid.id] }],
      open: ['Is Mid Co remote after all?'],
      sections: [
        { kind: 'table', title: 'The field in groups', delivers: 'A final list of 3 roles recorded', columns: ['Group', 'Which', 'What they share'], rows: [{ cells: ['Platform owners', 'Top Co, Mid Co', 'Own the roadmap'], from: [top.id, mid.id] }, { cells: ['Feature roles', 'Low Co', 'A backlog'], from: [low.id] }] },
        { kind: 'steps', title: 'The top three and why', items: [{ text: 'Principal PM, Top Co: owns the platform and the evals', detail: 'Posted months ago', from: [top.id] }, { text: 'Staff PM, Mid Co: owns a shared gateway', detail: 'Hybrid, Austin', from: [mid.id] }, { text: 'Staff PM, Low Co: a backlog', from: [low.id] }] },
        { kind: 'steps', title: 'What to do next', items: [{ text: 'Apply to Top Co first', from: [top.id] }, { text: 'Ask Mid Co about remote', from: [mid.id] }] },
      ],
    })}</answer>${inputs.SHAPE}`;
    expect(startNotebookStep(ctx as never, nb.id)).toMatchObject({ started: true, step: { kind: 'write', shape: 'writeup' } });
    for (let i = 0; i < 50 && s.get(nb.id)!.steps![1].status === 'running'; i++) await new Promise((r) => setTimeout(r, 20));
    // The writer was asked for a write-up: the field ranked (the best first), what failed, a ruled-out one with why, the page that explains.
    const asked = S.writerAsked.at(-1)!;
    expect(asked.SHAPE).toBe('write-up');
    const themes = JSON.parse(asked.THEMES) as Array<Record<string, unknown>>;
    expect(themes.map((t) => t.title)).toEqual(['Principal PM, Top Co', 'Staff PM, Mid Co', 'Staff PM, Low Co', 'PM, Out Co', 'Empowered product teams']);
    expect(themes[1]).toMatchObject({ failed: ['Open to U.S. remote: Hybrid, Austin'] });
    expect(themes[3]).toMatchObject({ ruledOut: 'Senior, not Staff' });
    expect(themes[4]).toMatchObject({ explains: true });
    // Kept as the answer; the step is met; the done-when the groups table gives is met.
    const after = s.get(nb.id)!;
    expect(after.steps![1]).toMatchObject({ status: 'met', note: 'write-up written' });
    expect(after.answer).toMatchObject({ confidence: 'medium', by: 'notebook-writer' });
    expect(after.answer!.sections!.map((x) => x.title)).toEqual(['The field in groups', 'The top three and why', 'What to do next']);
    expect(criterionMet(after, s.entries(nb.id), 'A final list of 3 roles recorded')).toBe(true);
    const d = notebookWidgetData(after, s.entries(nb.id)).notebook;
    expect(d.findings[0].refs.map((r) => r.label)).toEqual(['Principal PM, Top Co', 'Staff PM, Mid Co']);
    // The shortlist page leads with the lay of the land (no cover art), keeps the counts under the strip, and shows the write-up and what it rests on after Head to head.
    expect(d.answer).toMatchObject({ label: 'The lay of the land · fairly sure', nextLabel: 'How well checked:' });
    expect(d.answer.cover).toBeUndefined();
    expect(written(after)).toMatchObject({ kind: 'writeup', findings: 1, open: 1 });
    const cids = notebookWidgetComponents(after, undefined, notebookWidgetData(after, s.entries(nb.id), s)).map((c) => c.id);
    expect(cids).toEqual(expect.arrayContaining(['lay', 'numbers_p', 'writeup_p', 'writeup_p_s', 'rests_p']));
    expect(cids).not.toContain('callout');
    // The brief (and the extended one) leads with the lay of the land, its findings and what's open, and prints its parts after the shortlist.
    for (const q of ['', '?full=1']) {
      const brief = (await get(`/notebooks/${nb.id}/brief.html${q}`)).text;
      expect(brief).toContain('The lay of the land · fairly sure');
      expect(brief).toContain('<b>How well checked:</b> Two checked with sources.');
      expect(brief).toContain('The two strongest own an agent platform outright.');
      expect(brief).toContain('Still open');
      expect(brief).toContain('>The write-up<');
      expect(brief).toContain('The field in groups');
      expect(brief).toContain('The top three and why');
      expect(brief).toContain('Apply to Top Co first');
    }
    // What's new is about the options, not the write-up.
    expect((await get(`/notebooks/${nb.id}/brief.html?latest=1`)).text).not.toContain('>The write-up<');
    // Read back, it is the write-up, not an answer to a question.
    const text = notebookReadoutText(after, s.entries(nb.id), 'written');
    expect(text).toContain('## Write-up (medium confidence)');
    expect(text).not.toContain('Q: ');
    expect(text).toContain('### The top three and why');
    // Done, it offers Write up again.
    s.updateStep(nb.id, wid, { status: 'done' });
    page = (await get(`/notebooks/${nb.id}`)).text;
    expect(page).toContain('Write up again →');
    // The document form and the drafter keep the shape.
    const { notebookToMarkdown, notebookFromMarkdown, setupOf } = await import('../lib/notebook-edit.js');
    const md = notebookToMarkdown(setupOf(s.get(nb.id)!), s.get(nb.id)!.layout);
    expect(md).toContain('2. Write up the field (write; writeup)');
    const back = notebookFromMarkdown(md.replace('(write; writeup)', '(write; write-up)'), setupOf(s.get(nb.id)!), s.get(nb.id)!.layout, new Set());
    expect('setup' in back && back.setup.steps[1].shape).toBe('writeup');
    const { draftSteps } = await import('../lib/notebook-draft.js');
    expect(draftSteps([{ title: 'Write up the field', kind: 'write', agent: '', shape: 'writeup' }], new Set()).steps!.map((x) => x.shape)).toEqual(['writeup']);

    // Deciding writes it once more, around the picks; the flash says so.
    const before = S.writerAsked.length;
    const res = await post(`/notebooks/${nb.id}/decide`, { decision: 'These two.', chosen: [top.id, mid.id] });
    expect(decodeURIComponent(res.headers.location)).toContain('The write-up is being written again around your picks.');
    for (let i = 0; i < 200 && ctx.notebookPipelines?.has(nb.id); i++) await new Promise((r) => setTimeout(r, 20));
    expect(S.writerAsked.length).toBe(before + 1);
    const again = JSON.parse(S.writerAsked.at(-1)!.THEMES) as Array<Record<string, unknown>>;
    expect(again.filter((t) => t.chosen).map((t) => t.title)).toEqual(['Principal PM, Top Co', 'Staff PM, Mid Co']);
    expect(s.get(nb.id)!.lastRunNote).toContain('written again now that you decided');
    S.writerReply = undefined;
  });

  it('a scheduled search that finds new ones writes the shortlist up again; one that finds nothing new leaves it', async () => {
    const app = await makeApp();
    const ctx = app.locals as never as Parameters<typeof import('../lib/notebook-cadence.js')['runNotebookCadenceOnce']>[0];
    const { runNotebookCadenceOnce } = await import('../lib/notebook-cadence.js');
    const { NotebookStore } = await import('@some-useful-agents/core');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.create({ title: 'Roles every morning', statement: 'Find Staff PM roles', cadence: '0 7 * * *' });
    s.setFields(nb.id, [{ key: 'posting_url', label: 'Posting', type: 'url', role: 'link' }]);
    s.upsertOption(nb.id, { title: 'Staff PM, Old Co', by: 'agent:x', data: { posting_url: 'https://jobs.example/old' }, fingerprint: 'https://jobs.example/old' });
    s.setSteps(nb.id, [{ title: 'Find roles', kind: 'find', target: 2, status: 'done' }, { title: 'Write up the field', kind: 'write', shape: 'writeup', status: 'done' }]);
    s.setAnswer(nb.id, { question: 'Find Staff PM roles', text: 'One role.', confidence: 'low', findings: [], open: [], at: new Date().toISOString(), by: 'notebook-writer' });
    const at = (x: string) => new Date(x);
    const idle = async () => { for (let i = 0; i < 200 && ctx.notebookPipelines?.size; i++) await new Promise((r) => setTimeout(r, 20)); };
    S.writerReply = () => `<answer>${JSON.stringify({ answer: 'Two roles now, **one new**.', confidence: 'low', findings: [], open: [] })}</answer>`;
    const before = S.writerAsked.length;
    expect(runNotebookCadenceOnce(ctx, at('2026-10-07T08:00:00')).get(nb.id)).toBe('first-seen');
    // Nothing new: the write-up stands.
    S.finderReply = () => '<notebook>{"entries":[{"kind":"option","title":"Staff PM, Old Co","fingerprint":"https://jobs.example/old"}]}</notebook>';
    expect(runNotebookCadenceOnce(ctx, at('2026-10-08T07:01:00')).get(nb.id)).toBe('started');
    await idle();
    expect(S.writerAsked.length).toBe(before);
    expect(s.get(nb.id)!.answer!.text).toBe('One role.');
    // A new one: written again.
    S.finderReply = () => '<notebook>{"entries":[{"kind":"option","title":"Staff PM, New Co","fingerprint":"https://jobs.example/new"}]}</notebook>';
    expect(runNotebookCadenceOnce(ctx, at('2026-10-09T07:01:00')).get(nb.id)).toBe('started');
    await idle();
    expect(S.writerAsked.length).toBe(before + 1);
    expect(s.get(nb.id)!.answer!.text).toBe('Two roles now, **one new**.');
    S.finderReply = undefined;
    S.writerReply = undefined;
  });
});

describe('editing the talking points', () => {
  it('rewords, reorders, removes and adds points, keeping the themes each rests on; the agenda links to it', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const post = (path: string, body: string) => request(app).post(path).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const { NotebookStore, layoutPreset } = await import('@some-useful-agents/core');
    const { notebookWidgetData, notebookWidgetComponents } = await import('../lib/notebook-widgets.js');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.create({ title: 'Meet Dana Reyes' });
    s.setFields(nb.id, [{ key: 'theme', label: 'Theme', type: 'text' }, { key: 'evidence', label: 'What she said', type: 'text' }]);
    const a = s.upsertOption(nb.id, { title: 'Human work', by: 'agent:x', data: { theme: 'Human work', evidence: 'She writes her drafts.' } }).entry;
    const b = s.upsertOption(nb.id, { title: 'Small campaigns', by: 'agent:x', data: { theme: 'Small campaigns', evidence: 'She teaches micro-campaigns.' } }).entry;
    s.setLayout(nb.id, layoutPreset('dossier')!.layout, 'notebook');

    // Nothing written yet: no Edit on the agenda.
    expect(notebookWidgetData(s.get(nb.id)!, s.entries(nb.id)).notebook.talkingPointsEdit).toBeUndefined();
    s.setBriefing(nb.id, { points: [{ text: 'Ask what she never hands to AI', why: 'She writes her drafts.', ask: 'Where does AI stop?', from: [a.id] }, { text: 'Talk about small campaigns', from: [b.id] }, { text: 'An old point', from: [] }], questions: ['What would you change?'], watch: ['Don\'t pitch volume'], at: '2026-10-26T12:00:00Z', by: 'notebook-writer' });
    const data = notebookWidgetData(s.get(nb.id)!, s.entries(nb.id));
    expect(data.notebook.talkingPointsEdit).toBe(`/notebooks/${nb.id}/talking-points`);
    expect(notebookWidgetComponents(s.get(nb.id)!).find((c) => c.component === 'Agenda')).toMatchObject({ editHref: { path: '/notebook/talkingPointsEdit' } });

    const page = (await get(`/notebooks/${nb.id}/talking-points`)).text;
    expect(page).toContain('Edit the talking points');
    expect(page).toContain('Ask what she never hands to AI');
    expect(page).toContain('Written by sua on Oct 26. Write again replaces what you save here.');
    expect(page).toContain(`href="/notebooks/${nb.id}/entries/${a.id}">Human work</a>`);

    // Rows in their new order (the second moved first), the old point removed, one added; the empty new row adds nothing.
    const row = (uid: string, text: string, why: string, ask: string, from: string) => `point_uid=${uid}&point_text=${encodeURIComponent(text)}&point_why=${encodeURIComponent(why)}&point_ask=${encodeURIComponent(ask)}&point_from=${encodeURIComponent(from)}`;
    const body = [
      row('p1', 'Open with her micro-campaigns', '', 'How small is too small?', b.id),
      row('p0', 'Ask what she never hands to AI', 'She writes her own drafts.', '', a.id),
      row('p2', 'An old point', '', '', ''),
      row('new', 'Ask about her next hire', 'Mentioned hiring in a talk.', '', ''),
      'point_drop=p2',
      `questions=${encodeURIComponent('What would you change?\n\nWho else should I meet?')}`,
      'watch=',
    ].join('&');
    const saved = await post(`/notebooks/${nb.id}/talking-points`, body);
    expect(decodeURIComponent(saved.headers.location)).toContain('Saved the talking points (3).');
    const after = s.get(nb.id)!.briefing!;
    expect(after.points).toEqual([
      { text: 'Open with her micro-campaigns', ask: 'How small is too small?', from: [b.id] },
      { text: 'Ask what she never hands to AI', why: 'She writes her own drafts.', from: [a.id] },
      { text: 'Ask about her next hire', why: 'Mentioned hiring in a talk.', from: [] },
    ]);
    expect(after).toMatchObject({ questions: ['What would you change?', 'Who else should I meet?'], watch: [], by: 'you', struck: ['An old point'] });
    expect((await get(`/notebooks/${nb.id}/talking-points`)).text).toContain('You edited these. Write again replaces them.');

    // Every point removed: no talking points (the agenda falls back to the themes).
    const none = await post(`/notebooks/${nb.id}/talking-points`, [row('p0', 'x', '', '', ''), 'point_drop=p0', row('new', '', '', '', '')].join('&'));
    expect(decodeURIComponent(none.headers.location)).toContain('Removed the talking points.');
    expect(s.get(nb.id)!.briefing).toBeUndefined();
  });

  it('strikes one point and has sua write a new one in its place; struck ones are not written again', async () => {
    const app = await makeApp();
    const post = (path: string, body: string) => request(app).post(path).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const { NotebookStore, layoutPreset } = await import('@some-useful-agents/core');
    const { notebookWidgetData, notebookWidgetComponents } = await import('../lib/notebook-widgets.js');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.create({ title: 'Meet Dana Reyes' });
    s.setFields(nb.id, [{ key: 'theme', label: 'Theme', type: 'text' }, { key: 'evidence', label: 'What she said', type: 'text' }]);
    const a = s.upsertOption(nb.id, { title: 'Human work', by: 'agent:x', data: { theme: 'Human work', evidence: 'She writes her drafts.' } }).entry;
    s.setSteps(nb.id, [{ title: 'Find what she said', kind: 'find', target: 1, status: 'done' }, { title: 'Write the talking points', kind: 'write', target: 3, status: 'done' }]);
    s.setLayout(nb.id, layoutPreset('dossier')!.layout, 'notebook');
    const points = [{ text: 'Open with her drafts', from: [a.id] }, { text: 'Confirm her current role at Acme', from: [] }, { text: 'Ask what comes next', from: [] }];
    s.setBriefing(nb.id, { points, questions: ['Q?'], watch: [], at: '2026-10-26T12:00:00Z', by: 'notebook-writer' });
    s.setBriefing(nb.id, { points, questions: ['Q?'], watch: [], at: '2026-10-27T12:00:00Z', by: 'notebook-writer' });
    const previous = s.get(nb.id)!.briefing!.previous;
    expect(notebookWidgetData(s.get(nb.id)!, s.entries(nb.id)).notebook.talkingPointsReplace).toBe(`/notebooks/${nb.id}/talking-points/replace`);
    expect(notebookWidgetComponents(s.get(nb.id)!).find((c) => c.component === 'Agenda')).toMatchObject({ replaceHref: { path: '/notebook/talkingPointsReplace' } });

    // A page drawn before the point changed strikes nothing.
    const stale = await post(`/notebooks/${nb.id}/talking-points/replace`, `at=1&text=${encodeURIComponent('Something else')}`);
    expect(decodeURIComponent(stale.headers.location)).toContain('That point has changed since. Nothing was struck.');

    S.writerAsked.length = 0;
    S.writerReply = () => `<briefing>${JSON.stringify({ points: [{ text: 'Ask where AI stops in her drafts', why: 'In her post on drafting she said she writes them herself.', from: [a.id] }], questions: [], watch: [] })}</briefing>`;
    const res = await post(`/notebooks/${nb.id}/talking-points/replace`, `at=1&text=${encodeURIComponent('Confirm her current role at Acme')}`);
    expect(decodeURIComponent(res.headers.location)).toContain('Struck it. sua is writing a new point in its place.');
    for (let i = 0; i < 50 && s.get(nb.id)!.briefing!.points.length < 3; i++) await new Promise((r) => setTimeout(r, 20));
    const after = s.get(nb.id)!.briefing!;
    // In its place, the others as they were; what the band compares against is untouched.
    expect(after.points.map((p) => p.text)).toEqual(['Open with her drafts', 'Ask where AI stops in her drafts', 'Ask what comes next']);
    expect(after).toMatchObject({ questions: ['Q?'], struck: ['Confirm her current role at Acme'], previous });
    // The writer was asked for one, knowing what's kept and what was struck.
    const asked = JSON.parse(S.writerAsked[0].NOTEBOOK) as { keep: string[]; skip: string[] };
    expect(S.writerAsked[0].COUNT).toBe('1');
    expect(asked.keep).toEqual(['Open with her drafts', 'Ask what comes next']);
    expect(asked.skip).toEqual(['Confirm her current role at Acme']);

    // Write again: the struck point is still skipped, and kept on the rewrite.
    S.writerReply = () => `<briefing>${JSON.stringify({ points: [{ text: 'A fresh opener', from: [a.id] }] })}</briefing>`;
    S.writerAsked.length = 0;
    await post(`/notebooks/${nb.id}/steps/${s.get(nb.id)!.steps![1].id}/again`, '');
    for (let i = 0; i < 50 && s.get(nb.id)!.briefing!.points[0].text !== 'A fresh opener'; i++) await new Promise((r) => setTimeout(r, 20));
    expect(JSON.parse(S.writerAsked[0].NOTEBOOK)).toMatchObject({ skip: ['Confirm her current role at Acme'] });
    expect(JSON.parse(S.writerAsked[0].NOTEBOOK).keep).toBeUndefined();
    expect(s.get(nb.id)!.briefing!.struck).toEqual(['Confirm her current role at Acme']);
    S.writerReply = undefined;
  });

  it('a correction in the conversation: worked out as a card, applied, what rests on it rewritten, and kept when research looks again', async () => {
    await makeApp();
    const ctx = S.ctx!;
    const { NotebookStore, InboxStore } = await import('@some-useful-agents/core');
    const { notebookThread } = await import('../lib/notebook-chat.js');
    const { startNotebookCorrection, applyNotebookCorrection } = await import('../lib/notebook-correction.js');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const inbox = InboxStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.create({ title: 'Meet Dana Reyes' });
    s.setFields(nb.id, [{ key: 'theme', label: 'Theme', type: 'text' }]);
    const a = s.upsertOption(nb.id, { title: 'Running ops', by: 'agent:x', data: { theme: 'Running ops' } }).entry;
    s.setSteps(nb.id, [{ title: 'Find what she said', kind: 'find', target: 1, status: 'done' }, { title: 'Write the talking points', kind: 'write', target: 3, status: 'done' }]);
    s.setAbout(nb.id, 'person', { name: 'Dana Reyes', facts: [{ key: 'role', label: 'Role', value: 'VP Ops' }, { key: 'location', label: 'Based in', value: 'Austin' }] });
    s.setBriefing(nb.id, {
      points: [{ text: 'Open with her drafts', from: [a.id] }, { text: 'Ask how she runs ops as VP Ops', from: [a.id] }, { text: 'Ask what comes next', from: [] }],
      questions: ['As VP Ops, what keeps you up at night?', 'Who else should I meet?'], watch: [], at: '2026-10-26T12:00:00Z', by: 'notebook-writer',
    });
    const thread = notebookThread(ctx, s.get(nb.id)!)!;
    const said = "She's COO now, not VP Ops";
    const lastAction = () => JSON.parse([...inbox.listResponses(thread)].reverse().find((r) => r.role === 'action')!.metaJson!) as import('@some-useful-agents/core').InboxActionMeta;
    const lastWords = () => [...inbox.listResponses(thread)].reverse().find((r) => r.role === 'triage')!.body;

    // Triage hands it over in their words; working it out changes nothing (a read).
    const { parseProposedActions } = await import('./inbox-plan.js');
    const parsed = parseProposedActions([{ type: 'notebook-correct', rationale: 'A correction', inputs: { NOTEBOOK: nb.id, INSTRUCTION: ` ${said} ` } }, { type: 'notebook-correct', inputs: { NOTEBOOK: nb.id } }], [], []);
    expect(parsed.accepted[0]).toMatchObject({ agentId: 'notebook-correct', effect: 'read', inputs: { NOTEBOOK: nb.id, INSTRUCTION: said } });
    expect(parsed.rejected[0].reason).toBe('notebook-correct needs inputs.NOTEBOOK and inputs.INSTRUCTION');

    // Worked out: the agent names the change; the points and questions that say the old role come along by their words.
    S.correctionReply = () => `<correction>${JSON.stringify({ semantic_delta: { type: 'about-fact', target_id: 'about:person:role', old_value: 'VP Ops', new_value: 'COO', label: 'Role' }, impact: [{ object_id: 'point:2', action: 'keep', reason: 'not about her role' }, { object_id: 'about:person:location', action: 'invalidate', reason: 'x' }], clarification_required: false, clarification_question: '' })}</correction>`;
    let work: Promise<void> | undefined;
    expect(startNotebookCorrection(ctx, thread, { kind: 'action', status: 'proposed', agentId: 'notebook-correct', inputs: { NOTEBOOK: nb.id, INSTRUCTION: said } }, (p) => { work = p; })).toMatchObject({ status: 'completed' });
    await work;
    expect(S.correctionAsked[0].INSTRUCTION).toBe(said);
    expect(JSON.parse(S.correctionAsked[0].NOTEBOOK).parts).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'about:person:role', role: 'evidence' }), expect.objectContaining({ id: 'point:1', role: 'judgment', from: [`option:${a.id}`] })]));
    const card = lastAction();
    expect(card).toMatchObject({ agentId: 'notebook-correct-apply', status: 'proposed', ctaLabel: 'Apply' });
    expect(card.surfaceChanges).toEqual(expect.arrayContaining([
      { what: 'Role', before: 'VP Ops', after: 'COO' },
      expect.objectContaining({ what: 'rewrite', before: 'Ask how she runs ops as VP Ops' }),
      expect.objectContaining({ what: 'take out', before: 'As VP Ops, what keeps you up at night?' }),
      // A fact about them isn't dropped by another fact's change: looked at again, not taken out.
      expect.objectContaining({ what: 'may be out of date', before: 'Dana Reyes, Based in: Austin' }),
    ]));
    expect(card.rationale).toBe('Role: VP Ops → COO. Rewrites 1, takes out 1, flags 1 that may be out of date; everything else stays as it is.');
    // Nothing changed yet.
    expect(s.get(nb.id)!.about!.person!.facts.find((f) => f.key === 'role')!.value).toBe('VP Ops');

    // Applied: the fact now, the question out, the point written again in its place.
    S.writerReply = () => `<briefing>${JSON.stringify({ points: [{ text: 'Ask how she runs ops as COO', from: [a.id] }] })}</briefing>`;
    S.writerAsked.length = 0;
    let wrote: Promise<void> | undefined;
    const applied = applyNotebookCorrection(ctx, thread, card, (p) => { wrote = p; });
    expect(applied).toMatchObject({ status: 'completed' });
    expect(applied.summary).toBe('Role is COO now, as you said; took out 1 question; rewriting 1 talking point…');
    await wrote;
    const after = s.get(nb.id)!;
    expect(after.about!.person!.facts.find((f) => f.key === 'role')).toMatchObject({ value: 'COO', was: { value: 'VP Ops' } });
    expect(after.about!.person!.facts.find((f) => f.key === 'location')!.value).toBe('Austin');
    expect(after.briefing!.points.map((p) => p.text)).toEqual(['Open with her drafts', 'Ask how she runs ops as COO', 'Ask what comes next']);
    expect(after.briefing).toMatchObject({ questions: ['Who else should I meet?'], struck: ['Ask how she runs ops as VP Ops'] });
    expect(S.writerAsked[0].COUNT).toBe('1');
    expect(JSON.parse(S.writerAsked[0].NOTEBOOK)).toMatchObject({ keep: ['Open with her drafts', 'Ask what comes next'], person: { facts: expect.arrayContaining(['Role: COO']) } });
    expect(lastWords()).toContain('Corrected **Meet Dana Reyes**');
    expect(ctx.notebookPipelines?.has(nb.id)).toBeFalsy();

    // Research looking again doesn't change it back.
    s.setAbout(nb.id, 'person', { facts: [{ key: 'role', label: 'Role', value: 'VP Ops' }, { key: 'location', label: 'Based in', value: 'Denver' }] });
    expect(s.get(nb.id)!.about!.person!.facts.find((f) => f.key === 'role')!.value).toBe('COO');
    expect(s.get(nb.id)!.about!.person!.facts.find((f) => f.key === 'location')!.value).toBe('Denver');

    // Unclear: the agent's question, and no card.
    const cards = inbox.listResponses(thread).filter((r) => r.role === 'action').length;
    S.correctionReply = () => `<correction>${JSON.stringify({ semantic_delta: { type: 'other', target_id: '', old_value: '', new_value: '' }, impact: [], clarification_required: true, clarification_question: 'Which point do you mean?' })}</correction>`;
    startNotebookCorrection(ctx, thread, { kind: 'action', status: 'proposed', agentId: 'notebook-correct', inputs: { NOTEBOOK: nb.id, INSTRUCTION: "that's wrong" } }, (p) => { work = p; });
    await work;
    expect(lastWords()).toBe('Which point do you mean?');
    // A part the notebook doesn't have is a question too, never a guess.
    S.correctionReply = () => `<correction>${JSON.stringify({ semantic_delta: { type: 'written', target_id: 'point:9', old_value: 'x', new_value: '' }, impact: [] })}</correction>`;
    startNotebookCorrection(ctx, thread, { kind: 'action', status: 'proposed', agentId: 'notebook-correct', inputs: { NOTEBOOK: nb.id, INSTRUCTION: 'drop the one about boats' } }, (p) => { work = p; });
    await work;
    expect(lastWords()).toBe('Which part of the notebook is wrong, and what should it say?');
    expect(inbox.listResponses(thread).filter((r) => r.role === 'action').length).toBe(cards);
    S.correctionReply = undefined;
    S.writerReply = undefined;
  });

  it("a correction's recheck counts the checks it reopened, not one that was open before", async () => {
    await makeApp();
    const ctx = S.ctx!;
    const { NotebookStore, InboxStore } = await import('@some-useful-agents/core');
    const { notebookThread } = await import('../lib/notebook-chat.js');
    const { startNotebookCorrection, applyNotebookCorrection } = await import('../lib/notebook-correction.js');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const inbox = InboxStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.create({ title: 'Meet Sam Ortiz' });
    s.setFields(nb.id, [{ key: 'topic', label: 'Topic', type: 'text' }]);
    s.setChecks(nb.id, ['Confirm their current role', 'Confirm it is connected to them', 'Check time-sensitive claims are current']);
    s.setSteps(nb.id, [{ title: 'Find topics', kind: 'find', target: 1, status: 'done' }, { title: 'Check topics', kind: 'check', status: 'stuck' }]);
    s.setAbout(nb.id, 'person', { name: 'Sam Ortiz', facts: [{ key: 'organization', label: 'Company', value: 'Acme' }] });
    const a = s.upsertOption(nb.id, { title: 'Pipeline reviews', by: 'agent:x', data: { topic: 'Pipeline reviews' } }).entry;
    s.checkOption(nb.id, a.id, 'Confirm their current role', true);
    s.checkOption(nb.id, a.id, 'Confirm it is connected to them', true);
    // The third check was still open before the correction.
    const thread = notebookThread(ctx, s.get(nb.id)!)!;
    S.correctionReply = () => `<correction>${JSON.stringify({ semantic_delta: { type: 'about-fact', target_id: 'about:person:organization', old_value: 'Acme', new_value: 'Acme and Brightline', label: 'Company' }, impact: [{ object_id: `option:${a.id}:check:0`, action: 'reevaluate', reason: 'his role' }, { object_id: `option:${a.id}:check:1`, action: 'reevaluate', reason: 'his work' }], clarification_required: false, clarification_question: '' })}</correction>`;
    let work: Promise<void> | undefined;
    startNotebookCorrection(ctx, thread, { kind: 'action', status: 'proposed', agentId: 'notebook-correct', inputs: { NOTEBOOK: nb.id, INSTRUCTION: 'He does both' } }, (p) => { work = p; });
    await work;
    S.correctionReply = undefined;
    const card = JSON.parse([...inbox.listResponses(thread)].reverse().find((r) => r.role === 'action')!.metaJson!) as import('@some-useful-agents/core').InboxActionMeta;
    // The checker answers the two it reopened; the time-sensitive one stays unknown.
    S.checkerReply = () => `<notebook>${JSON.stringify({ facts: [{ id: a.id, checked: ['Confirm their current role', 'Confirm it is connected to them'] }] })}</notebook>`;
    let checked: Promise<void> | undefined;
    applyNotebookCorrection(ctx, thread, card, (p) => { checked = p; });
    await checked;
    S.checkerReply = undefined;
    const words = [...inbox.listResponses(thread)].reverse().find((r) => r.role === 'triage')!.body;
    expect(words).toContain('1 of 1 corrected checked');
    expect(words).not.toContain('still open');
  });

  it('a correction applied while a step runs waits on its card, and applies itself when the step is done', async () => {
    await makeApp();
    const ctx = S.ctx!;
    const { NotebookStore, InboxStore } = await import('@some-useful-agents/core');
    const { notebookThread } = await import('../lib/notebook-chat.js');
    const { startNotebookCorrection } = await import('../lib/notebook-correction.js');
    const { reconcileStepCards } = await import('../lib/notebook-step-queue.js');
    const { runProposedAction } = await import('./inbox-engine.js');
    const { formatConversationSnapshot } = await import('./inbox-shared.js');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const inbox = InboxStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.create({ title: 'Meet Sam Ortiz' });
    s.setSteps(nb.id, [{ title: 'Learn about Sam', kind: 'profile', status: 'done' }, { title: 'Check topics and sources', kind: 'check', status: 'running' }]);
    s.setAbout(nb.id, 'person', { name: 'Sam Ortiz', facts: [{ key: 'organization', label: 'Company', value: 'Acme (not settled: Acme or Brightline)' }] });
    const thread = notebookThread(ctx, s.get(nb.id)!)!;
    S.correctionReply = () => `<correction>${JSON.stringify({ semantic_delta: { type: 'about-fact', target_id: 'about:person:organization', old_value: 'Acme (not settled: Acme or Brightline)', new_value: 'Acme and Brightline', label: 'Company' }, impact: [], clarification_required: false, clarification_question: '' })}</correction>`;
    let work: Promise<void> | undefined;
    startNotebookCorrection(ctx, thread, { kind: 'action', status: 'proposed', agentId: 'notebook-correct', inputs: { NOTEBOOK: nb.id, INSTRUCTION: 'Sam does both' } }, (p) => { work = p; });
    await work;
    S.correctionReply = undefined;
    const cardRow = () => [...inbox.listResponses(thread)].reverse().find((r) => r.role === 'action' && r.metaJson?.includes('notebook-correct-apply'))!;
    const meta = () => JSON.parse(cardRow().metaJson!) as import('@some-useful-agents/core').InboxActionMeta;
    const company = () => s.get(nb.id)!.about!.person!.facts.find((f) => f.key === 'organization')!.value;

    // Apply pressed mid-step: approved, waiting; nothing changed yet.
    ctx.notebookPipelines ??= new Map();
    ctx.notebookPipelines.set(nb.id, { agentId: 'notebook-checker', step: 2, of: 2, startedAt: Date.now() });
    const pressed: import('@some-useful-agents/core').InboxActionMeta = { ...meta(), status: 'running', startedAt: Date.now(), approvedBy: 'operator' };
    expect(inbox.transitionActionStatus(cardRow().id, 'proposed', JSON.stringify(pressed))).toBe(true);
    await runProposedAction(ctx, thread, cardRow(), pressed);
    expect(meta()).toMatchObject({ status: 'proposed', waitingFor: 'Check topics and sources', approvedBy: 'operator' });
    expect(meta().startedAt).toBeUndefined();
    expect(company()).toBe('Acme (not settled: Acme or Brightline)');
    expect(formatConversationSnapshot(inbox.listResponses(thread))).toContain('approved, waiting for Check topics and sources');
    // Still mid-step: a reconcile leaves it waiting.
    reconcileStepCards(ctx, nb.id);
    expect(meta().status).toBe('proposed');

    // The step is done: it applies itself.
    s.updateStep(nb.id, s.get(nb.id)!.steps![1].id, { status: 'stuck' });
    ctx.notebookPipelines.delete(nb.id);
    reconcileStepCards(ctx, nb.id);
    for (let i = 0; i < 50 && meta().status !== 'completed'; i++) await new Promise((r) => setTimeout(r, 20));
    expect(meta()).toMatchObject({ status: 'completed' });
    expect(meta().waitingFor).toBeUndefined();
    expect(company()).toBe('Acme and Brightline');
  });

  it("a correction to an option's fact: its check results are forgotten, it's checked again, and its pick says what changed", async () => {
    await makeApp();
    const ctx = S.ctx!;
    const { NotebookStore, InboxStore } = await import('@some-useful-agents/core');
    const { notebookThread } = await import('../lib/notebook-chat.js');
    const { startNotebookCorrection, applyNotebookCorrection } = await import('../lib/notebook-correction.js');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const inbox = InboxStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.create({ title: 'Buy a stand mixer' });
    s.setFields(nb.id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'bowl', label: 'Bowl', type: 'text' }]);
    s.setChecks(nb.id, ['Under $400', 'Bowl of 5 qt or more']);
    s.setSteps(nb.id, [{ title: 'Find 2 mixers', kind: 'find', target: 2, status: 'done' }, { title: 'Check them', kind: 'check', status: 'done' }, { title: 'Pick one', kind: 'decide', target: 1 }]);
    const a = s.upsertOption(nb.id, { title: 'Artisan', by: 'agent:x', data: { price: 350, bowl: '5 qt' } }).entry;
    const b = s.upsertOption(nb.id, { title: 'Classic', by: 'agent:x', data: { price: 280, bowl: '4.5 qt' } }).entry;
    s.checkOption(nb.id, a.id, 'Under $400', true);
    s.checkOption(nb.id, a.id, 'Bowl of 5 qt or more', true);
    s.choose(nb.id, a.id);
    s.checkOption(nb.id, b.id, 'Under $400', true);
    s.ruleOut(nb.id, b.id, 'Fails "Bowl of 5 qt or more": "4.5 qt bowl"', 'agent:notebook-checker');
    const thread = notebookThread(ctx, s.get(nb.id)!)!;
    const lastAction = () => JSON.parse([...inbox.listResponses(thread)].reverse().find((r) => r.role === 'action')!.metaJson!) as import('@some-useful-agents/core').InboxActionMeta;
    const lastWords = () => [...inbox.listResponses(thread)].reverse().find((r) => r.role === 'triage')!.body;
    const correct = async (said: string, delta: Record<string, string>, impact: unknown[] = []) => {
      S.correctionReply = () => `<correction>${JSON.stringify({ semantic_delta: delta, impact, clarification_required: false, clarification_question: '' })}</correction>`;
      let work: Promise<void> | undefined;
      startNotebookCorrection(ctx, thread, { kind: 'action', status: 'proposed', agentId: 'notebook-correct', inputs: { NOTEBOOK: nb.id, INSTRUCTION: said } }, (p) => { work = p; });
      await work;
      return lastAction();
    };

    // The price was wrong: its checks and its pick come along by the notebook's links.
    const card = await correct('The Artisan is actually $450', { type: 'option-fact', target_id: `option:${a.id}:price`, old_value: '350', new_value: '450' });
    expect(card).toMatchObject({ agentId: 'notebook-correct-apply', rationale: 'Artisan, Price: 350 → 450. Looks again at 3; everything else stays as it is.' });
    expect(card.surfaceChanges![0]).toEqual({ what: 'Artisan, Price', before: '350', after: '450' });

    // Applied: the fact now; then just this option, just those checks, with the check step's agent.
    const asked: Array<Record<string, string>> = [];
    S.checkerReply = (inputs) => { asked.push(inputs); return `<notebook>${JSON.stringify({ facts: [{ id: a.id, checked: ['Bowl of 5 qt or more'], ruleOut: 'Fails "Under $400": "$450.00"' }] })}</notebook>`; };
    let checked: Promise<void> | undefined;
    const applied = applyNotebookCorrection(ctx, thread, card, (p) => { checked = p; });
    expect(applied.summary).toBe("Artisan's price is $450 now, as you said; checking it again…");
    expect(s.entries(nb.id).find((e) => e.id === a.id)!.data!.price).toBe(450);
    await checked;
    expect(JSON.parse(asked[0].OPTIONS).map((o: { id: string }) => o.id)).toEqual([a.id]);
    expect(JSON.parse(asked[0].OPTIONS)[0].left).toEqual(['Under $400', 'Bowl of 5 qt or more']);
    const artisan = s.entries(nb.id).find((e) => e.id === a.id)!;
    // Picked, so failing a check is your call: it stays picked and says why.
    expect(artisan).toMatchObject({ checked: ['Bowl of 5 qt or more'], failedChecks: { 'Under $400': expect.stringContaining('$450') } });
    expect(artisan.chosenAt).toBeTruthy();
    expect(artisan.ruledOut).toBeUndefined();
    expect(lastWords()).toContain('Checked what you corrected (**Check them**, with notebook-checker): 1 of 1 corrected checked');
    expect(lastWords()).toContain('Artisan is still picked, but now fails "Under $400": unpick it if that changes your mind');

    // A fact that ruled one out was wrong: it's back in, checked again on the check that rests on it (the agent says which), and passes.
    const back = await correct("The Classic's bowl is 5 qt, not 4.5", { type: 'option-fact', target_id: `option:${b.id}:bowl`, old_value: '4.5 qt', new_value: '5 qt' }, [{ object_id: `option:${b.id}:check:1`, action: 'reevaluate', reason: 'about the bowl' }]);
    expect(back.surfaceChanges).toEqual(expect.arrayContaining([expect.objectContaining({ what: 'look again', before: 'Classic ruled out: Fails "Bowl of 5 qt or more": "4.5 qt bowl"' })]));
    S.checkerReply = () => `<notebook>${JSON.stringify({ facts: [{ id: b.id, checked: ['Bowl of 5 qt or more'] }] })}</notebook>`;
    applyNotebookCorrection(ctx, thread, back, (p) => { checked = p; });
    await checked;
    expect(s.entries(nb.id).find((e) => e.id === b.id)).toMatchObject({ checked: ['Under $400', 'Bowl of 5 qt or more'], data: { bowl: '5 qt' } });
    expect(s.entries(nb.id).find((e) => e.id === b.id)!.ruledOut).toBeUndefined();
    expect(lastWords()).toContain('brought Classic back to check it again');

    // Checked again and it fails: ruled out now, and sua says why.
    const dearer = await correct("The Classic is $420, not $280", { type: 'option-fact', target_id: `option:${b.id}:price`, old_value: '$280', new_value: '$420' }, [{ object_id: `option:${b.id}:check:0`, action: 'reevaluate', reason: 'the price check' }]);
    S.checkerReply = () => `<notebook>${JSON.stringify({ facts: [{ id: b.id, ruleOut: 'Fails "Under $400": "$420"' }] })}</notebook>`;
    applyNotebookCorrection(ctx, thread, dearer, (p) => { checked = p; });
    await checked;
    expect(s.entries(nb.id).find((e) => e.id === b.id)!.ruledOut).toMatchObject({ reason: 'Fails "Under $400": "$420"' });
    expect(lastWords()).toContain('Classic is ruled out now (Fails "Under $400": "$420")');
    S.checkerReply = undefined;
    S.correctionReply = undefined;
  });

  it('a correction to a rule: a changed check checks every option on it, a limit brings back what it ruled out, a done-when goes', async () => {
    await makeApp();
    const ctx = S.ctx!;
    const { NotebookStore, InboxStore } = await import('@some-useful-agents/core');
    const { notebookThread } = await import('../lib/notebook-chat.js');
    const { startNotebookCorrection, applyNotebookCorrection } = await import('../lib/notebook-correction.js');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const inbox = InboxStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.create({ title: 'Buy a stand mixer', params: ['under $400'], criteria: ['One picked', 'Bought by Friday'] });
    s.setFields(nb.id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'bowl', label: 'Bowl', type: 'text' }]);
    s.setChecks(nb.id, ['Under $400', 'Bowl of 5 qt or more']);
    s.setSteps(nb.id, [{ title: 'Find mixers', kind: 'find', target: 3, status: 'done' }, { title: 'Check them', kind: 'check', status: 'done' }, { title: 'Pick one', kind: 'decide', target: 1 }]);
    const a = s.upsertOption(nb.id, { title: 'Artisan', by: 'agent:x', data: { price: 350, bowl: '5 qt' } }).entry;
    const b = s.upsertOption(nb.id, { title: 'Classic', by: 'agent:x', data: { price: 280, bowl: '4.5 qt' } }).entry;
    const c = s.upsertOption(nb.id, { title: 'Tilt-head', by: 'agent:x', data: { price: 300, bowl: '4.5 qt' } }).entry;
    const d = s.upsertOption(nb.id, { title: 'Pro 600', by: 'agent:x', data: { price: 520, bowl: '6 qt' } }).entry;
    for (const k of ['Under $400', 'Bowl of 5 qt or more']) s.checkOption(nb.id, a.id, k, true);
    s.checkOption(nb.id, b.id, 'Under $400', true);
    s.ruleOut(nb.id, b.id, 'Fails "Bowl of 5 qt or more": "4.5 qt bowl"', 'agent:notebook-checker');
    // One you ruled out stays yours, whatever changes.
    s.ruleOut(nb.id, c.id, 'Fails "Bowl of 5 qt or more": "4.5 qt"', 'you');
    s.ruleOut(nb.id, d.id, 'Over budget: $520', 'agent:x');
    const thread = notebookThread(ctx, s.get(nb.id)!)!;
    const lastAction = () => JSON.parse([...inbox.listResponses(thread)].reverse().find((r) => r.role === 'action')!.metaJson!) as import('@some-useful-agents/core').InboxActionMeta;
    const lastWords = () => [...inbox.listResponses(thread)].reverse().find((r) => r.role === 'triage')!.body;
    const correct = async (said: string, delta: Record<string, string>, impact: unknown[] = []) => {
      S.correctionReply = () => `<correction>${JSON.stringify({ semantic_delta: delta, impact, clarification_required: false, clarification_question: '' })}</correction>`;
      let work: Promise<void> | undefined;
      startNotebookCorrection(ctx, thread, { kind: 'action', status: 'proposed', agentId: 'notebook-correct', inputs: { NOTEBOOK: nb.id, INSTRUCTION: said } }, (p) => { work = p; });
      await work;
      return lastAction();
    };
    let done: Promise<void> | undefined;
    const asked: Array<Record<string, string>> = [];

    // A check changes: its results are forgotten, the one it ruled out comes back, and every option is checked on it.
    const check = await correct('A 4 qt bowl is fine', { type: 'check', target_id: 'check:1', old_value: '5 qt', new_value: 'Bowl of 4 qt or more' });
    expect(check.rationale).toBe('Check: Bowl of 5 qt or more → Bowl of 4 qt or more. Checks the options against it, looks again at 2; everything else stays as it is.');
    S.checkerReply = (inputs) => { asked.push(inputs); return `<notebook>${JSON.stringify({ facts: [{ id: a.id, checked: ['Bowl of 4 qt or more'] }, { id: b.id, checked: ['Bowl of 4 qt or more'] }] })}</notebook>`; };
    expect(applyNotebookCorrection(ctx, thread, check, (p) => { done = p; }).summary).toBe('The check "Bowl of 5 qt or more" is "Bowl of 4 qt or more" now; brought Classic back to check it again; checking the options against it…');
    await done;
    expect(s.get(nb.id)!.checks).toEqual(['Under $400', 'Bowl of 4 qt or more']);
    expect(JSON.parse(asked[0].OPTIONS).map((o: { id: string; left: string[] }) => [o.id, o.left])).toEqual(expect.arrayContaining([[a.id, ['Bowl of 4 qt or more']], [b.id, ['Bowl of 4 qt or more']]]));
    const opts = () => Object.fromEntries(s.entries(nb.id).filter((e) => e.kind === 'option').map((e) => [e.title, e]));
    expect(opts().Artisan.checked).toEqual(['Under $400', 'Bowl of 4 qt or more']);
    expect(opts().Classic).toMatchObject({ checked: ['Under $400', 'Bowl of 4 qt or more'] });
    expect(opts().Classic.ruledOut).toBeUndefined();
    expect(opts()['Tilt-head'].ruledOut).toMatchObject({ by: 'you' });
    expect(lastWords()).toContain('Checked against the changed check (**Check them**, with notebook-checker): 2 of 2 checked');

    // A limit changes: what the agent says it ruled out comes back and is checked.
    asked.length = 0;
    const limit = await correct('The budget is $600 now', { type: 'limit', target_id: 'limit:0', old_value: 'under $400', new_value: 'under $600' }, [{ object_id: `option:${d.id}:ruled-out`, action: 'reevaluate', reason: 'over the old budget' }]);
    expect(limit.surfaceChanges![0]).toEqual({ what: 'limit', before: 'under $400', after: 'under $600' });
    S.checkerReply = (inputs) => { asked.push(inputs); return `<notebook>${JSON.stringify({ facts: [{ id: d.id, checked: ['Bowl of 4 qt or more'] }] })}</notebook>`; };
    applyNotebookCorrection(ctx, thread, limit, (p) => { done = p; });
    await done;
    expect(s.get(nb.id)!.params).toEqual(['under $600']);
    expect(JSON.parse(asked[0].OPTIONS).map((o: { id: string }) => o.id)).toEqual([d.id]);
    expect(opts()['Pro 600'].ruledOut).toBeUndefined();
    expect(lastWords()).toContain('the limit "under $400" is "under $600" now; the next search uses it; brought Pro 600 back to check it again');

    // A limit and the check that applies it change together: both, and every option is checked on the new check.
    asked.length = 0;
    const both = await correct('Up to $700 is fine', { type: 'limit', target_id: 'limit:0', old_value: 'under $600', new_value: 'under $700' }, [{ object_id: 'check:0', action: 'reevaluate', reason: 'it applies the budget', new_value: 'Under $700' }]);
    expect(both.rationale).toBe('Limit: under $600 → under $700. Changes 1 more rule with it, checks the options against it, looks again at 2; everything else stays as it is.');
    expect(both.surfaceChanges![1]).toEqual({ what: 'check', before: 'Under $400', after: 'Under $700' });
    S.checkerReply = (inputs) => { asked.push(inputs); return `<notebook>${JSON.stringify({ facts: [] })}</notebook>`; };
    applyNotebookCorrection(ctx, thread, both, (p) => { done = p; });
    await done;
    expect(s.get(nb.id)!).toMatchObject({ params: ['under $700'], checks: ['Under $700', 'Bowl of 4 qt or more'] });
    expect(JSON.parse(asked[0].OPTIONS).map((o: { left: string[] }) => o.left[0])).toEqual(['Under $700', 'Under $700', 'Under $700']);
    expect(lastWords()).toContain('the limit "under $600" is "under $700" now; the check "Under $400" is "Under $700" now; the next search uses it');

    // A done-when taken out: just that.
    const crit = await correct("We don't need it by Friday", { type: 'criterion', target_id: 'criterion:1', old_value: 'Bought by Friday', new_value: '' });
    expect(crit.rationale).toBe('Done when: Bought by Friday → taken out. Nothing else changes.');
    expect(applyNotebookCorrection(ctx, thread, crit).summary).toBe('Took out the done-when "Bought by Friday".');
    expect(s.get(nb.id)!.criteria.map((x) => x.text)).toEqual(['One picked']);
    // A card made before the rule changed again finds it by its words, or refuses.
    expect(applyNotebookCorrection(ctx, thread, crit)).toMatchObject({ status: 'failed', refusalReason: 'That rule has changed since this was worked out. Ask again.' });
    S.checkerReply = undefined;
    S.correctionReply = undefined;
  });

  it("a correction to their photo: a page's picture is kept as theirs, a picture's link fact goes, and research doesn't replace it", async () => {
    await makeApp();
    const ctx = S.ctx!;
    const { NotebookStore, InboxStore } = await import('@some-useful-agents/core');
    const { notebookThread } = await import('../lib/notebook-chat.js');
    const { startNotebookCorrection, applyNotebookCorrection } = await import('../lib/notebook-correction.js');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const inbox = InboxStore.fromHandle(S.runStore.databaseHandle());
    const nb = s.create({ title: 'Meet Dana Reyes' });
    s.setAbout(nb.id, 'person', { name: 'Dana Reyes', facts: [{ key: 'role', label: 'Role', value: 'COO' }, { key: 'image', label: 'Who they are ProfileCard photo', value: 'https://dana.example/dana.png' }] });
    s.saveAboutPhoto(nb.id, 'person', 'https://old.example/dana-2016.jpg', { contentType: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]) }, 'photo', { page: 'https://old.example/p/dana', why: 'captioned with their name on a page about them' });
    const thread = notebookThread(ctx, s.get(nb.id)!)!;
    const lastAction = () => JSON.parse([...inbox.listResponses(thread)].reverse().find((r) => r.role === 'action')!.metaJson!) as import('@some-useful-agents/core').InboxActionMeta;
    const lastWords = () => [...inbox.listResponses(thread)].reverse().find((r) => r.role === 'triage')!.body;
    const correct = async (said: string, delta: Record<string, string>) => {
      S.correctionReply = () => `<correction>${JSON.stringify({ semantic_delta: delta, impact: [], clarification_required: false, clarification_question: '' })}</correction>`;
      let work: Promise<void> | undefined;
      startNotebookCorrection(ctx, thread, { kind: 'action', status: 'proposed', agentId: 'notebook-correct', inputs: { NOTEBOOK: nb.id, INSTRUCTION: said } }, (p) => { work = p; });
      await work;
    };

    // The agent sees the picture the page shows, as a part.
    S.correctionAsked.length = 0;
    await correct('Use the portrait on my About page', { type: 'about-fact', target_id: 'about:person:photo', old_value: 'https://old.example/dana-2016.jpg', new_value: 'https://dana.example/about', label: 'Photo' });
    expect(JSON.parse(S.correctionAsked[0].NOTEBOOK).parts).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'about:person:photo', kind: 'photo', text: 'Dana Reyes, Photo: https://old.example/dana-2016.jpg (on https://old.example/p/dana)' })]));
    const card = lastAction();
    expect(card.surfaceChanges).toEqual(expect.arrayContaining([
      { what: 'Photo', before: 'the picture on old.example', after: 'the picture on dana.example' },
      expect.objectContaining({ what: 'take out', before: 'Dana Reyes, Who they are ProfileCard photo: https://dana.example/dana.png' }),
    ]));

    // Applied: the page isn't a picture, so its picture of them is found there and kept as yours; the link fact goes.
    const fetched: string[] = [];
    ctx.notebookLogoDeps = { fetchImage: async (u) => { fetched.push(u); if (u.endsWith('/about')) throw new Error('not an image'); return { contentType: 'image/png', bytes: new Uint8Array([9, 9]) }; }, siteIcons: async () => [] };
    const checkPhoto = ctx.notebookPersonPhotoCheck;
    ctx.notebookPersonPhotoCheck = async (page, name) => ({ image: 'https://dana.example/dana.png', page, why: `captioned ${name}` });
    let done: Promise<void> | undefined;
    expect(applyNotebookCorrection(ctx, thread, card, (p) => { done = p; }).summary).toBe("Took out the picture's link from what it knows about them; fetching the picture…");
    await done;
    expect(fetched).toEqual(['https://dana.example/about', 'https://dana.example/dana.png']);
    expect(s.aboutPhoto(nb.id, 'person')).toMatchObject({ sourceUrl: 'https://dana.example/dana.png', page: 'https://dana.example/about', why: 'you picked it' });
    expect(s.get(nb.id)!.about!.person!.facts.map((f) => f.key)).toEqual(['role']);
    expect(lastWords()).toContain('kept the photo from dana.example, as you picked');

    // Not a link: asked for one. None at all: it goes, and isn't used again.
    await correct("That photo isn't me", { type: 'about-fact', target_id: 'about:person:photo', old_value: '', new_value: 'my newer one', label: 'Photo' });
    expect(lastWords()).toBe('Send me a link to the picture to use: the picture itself, or a page it’s on.');
    await correct("That photo isn't me", { type: 'about-fact', target_id: 'about:person:photo', old_value: 'https://dana.example/dana.png', new_value: '', label: 'Photo' });
    expect(applyNotebookCorrection(ctx, thread, lastAction()).summary).toBe("Took out the photo; it won't be used again.");
    expect(s.aboutPhoto(nb.id, 'person')).toBeUndefined();
    expect(s.get(nb.id)!.about!.person!.rejectedPhotos).toEqual(['https://dana.example/dana.png']);
    ctx.notebookLogoDeps = undefined;
    ctx.notebookPersonPhotoCheck = checkPhoto;
    S.correctionReply = undefined;
  });
});

describe('a find step that needs something the notebook does not have', () => {
  it('searches nothing, guesses nothing, tries once, and says what to give it', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const { startNotebookStep } = await import('../lib/notebook-steps.js');
    const ctx = getContext(app.locals);
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Find jobs matched to my profile', statement: 'A job search matched to my LinkedIn profile.', params: [], criteria: [], pipeline: [], cadence: '' });
    store.setFields(nb.id, [{ key: 'url', label: 'Posting', type: 'url', role: 'link' }]);
    store.setSteps(nb.id, [{ title: 'Find 5 matching jobs', kind: 'find', target: 5 }, { title: 'Pick', kind: 'decide', target: 3 }]);
    let asked = 0;
    S.finderReply = () => { asked++; return `Nothing was searched.\n<notebook>${JSON.stringify({ entries: [], sources: [], needs: 'the LinkedIn profile it should match', summary: 'Nothing was searched.' })}</notebook>`; };
    expect(startNotebookStep(ctx, nb.id)).toMatchObject({ started: true });
    for (let i = 0; i < 200 && ctx.notebookPipelines?.has(nb.id); i++) await new Promise((r) => setTimeout(r, 10));
    const step = store.get(nb.id)!.steps![0];
    expect(asked).toBe(1);
    expect(step).toMatchObject({ status: 'stuck', tries: 1 });
    expect(step.why).toBe("Nothing was searched: it needs the LinkedIn profile it should match, and the notebook doesn't have it. Nothing was guessed. Paste it at the top of the notebook's page, or choose Go on without it.");
    // The notebook now asks for it, and waits.
    expect(store.get(nb.id)!.given).toMatchObject([{ label: 'the LinkedIn profile it should match', state: 'missing' }]);
    expect(startNotebookStep(ctx, nb.id)).toMatchObject({ started: false, reason: "It's waiting on the LinkedIn profile it should match. Paste it at the top of the notebook's page, or choose Go on without it." });
    expect(store.entries(nb.id).filter((e) => e.kind === 'option')).toEqual([]);
    // No search is counted: nobody looked.
    expect(store.searches(nb.id)).toEqual([]);
    expect(store.passes(nb.id)[0].note).toContain("nothing searched; it needs the LinkedIn profile it should match, which the notebook doesn't have");
    S.finderReply = undefined;
  });
});
