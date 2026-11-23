import { describe, it, expect, vi, afterEach } from 'vitest';
import { BackgroundTasks, inBackground } from './background.js';

afterEach(() => vi.restoreAllMocks());

describe('BackgroundTasks', () => {
  it('tracks work until it settles', async () => {
    const tasks = new BackgroundTasks();
    let finish!: () => void;
    tasks.run('slow', new Promise<void>((r) => { finish = r; }));
    expect(tasks.size).toBe(1);
    expect(tasks.pending()).toEqual(['slow']);
    finish();
    expect(await tasks.drain(1000)).toEqual([]);
    expect(tasks.size).toBe(0);
  });

  it('logs an uncaught failure with its label instead of an unhandled rejection', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const tasks = new BackgroundTasks();
    tasks.run('triage', Promise.reject(new Error('database is not open')));
    await tasks.drain(1000);
    expect(err).toHaveBeenCalledWith('[background] triage failed: database is not open');
  });

  it('waits for work that running work starts', async () => {
    const tasks = new BackgroundTasks();
    let done = false;
    tasks.run('first', (async () => {
      await new Promise((r) => setTimeout(r, 10));
      tasks.run('second', new Promise<void>((r) => setTimeout(() => { done = true; r(); }, 10)));
    })());
    expect(await tasks.drain(1000)).toEqual([]);
    expect(done).toBe(true);
  });

  it('gives up at the timeout and names what is still running', async () => {
    const tasks = new BackgroundTasks();
    tasks.run('stuck', new Promise(() => undefined));
    expect(await tasks.drain(30)).toEqual(['stuck']);
  });
});

describe('inBackground', () => {
  it('creates the registry on first use', async () => {
    const ctx: { background?: BackgroundTasks } = {};
    inBackground(ctx, 'x', Promise.resolve());
    expect(ctx.background).toBeInstanceOf(BackgroundTasks);
    expect(await ctx.background!.drain(1000)).toEqual([]);
  });
});
