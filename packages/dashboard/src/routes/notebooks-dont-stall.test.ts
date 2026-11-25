import { describe, it, expect, afterEach } from 'vitest';
import { InboxStore } from '@some-useful-agents/core';
import { S, makeApp } from './notebooks.test-kit.js';

// Answers that don't stall (a real question, 2026-11-25: its check step ran
// three tries of five minutes each, all five options from one store whose
// pages can't be read, and confirmed none). A check try that settles little
// is the last; a short check goes on to the write-up; a find step whose
// options all come from one site tries once elsewhere.
describe("answers that don't stall", () => {
  afterEach(() => { S.checkerReply = undefined; S.finderReply = undefined; S.writerReply = undefined; });

  const setup = async (straightThrough = true) => {
    const app = await makeApp({ straightThrough });
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const { startNotebookStep } = await import('../lib/notebook-steps.js');
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
    return { ctx, store, settle, said, start: (id: string) => startNotebookStep(ctx, id) };
  };

  const shortlist = (store: Awaited<ReturnType<typeof setup>>['store'], steps: Parameters<Awaited<ReturnType<typeof setup>>['store']['setSteps']>[1]) => {
    const nb = store.create({ title: 'Headphones for flights' });
    store.setChecks(nb.id, ['Cancels engine noise', 'Has a wired mode']);
    const ids = ['A', 'B', 'C', 'D'].map((n) => store.upsertOption(nb.id, { title: `Pair ${n}`, by: 'you', fingerprint: `https://shop${n}.example/p` }).entry.id);
    store.setSteps(nb.id, steps);
    return { nb, ids };
  };

  it('a check try that settles under a quarter of what is open is the last; straight through, it goes on to the write-up', async () => {
    const { store, settle, said, start } = await setup();
    const { nb, ids } = shortlist(store, [{ title: 'Check them', kind: 'check' }, { title: 'Write up the field', kind: 'write', shape: 'writeup' }]);
    let asked = 0;
    // 1 of 8 pairs settled a try.
    S.checkerReply = () => { asked++; return `<notebook>${JSON.stringify({ facts: [{ id: ids[asked - 1], checked: ['Cancels engine noise'] }] })}</notebook>`; };
    expect(start(nb.id).started).toBe(true);
    await settle(nb.id);
    expect(asked).toBe(1);
    const [check, write] = store.get(nb.id)!.steps!;
    expect(check).toMatchObject({ status: 'done', movedOn: true, tries: 1 });
    expect(write.status).not.toBe('todo');
    const went = said(nb.id).find((b) => b.startsWith('**Check them** stopped after 1 try'))!;
    expect(went).toContain('1 of 8 checks confirmed or ruled out');
    expect(went).toContain('Going on to **Write up the field**: it marks what wasn’t confirmed as unconfirmed.');
  });

  it('waiting for you (no straight through), the short check stops after its one try and offers Try again and Move on', async () => {
    const { store, settle, start } = await setup(false);
    const { nb, ids } = shortlist(store, [{ title: 'Check them', kind: 'check' }, { title: 'Write up the field', kind: 'write', shape: 'writeup' }]);
    let asked = 0;
    S.checkerReply = () => { asked++; return `<notebook>${JSON.stringify({ facts: [{ id: ids[0], checked: ['Cancels engine noise'] }] })}</notebook>`; };
    start(nb.id);
    await settle(nb.id);
    expect(asked).toBe(1);
    expect(store.get(nb.id)!.steps!.map((x) => x.status)).toEqual(['stuck', 'todo']);
  });

  it('a check try that checks options through keeps going, as before', async () => {
    const { store, settle, start } = await setup(false);
    const { nb, ids } = shortlist(store, [{ title: 'Check them', kind: 'check' }, { title: 'Pick one', kind: 'decide', target: 1 }]);
    let asked = 0;
    const both = ['Cancels engine noise', 'Has a wired mode'];
    S.checkerReply = () => { asked++; const two = asked === 1 ? ids.slice(0, 2) : ids.slice(2); return `<notebook>${JSON.stringify({ facts: two.map((id) => ({ id, checked: both })) })}</notebook>`; };
    start(nb.id);
    await settle(nb.id);
    expect(asked).toBe(2);
    expect(store.get(nb.id)!.steps![0]).toMatchObject({ status: 'met', tries: 2 });
  });

  const finds = (host: (i: number) => string, from: number, n: number) => `<notebook>${JSON.stringify({ entries: Array.from({ length: n }, (_, i) => ({ kind: 'option', title: `Pair ${String(from + i)}`, fingerprint: `https://${host(i)}/p/${String(from + i)}` })) })}</notebook>`;

  it('a find step whose options all come from one site tries once elsewhere, told where not to look, then goes on', async () => {
    const { store, settle, start } = await setup(false);
    const nb = store.create({ title: 'Headphones for flights' });
    store.setSteps(nb.id, [{ title: 'Find 4 pairs', kind: 'find', agentId: 'notebook-finder', target: 4 }, { title: 'Check them', kind: 'check' }]);
    const asked: string[] = [];
    S.finderReply = (inputs) => { asked.push(inputs.NOTEBOOK); return asked.length === 1 ? finds(() => 'www.onestore.example', 1, 4) : finds(() => 'other.example', 5, 1); };
    start(nb.id);
    await settle(nb.id);
    expect(asked).toHaveLength(2);
    expect(asked[1]).toContain('Still needed:\n- 2 more from somewhere other than onestore.example');
    expect(store.get(nb.id)!.steps![0]).toMatchObject({ status: 'met', tries: 2 });
    expect(store.get(nb.id)!.lastRunNote).toContain('1 more from other sites, though most are still from onestore.example');
  });

  it('short of its count and leaning on one site, the next try is told to look elsewhere at once (no third try)', async () => {
    const { store, settle, start } = await setup(false);
    const nb = store.create({ title: 'Headphones for flights' });
    store.setSteps(nb.id, [{ title: 'Find 6 pairs', kind: 'find', agentId: 'notebook-finder', target: 6 }, { title: 'Check them', kind: 'check' }]);
    const asked: string[] = [];
    S.finderReply = (inputs) => { asked.push(inputs.NOTEBOOK); return asked.length === 1 ? finds(() => 'onestore.example', 1, 5) : finds(() => 'other.example', 10, 2); };
    start(nb.id);
    await settle(nb.id);
    expect(asked).toHaveLength(2);
    expect(asked[1]).toContain('Still needed:\n- 1 more, from somewhere other than onestore.example');
    expect(store.get(nb.id)!.steps![0]).toMatchObject({ status: 'met', tries: 2 });
    expect(store.get(nb.id)!.lastRunNote).toContain('2 more from other sites');
  });

  it('when the other sites have none, it still goes on, and says so', async () => {
    const { store, settle, start } = await setup(false);
    const nb = store.create({ title: 'Headphones for flights' });
    store.setSteps(nb.id, [{ title: 'Find 4 pairs', kind: 'find', agentId: 'notebook-finder', target: 4 }, { title: 'Check them', kind: 'check' }]);
    let asked = 0;
    S.finderReply = () => { asked++; return asked === 1 ? finds(() => 'onestore.example', 1, 4) : '<notebook>{"entries":[]}</notebook>'; };
    start(nb.id);
    await settle(nb.id);
    expect(asked).toBe(2);
    expect(store.get(nb.id)!.steps![0].status).toBe('met');
    expect(store.get(nb.id)!.lastRunNote).toContain('all from onestore.example still; the other sites had none that fit');
  });

  it('one try only, with no check after it, from a job board that hosts many companies, or a site you asked for', async () => {
    const { store, settle, start } = await setup(false);
    const run = async (title: string, host: string, steps: Parameters<typeof store.setSteps>[1]) => {
      const nb = store.create({ title });
      store.setSteps(nb.id, steps);
      let asked = 0;
      S.finderReply = () => { asked++; return finds(() => host, asked * 10, 4); };
      start(nb.id);
      await settle(nb.id);
      return asked;
    };
    const find = { title: 'Find 4', kind: 'find' as const, agentId: 'notebook-finder', target: 4 };
    expect(await run('Headphones', 'onestore.example', [find])).toBe(1);
    expect(await run('PM roles', 'jobs.ashbyhq.com', [find, { title: 'Check them', kind: 'check' }])).toBe(1);
    expect(await run('Headphones on Onestore', 'onestore.example', [find, { title: 'Check them', kind: 'check' }])).toBe(1);
  });
});
