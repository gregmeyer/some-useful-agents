import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { InboxStore } from '@some-useful-agents/core';
import { S, makeApp, COOKIE, PORT } from './notebooks.test-kit.js';

// One "Done" moment (the answer prototype): when the last of sua's steps
// finishes, the conversation says Done once, with the counts and the way to
// the answer; the conversation's card shows the steps; step-by-step messages
// fold away; the top-bar pill names the answer that just finished.
describe('the Done moment', () => {
  afterEach(() => { S.finderReply = undefined; S.checkerReply = undefined; });

  const setup = async () => {
    const app = await makeApp({ straightThrough: true });
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const steps = await import('../lib/notebook-steps.js');
    const ctx = getContext(app.locals);
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const inbox = InboxStore.fromHandle(S.runStore.databaseHandle());
    const settle = async (id: string) => {
      for (let calm = 0, i = 0; i < 400 && calm < 4; i++) {
        await new Promise((r) => setTimeout(r, 25));
        const busy = (store.get(id)!.steps ?? []).some((x) => x.status === 'running') || ctx.notebookPipelines?.has(id);
        calm = busy ? 0 : calm + 1;
      }
    };
    const said = (id: string) => inbox.listResponses(store.get(id)!.conversationId ?? '').map((r) => r.body);
    const get = (p: string) => request(app).get(p).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    return { app, ctx, store, inbox, settle, said, get, steps };
  };
  const found = (n: number) => `<notebook>${JSON.stringify({ entries: Array.from({ length: n }, (_, i) => ({ kind: 'option', title: `Pair ${String(i + 1)}`, fingerprint: `https://shop${String(i)}.example/p` })) })}</notebook>`;

  it('says Done once, with the counts, the step that is yours, and the link to the answer', async () => {
    const { ctx, store, said, settle, steps } = await setup();
    const nb = store.create({ title: 'Headphones for flights' });
    store.setSteps(nb.id, [{ title: 'Find 2 pairs', kind: 'find', agentId: 'notebook-finder', target: 2 }, { title: 'Pick one', kind: 'decide', target: 1 }]);
    S.finderReply = () => found(2);
    steps.startNotebookStep(ctx, nb.id);
    await settle(nb.id);
    const done = said(nb.id).filter((b) => b.startsWith('Done'));
    expect(done).toHaveLength(1);
    expect(done[0]).toMatch(/^Done: 2 \w+\. One step is yours: \*\*Pick one\*\*\. \[Open the answer →\]\(\/notebooks\/headphones-for-flights\)$/);
    // Said again for the same question: no second Done.
    steps.postStepCard(ctx, store.get(nb.id)!, store.get(nb.id)!.steps![0].id, { met: true, have: 2, want: 2, missing: [] });
    expect(said(nb.id).filter((b) => b.startsWith('Done'))).toHaveLength(1);
  });

  it('with no step of yours after it, Done has no "yours"; a stuck run says no Done', async () => {
    const { ctx, store, said, settle, steps } = await setup();
    const a = store.create({ title: 'Find two' });
    store.setSteps(a.id, [{ title: 'Find 2 pairs', kind: 'find', agentId: 'notebook-finder', target: 2 }]);
    S.finderReply = () => found(2);
    steps.startNotebookStep(ctx, a.id);
    await settle(a.id);
    expect(said(a.id).find((b) => b.startsWith('Done'))).toMatch(/^Done: 2 \w+\. \[Open the answer →\]/);
    const b = store.create({ title: 'Find five' });
    store.setSteps(b.id, [{ title: 'Find 5 pairs', kind: 'find', agentId: 'notebook-finder', target: 5 }, { title: 'Pick one', kind: 'decide', target: 1 }]);
    S.finderReply = () => '<notebook>{"entries":[]}</notebook>';
    steps.startNotebookStep(ctx, b.id);
    await settle(b.id);
    expect(store.get(b.id)!.steps![0].status).toBe('stuck');
    expect(said(b.id).some((x) => x.startsWith('Done'))).toBe(false);
  });

  it("the conversation's card is the answer's: its kind, its steps, and Open the answer", async () => {
    const { store, inbox, get } = await setup();
    const nb = store.create({ title: 'Headphones for flights' });
    store.setSteps(nb.id, [{ title: 'Find 2 pairs', kind: 'find', target: 2 }, { title: 'Pick one', kind: 'decide', target: 1 }]);
    store.updateStep(nb.id, store.get(nb.id)!.steps![0].id, { status: 'done', note: '2 of 2 found' });
    const thread = inbox.add({ priority: 'medium', source: 'manual', title: `Answer: ${nb.title}`, body: '(empty)', contextJson: JSON.stringify({ page: { path: `/notebooks/${nb.id}`, title: nb.title, kind: 'notebook', id: nb.id } }) })!;
    store.setConversation(nb.id, thread.id);
    const page = (await get(`/inbox/${thread.id}/fragment`)).text;
    expect(page).toContain('<span class="ib-notebook__kicker">Shortlist</span>');
    expect(page).toContain('Open the answer →');
    expect(page).not.toContain('Open notebook →');
    expect(page).toMatch(/steps-card__row--done[\s\S]*?Find 2 pairs[\s\S]*?2 of 2 found/);
    expect(page).toMatch(/steps-card__row--yours[\s\S]*?Pick one[\s\S]*?yours/);
  });

  it('two or more step messages in a row fold behind "Show each step"; one stays as it is', async () => {
    const { inbox, get } = await setup();
    const many = inbox.add({ priority: 'medium', source: 'manual', title: 'A', body: 'x' })!;
    for (const n of [1, 2]) inbox.addResponse(many.id, 'triage', `Step ${String(n)} of 3 is done: **S${String(n)}** (ok). Going on to **S${String(n + 1)}**.`);
    inbox.addResponse(many.id, 'triage', 'Done: 2 pairs. [Open the answer →](/notebooks/a)');
    const page = (await get(`/inbox/${many.id}/fragment`)).text;
    expect(page).toContain('Show each step (2)');
    expect(page).toContain('Done: 2 pairs.');
    const one = inbox.add({ priority: 'medium', source: 'manual', title: 'B', body: 'x' })!;
    inbox.addResponse(one.id, 'triage', 'Step 1 of 3 is done: **S1** (ok). Going on to **S2**.');
    expect((await get(`/inbox/${one.id}/fragment`)).text).not.toContain('Show each step');
  });

  it('the pill names an answer that just finished and goes to it; an old one is just counted', async () => {
    const { ctx, inbox, get } = await setup();
    const { recentDone } = await import('./inbox-count.js');
    const t = inbox.add({ priority: 'medium', source: 'manual', title: 'Answer: Headphones for flights', body: '(empty)' })!;
    inbox.addResponse(t.id, 'triage', 'Done: 2 pairs. One step is yours: **Pick one**. [Open the answer →](/notebooks/headphones-for-flights)');
    inbox.updateStatus(t.id, 'awaiting_user');
    expect(recentDone(ctx)).toEqual({ title: 'Headphones for flights', href: '/notebooks/headphones-for-flights' });
    const res = await get('/inbox/needs-you-count');
    expect(res.body.done).toEqual({ title: 'Headphones for flights', href: '/notebooks/headphones-for-flights' });
    expect(recentDone(ctx, Date.now() + 31 * 60_000)).toBeUndefined();
  });
});
