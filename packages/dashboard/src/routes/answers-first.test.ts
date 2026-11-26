import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { S, makeApp, COOKIE, PORT } from './notebooks.test-kit.js';

// The answer first (the answer prototype): a shortlist leads with where it
// stands, the options, the write-up and what it rests on; its charts, head to
// head, checklist, timeline, search log and limits are one fold. Beside it,
// its sources: the first few with whether their quote was found.
describe('the answer first', () => {
  const setup = async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const page = async (id: string) => (await request(app).get(`/notebooks/${id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;
    return { store, page };
  };

  it('a shortlist kept on an older Shortlist page gets the new order, and still says Shortlist', async () => {
    const { notebookLayoutOf, layoutPreset } = await import('@some-useful-agents/core');
    const { pageName } = await import('../lib/notebook-edit.js');
    const old = { preset: 'shortlist', components: [{ id: 'root', component: 'Column', children: ['top', 'mid', 'shortlist_panel'] }] } as never;
    const now = notebookLayoutOf({ layout: old });
    expect(now.components).toEqual(layoutPreset('shortlist')!.layout.components);
    expect(now.components.find((c) => c.id === 'root')!.children).toEqual(['top', 'shortlist_panel', 'writeup_p', 'rests_p', 'detail_d']);
    expect(pageName(old)).toBe('Shortlist');
  });

  it("its sources beside it: the found ones first, the rest counted; none until it has a page", async () => {
    const { store, page } = await setup();
    const nb = store.create({ title: 'Headphones for flights' });
    expect(await page(nb.id)).not.toContain('nb-rail__list');
    const add = (n: number, status?: 'found' | 'missing') => {
      const e = store.addEntry(nb.id, { kind: 'evidence', title: `Review ${String(n)}`, body: `"a quote long enough to check ${String(n)}" Review ${String(n)}`, by: 'x', source: `https://review${String(n)}.example/p` });
      if (status) store.setEntryTrace(nb.id, e.id, status);
    };
    add(1, 'missing'); add(2); add(3, 'found'); add(4, 'found'); add(5);
    const html = await page(nb.id);
    const rail = html.slice(html.indexOf('nb-rail'), html.indexOf('</section>', html.indexOf('nb-rail')));
    expect(rail).toContain('Sources · 5');
    expect((rail.match(/class="nb-rail__row"/g) ?? []).length).toBe(3);
    // Found first.
    expect(rail.indexOf('✓ found')).toBeLessThan(rail.indexOf('not checked yet'));
    expect(rail).toContain('and 2 more · 2 quotes found on their pages, 1 not found.');
    expect(rail).toContain('href="https://review3.example/p" target="_blank"');
  });
});
