import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { createTestContext, closeTestContext } from './test-harness.js';
import { inBackground } from './lib/background.js';

describe('test harness', () => {
  it('waits for background work before closing the stores, then removes the dir', async () => {
    const t = await createTestContext();
    expect(t.ctx.live).toBeUndefined();
    let wroteAfter = false;
    inBackground(t.ctx, 'late write', new Promise<void>((r) => setTimeout(() => {
      t.ctx.runStore.listRuns({ limit: 1 }); // throws "database is not open" if the store closed first
      wroteAfter = true;
      r();
    }, 30)));
    await closeTestContext(t);
    expect(wroteAfter).toBe(true);
    expect(existsSync(t.dir)).toBe(false);
  });

  it('fails the test, by label, when work is still running at teardown', async () => {
    const t = await createTestContext();
    inBackground(t.ctx, 'never ends', new Promise(() => undefined));
    await expect(closeTestContext(t, 50)).rejects.toThrow('still running at teardown: never ends');
    expect(existsSync(t.dir)).toBe(false);
  });
});
