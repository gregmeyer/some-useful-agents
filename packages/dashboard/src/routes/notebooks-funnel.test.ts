import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { InboxStore } from '@some-useful-agents/core';
import { S, makeApp, COOKIE, PORT } from './notebooks.test-kit.js';

describe('the funnel on the page and in the conversation', () => {
  it('moves, rules out and brings back from the page; the page shows the funnel', async () => {
    const app = await makeApp();
    const post = (path: string, body: Record<string, string> = {}) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    await post('/notebooks', { title: 'Car' });
    await post('/notebooks/car/edit', { title: 'Car', stages: 'Found\nChecked\nTest drive' });
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const rav4 = store.upsertOption('car', { title: '2010 RAV4', by: 'you' }).entry;
    const xt = store.upsertOption('car', { title: '2009 Forester XT', by: 'you' }).entry;

    expect(decodeURIComponent((await post(`/notebooks/car/entries/${rav4.id}/stage`, { stage: 'Checked' })).headers.location)).toContain('2010 RAV4 → Checked');
    expect(decodeURIComponent((await post(`/notebooks/car/entries/${rav4.id}/stage`, { stage: 'Bought' })).headers.location)).toContain("isn't one of this notebook's stages");
    expect(decodeURIComponent((await post(`/notebooks/car/entries/${xt.id}/rule-out`, { quick: 'Too expensive', reason: '' })).headers.location)).toContain("Searches won't suggest it again");
    expect(store.findOption('car', 'XT')?.ruledOut).toMatchObject({ reason: 'Too expensive', by: 'you', stage: 'Found' });

    const page = await request(app).get('/notebooks/car').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(page.text).toContain('class="nb-funnel"');
    expect(page.text).toContain('Ruled out at Found: Too expensive');
    expect(page.text).toContain('Move to Test drive →');
    expect(page.text.indexOf('2010 RAV4')).toBeLessThan(page.text.indexOf('2009 Forester XT')); // ruled out sinks

    await post(`/notebooks/car/entries/${xt.id}/reinstate`);
    expect(store.findOption('car', 'XT')?.ruledOut).toBeUndefined();
  });

  it('Narrow… keeps the picks, rules out the rest, and the notebook stays open', async () => {
    const app = await makeApp();
    const post = (path: string, body: Record<string, string> | string = {}) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    await post('/notebooks', { title: 'Cars' });
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    store.setFields('cars', [{ key: 'url', label: 'Listing', type: 'url', role: 'link' }, { key: 'price', label: 'Price', type: 'money', role: 'price' }]);
    store.setSteps('cars', [{ title: 'Find 3', kind: 'find', target: 3, status: 'done' }, { title: 'Decide which cars stay in the running', kind: 'narrow' }, { title: 'Pick one', kind: 'decide', target: 1 }]);
    const add = (title: string, price: number) => store.upsertOption('cars', { title, by: 'you', data: { url: `https://cars.example/${String(price)}`, price } }).entry;
    const rav = add('RAV4', 9000); const crv = add('CR-V', 11000); add('Outback', 14000);
    const page = (await get('/notebooks/cars')).text;
    expect(page).toContain('title="Decide which cars stay in the running">Narrow…</summary>');
    expect(page).toContain('action="/notebooks/cars/narrow"');
    expect(page).toContain('data-nb-mode="narrow"');
    expect(page).toMatch(/<summary class="btn btn--sm">Decide…<\/summary>/); // not the main button now
    expect(page).toContain('<span class="nb-step__count">keep the best</span><span class="nb-step__state nb-step__state--todo">to do</span>');
    const out = await post('/notebooks/cars/narrow', `chosen=${rav.id}&chosen=${crv.id}&decision=Too+pricey`);
    expect(decodeURIComponent(out.headers.location)).toContain('Kept 2, ruled out 1. Next: Pick one.');
    const nb = store.get('cars')!;
    expect(nb.status).toBe('active');
    expect(store.findOption('cars', 'Outback')?.ruledOut?.reason).toBe('Too pricey');
    const after = (await get('/notebooks/cars')).text;
    expect(after).not.toContain('Narrow…</summary>');
    expect(after).toContain('<summary class="btn btn--sm btn--primary">Decide…</summary>');
    expect(decodeURIComponent((await post('/notebooks/cars/narrow', {})).headers.location)).toContain('Pick at least one');
  });

  it('with steps, hand-moved stages are hidden: no stage chip, Move button or stage filter', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Cars' });
    store.setFields(nb.id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'color', label: 'Color', type: 'text' }]);
    store.setStages(nb.id, ['Found', 'Verified']);
    const a = store.upsertOption(nb.id, { title: 'RAV4', by: 'you', data: { price: 9000, color: 'red' } }).entry;
    const b = store.upsertOption(nb.id, { title: 'CR-V', by: 'you', data: { price: 9500, color: 'blue' } }).entry;
    store.ruleOut(nb.id, b.id, 'too pricey');
    // Without steps: stages as before.
    let page = (await get(`/notebooks/${nb.id}`)).text;
    expect(page).not.toContain('"stageChips":false');
    expect(page).toContain('"filters":["added","seen","stage","color"]');
    expect((await get(`/notebooks/${nb.id}/entries/${a.id}`)).text).toContain('Move to Verified →');
    store.setSteps(nb.id, [{ title: 'Find 2', kind: 'find', target: 2 }, { title: 'Pick 1', kind: 'decide', target: 1 }]);
    page = (await get(`/notebooks/${nb.id}`)).text;
    expect(page).toContain('"stageChips":false');
    expect(page).toContain('"filters":["added","seen","color"]');
    const opt = (await get(`/notebooks/${nb.id}/entries/${a.id}`)).text;
    expect(opt).not.toContain('Move to Verified');
    expect(opt).not.toContain('class="nb-stage__chip" title="Stage');
    expect(opt).toContain('Rule out…');
    const out = (await get(`/notebooks/${nb.id}/entries/${b.id}`)).text;
    expect(out).toContain('Ruled out: too pricey');
    expect(out).not.toContain('Ruled out at Found');
  });

  it('a link to a search page says so, and Where it stands asks for their own pages', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Cars' });
    store.setFields(nb.id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'listing_url', label: 'Listing URL', type: 'url', role: 'link' }]);
    const a = store.upsertOption(nb.id, { title: '2008 Forester', by: 'x', fingerprint: 'a', data: { price: 3495, listing_url: 'https://www.cargurus.com/Cars/l-Used-Subaru-Forester-c1' } }).entry;
    store.upsertOption(nb.id, { title: '2010 Forester', by: 'x', fingerprint: 'b', data: { price: 4199, listing_url: 'https://www.cargurus.com/Cars/l-Used-Subaru-Forester-c1' } });
    const b = store.upsertOption(nb.id, { title: '2010 RAV4', by: 'x', fingerprint: 'c', data: { price: 4023, listing_url: 'https://www.cargurus.com/details/412345678' } }).entry;
    const page = (await get(`/notebooks/${nb.id}`)).text;
    expect(page).toContain('"linkIsList":true');
    expect(page).toContain("find each one's own listing url: 2 of 3 link to a search page. Ask sua for a step that finds them.");
    expect((await get(`/notebooks/${nb.id}/entries/${a.id}`)).text).toContain('>Search page ↗</a>');
    expect((await get(`/notebooks/${nb.id}/entries/${b.id}`)).text).toContain('>Listing URL ↗</a>');
  });

  it('Decide… lists the options still in to pick from, and records the picks', async () => {
    const app = await makeApp();
    const post = (path: string, body: Record<string, string> | string = {}) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    await post('/notebooks', { title: 'Peers' });
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    store.setFields('peers', [{ key: 'site', label: 'Website', type: 'url', role: 'link' }, { key: 'employees', label: 'Employees', type: 'number', role: 'measure', unit: 'employees' }, { key: 'fit', label: 'Fit', type: 'number', role: 'score' }]);
    store.setChecks('peers', ['Sells software']);
    store.setSteps('peers', [{ title: 'Find 3', kind: 'find', target: 3 }, { title: 'Check them', kind: 'check' }, { title: 'Pick the final 2', kind: 'decide', target: 2 }]);
    const add = (title: string, fit: number) => store.upsertOption('peers', { title, by: 'you', data: { site: `https://${title.toLowerCase()}.example`, employees: 1200, fit } }).entry;
    const acme = add('Acme', 90);
    const hooli = add('Hooli', 70);
    const globex = add('Globex', 80);
    store.checkOption('peers', acme.id, 'Sells software', true);
    store.ruleOut('peers', globex.id, 'not a peer');

    const page = await get('/notebooks/peers');
    expect(page.text).toContain('<h2 class="nb-act__title">Pick the final 2</h2>');
    expect(page.text).toContain('0 of 2 picked');
    expect(page.text).toContain('2 still in, best first.');
    expect(page.text).toMatch(/type="checkbox" name="chosen" value="[^"]+">\s*<span class="nb-decide__name">Acme<\/span>/);
    expect(page.text).toContain('Fit 90');
    expect(page.text).toContain('1,200 employees');
    expect(page.text).toContain('nb-decide__checks is-all');
    expect(page.text.indexOf('nb-decide__name">Acme')).toBeLessThan(page.text.indexOf('nb-decide__name">Hooli'));
    expect(page.text).not.toContain('nb-decide__name">Globex'); // ruled out

    const out = await post('/notebooks/peers/decide', `chosen=${acme.id}&chosen=${hooli.id}&decision=Closest+in+size`);
    expect(decodeURIComponent(out.headers.location)).toContain('Decided.');
    const nb = store.get('peers')!;
    expect(nb.decision).toBe('Chose Acme and Hooli. Closest in size');
    expect(nb.steps!.find((x) => x.kind === 'decide')).toMatchObject({ status: 'done', note: '2 chosen' });
    expect(store.entries('peers').filter((e) => e.chosenAt).map((e) => e.title).sort()).toEqual(['Acme', 'Hooli']);
    // Chosen shows on the option's page, and the shortlist's data says so (the card's ribbon).
    expect((await get(`/notebooks/peers/entries/${acme.id}`)).text).toContain('nb-stage__chip--chosen');
    expect((await get(`/notebooks/peers/entries/${globex.id}`)).text).not.toContain('nb-stage__chip--chosen');
    const { notebookWidgetData } = await import('../lib/notebook-widgets.js');
    expect(notebookWidgetData(store.get('peers')!, store.entries('peers')).notebook.options.filter((o) => o.chosen).map((o) => o.title).sort()).toEqual(['Acme', 'Hooli']);

    // One pick wanted: a radio, not a checkbox.
    await post('/notebooks/peers/status', { status: 'active' });
    store.setSteps('peers', [{ title: 'Find 3', kind: 'find', target: 3 }, { title: 'Pick one', kind: 'decide', target: 1 }]);
    const again = await get('/notebooks/peers');
    expect(again.text).toMatch(/type="radio" name="chosen" value="[^"]+" checked>/); // the earlier pick, ready to keep
  });

  it('Pick: one option at a time, or Save picks from Decide…, without closing the notebook', async () => {
    const app = await makeApp();
    const post = (path: string, body: Record<string, string> | string = {}) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    await post('/notebooks', { title: 'Gadgets' });
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    store.setSteps('gadgets', [{ title: 'Find 2', kind: 'find', target: 2 }, { title: 'Pick which to buy', kind: 'decide', target: 1 }]);
    store.updateStep('gadgets', store.get('gadgets')!.steps![0].id, { status: 'done' });
    const radio = store.upsertOption('gadgets', { title: 'Radio', by: 'you' }).entry;
    const lamp = store.upsertOption('gadgets', { title: 'Lamp', by: 'you' }).entry;

    // The step card opens Decide…, which can save picks without closing.
    const page = (await get('/notebooks/gadgets')).text;
    expect(page).toContain('data-nb-open-act="decide"');
    expect(page).toContain('data-nb-act-name="decide"');
    expect(page).toContain('Save picks, keep it open');
    // The option page has Pick this one.
    expect((await get(`/notebooks/gadgets/entries/${radio.id}`)).text).toContain('>Pick this one</button>');

    const picked = await post(`/notebooks/gadgets/entries/${radio.id}/choose`, { back: 'option' });
    expect(decodeURIComponent(picked.headers.location)).toContain(`/entries/${radio.id}?flash=Picked Radio.`);
    let nb = store.get('gadgets')!;
    expect(nb.status).toBe('active');
    expect(nb.steps![1]).toMatchObject({ status: 'done', note: '1 chosen' });
    const opt = (await get(`/notebooks/gadgets/entries/${radio.id}`)).text;
    expect(opt).toContain('✓ Picked');
    expect(opt).toContain('>Unpick</button>');

    // Taking it back opens the step again.
    await post(`/notebooks/gadgets/entries/${radio.id}/choose`, { on: '0' });
    nb = store.get('gadgets')!;
    expect(store.entries('gadgets').some((e) => e.chosenAt)).toBe(false);
    expect(nb.steps![1].status).toBe('todo');

    // Save picks from Decide…: these are the picks, and it stays open.
    const saved = await post('/notebooks/gadgets/decide', `chosen=${lamp.id}&keep=1`);
    expect(decodeURIComponent(saved.headers.location)).toContain('Picked 1. The notebook stays open.');
    nb = store.get('gadgets')!;
    expect(nb.status).toBe('active');
    expect(nb.decision).toBeUndefined();
    expect(store.entries('gadgets').filter((e) => e.chosenAt).map((e) => e.title)).toEqual(['Lamp']);
    expect(nb.steps![1].status).toBe('done');

    // A ruled-out option can't be picked.
    store.ruleOut('gadgets', radio.id, 'meh');
    const no = await post(`/notebooks/gadgets/entries/${radio.id}/choose`);
    expect(decodeURIComponent(no.headers.location)).toContain('was ruled out');
  });

  it("sua's picks: marked from its notebook-add, replaced by the next ones, ticked from Decide…", async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { parseNotebookAdd, applyNotebookAdd } = await import('../lib/notebook-chat.js');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Peers' });
    store.setFields(nb.id, [{ key: 'fit', label: 'Fit', type: 'number', role: 'score' }]);
    for (const [t, fit] of [['Pigment', 90], ['Vena', 80], ['Planful', 70], ['Board', 60]] as const) store.upsertOption(nb.id, { title: t, by: 'agent:x', data: { fit } });
    store.ruleOut(nb.id, store.findOption(nb.id, 'Board')!.id, 'too big');
    const first = applyNotebookAdd(store, nb.id, parseNotebookAdd(JSON.stringify({ picks: ['Pigment', 'Vena', 'Board', 'Nope'] })).add!, 'sua');
    expect(first.added).toEqual(['couldn\'t find an option matching "Nope"', "sua's picks: Pigment, Vena"]); // Board is ruled out
    let page = (await get(`/notebooks/${nb.id}`)).text;
    expect(page).toContain("Tick sua's picks (2)");
    expect(page).toMatch(/name="chosen" value="[^"]+" data-sua-pick>[\s\S]{0,400}?<span class="nb-decide__sua"[^>]*>sua<\/span> Pigment/);
    // The next recommendation replaces the last.
    applyNotebookAdd(store, nb.id, parseNotebookAdd(JSON.stringify({ picks: ['Planful'] })).add!, 'sua');
    expect(store.entries(nb.id).filter((e) => e.suggestedAt).map((e) => e.title)).toEqual(['Planful']);
    page = (await get(`/notebooks/${nb.id}`)).text;
    expect(page).toContain("Tick sua's picks (1)");
    expect(parseNotebookAdd(JSON.stringify({ picks: [] })).error).toBe('Nothing to add.');
  });

  it('Merge with… on an option\'s page, and sua\'s merge, make two options one', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const post = (path: string, body: Record<string, string>) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { parseNotebookAdd, applyNotebookAdd } = await import('../lib/notebook-chat.js');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Cars' });
    store.setFields(nb.id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'miles', label: 'Miles', type: 'number', role: 'measure' }]);
    const a = store.upsertOption(nb.id, { title: '2010 RAV4, Lynnwood', by: 'you', data: { price: 4023 } }).entry;
    const b = store.upsertOption(nb.id, { title: '2010 RAV4, Lynnwood (dealer)', by: 'you', data: { miles: 149652 } }).entry;
    const c = store.upsertOption(nb.id, { title: '2009 Forester', by: 'you', data: { price: 4700 } }).entry;
    const page = (await get(`/notebooks/${nb.id}/entries/${a.id}`)).text;
    expect(page).toContain(`action="/notebooks/${nb.id}/entries/${a.id}/merge"`);
    expect(page).toMatch(new RegExp(`<option value="${b.id}">★ 2010 RAV4, Lynnwood \\(dealer\\)</option>[\\s\\S]*<option value="${c.id}">2009 Forester</option>`));
    const out = await post(`/notebooks/${nb.id}/entries/${a.id}/merge`, { copy: b.id });
    expect(decodeURIComponent(out.headers.location)).toContain(`/entries/${a.id}?flash=Merged “2010 RAV4, Lynnwood (dealer)” into this one.`);
    expect(store.entries(nb.id).filter((e) => e.kind === 'option').map((e) => e.id).sort()).toEqual([a.id, c.id].sort());
    expect(store.entries(nb.id).find((e) => e.id === a.id)!.data).toEqual({ price: 4023, miles: 149652 });
    // sua merges on their word.
    const d = store.upsertOption(nb.id, { title: '2009 Subaru Forester 2.5X', by: 'you', data: { miles: 156292 } }).entry;
    const r = applyNotebookAdd(store, nb.id, parseNotebookAdd(JSON.stringify({ merge: [{ option: '2009 Forester', copies: ['Subaru Forester 2.5X'] }] })).add!, 'sua');
    expect(r.added).toEqual(['merged into 2009 Forester: 2009 Subaru Forester 2.5X']);
    expect(store.entries(nb.id).some((e) => e.id === d.id)).toBe(false);
  });

  it('sua rules out, moves, brings back and ticks criteria by name, and says what it couldn\'t find', async () => {
    await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { parseNotebookAdd, applyNotebookAdd } = await import('../lib/notebook-chat.js');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Staff role', criteria: ['An offer in hand', 'Decided by Nov'] });
    store.setStages(nb.id, ['Found', 'Applied', 'Interview', 'Offer']);
    for (const t of ['Staff Engineer, Stripe', 'Staff Engineer, Plaid', 'Staff Engineer, Ramp']) store.upsertOption(nb.id, { title: t, by: 'agent:jobs' });

    const { add, error } = parseNotebookAdd(JSON.stringify({
      moves: [{ option: 'Stripe', stage: 'Interview' }, { option: 'Ramp', stage: 'Hired' }],
      ruleOut: [{ option: 'plaid', reason: 'no callback' }, { option: 'Brex', reason: 'x' }],
      met: ['offer in hand', 'a pony'],
    }));
    expect(error).toBeUndefined();
    const { added } = applyNotebookAdd(store, nb.id, add!, 'sua');
    expect(added).toEqual([
      'moved: Staff Engineer, Stripe → Interview',
      expect.stringContaining('"Hired" isn\'t one of this notebook\'s stages'),
      'ruled out: Staff Engineer, Plaid (no callback)',
      'couldn\'t find an option matching "Brex"',
      'met: An offer in hand',
      'couldn\'t find a done-when matching "a pony"',
    ]);
    expect(store.findOption(nb.id, 'Plaid')?.ruledOut).toMatchObject({ reason: 'no callback', by: 'sua', stage: 'Found' });
    expect(applyNotebookAdd(store, nb.id, parseNotebookAdd(JSON.stringify({ reinstate: ['Plaid'] })).add!).added).toEqual(['brought back: Staff Engineer, Plaid']);
    expect(parseNotebookAdd('{}').error).toBe('Nothing to add.');
  });
});

describe('notebook photos', () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

  it('a briefing on a subject keeps each source page\'s own picture, searches for none, and shows them on the page, in the brief and beside the lead', async () => {
    const app = await makeApp();
    const { getContext } = await import('../context.js');
    const { NotebookStore, layoutPreset } = await import('@some-useful-agents/core');
    const { keepPhotos } = await import('../lib/notebook-photos.js');
    const { startNotebookPictures } = await import('../lib/notebook-pictures.js');
    const { notebookLayoutValues, picturedOptions, subjectLeadPicture, notebookWidgetData } = await import('../lib/notebook-widgets.js');
    const ctx = getContext(app.locals);
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Learn about Acme Trails', briefOn: { name: 'Acme Trails', kind: 'organization', site: 'https://acmetrails.example/' } });
    store.setFields(nb.id, [{ key: 'source_url', label: 'Source', type: 'url', role: 'link' }, { key: 'image', label: 'Picture', type: 'image', role: 'image' }]);
    store.setLayout(nb.id, layoutPreset('subject')!.layout, 'picked');
    const add = (title: string, url: string) => store.upsertOption(nb.id, { title, by: 'agent:notebook-finder', data: { source_url: url } }).entry;
    const press = add('Acme Trails in the Valley Gazette', 'https://gazette.example/news/acme-trails-opens');
    const own = add('About Acme Trails', 'https://acmetrails.example/about');
    const bare = add('Acme Trails in a directory', 'https://directory.example/listing?q=acme');
    // None of these is "one listing" with a matching title; for a subject briefing the page's own picture is kept anyway.
    const deps = {
      fetchImage: async () => ({ bytes: JPEG, contentType: 'image/jpeg' }),
      pagePreview: async (u: string) => (u.includes('directory') ? {} : { image: `${new URL(u).origin}/lead.jpg`, title: 'Something else entirely' }),
    };
    expect(await keepPhotos(store, nb.id, { deps })).toEqual({ kept: 2, tried: 3 });
    expect(store.hasPhoto(press.id) && store.hasPhoto(own.id)).toBe(true);
    expect(store.hasPhoto(bare.id)).toBe(false);
    // No image search runs for it: what has no picture of its own gets a drawing.
    let searched = 0;
    ctx.notebookPictureRun = async () => { searched++; return undefined; };
    expect(startNotebookPictures(ctx, nb.id)).toBe(false);
    expect(searched).toBe(0);
    expect(store.photoKind(bare.id)).toBe('illustration');
    expect(store.photoKind(press.id)).toBe('listing');
    // The page draws the sources as cards because some have pictures; with none, a table.
    const now = store.get(nb.id)!;
    const data = notebookWidgetData(now, store.entries(nb.id, 100), store);
    expect(picturedOptions(data)).toEqual({ pictured: 2, of: 3 });
    expect(notebookLayoutValues(now, data).evidenceLayout).toBe('grid');
    expect(notebookLayoutValues(now, { notebook: { options: [{ image: '/x', imageKind: 'illustration' }] } }).evidenceLayout).toBe('table');
    expect(notebookLayoutValues(now).evidenceLayout).toBe('table');
    // Beside the lead: a photo from the subject's own site first; none for a notebook that isn't a subject briefing.
    expect(subjectLeadPicture(now, data.notebook.options)).toBe(`/notebooks/${nb.id}/entries/${own.id}/photo`);
    expect(subjectLeadPicture({}, data.notebook.options)).toBeUndefined();
    // The brief has the pictures: a card each, the drawing-only one without a picture.
    store.setAnswer(nb.id, { question: 'q', text: '**Acme Trails is a trail guide.**', confidence: 'medium', findings: [], open: [], at: '2026-11-14T00:00:00.000Z', by: 'notebook-writer' });
    const brief = (await request(app).get(`/notebooks/${nb.id}/brief.html`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;
    expect((brief.match(/<img class="card__pic"/g) ?? []).length).toBe(2);
    expect(brief).toContain('class="card__pic is-empty"');
    expect(brief).toContain('<a class="src" href="https://gazette.example/news/acme-trails-opens">gazette.example</a>');
    expect(brief).toContain(`<img class="art is-photo" src="/notebooks/${nb.id}/entries/${own.id}/photo"`);
    // Saved as a file (and the PDF): the pictures are inside it.
    const saved = (await request(app).get(`/notebooks/${nb.id}/brief.html?download=1`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;
    expect((saved.match(/<img class="card__pic" src="data:image\/jpeg;base64,/g) ?? []).length).toBe(2);
  });

  it('keeps photos from the image field or a matching listing page, and remembers what failed', async () => {
    await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { keepPhotos } = await import('../lib/notebook-photos.js');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.setFields(store.create({ title: 'Car' }).id, [
      { key: 'photo', label: 'Photo', type: 'image', role: 'image' },
      { key: 'url', label: 'Listing', type: 'url', role: 'link' },
    ]);
    const add = (title: string, data: Record<string, string>) => store.upsertOption(nb.id, { title, by: 'agent:x', data }).entry;
    const given = add('2010 Toyota RAV4 Sport', { photo: 'https://img.example/rav4.jpg' });
    const listing = add('2009 Subaru Forester 2.5X', { url: 'https://www.autotrader.com/cars-for-sale/inventory/700000001' });
    const results = add('2007 Subaru Forester', { url: 'https://www.cargurus.com/Cars/l-Used-Subaru-Forester-Seattle-c8308' });
    const wrongCar = add('2006 Subaru Forester 2.5X', { url: 'https://www.autotrader.com/cars-for-sale/inventory/772291286' });
    const fetched: string[] = [];
    const deps = {
      fetchImage: async (u: string) => { fetched.push(u); if (u.includes('broken')) throw new Error('HTTP 404'); return { bytes: JPEG, contentType: 'image/jpeg' }; },
      pagePreview: async (u: string) => (u.endsWith('700000001')
        ? { image: 'https://images.autotrader.com/forester-09.jpg', title: '2009 Subaru Forester 2.5X for sale in Seattle' }
        : { image: 'https://images.autotrader.com/other.jpg', title: '2014 Honda CR-V EX' }),
    };
    expect(await keepPhotos(store, nb.id, { deps })).toEqual({ kept: 2, tried: 4 });
    expect(fetched.sort()).toEqual(['https://images.autotrader.com/forester-09.jpg', 'https://img.example/rav4.jpg']);
    expect(store.hasPhoto(given.id) && store.hasPhoto(listing.id)).toBe(true);
    expect(store.hasPhoto(results.id) || store.hasPhoto(wrongCar.id)).toBe(false);
    // Tried once: not again.
    expect(await keepPhotos(store, nb.id, { deps })).toEqual({ kept: 0, tried: 0 });
  });

  it('serves a kept photo as an image only, and the card shows it', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.setFields(store.create({ title: 'Car' }).id, [{ key: 'photo', label: 'Photo', type: 'image', role: 'image' }]);
    const e = store.upsertOption(nb.id, { title: 'RAV4', by: 'agent:x', data: { photo: 'https://img.example/a.jpg' } }).entry;
    store.savePhoto(nb.id, e.id, 'https://img.example/a.jpg', { contentType: 'image/jpeg', bytes: JPEG });
    const res = await request(app).get(`/notebooks/car/entries/${e.id}/photo`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain('sandbox');
    expect((await request(app).get('/notebooks/car/entries/nope/photo').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).status).toBe(404);
    const page = await request(app).get('/notebooks/car').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    // With fields, options are drawn by the shortlist widget: the kept copy is its image.
    expect(page.text).toContain('data-a2ui-surface');
    expect(page.text).toContain(`"image":"/notebooks/car/entries/${e.id}/photo"`);
    expect(page.text).toContain('Get photos');
    // The header shows the notebook's picture, as the conversation card does.
    expect(page.text).toContain(`<img class="nb-hero__cover" src="/notebooks/car/entries/${e.id}/photo"`);
    // Decide… shows it beside the option too; one with no picture keeps the column.
    expect(page.text).toContain(`<img class="nb-decide__thumb" src="/notebooks/car/entries/${e.id}/photo"`);
    expect(page.text).toContain('nb-decide__list nb-decide__list--thumbs');
    const bare = store.create({ title: 'Bike' });
    const barePage = await request(app).get(`/notebooks/${bare.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(barePage.text).not.toContain('nb-hero__cover');
    expect(barePage.text).toContain('nb-hero__icon');
  });
});

describe('setting a notebook up', () => {
  it('a setup pass sets fields, stages and the facts of options already there, and records no search', async () => {
    await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { applyKeeperResult, NOTEBOOK_SETUP } = await import('../lib/notebook-pipeline.js');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Buy a used car' });
    const rav = store.addEntry(nb.id, { kind: 'option', title: '2010 RAV4, 149,652 mi, $4,023', body: 'https://cars.example/listing/123456', by: 'agent:old' });
    expect(store.needsSetup(nb.id)).toBe(true);
    const out = applyKeeperResult(store, nb, NOTEBOOK_SETUP, 'setup-1', `<notebook>${JSON.stringify({
      entries: [],
      fields: [{ key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'miles', label: 'Miles', type: 'number', unit: 'mi', role: 'measure' }, { key: 'url', label: 'Listing', type: 'url', role: 'link' }],
      stages: ['Found', 'Checked', 'Bought'],
      facts: [{ id: rav.id, data: { price: 4023, miles: 149652, url: 'https://cars.example/listing/123456' } }, { id: 'nope', data: { price: 1 } }],
    })}</notebook>`);
    expect(out).toMatchObject({ added: 0, factsSet: 1 });
    const after = store.get(nb.id)!;
    expect(after.fields.map((f) => f.key)).toEqual(['price', 'miles', 'url']);
    expect(after.stages).toEqual(['Found', 'Checked', 'Bought']);
    const e = store.findOption(nb.id, 'RAV4')!;
    expect(e).toMatchObject({ data: { price: 4023, miles: 149652 }, fingerprint: 'cars.example/listing/123456', stage: 'Found' });
    expect(store.missedSearches(nb.id, { by: 'agent:old', createdAt: '2000-01-01T00:00:00Z' })).toBe(0);
    expect(S.runStore.databaseHandle().prepare('SELECT COUNT(*) AS n FROM notebook_searches').get()).toMatchObject({ n: 0 });
    expect(store.needsSetup(nb.id)).toBe(false); // it has fields now
  });

  it('starts setup when a notebook is created and when an options-but-no-fields notebook is opened, once', async () => {
    const app = await makeApp();
    const post = (path: string, body: Record<string, string> = {}) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    expect(decodeURIComponent((await post('/notebooks', { title: 'Find a staff role' })).headers.location)).toContain('sua is setting up what to track');
    expect(store.get('find-a-staff-role')!.setupAt).toBeTruthy();

    const old = store.create({ title: 'Old car hunt' });
    store.addEntry(old.id, { kind: 'option', title: '2009 Forester', by: 'you' });
    expect(store.get(old.id)!.setupAt).toBeUndefined();
    await request(app).get(`/notebooks/${old.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(store.get(old.id)!.setupAt).toBeTruthy();
    expect(store.needsSetup(old.id)).toBe(false); // tried: a later visit doesn't try again
  });

  it('options sua files from conversation keep their facts once the notebook has fields', async () => {
    await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { parseNotebookAdd, applyNotebookAdd } = await import('../lib/notebook-chat.js');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Car' });
    store.setFields(nb.id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'miles', label: 'Miles', type: 'number', unit: 'mi', role: 'measure' }]);
    const { add } = parseNotebookAdd(JSON.stringify({ entries: [
      { kind: 'option', title: '2011 Forester at the Ballard lot', body: 'saw it Saturday', data: { price: '$6,200', miles: 141000, color: 'blue' }, fingerprint: 'VIN JF2SH' },
      { kind: 'note', title: 'Wants heated seats', data: { price: 1 } },
    ] }));
    applyNotebookAdd(store, nb.id, add!, 'sua');
    expect(store.findOption(nb.id, 'Ballard')).toMatchObject({ data: { price: 6200, miles: 141000 }, fingerprint: 'vin jf2sh' });
    expect(store.entries(nb.id).find((e) => e.kind === 'note')!.data).toBeUndefined();
  });
});

describe('the notebooks list', () => {
  it('filters by status (active first), searches, sorts, pages, and shows each notebook\'s facts and cover', async () => {
    const app = await makeApp();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const { NotebookStore } = await import('@some-useful-agents/core');
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    for (let i = 1; i <= 14; i++) s.create({ title: `Notebook ${String(i).padStart(2, '0')}`, statement: i === 7 ? 'Find a staff role' : 'x' });
    const car = s.setFields(s.create({ title: 'Buy a used car', params: ['$3k-$5k budget'], criteria: ['One fits'] }).id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }]);
    const rav = s.upsertOption(car.id, { title: '2010 Toyota RAV4, 149,652 mi, $4,023', by: 'agent:x', data: { price: 4023 } }).entry;
    s.savePhoto(car.id, rav.id, 'https://img.example/r.jpg', { contentType: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0xff, 1]) }, { kind: 'representative' });
    s.decide(s.create({ title: 'Laptop' }).id, 'MacBook');

    const first = await get('/notebooks');
    expect(first.text).toContain('Active <span class="nb-tabs__n">15</span>');
    expect(first.text).toContain('Decided <span class="nb-tabs__n">1</span>');
    expect(first.text).not.toContain('>Laptop ');                 // active by default
    expect(first.text).toContain('1–12 of 15');
    expect(first.text).toContain('href="/notebooks?page=2"');
    expect((await get('/notebooks?page=2')).text).toContain('13–15 of 15');
    const decided = (await get('/notebooks?status=decided')).text;
    expect(decided).toContain('Laptop');
    expect(decided).toContain('nb-status--decided');
    const search = await get('/notebooks?q=staff');
    expect(search.text).toContain('Notebook 07');
    expect(search.text).not.toContain('Notebook 08');
    const carCard = await get('/notebooks?q=used%20car');
    expect(carCard.text).toContain('<span class="nbl-card__price">$4,023</span><span class="nbl-card__leadname">2010 Toyota RAV4</span>');
    // One data line, its progress as dots in the footer, and no "active" chip (the tab says it).
    expect(carCard.text).toContain('<span class="nbl-card__facts"><span>1 option</span><span>1 in the running</span></span>');
    expect(carCard.text).toContain('<span class="nbl-card__met" title="Done when: ○ One fits"><span class="nbl-card__dots" aria-hidden="true"><i class=""></i></span>0 of 1 met</span>');
    expect(carCard.text).not.toContain('nb-status--active');
    // A photo fills its frame with a blurred copy of itself behind it.
    expect(carCard.text).toContain(`class="nbl-card__cover nbl-card__cover--photo" style="--cover:url('/notebooks/buy-a-used-car/entries/${rav.id}/photo')"`);
    expect(carCard.text).toContain(`src="/notebooks/buy-a-used-car/entries/${rav.id}/photo"`);
    expect(carCard.text).toContain('example photo');
    // No picture yet: its own generated cover, with an icon for its kind.
    const plain = await get('/notebooks?q=Notebook%2001');
    expect(plain.text).toContain('class="nbl-card__art"');
    expect((await get('/notebooks?q=nothing-like-this')).text).toContain('No active notebooks matching');
  });
});

describe('sua greets a new notebook', () => {
  it('says what it set up and the first useful thing to tell it', async () => {
    await makeApp();
    const { notebookGreeting } = await import('../lib/notebook-chat.js');
    const nb = {
      id: 'car', title: 'Buy a used car', statement: 'A reliable car for a new driver.', params: [], pipeline: [], cadence: '', status: 'active' as const, createdAt: '', updatedAt: '', checks: [],
      criteria: [{ text: 'At least one car that fits', met: false }, { text: 'Clean title', met: false }],
      fields: [{ key: 'price', label: 'Price', type: 'money' as const, role: 'price' as const }, { key: 'miles', label: 'Miles', type: 'number' as const }, { key: 'photo', label: 'Photo', type: 'image' as const, role: 'image' as const }],
      stages: ['Found', 'Checked', 'Bought'],
    };
    const text = notebookGreeting(nb);
    expect(text.split('\n')[0]).toBe("I've started **Buy a used car**. What are your limits? Budget, must-haves, deal-breakers, and where to look.");
    expect(text).toContain("Here's how I'll keep it:");
    expect(text).toContain("I'll note its price and miles");
    expect(text).not.toContain('photo');
    expect(text).toContain('Found → Checked → Bought');
    expect(text).toContain('**Done when:** at least one car that fits; clean title.');
    expect(text).toContain('What are your limits? Budget, must-haves, deal-breakers, and where to look.');
    expect(notebookGreeting({ ...nb, params: ['AWD'] })).toContain("Tell me about any you've already seen, or ask me to search");
    expect(notebookGreeting({ ...nb, statement: '' })).toContain("What's this notebook for?");
  });

  it('posts it once, into the notebook\'s own conversation, after setup', async () => {
    const app = await makeApp();
    const post = (path: string, body: Record<string, string> = {}) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    await post('/notebooks', { title: 'Find a staff role', statement: 'Remote, product company' });
    const { NotebookStore, InboxStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    for (let i = 0; i < 200 && !store.get('find-a-staff-role')!.conversationId; i++) await new Promise((r) => setTimeout(r, 25));
    const nb = store.get('find-a-staff-role')!;
    expect(nb.conversationId).toBeTruthy();
    const inbox = InboxStore.fromHandle(S.runStore.databaseHandle());
    const thread = inbox.get(nb.conversationId!)!;
    expect(thread).toMatchObject({ title: 'Notebook: Find a staff role', status: 'awaiting_user' });
    const said = inbox.listResponses(thread.id);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatchObject({ role: 'triage' });
    expect(said[0].body).toContain("I've started **Find a staff role**");
    // Talking to sua continues the same conversation.
    await post('/notebooks/find-a-staff-role/ask', { text: 'remote only' });
    expect(store.get('find-a-staff-role')!.conversationId).toBe(thread.id);
  });
});

describe("a new notebook's Start", () => {
  it('is offered for a first step sua can run, not for yours or one that needs an agent', async () => {
    await makeApp();
    const { startableFirstStep } = await import('../lib/notebook-chat.js');
    const step = (kind: string, extra: Record<string, unknown> = {}) => ({ steps: [{ id: 's1', title: 'Step', kind, status: 'todo', tries: 0, ...extra }] }) as never;
    expect(startableFirstStep(step('find'))?.id).toBe('s1'); // sua's finder
    expect(startableFirstStep(step('check'))?.id).toBe('s1'); // sua's checker
    expect(startableFirstStep(step('source', { agentId: 'facts-agent' }))?.id).toBe('s1');
    expect(startableFirstStep(step('source'))).toBeUndefined(); // needs an agent first
    expect(startableFirstStep(step('decide'))).toBeUndefined(); // yours
    expect(startableFirstStep(step('find', { status: 'done' }))).toBeUndefined();
    expect(startableFirstStep({ steps: [] } as never)).toBeUndefined();
  });

  it("starts step 1 when you press it (the step card's WAS todo), and a stale one does nothing", async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const { getContext } = await import('../context.js');
    const { executeNotebookStep } = await import('./inbox-engine.js');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Peers' });
    store.setSteps(nb.id, [{ title: 'Find 3', kind: 'find', target: 3 }]);
    S.finderReply = () => '<notebook>{"entries":[{"kind":"option","title":"A"},{"kind":"option","title":"B"},{"kind":"option","title":"C"}]}</notebook>';
    const ctx = getContext(app.locals);
    const card = { kind: 'action' as const, status: 'proposed' as const, agentId: 'notebook-step', inputs: { NOTEBOOK: nb.id, STEP: 's1', WAS: 'todo' } };
    expect(await executeNotebookStep(ctx, card)).toMatchObject({ status: 'completed', summary: "Working on **Find 3**. I'll say here when it's done or stuck." });
    for (let i = 0; i < 200 && store.get(nb.id)!.steps![0].status === 'running'; i++) await new Promise((r) => setTimeout(r, 20));
    expect(store.get(nb.id)!.steps![0].status).toBe('met');
    // Pressed again later: the step isn't to do any more.
    expect(await executeNotebookStep(ctx, card)).toMatchObject({ status: 'failed' });
    S.finderReply = undefined;
  });
});

describe('a notebook started without steps', () => {
  afterEach(() => { S.stepsReply = undefined; });
  const make = async () => {
    const app = await makeApp();
    const post = (path: string, body: Record<string, string> = {}) => request(app).post(path)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
    const { NotebookStore, InboxStore } = await import('@some-useful-agents/core');
    return { app, post, store: NotebookStore.fromHandle(S.runStore.databaseHandle()), inbox: InboxStore.fromHandle(S.runStore.databaseHandle()) };
  };
  const greeted = async (store: { get(id: string): { conversationId?: string } | undefined }, id: string) => {
    for (let i = 0; i < 200 && !store.get(id)?.conversationId; i++) await new Promise((r) => setTimeout(r, 25));
  };

  it('gets steps from sua after setup (only its steps change), and the greeting says them', async () => {
    const { post, store, inbox } = await make();
    let asked: Record<string, string> | undefined;
    S.stepsReply = (inputs) => {
      asked = inputs;
      return `<draft>${JSON.stringify({ title: 'Something else', statement: 'ignored', steps: [
        { title: 'Find 10 roles', kind: 'find', agent: 'sched-agent', target: 10 },
        { title: 'Source pay', kind: 'source', agent: 'sched-agent', facts: ['Salary'] },
        { title: 'Check pay bands', kind: 'check', agent: '' },
        { title: 'Pick one', kind: 'decide', agent: 'made-up-agent', target: 1 },
      ] })}</draft>`;
    };
    await post('/notebooks', { title: 'Find a staff role', statement: 'Remote, product company' });
    await greeted(store, 'find-a-staff-role');
    const nb = store.get('find-a-staff-role')!;
    // Its steps, with a known agent kept and an invented one dropped; nothing else changed.
    expect(nb.steps!.map((x) => [x.title, x.kind, x.agentId ?? '', x.status])).toEqual([
      ['Find 10 roles', 'find', 'sched-agent', 'todo'], ['Source pay', 'source', 'sched-agent', 'todo'], ['Check pay bands', 'check', '', 'todo'], ['Pick one', 'decide', '', 'todo'],
    ]);
    expect(nb.steps![1].facts).toEqual(['salary']); // the field it names, by its key
    expect(nb).toMatchObject({ title: 'Find a staff role', statement: 'Remote, product company' });
    // sua was asked after setup: it saw the fields setup gave the notebook.
    expect(asked!.TEXT).toBe('Remote, product company');
    expect(JSON.parse(asked!.CURRENT)).toMatchObject({ title: 'Find a staff role', steps: [] });
    expect(asked!.CURRENT).toContain('"salary"');
    const said = inbox.listResponses(nb.conversationId!);
    expect(said).toHaveLength(2);
    expect(said[0].body).toContain('**The work, one step at a time:** find 10 roles, then source pay, then check pay bands, then pick one.');
    // Step 1 is a press away: the greeting says so, and a Start card follows it.
    expect(said[0].body).toContain("Press **Start** when you're ready and I'll begin with **Find 10 roles**.");
    expect(said[1]).toMatchObject({ role: 'action' });
    expect(JSON.parse(said[1].metaJson!)).toMatchObject({ agentId: 'notebook-step', status: 'proposed', ctaLabel: 'Start', inputs: { NOTEBOOK: nb.id, STEP: 's1', WAS: 'todo' }, rationale: 'Start step 1: Find 10 roles, with sched-agent.' });
  });

  it('a new notebook waiting on its Start card offers Start on its own page: one press, no trip to the conversation', async () => {
    const { app, post, store, inbox } = await make();
    const get = (path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    await post('/notebooks', { title: 'Headphones', statement: 'For flights.', step_title: 'Find 5 pairs', step_kind: 'find', step_agent: 'sched-agent' });
    await greeted(store, 'headphones');
    const nb = store.get('headphones')!;
    const thread = nb.conversationId!;
    // The Start card follows the greeting a moment after the conversation exists.
    for (let i = 0; i < 200 && !inbox.listResponses(thread).some((r) => r.role === 'action'); i++) await new Promise((r) => setTimeout(r, 25));
    const card = () => JSON.parse(inbox.listResponses(thread).find((r) => r.role === 'action')!.metaJson!) as { status: string; ctaLabel: string };
    expect(card()).toMatchObject({ status: 'proposed', ctaLabel: 'Start' });

    // The bar under the steps and the Talk card both carry the step's own button (the header's form), and a way to talk instead.
    const page = (await get('/notebooks/headphones')).text;
    const bar = /<div class="nb-live__row nb-live__row--waiting"[\s\S]*?<\/div>/.exec(page)![0];
    expect(bar).toContain('<strong>Ready when you are</strong> · Start: Start step 1: Find 5 pairs');
    expect(bar).toContain('<form method="POST" action="/notebooks/headphones/run" class="nb-next__form">');
    expect(bar).toMatch(/<button type="submit" class="btn btn--primary btn--sm nb-next"[^>]*>Start step 1/);
    expect(bar).toContain(`data-nb-continue="${thread}">Ask sua</button>`);
    expect(page).not.toContain('Review and approve');
    expect(page).not.toContain('sua needs your OK');
    expect(page).toMatch(/class="nb-talk__waiting-label">Ready when you are<[\s\S]*?action="\/notebooks\/headphones\/run"/);

    // Pressing it is pressing the card: the step starts, and nothing is left to approve.
    const pressed = await post('/notebooks/headphones/run');
    expect(pressed.status).toBe(303);
    expect(card().status).not.toBe('proposed');
    for (let i = 0; i < 200 && (store.get('headphones')!.steps ?? []).some((x) => x.status === 'running'); i++) await new Promise((r) => setTimeout(r, 25));
  });

  it("keeps a draft's steps without asking again, and still greets when sua gives none", async () => {
    const { post, store, inbox } = await make();
    let calls = 0;
    S.stepsReply = () => { calls++; return undefined; };
    await post('/notebooks', { title: 'Headphones', statement: 'For flights.', step_title: 'Find 5 pairs', step_kind: 'find', step_agent: 'sched-agent' });
    await post('/notebooks', { title: 'Rental', statement: 'A quiet 2-bed' });
    await greeted(store, 'headphones');
    await greeted(store, 'rental');
    expect(store.get('headphones')!.steps!.map((x) => x.title)).toEqual(['Find 5 pairs']);
    expect(store.get('rental')!.steps).toBeUndefined();
    expect(calls).toBe(1); // only the notebook without steps
    expect(inbox.listResponses(store.get('rental')!.conversationId!)[0].body).not.toContain('one step at a time');
    // No steps: nothing to start, so no card.
    expect(inbox.listResponses(store.get('rental')!.conversationId!)).toHaveLength(1);
  });
});

describe("a notebook's conversation shows the notebook", () => {
  const get = (app: Awaited<ReturnType<typeof makeApp>>, path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
  it('as a card under the title: from the page it was started on, or the notebook it belongs to; not on other threads', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.setFields(store.create({ title: 'Guitar', criteria: ['Has a pickup'] }).id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }]);
    store.upsertOption(nb.id, { title: 'Ibanez Talman', by: 'agent:x', data: { price: 279.99 } });
    store.upsertOption(nb.id, { title: 'Yamaha FSX', by: 'agent:x', data: { price: 349 } });
    const inbox = InboxStore.fromHandle(S.runStore.databaseHandle());
    const fromPage = inbox.add({ priority: 'medium', source: 'manual', title: 'Notebook: Guitar', body: '(empty)',
      contextJson: JSON.stringify({ page: { kind: 'notebook', id: nb.id, path: `/notebooks/${nb.id}`, title: 'Guitar' } }) });
    let res = await get(app, `/inbox/${fromPage.id}/fragment`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`class="ib-notebook" href="/notebooks/${nb.id}"`);
    expect(res.text).toContain('2 options · 2 in the running · 0 of 1 done');
    expect(res.text).toContain('<strong>$279.99</strong> Ibanez Talman');

    const linked = inbox.add({ priority: 'medium', source: 'manual', title: 'About the guitar', body: '(empty)' });
    store.setConversation(nb.id, linked.id);
    expect((await get(app, `/inbox/${linked.id}/fragment`)).text).toContain(`href="/notebooks/${nb.id}"`);

    const other = inbox.add({ priority: 'medium', source: 'manual', title: 'Something else', body: '(empty)' });
    res = await get(app, `/inbox/${other.id}/fragment`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('ib-notebook');
  });
});

describe('a notebook page names its conversation', () => {
  it('for the sua panel to open when you arrive with it open', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Bike' });
    const page = () => request(app).get(`/notebooks/${nb.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect((await page()).text).toContain('data-page-thread=""');
    const thread = InboxStore.fromHandle(S.runStore.databaseHandle()).add({ priority: 'medium', source: 'manual', title: 'Notebook: Bike', body: '(empty)' });
    store.setConversation(nb.id, thread.id);
    expect((await page()).text).toContain(`data-page-thread="${thread.id}"`);
  });
});

describe('runs not in the notebook yet', () => {
  it('Skip stops offering a run that does not belong; Skip all clears the rest', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Guitar' });
    store.addEntry(nb.id, { kind: 'option', title: 'Redondo CE', by: 'agent:finder', runId: 'run-g0' });
    const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
    for (const [id, ago] of [['run-g0', 90_000], ['run-g1', 60_000], ['run-g2', 50_000], ['run-g3', 40_000]] as const) {
      S.runStore.createRun({ id, agentName: 'finder', status: 'completed', startedAt: at(ago), completedAt: at(ago - 1000), triggeredBy: 'dashboard', result: 'done' } as never);
    }
    const get = () => request(app).get(`/notebooks/${nb.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    const post = (path: string) => request(app).post(`/notebooks/${nb.id}/runs/${path}`)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    let page = await get();
    for (const r of ['run-g1', 'run-g2', 'run-g3']) expect(page.text).toContain(`/runs/${r}/skip`);
    expect(page.text).toContain(`/notebooks/${nb.id}/runs/skip-all`);
    expect(decodeURIComponent((await post('run-g1/skip')).headers.location.replace(/\+/g, ' '))).toContain("won't be offered here again");
    page = await get();
    expect(page.text).not.toContain('/runs/run-g1/');
    expect(page.text).toContain('/runs/run-g2/add');
    // Only runs it offers can be skipped.
    expect(decodeURIComponent((await post('run-g0/skip')).headers.location.replace(/\+/g, ' '))).toContain("isn't offered here");
    expect(decodeURIComponent((await post('skip-all')).headers.location.replace(/\+/g, ' '))).toContain('Skipped 2 runs');
    expect((await get()).text).not.toContain('Runs not in this notebook yet');
    expect(store.skippedRunIds(nb.id).sort()).toEqual(['run-g1', 'run-g2', 'run-g3']);
  });

  it('lists finished runs of its agents that ran elsewhere, and Add to notebook files one', async () => {
    const app = await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'Car' });
    store.addEntry(nb.id, { kind: 'option', title: '2010 RAV4', by: 'agent:sweep', runId: 'run-filed' });
    const now = Date.now();
    const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
    const keeper = `<notebook>${JSON.stringify({ entries: [{ kind: 'option', title: '2007 Forester 2.5 X' }] })}</notebook>`;
    const run = (id: string, agentName: string, status: 'completed' | 'failed', msAgo: number, result?: string) =>
      S.runStore.createRun({ id, agentName, status, startedAt: iso(msAgo), completedAt: iso(msAgo - 1000), triggeredBy: 'dashboard', ...(result ? { result } : {}) } as never);
    run('run-filed', 'sweep', 'completed', 3_600_000, keeper);
    run('run-new', 'sweep', 'completed', 60_000, keeper);
    run('run-failed', 'sweep', 'failed', 120_000);
    run('run-old', 'sweep', 'completed', 20 * 86_400_000, keeper);
    run('run-other', 'weather', 'completed', 60_000, keeper);
    const get = () => request(app).get(`/notebooks/${nb.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    let page = await get();
    expect(page.text).toContain('Runs not in this notebook yet');
    expect(page.text).toContain(`/notebooks/${nb.id}/runs/run-new/add`);
    for (const r of ['run-filed', 'run-failed', 'run-old', 'run-other']) expect(page.text).not.toContain(`/runs/${r}/add`);
    // A run already filed into another notebook belongs there.
    run('run-other-nb', 'sweep', 'completed', 30_000, keeper);
    const other = store.create({ title: 'Other' });
    store.recordSearch(other.id, 'sweep', 'run-other-nb', 1);
    expect((await get()).text).not.toContain('/runs/run-other-nb/add');
    // A run one of its steps made (a page reader setting facts on an option it has) is in it,
    // and not offered to the other notebook either.
    run('run-facts', 'sweep', 'completed', 20_000, '{"salary": 200000}');
    expect((await get()).text).toContain('/runs/run-facts/add');
    const pass = store.startPass(nb.id, 'pipeline');
    store.addRunToPass(pass, 'run-facts');
    expect((await get()).text).not.toContain('/runs/run-facts/add');
    expect(store.notebooksForRuns(['run-facts'])).toEqual([{ notebookId: nb.id, title: 'Car', runId: 'run-facts' }]);

    const post = (runId: string) => request(app).post(`/notebooks/${nb.id}/runs/${runId}/add`)
      .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(decodeURIComponent((await post('run-other')).headers.location.replace(/\+/g, ' '))).toContain("isn't one of its agents");
    expect(decodeURIComponent((await post('run-new')).headers.location.replace(/\+/g, ' '))).toContain("Adding that run's results");
    for (let i = 0; i < 50 && !store.entries(nb.id).some((e) => e.title.startsWith('2007 Forester')); i++) await new Promise((r) => setTimeout(r, 20));
    expect(store.entries(nb.id).find((e) => e.title.startsWith('2007 Forester'))?.runId).toBe('run-new');
    page = await get();
    expect(page.text).not.toContain('Runs not in this notebook yet');
    expect(decodeURIComponent((await post('run-new')).headers.location.replace(/\+/g, ' '))).toContain('already in the notebook');
    // Adding it was a pass of its own, and the Workflow draws it.
    const passes = store.passes(nb.id);
    expect(passes[0]).toMatchObject({ kind: 'added', runIds: ['run-new'], note: expect.stringContaining('sweep: 1 new') });
    const wf = await request(app).get(`/notebooks/${nb.id}/workflow?pass=${passes[0].id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(wf.text).toContain('class="nbw-pass is-on"');
    expect(wf.text).toContain('Added to notebook');
    expect(wf.text).toContain('Earlier run'); // run-filed, from before passes

    // Decided still takes a run (anything learned since is worth keeping); archived doesn't.
    run('run-after', 'sweep', 'completed', 10_000, `<notebook>${JSON.stringify({ entries: [{ kind: 'option', title: '2012 Outback' }] })}</notebook>`);
    store.decide(nb.id, 'The RAV4');
    expect((await get()).text).toContain('/runs/run-after/add');
    expect(decodeURIComponent((await post('run-after')).headers.location.replace(/\+/g, ' '))).toContain("Adding that run's results");
    for (let i = 0; i < 50 && !store.entries(nb.id).some((e) => e.title === '2012 Outback'); i++) await new Promise((r) => setTimeout(r, 20));
    expect(store.entries(nb.id).some((e) => e.title === '2012 Outback')).toBe(true);
    run('run-late', 'sweep', 'completed', 5_000, keeper);
    store.archive(nb.id);
    expect(decodeURIComponent((await post('run-late')).headers.location.replace(/\+/g, ' '))).toContain('archived');
  });
});

describe("Home's notebooks shelf", () => {
  it('shows your recent notebooks newest first (four at most; one you decided or archived is marked), what sua is waiting on, and + New', async () => {
    const app = await makeApp();
    S.agentStore.createAgent({ id: 'hello', name: 'Hello', status: 'active', source: 'local', mcp: false, nodes: [{ id: 'n', type: 'shell', command: 'echo hi' }] } as never, 'cli');
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const home = async () => (await request(app).get('/').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;

    // None yet: an inviting + New, nothing else.
    let page = await home();
    expect(page).toContain('Your notebooks');
    expect(page).toContain('class="nbs-new nbs-new--alone" href="/notebooks/new"');
    expect(page).not.toContain('class="nbs-card"');

    const ids: string[] = [];
    for (const t of ['Bike', 'Laptop', 'Trip', 'Job']) ids.push(store.create({ title: t }).id);
    // The car changes after them, in a later millisecond, so it's the newest.
    await new Promise((r) => setTimeout(r, 15));
    const car = store.setFields(store.create({ title: 'Car', criteria: ['Clean title', 'Under budget'] }).id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }]);
    store.markCriterion(car.id, 0, true);
    store.upsertOption(car.id, { title: '2010 RAV4', by: 'agent:x', data: { price: 4023 } });
    // Decided and archived ones made earlier; the car is touched last.
    const done = store.create({ title: 'Old couch' });
    store.decide(done.id, 'Kept it');
    const away = store.create({ title: 'Old desk' });
    store.archive(away.id);
    await new Promise((r) => setTimeout(r, 15));
    store.markCriterion(car.id, 1, false);
    const thread = InboxStore.fromHandle(S.runStore.databaseHandle()).add({ priority: 'medium', source: 'manual', title: 'Notebook: Car', body: '(empty)' });
    store.setConversation(car.id, thread.id);
    InboxStore.fromHandle(S.runStore.databaseHandle()).updateStatus(thread.id, 'awaiting_user');

    page = await home();
    const cards = page.match(/class="nbs-card" href="\/notebooks\/([^"]+)"/g) ?? [];
    expect(cards).toHaveLength(4);
    expect(cards[0]).toContain(`/notebooks/${car.id}"`); // changed last, so first
    // Recent ones you decided or put away are listed too, marked; they're where you were, not a suggestion.
    expect(page).toContain('Recent notebooks');
    const card = (id: string) => page.slice(page.indexOf(`/notebooks/${id}"`), page.indexOf('</a>', page.indexOf(`/notebooks/${id}"`)));
    expect(card(done.id)).toContain('<span class="nbs-card__mark">decided</span>');
    expect(card(away.id)).toContain('<span class="nbs-card__mark">archived</span>');
    expect(card(car.id)).not.toContain('nbs-card__mark');
    expect(page).toContain('All notebooks (7) →');
    const carCard = page.slice(page.indexOf(`/notebooks/${car.id}"`), page.indexOf('</a>', page.indexOf(`/notebooks/${car.id}"`)));
    expect(carCard).toContain('sua asked you');
    expect(carCard).toContain('<span class="nbs-card__price">$4,023</span>');
    expect(carCard).toContain('aria-label="1 of 2 done"');
    expect((carCard.match(/nbs-dot is-met/g) ?? []).length).toBe(1);
    expect(page.match(/sua asked you/g)).toHaveLength(1);
    expect(page).toContain('class="nbs-new" href="/notebooks/new"');
  });

  it("a card's picture is its lead option's, not just the newest picture", async () => {
    const app = await makeApp();
    S.agentStore.createAgent({ id: 'hello', name: 'Hello', status: 'active', source: 'local', mcp: false, nodes: [{ id: 'n', type: 'shell', command: 'echo hi' }] } as never, 'cli');
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const home = async () => (await request(app).get('/').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;
    const png = { contentType: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) };
    const car = store.setFields(store.create({ title: 'Car' }).id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }]);
    const cheap = store.upsertOption(car.id, { title: '2010 RAV4', by: 'agent:x', data: { price: 4023 } });
    await new Promise((r) => setTimeout(r, 15));
    const dear = store.upsertOption(car.id, { title: '2014 CR-V', by: 'agent:x', data: { price: 9900 } });
    store.savePhoto(car.id, dear.entry.id, 'https://example.test/crv.jpg', png, { kind: 'listing' });
    const card = (page: string) => page.slice(page.indexOf(`/notebooks/${car.id}"`), page.indexOf('</a>', page.indexOf(`/notebooks/${car.id}"`)));

    // The lead (cheapest) has no picture yet: the notebook's cover, the newest picture.
    let c = card(await home());
    expect(c).toContain('<span class="nbs-card__leadname">2010 RAV4</span>');
    expect(c).toContain(`/entries/${dear.entry.id}/photo`);
    // A drawing of the lead doesn't win over a real photo of another option.
    store.savePhoto(car.id, cheap.entry.id, 'illustration', { contentType: 'image/svg+xml', bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>') }, { kind: 'illustration' });
    expect(card(await home())).toContain(`/entries/${dear.entry.id}/photo`);
    // Once the lead has a photo of its own, the card shows it.
    store.savePhoto(car.id, cheap.entry.id, 'https://example.test/rav4.jpg', png, { kind: 'listing' });
    c = card(await home());
    expect(c).toContain(`/entries/${cheap.entry.id}/photo`);
    expect(c).not.toContain(`/entries/${dear.entry.id}/photo`);
    // The notebook's own header shows the same picture as its card.
    const page = (await request(app).get(`/notebooks/${car.id}`).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE)).text;
    expect(page).toContain(`<img class="nb-hero__cover" src="/notebooks/${car.id}/entries/${cheap.entry.id}/photo"`);
  });
});
