import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { join } from 'node:path';
import { InboxStore } from '@some-useful-agents/core';
import { S, makeApp, COOKIE, PORT } from './notebooks.test-kit.js';

// Ask once, the answer arrives: a step that met its goal goes straight on to
// the next of sua's, with no Continue to press. You're asked only when it's
// stuck, needs something of yours, or the next step is yours.
describe('steps run straight through', () => {
  afterEach(() => { S.stepsReply = undefined; });

  const setup = async () => {
    const app = await makeApp({ straightThrough: true });
    const post = (path: string, body: Record<string, string> = {}) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const counter = join(S.dir, 'n');
    // One new company a run…
    S.agentStore.createAgent({ id: 'finder', name: 'Finder', status: 'active', source: 'local', mcp: false, nodes: [{ id: 'n', type: 'shell', command: `n=$(cat ${counter} 2>/dev/null || echo 0); n=$((n+1)); echo $n > ${counter}; echo '<notebook>{"entries":[{"kind":"option","title":"Company '$n'"}]}</notebook>'` }] } as never, 'cli');
    // …and one that only ever finds the same company.
    S.agentStore.createAgent({ id: 'samey', name: 'Samey', status: 'active', source: 'local', mcp: false, nodes: [{ id: 'n', type: 'shell', command: `echo '<notebook>{"entries":[{"kind":"option","title":"Company 1"}]}</notebook>'` }] } as never, 'cli');
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const inbox = InboxStore.fromHandle(S.runStore.databaseHandle());
    const quiet = async (id: string) => {
      // Settled: nothing running, and no hop to the next step about to start.
      for (let calm = 0, i = 0; i < 400 && calm < 4; i++) {
        await new Promise((r) => setTimeout(r, 25));
        const busy = (store.get(id)!.steps ?? []).some((x) => x.status === 'running') || S.ctx!.notebookPipelines?.has(id);
        calm = busy ? 0 : calm + 1;
      }
    };
    const cards = (id: string) => inbox.listResponses(store.get(id)!.conversationId!).filter((r) => r.role === 'action')
      .map((r) => JSON.parse(r.metaJson!) as { status: string; ctaLabel: string });
    return { post, store, inbox, quiet, cards };
  };

  it('goes on to the next step by itself, and stops at a step of yours', async () => {
    const { post, store, inbox, quiet, cards } = await setup();
    const nb = store.create({ title: 'Peers', pipeline: ['sched-agent'] });
    store.setSteps(nb.id, [
      { title: 'Find 2 companies', kind: 'find', agentId: 'finder', target: 2 },
      { title: 'Find 3 companies', kind: 'find', agentId: 'finder', target: 3 },
      { title: 'Pick the final set', kind: 'decide', target: 1 },
    ]);
    await post(`/notebooks/${nb.id}/run`);
    await quiet(nb.id);
    const steps = store.get(nb.id)!.steps!;
    expect(steps.map((x) => x.status)).toEqual(['done', 'met', 'todo']);
    const said = inbox.listResponses(store.get(nb.id)!.conversationId!);
    expect(said.some((r) => r.body.includes('Step 1 of 3 is done: **Find 2 companies** (2 of 2 found). Going on to **Find 3 companies**, with finder.'))).toBe(true);
    // No Continue was ever offered; the step of yours is its own button on the page.
    expect(cards(nb.id).filter((c) => c.ctaLabel === 'Continue')).toEqual([]);
  });

  it('stops when a step is stuck, and asks: Move on or Try again', async () => {
    const { post, store, quiet, cards } = await setup();
    const nb = store.create({ title: 'Peers', pipeline: ['sched-agent'] });
    store.setSteps(nb.id, [
      { title: 'Find 1 company', kind: 'find', agentId: 'samey', target: 1 },
      { title: 'Find 5 companies', kind: 'find', agentId: 'samey', target: 5 },
      { title: 'Pick the final set', kind: 'decide', target: 1 },
    ]);
    await post(`/notebooks/${nb.id}/run`);
    await quiet(nb.id);
    expect(store.get(nb.id)!.steps!.map((x) => x.status)).toEqual(['done', 'stuck', 'todo']);
    expect(cards(nb.id).filter((c) => c.status === 'proposed').map((c) => c.ctaLabel)).toEqual(['Move on', 'Try again']);
  });

  it('a next step that can\'t start says why, and leaves its Continue', async () => {
    const { post, store, inbox, quiet, cards } = await setup();
    const nb = store.create({ title: 'Peers', pipeline: ['sched-agent'] });
    store.setSteps(nb.id, [
      { title: 'Find 1 company', kind: 'find', agentId: 'finder', target: 1 },
      { title: 'Check them', kind: 'check' },
    ]);
    await post(`/notebooks/${nb.id}/run`);
    await quiet(nb.id);
    expect(store.get(nb.id)!.steps!.map((x) => x.status)).toEqual(['met', 'todo']);
    expect(inbox.listResponses(store.get(nb.id)!.conversationId!).some((r) => r.body.startsWith("I couldn't go on to **Check them**: The notebook has no checks yet."))).toBe(true);
    expect(cards(nb.id).filter((c) => c.status === 'proposed').map((c) => c.ctaLabel)).toEqual(['Continue']);
  });

  it('a new notebook starts on its own: the greeting says so, and there is no Start card', async () => {
    const { post, store, inbox, quiet, cards } = await setup();
    S.stepsReply = () => `<draft>${JSON.stringify({ title: 'x', statement: 'x', steps: [{ title: 'Find 2 roles', kind: 'find', agent: 'finder', target: 2 }, { title: 'Pick one', kind: 'decide', target: 1 }] })}</draft>`;
    await post('/notebooks', { title: 'Find a staff role', statement: 'Remote, product company' });
    for (let i = 0; i < 200 && !store.get('find-a-staff-role')?.conversationId; i++) await new Promise((r) => setTimeout(r, 25));
    await quiet('find-a-staff-role');
    const nb = store.get('find-a-staff-role')!;
    const said = inbox.listResponses(nb.conversationId!);
    expect(said[0].body).toContain("I've started on **Find 2 roles**. I'll go straight through and only stop if I get stuck or need you.");
    expect(said[0].body).not.toContain('Press **Start**');
    expect(cards(nb.id).filter((c) => c.ctaLabel === 'Start')).toEqual([]);
    expect(nb.steps!.map((x) => x.status)).toEqual(['met', 'todo']);
  });
});
