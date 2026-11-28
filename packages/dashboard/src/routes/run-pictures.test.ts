/**
 * A picture a run made, end to end: a graphics server in Docker saves it in
 * the folder it shares, sua shows it in the conversation and adds it to the
 * answer the conversation is about, and the answer's page shows it. A
 * picture left inside the container is said plainly.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { S, makeApp, COOKIE, PORT } from './notebooks.test-kit.js';

// The 8-byte PNG signature and a little more: enough to be a PNG to the type checks.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function setup(graphicPath: string) {
  const app = await makeApp();
  const { NotebookStore, InboxStore, ToolStore } = await import('@some-useful-agents/core');
  const db = S.runStore.databaseHandle();
  const shared = join(S.dir, 'graphics-out');
  mkdirSync(shared, { recursive: true });
  writeFileSync(join(shared, 'pbj.png'), PNG);
  const tools = ToolStore.fromHandle(db);
  tools.createMcpServer({ id: 'modern-graphics', name: 'modern-graphics', transport: 'stdio', enabled: true, command: 'docker', args: ['run', '--rm', '-i', '-v', `${shared}:/app/output`, '-w', '/app', 'modern-graphics'] });
  Object.assign(S.ctx!, { toolStore: tools });
  S.agentStore.createAgent({
    id: 'graphics-creator-mcp', name: 'Graphics creator (MCP)', status: 'active', source: 'local', mcp: false,
    nodes: [{ id: 'render', type: 'shell', command: 'echo' }],
    outputWidget: { type: 'dashboard', fields: [{ name: 'title', type: 'text', label: 'Title' }, { name: 'graphic_path', type: 'preview', label: 'Output' }] },
  } as never, 'cli');
  const runId = 'run-pbj';
  S.runStore.createRun({ id: runId, agentName: 'graphics-creator-mcp', status: 'completed', startedAt: new Date().toISOString(), triggeredBy: 'dashboard', result: JSON.stringify({ title: 'PB&J in Six Steps', graphic_path: graphicPath }) } as never);
  const store = NotebookStore.fromHandle(db);
  const nb = store.create({ title: 'Learn to make a PB&J' });
  const other = store.create({ title: 'Something else' });
  const inbox = InboxStore.fromHandle(db);
  const thread = inbox.add({ priority: 'medium', source: 'manual', title: 'build me an artboard for my PB&J notebook', body: '(empty)' })!;
  inbox.addResponse(thread.id, 'triage', `I found your [PB&J notebook](/notebooks/${nb.id}).`);
  const action = inbox.addResponse(thread.id, 'action', 'Draw it.', JSON.stringify({ kind: 'action', status: 'completed', agentId: 'graphics-creator-mcp', effect: 'write', inputs: { TOPIC: 'PB&J' }, runId, resultSummary: 'done' }));
  const get = async (p: string) => request(app).get(p).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
  const post = async (p: string, form: Record<string, string>) => request(app).post(p).type('form').send(form).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE).set('Origin', `http://127.0.0.1:${PORT}`);
  return { store, inbox, nb, other, thread, action, runId, get, post };
}

describe('a picture a run made', () => {
  it('is served from the folder the Docker server shares, and only from there', async () => {
    const { get } = await setup('output/pbj.png');
    const ok = await get('/output-file?path=output%2Fpbj.png');
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toMatch(/^image\/png/);
    expect((await get('/output-file?path=%2Fapp%2Foutput%2Fpbj.png')).status).toBe(200);
    expect((await get('/output-file?path=%2Fapp%2Foutput%2F..%2F..%2Fetc%2Fpasswd')).status).toBe(403);
  });

  it('shows in the conversation with one Add button for the conversation’s answer, others behind Another answer; adding puts it on the answer’s page and brief, once; Remove takes it out', async () => {
    const { store, inbox, nb, other, thread, action, runId, get, post } = await setup('output/pbj.png');
    const page = (await get(`/inbox/${thread.id}/fragment`)).text;
    expect(page).toContain('<a class="inbox-action__picture" href="/output-file?path=output%2Fpbj.png" target="_blank" rel="noopener" title="Open full size"><img src="/output-file?path=output%2Fpbj.png" alt="Output" loading="lazy"></a>');
    expect(page).toContain('Add to Learn to make a PB&amp;J</button>');
    expect(page).toMatch(new RegExp(`<summary>Another answer</summary>[\\s\\S]*<option value="${other.id}">Something else</option>`));
    // The widget's own link to the file isn't repeated.
    expect(page).not.toContain('Open Output');

    const add = async () => post(`/inbox/${thread.id}/actions/${action.id}/add-picture`, { field: 'graphic_path', notebook: nb.id });
    const res = await add();
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain('ok=');
    // Pressed twice: still one.
    expect((await add()).headers.location).toContain(encodeURIComponent('already in'));
    const ids = store.pictureNoteIds(nb.id);
    expect(ids).toHaveLength(1);
    expect(store.picturesFromRun(runId)).toEqual([{ notebookId: nb.id, entryId: ids[0] }]);
    expect(store.photo(ids[0])).toMatchObject({ contentType: 'image/png', sourceUrl: `/runs/${runId}` });
    expect(inbox.listResponses(thread.id).filter((r) => r.role === 'system').map((r) => r.body)).toEqual([`Added **PB&J in Six Steps** to [Learn to make a PB&J](/notebooks/${nb.id}).`]);

    // Where it is, with Remove; no second Add for that answer.
    const after = (await get(`/inbox/${thread.id}/fragment`)).text;
    expect(after).toMatch(new RegExp(`<span>In <a href="/notebooks/${nb.id}">Learn to make a PB&amp;J</a></span>\\s*<button type="submit" class="btn btn--sm btn--ghost">Remove</button>`));
    expect(after).not.toContain('Add to Learn to make a PB&amp;J');
    const nbPage = (await get(`/notebooks/${nb.id}`)).text;
    expect(nbPage).toContain('class="nb-pictures"');
    expect(nbPage).toContain(`<img src="/notebooks/${nb.id}/entries/${ids[0]}/photo" alt="PB&amp;J in Six Steps" loading="lazy">`);
    expect(nbPage).toContain(`<a href="/runs/${runId}">the run that made it</a>`);
    const brief = (await get(`/notebooks/${nb.id}/brief.html`)).text;
    expect(brief).toMatch(/<section class="pictures" aria-label="Pictures"><h2[^>]*>Pictures<\/h2>/);
    expect(brief).not.toContain('<li>PB&amp;J in Six Steps</li>');
    expect(brief).toContain(`<img src="/notebooks/${nb.id}/entries/${ids[0]}/photo" alt="PB&amp;J in Six Steps"`);
    const saved = (await get(`/notebooks/${nb.id}/brief.html?download=1`)).text;
    expect(saved).toContain(`<img src="data:image/png;base64,${PNG.toString('base64')}" alt="PB&amp;J in Six Steps"`);
    const img = await get(`/notebooks/${nb.id}/entries/${ids[0]}/photo`);
    expect(img.status).toBe(200);
    expect(Buffer.from(img.body as Buffer).equals(PNG)).toBe(true);
    expect((await get(`/notebooks/${other.id}`)).text).not.toContain('class="nb-pictures"');

    const rm = await post(`/inbox/${thread.id}/actions/${action.id}/remove-picture`, { notebook: nb.id });
    expect(rm.headers.location).toContain('ok=');
    expect(store.pictureNoteIds(nb.id)).toEqual([]);
    expect(inbox.listResponses(thread.id).at(-1)).toMatchObject({ role: 'system', body: `Took **PB&J in Six Steps** out of [Learn to make a PB&J](/notebooks/${nb.id}).` });
    expect((await get(`/notebooks/${nb.id}`)).text).not.toContain('class="nb-pictures"');

    // On the answer's own page, Remove beside the picture takes it out too.
    await add();
    const [again] = store.pictureNoteIds(nb.id);
    expect((await get(`/notebooks/${nb.id}`)).text).toContain(`<form method="POST" action="/notebooks/${nb.id}/entries/${again}/remove" class="nb-picture__remove">`);
    expect((await post(`/notebooks/${nb.id}/entries/${again}/remove`, {})).status).toBe(303);
    expect(store.pictureNoteIds(nb.id)).toEqual([]);
    expect((await get(`/notebooks/${nb.id}/entries/${again}/photo`)).status).toBe(404);
  });

  it('when the run ends in a conversation about one answer, the picture goes into it by itself, said before sua replies', async () => {
    const { store, inbox, nb, thread, runId } = await setup('output/pbj.png');
    const { finalizeActionFromOutcome } = await import('./inbox-engine.js');
    const running = inbox.addResponse(thread.id, 'action', 'Draw it again.', JSON.stringify({ kind: 'action', status: 'running', agentId: 'graphics-creator-mcp', effect: 'write', inputs: {} }));
    const meta = JSON.parse(running.metaJson!) as never;
    finalizeActionFromOutcome(S.ctx as never, thread.id, running.id, meta, { id: runId, status: 'completed', result: 'done' }, { refire: false });
    expect(store.pictureNoteIds(nb.id)).toHaveLength(1);
    expect(inbox.listResponses(thread.id).at(-1)).toMatchObject({ role: 'system', body: `Added **PB&J in Six Steps** to [Learn to make a PB&J](/notebooks/${nb.id}). It's under Pictures on its page.` });
    // Settled again (a restart): not added twice.
    finalizeActionFromOutcome(S.ctx as never, thread.id, running.id, meta, { id: runId, status: 'completed', result: 'done' }, { refire: false });
    expect(store.pictureNoteIds(nb.id)).toHaveLength(1);
  });

  it('a conversation about no answer waits for you to choose', async () => {
    const { store, inbox, nb, other, runId } = await setup('output/pbj.png');
    const { finalizeActionFromOutcome } = await import('./inbox-engine.js');
    const t2 = inbox.add({ priority: 'medium', source: 'manual', title: 'draw me something', body: '(empty)' })!;
    const r = inbox.addResponse(t2.id, 'action', 'Draw it.', JSON.stringify({ kind: 'action', status: 'running', agentId: 'graphics-creator-mcp', effect: 'write', inputs: {} }));
    finalizeActionFromOutcome(S.ctx as never, t2.id, r.id, JSON.parse(r.metaJson!) as never, { id: runId, status: 'completed', result: 'done' }, { refire: false });
    expect(store.pictureNoteIds(nb.id)).toEqual([]);
    expect(store.pictureNoteIds(other.id)).toEqual([]);
  });

  it('a picture kept with a run (an artboard drawn by picture-from-svg) is served too; nothing else from there', async () => {
    const { get } = await setup('output/pbj.png');
    const dir = join(S.agentStore.dataRoot, 'run-files', 'run-art');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'render-1.png'), PNG);
    writeFileSync(join(dir, 'notes.txt'), 'private');
    expect((await get(`/output-file?path=${encodeURIComponent(join(dir, 'render-1.png'))}`)).status).toBe(200);
    expect((await get(`/output-file?path=${encodeURIComponent(join(dir, 'notes.txt'))}`)).status).toBe(403);
  });

  it('left inside the container, it says so instead, and can’t be added', async () => {
    const { thread, action, nb, store, get, post } = await setup('.sua/graphics-output/pbj.png');
    const page = (await get(`/inbox/${thread.id}/fragment`)).text;
    expect(page).toContain("It made a picture sua can't show.");
    expect(page).toContain('.sua/graphics-output/pbj.png');
    expect(page).not.toContain('/add-picture"');
    expect(page).not.toContain('class="inbox-action__picture"');
    const res = await post(`/inbox/${thread.id}/actions/${action.id}/add-picture`, { field: 'graphic_path', notebook: nb.id });
    expect(res.headers.location).toContain('error=');
    expect(store.pictureNoteIds(nb.id)).toEqual([]);
  });
});

describe('NotebookStore.addPicture', () => {
  it('keeps only pictures a page shows safely', async () => {
    await makeApp();
    const { NotebookStore } = await import('@some-useful-agents/core');
    const store = NotebookStore.fromHandle(S.runStore.databaseHandle());
    const nb = store.create({ title: 'x' });
    expect(() => store.addPicture(nb.id, { title: 'svg', by: 'you', contentType: 'image/svg+xml', bytes: PNG })).toThrow(/PNG, JPEG, GIF or WebP/);
    expect(() => store.addPicture(nb.id, { title: 'empty', by: 'you', contentType: 'image/png', bytes: new Uint8Array() })).toThrow(/empty/);
    expect(store.pictureNoteIds(nb.id)).toEqual([]);
  });
});
