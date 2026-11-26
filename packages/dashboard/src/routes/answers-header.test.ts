import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { S, makeApp, COOKIE, PORT } from './notebooks.test-kit.js';

// The answer's header, calm (the answer prototype): the one thing to do now,
// Print and More in view; everything else one click away, in More or under
// "Steps and details", and every action still on the page.
describe("the answer's header", () => {
  const setup = async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const page = async (id: string) => (await request(app).get(`/notebooks/${id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;
    return { store, page };
  };
  // The buttons in view: the header's actions, not what's inside More's panel.
  const inView = (html: string) => {
    const acts = html.slice(html.indexOf('<div class="nb-acts">'), html.indexOf('<div class="nb-act__panel nb-more__panel">'));
    // A panel's own form (Decide…'s) isn't in view either: only summaries and links/buttons at the top level count.
    const top = acts.replace(/<div class="nb-act__panel[\s\S]*?<\/details>/g, '</details>');
    return (top.match(/class="btn /g) ?? []).length;
  };

  it('a shortlist ready for your pick shows three: Decide…, Print and More', async () => {
    const { store, page } = await setup();
    const nb = store.create({ title: 'Headphones for flights', statement: 'Under $300' });
    store.setSteps(nb.id, [{ title: 'Find 2 pairs', kind: 'find', target: 2, status: 'done' }, { title: 'Pick one', kind: 'decide', target: 1 }]);
    store.upsertOption(nb.id, { title: 'Pair A', by: 'you', data: {} });
    store.upsertOption(nb.id, { title: 'Pair B', by: 'you', data: {} });
    const html = await page(nb.id);
    expect(inView(html)).toBe(3);
    expect(html).toMatch(/<summary class="btn btn--sm btn--primary">Decide…<\/summary>/);
    expect(html).toContain('>Print</a>');
    expect(html).toContain('<summary class="btn btn--sm btn--ghost">More</summary>');
    // The kind as an eyebrow, and the one meta line.
    expect(html).toContain('<p class="nb-hero__subtitle">Shortlist</p>');
    expect(html).toMatch(/<p class="nb-hero__meta">started [^<]+<\/p>/);
  });

  it('every action is still on the page: in More, or under Steps and details', async () => {
    const { store, page } = await setup();
    const nb = store.create({ title: 'Headphones for flights', statement: 'Under $300', criteria: ['One pair that fits'] });
    store.setSteps(nb.id, [{ title: 'Find 2 pairs', kind: 'find', target: 2, status: 'done' }, { title: 'Pick one', kind: 'decide', target: 1 }]);
    store.upsertOption(nb.id, { title: 'Pair A', by: 'you', data: {} });
    const html = await page(nb.id);
    const id = nb.id;
    for (const url of [`/notebooks/${id}/edit`, `/notebooks/${id}/entries`, `/notebooks/${id}/decide`, `/notebooks/${id}/criteria/0`, `/notebooks/${id}/brief.html`, `/notebooks/${id}/tldr.png`, `/notebooks/${id}/export.suanb`, `/notebooks/${id}/shortlist.csv`, `/notebooks/${id}/workflow`, `/notebooks/${id}/star`, `/notebooks/${id}/given`]) {
      expect(html, url).toContain(url);
    }
    // The steps and the add row live under "Steps and details", closed when nothing needs you.
    const at = html.indexOf('<details class="nb-details" data-nb-details>');
    expect(at).toBeGreaterThan(0);
    expect(html.slice(at, at + 200)).toContain('<summary class="nb-details__summary">Steps and details</summary>');
    expect(html.indexOf('data-nb-details')).toBeLessThan(html.indexOf('Add a file or paste'));
  });

  it('a stopped-short step opens Steps and details, with Try again and Move on in view', async () => {
    const { store, page } = await setup();
    const nb = store.create({ title: 'Headphones for flights' });
    store.setSteps(nb.id, [{ title: 'Find 5 pairs', kind: 'find', target: 5, status: 'stuck', tries: 3 }, { title: 'Pick one', kind: 'decide', target: 1 }]);
    const html = await page(nb.id);
    expect(html).toContain('<details class="nb-details" data-nb-details open data-nb-details-needs>');
    expect(inView(html)).toBeLessThanOrEqual(4);
  });

  it('a step of yours that is Narrow… is the main thing; Decide… then waits in More', async () => {
    const { store, page } = await setup();
    const nb = store.create({ title: 'Jobs' });
    store.setSteps(nb.id, [{ title: 'Find 10', kind: 'find', target: 10, status: 'done' }, { title: 'Keep 5', kind: 'narrow', target: 5 }, { title: 'Pick one', kind: 'decide', target: 1 }]);
    store.upsertOption(nb.id, { title: 'Role A', by: 'you', data: {} });
    const html = await page(nb.id);
    expect(html).toMatch(/<summary class="btn btn--sm btn--primary"[^>]*>Narrow…<\/summary>/);
    const more = html.slice(html.indexOf('nb-more__panel'), html.indexOf('data-nb-details'));
    expect(more).toContain('>Decide…</summary>');
    expect(more).toContain('>+ Add entry</summary>');
  });
});
