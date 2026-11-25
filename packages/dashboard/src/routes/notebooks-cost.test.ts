import { describe, it, expect, afterEach } from 'vitest';
import { InboxStore } from '@some-useful-agents/core';
import { S, makeApp } from './notebooks.test-kit.js';

// A question costs less (2026-11-25: three real runs cost about $10 each and
// never reached an answer). Check and source steps work the best few; a find
// try is sized to what's still needed; a question has a budget its steps stop
// at (its write-up still runs); pictures and a page redraw wait.
describe('a question costs less', () => {
  afterEach(() => { S.checkerReply = undefined; S.finderReply = undefined; S.writerReply = undefined; S.pageAsked.length = 0; });

  const setup = async (straightThrough = false) => {
    const app = await makeApp({ straightThrough });
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
    return { ctx, store, settle, said, steps, start: (id: string) => steps.startNotebookStep(ctx, id) };
  };

  const withOptions = (store: Awaited<ReturnType<typeof setup>>['store'], n: number, steps: Parameters<Awaited<ReturnType<typeof setup>>['store']['setSteps']>[1]) => {
    const nb = store.create({ title: 'Headphones for flights' });
    store.setChecks(nb.id, ['Cancels engine noise', 'Has a wired mode']);
    const ids = Array.from({ length: n }, (_, i) => store.upsertOption(nb.id, { title: `Pair ${String(i + 1)}`, by: 'you', fingerprint: `https://shop${String(i)}.example/p` }).entry.id);
    store.setSteps(nb.id, steps);
    return { nb, ids };
  };
  const optionsAsked = (inputs: Record<string, string>) => (JSON.parse(inputs.OPTIONS) as Array<{ id: string }>).map((o) => o.id);

  it('a check step with no top of its own checks the best few: your pick plus 2, at least 5', async () => {
    const { store, settle, start } = await setup();
    const { nb } = withOptions(store, 12, [{ title: 'Check them', kind: 'check' }, { title: 'Pick one', kind: 'decide', target: 1 }]);
    const asked: string[][] = [];
    S.checkerReply = (inputs) => { asked.push(optionsAsked(inputs)); return '<notebook>{}</notebook>'; };
    start(nb.id);
    await settle(nb.id);
    expect(asked[0]).toHaveLength(5);
    expect(store.get(nb.id)!.steps![0].top).toBe(5);
  });

  it('one ruled out lets the next best in', async () => {
    const { store, settle, start } = await setup();
    const { nb, ids } = withOptions(store, 8, [{ title: 'Check them', kind: 'check' }, { title: 'Pick one', kind: 'decide', target: 1 }]);
    const both = ['Cancels engine noise', 'Has a wired mode'];
    const asked: string[][] = [];
    S.checkerReply = (inputs) => {
      const opts = optionsAsked(inputs);
      asked.push(opts);
      // First try: the first is ruled out, the rest checked through.
      return `<notebook>${JSON.stringify({ facts: opts.map((id, i) => (asked.length === 1 && i === 0 ? { id, ruleOut: 'Fails "Has a wired mode": "no jack"' } : { id, checked: both })) })}</notebook>`;
    };
    start(nb.id);
    await settle(nb.id);
    expect(asked[0]).toHaveLength(5);
    // The sixth best comes in for the one ruled out, and only it is asked about.
    expect(asked[1]).toHaveLength(1);
    expect(asked[0]).not.toContain(asked[1][0]);
    expect(ids).toContain(asked[1][0]);
    expect(store.get(nb.id)!.steps![0].status).toBe('met');
  });

  it('a job search keeping 10 checks 12; a top you set is kept; few options are all checked', async () => {
    const { store, settle, start } = await setup();
    const run = async (n: number, steps: Parameters<typeof store.setSteps>[1]) => {
      const { nb } = withOptions(store, n, steps);
      let first: string[] = [];
      S.checkerReply = (inputs) => { if (!first.length) first = optionsAsked(inputs); return '<notebook>{}</notebook>'; };
      start(nb.id);
      await settle(nb.id);
      return { first, top: store.get(nb.id)!.steps![0].top };
    };
    // Checked 8 at a time (CHECK_BATCH): the first batch of the 12.
    expect(await run(14, [{ title: 'Check them', kind: 'check' }, { title: 'Keep 10', kind: 'decide', target: 10 }])).toMatchObject({ top: 12 });
    const kept = await run(12, [{ title: 'Check them', kind: 'check', top: 3 }, { title: 'Pick one', kind: 'decide', target: 1 }]);
    expect(kept.top).toBe(3);
    expect(kept.first).toHaveLength(3);
    const few = await run(4, [{ title: 'Check them', kind: 'check' }, { title: 'Pick one', kind: 'decide', target: 1 }]);
    expect(few.top).toBeUndefined();
    expect(few.first).toHaveLength(4);
  });

  it('a find try is sized to what is still needed: 3 searches for 5, 2 for the top-up elsewhere', async () => {
    const { findSearches } = await import('../lib/notebook-pipeline.js');
    expect([1, 3, 5, 10, 30].map(findSearches)).toEqual([2, 2, 3, 5, 5]);
    const { store, settle, start } = await setup();
    const nb = store.create({ title: 'Headphones for flights' });
    store.setSteps(nb.id, [{ title: 'Find 5 pairs', kind: 'find', agentId: 'notebook-finder', target: 5 }, { title: 'Check them', kind: 'check' }]);
    const searches: string[] = [];
    S.finderReply = (inputs) => {
      searches.push(inputs.SEARCHES);
      const host = searches.length === 1 ? 'onestore.example' : 'other.example';
      const from = searches.length * 10;
      return `<notebook>${JSON.stringify({ entries: Array.from({ length: searches.length === 1 ? 5 : 2 }, (_, i) => ({ kind: 'option', title: `Pair ${String(from + i)}`, fingerprint: `https://${host}/p/${String(from + i)}` })) })}</notebook>`;
    };
    start(nb.id);
    await settle(nb.id);
    expect(searches).toEqual(['3', '2']);
  });

  it('past its budget, a check starts no second try and goes on to the write-up, saying so', async () => {
    const { ctx, store, settle, said, start } = await setup(true);
    ctx.notebookQuestionSpend = () => 9;
    const { nb, ids } = withOptions(store, 4, [{ title: 'Check them', kind: 'check' }, { title: 'Write up the field', kind: 'write', shape: 'writeup' }]);
    let asked = 0;
    // Enough to earn another try: two options checked through.
    S.checkerReply = () => { asked++; return `<notebook>${JSON.stringify({ facts: ids.slice((asked - 1) * 2, asked * 2).map((id) => ({ id, checked: ['Cancels engine noise', 'Has a wired mode'] })) })}</notebook>`; };
    start(nb.id);
    await settle(nb.id);
    expect(asked).toBe(1);
    expect(store.get(nb.id)!.steps![1].status).not.toBe('todo');
    expect(said(nb.id).some((b) => b.includes('It reached its budget for this question ($9.00 of $8.00).'))).toBe(true);
    ctx.notebookQuestionSpend = undefined;
  });

  it('past its budget, it does not start the next paid step by itself; under it, it does', async () => {
    const { ctx, store, settle, said, start } = await setup(true);
    const run = async (spent: number) => {
      ctx.notebookQuestionSpend = () => spent;
      const { nb } = withOptions(store, 0, [{ title: 'Find 2 pairs', kind: 'find', agentId: 'notebook-finder', target: 2 }, { title: 'Check them', kind: 'check' }]);
      S.finderReply = () => `<notebook>${JSON.stringify({ entries: [{ kind: 'option', title: 'Pair A', fingerprint: 'https://a.example/p' }, { kind: 'option', title: 'Pair B', fingerprint: 'https://b.example/p' }] })}</notebook>`;
      S.checkerReply = () => '<notebook>{}</notebook>';
      start(nb.id);
      await settle(nb.id);
      return { check: store.get(nb.id)!.steps![1].status, said: said(nb.id) };
    };
    const over = await run(9);
    expect(over.check).toBe('todo');
    expect(over.said.some((b) => b.startsWith('This question has spent $9.00 of its $8.00 budget, so I stopped before **Check them**.'))).toBe(true);
    expect((await run(1)).check).not.toBe('todo');
    ctx.notebookQuestionSpend = undefined;
  });

  it('the page is not drawn again after the first step when a write-up will draw it anyway', async () => {
    const { store, settle, start } = await setup();
    const run = async (steps: Parameters<typeof store.setSteps>[1]) => {
      S.pageAsked.length = 0;
      const nb = store.create({ title: 'Headphones' });
      store.setSteps(nb.id, steps);
      S.finderReply = () => `<notebook>${JSON.stringify({ entries: [{ kind: 'option', title: 'Pair A' }] })}</notebook>`;
      start(nb.id);
      await settle(nb.id);
      await new Promise((r) => setTimeout(r, 100));
      return S.pageAsked.length;
    };
    const find = { title: 'Find 1', kind: 'find' as const, agentId: 'notebook-finder', target: 1 };
    expect(await run([find, { title: 'Write it up', kind: 'write', shape: 'writeup' }])).toBe(0);
    expect(await run([find, { title: 'Pick one', kind: 'decide', target: 1 }])).toBeGreaterThan(0);
  });

  it('pictures wait while its steps run, and start once they stop', async () => {
    const { ctx, store, settle, start } = await setup();
    const calls: boolean[] = [];
    ctx.notebookPictureRun = async () => { calls.push(!!ctx.notebookPipelines?.has(nb.id)); return undefined; };
    const nb = store.create({ title: 'Headphones' });
    store.setSteps(nb.id, [{ title: 'Find 2', kind: 'find', agentId: 'notebook-finder', target: 2 }, { title: 'Pick one', kind: 'decide', target: 1 }]);
    S.finderReply = () => `<notebook>${JSON.stringify({ entries: [{ kind: 'option', title: 'Pair A' }, { kind: 'option', title: 'Pair B' }] })}</notebook>`;
    start(nb.id);
    await settle(nb.id);
    for (let i = 0; i < 40 && !calls.length; i++) await new Promise((r) => setTimeout(r, 25));
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((running) => !running)).toBe(true);
  });
});
