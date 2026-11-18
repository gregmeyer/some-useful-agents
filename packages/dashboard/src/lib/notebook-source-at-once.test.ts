import { describe, it, expect } from 'vitest';
import { bySiteAtOnce, SOURCE_SITES_AT_ONCE } from './notebook-steps.js';

const tick = () => new Promise((r) => setTimeout(r, 15));

describe('a source step reads pages from several sites at once', () => {
  it('up to 3 sites side by side, each site one page at a time, in order', async () => {
    const jobs = ['a.com/1', 'b.com/1', 'a.com/2', 'c.com/1', 'd.com/1', 'a.com/3'];
    let now = 0;
    let most = 0;
    const going = new Set<string>();
    const order: string[] = [];
    await bySiteAtOnce(jobs, (j) => j.split('/')[0], SOURCE_SITES_AT_ONCE, async (j) => {
      const site = j.split('/')[0];
      expect(going.has(site)).toBe(false);
      going.add(site); now++; most = Math.max(most, now);
      order.push(j);
      await tick();
      going.delete(site); now--;
    });
    expect(order).toHaveLength(6);
    expect(most).toBe(3);
    expect(order.filter((j) => j.startsWith('a.com'))).toEqual(['a.com/1', 'a.com/2', 'a.com/3']);
  });

  it('starts nothing more once stopped', async () => {
    const done: string[] = [];
    let stopped = false;
    await bySiteAtOnce(['a/1', 'a/2', 'a/3'], (j) => j.split('/')[0], 3, async (j) => { done.push(j); stopped = true; }, () => stopped);
    expect(done).toEqual(['a/1']);
  });

  it('is quicker than one at a time for pages on different sites', async () => {
    const t0 = Date.now();
    await bySiteAtOnce(['a/1', 'b/1', 'c/1'], (j) => j.split('/')[0], 3, async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(Date.now() - t0).toBeLessThan(250);
  });
});
