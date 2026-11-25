/**
 * Notebook files in the dashboard: Download / share → Notebook file, and
 * New notebook → Import a notebook file (docs/notebooks.md).
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { NotebookStore, unpackNotebookBundle } from '@some-useful-agents/core';
import { S, makeApp, COOKIE, PORT } from './notebooks.test-kit.js';

const HOST = `127.0.0.1:${PORT}`;
type App = Awaited<ReturnType<typeof makeApp>>;
const get = (app: App, path: string) => request(app).get(path).set('Host', HOST).set('Cookie', COOKIE)
  .buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
const getText = (app: App, path: string) => request(app).get(path).set('Host', HOST).set('Cookie', COOKIE);
const upload = (app: App, bytes: Buffer) => request(app).post('/notebooks/import/check').set('Host', HOST).set('Origin', `http://${HOST}`).set('Cookie', COOKIE).set('Content-Type', 'application/gzip').send(bytes);
const post = (app: App, path: string) => request(app).post(path).set('Host', HOST).set('Origin', `http://${HOST}`).set('Cookie', COOKIE).type('form').send({});

function seed(): string {
  const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
  const nb = s.create({ title: 'Pick headphones', statement: 'Under $300', pipeline: ['sched-agent'], cadence: '0 8 * * *' });
  s.addEntry(nb.id, { kind: 'option', title: 'Quiet One', by: 'you' });
  return nb.id;
}

describe('notebook files', () => {
  it('downloads a notebook as a notebook file, offered under Download / share', async () => {
    const app = await makeApp();
    const id = seed();
    const res = await get(app, `/notebooks/${id}/export.suanb`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/gzip/);
    expect(res.headers['content-disposition']).toMatch(/Pick headphones\.suanb/);
    const bundle = unpackNotebookBundle(res.body as Buffer);
    expect(bundle.meta.title).toBe('Pick headphones');
    expect(bundle.agents.map((a) => a.id)).toEqual(['sched-agent']);
    expect((await get(app, '/notebooks/nope/export.suanb')).status).toBe(404);
    const page = await getText(app, `/notebooks/${id}`);
    expect(page.text).toContain(`/notebooks/${id}/export.suanb`);
    expect(page.text).toContain('To another sua');
  });

  it('checks a file, shows what will happen, then imports it as a copy with its schedule off', async () => {
    const app = await makeApp();
    const id = seed();
    const file = (await get(app, `/notebooks/${id}/export.suanb`)).body as Buffer;
    expect((await getText(app, '/notebooks/new')).text).toContain('href="/notebooks/import"');
    expect((await getText(app, '/notebooks/import')).text).toContain('data-nb-import-file');

    const checked = await upload(app, file);
    expect(checked.body.ok).toBe(true);
    expect(checked.body.html).toContain(`${id}-2`);
    expect(checked.body.html).toMatch(/Uses <span class="mono">sched-agent<\/span>, already here/);
    expect(checked.body.html).toMatch(/schedule is off here/);

    const done = await post(app, `/notebooks/import/${checked.body.key}`);
    expect(done.status).toBe(303);
    expect(done.headers.location).toMatch(new RegExp(`^/notebooks/${id}-2\\?flash=`));
    const s = NotebookStore.fromHandle(S.runStore.databaseHandle());
    expect(s.get(`${id}-2`)!.cadence).toBe('');
    expect(s.entries(`${id}-2`, 100).map((e) => e.title)).toEqual(expect.arrayContaining(['Quiet One', 'Copied from another machine']));
    // A key is used once.
    expect(decodeURIComponent((await post(app, `/notebooks/import/${checked.body.key}`)).headers.location)).toMatch(/checked too long ago/);
  });

  it('says plainly when a file isn\'t a notebook file', async () => {
    const app = await makeApp();
    const bad = await upload(app, Buffer.from('not a notebook'));
    expect(bad.status).toBe(422);
    expect(bad.body.error).toMatch(/isn't a notebook file/);
  });
});
