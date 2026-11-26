/**
 * /skills: read, write and change skills (docs/skills.md).
 */
import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { SkillStore, type Agent } from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import { SESSION_COOKIE } from '../auth-middleware.js';
import { createTestContext, closeTestContext, type TestContext } from '../test-harness.js';
import { readPastedSkill } from '../lib/skill-edit.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3994;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;
const HOST = `127.0.0.1:${PORT}`;

let t: TestContext | undefined;
afterEach(async () => { await closeTestContext(t); t = undefined; });

async function makeApp(agents: Array<Partial<Agent>> = []) {
  t = await createTestContext({ port: PORT, prefix: 'sua-skills-' });
  for (const a of agents) t.ctx.agentStore.upsertAgent({ name: a.id, status: 'active', source: 'local', mcp: false, nodes: [{ id: 'main', type: 'shell', command: 'echo hi' }], ...a } as Agent, 'import', 'fixture');
  return buildDashboardApp(t.ctx);
}
const get = (app: Parameters<typeof request>[0], p: string) => request(app).get(p).set('Host', HOST).set('Cookie', COOKIE);
const post = (app: Parameters<typeof request>[0], p: string, body: Record<string, unknown>) =>
  request(app).post(p).set('Host', HOST).set('Origin', `http://${HOST}`).set('Cookie', COOKIE).type('form').send(body);
const store = () => SkillStore.fromHandle(t!.ctx.runStore.databaseHandle());

const PASTED = `---
name: choose-vendors
description: "Evaluate software for a job, with evidence."
---

## Objective
Select a defensible path to an outcome.`;

describe('a pasted skill', () => {
  it('reads SKILL.md frontmatter, or a skill page as copied, into its parts', () => {
    expect(readPastedSkill(PASTED)).toEqual({ name: 'choose-vendors', description: 'Evaluate software for a job, with evidence.', body: '## Objective\nSelect a defensible path to an outcome.' });
    expect(readPastedSkill('Metadata\nname\nchoose-vendors\ndescription\nEvaluate software.\nEvaluate software\nObjective…')).toEqual({ name: 'choose-vendors', description: 'Evaluate software.', body: 'Evaluate software\nObjective…' });
    expect(readPastedSkill('Just rules.')).toEqual({ body: 'Just rules.' });
  });
});

describe('/skills', () => {
  it("lists the shipped skills with what each is, its size and who uses it", async () => {
    const app = await makeApp([{ id: 'builder', skills: ['web-search'] }]);
    const res = await get(app, '/skills');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<h1');
    expect(res.text).toContain('href="/skills/web-search"');
    expect(res.text).toMatch(/SHIPPED[\s\S]*?of 6 KB/);
    expect(res.text).toMatch(/used by 1 agent: <a href="\/agents\/builder">builder<\/a>/);
    expect(res.text).toContain('href="/skills/new"');
  });

  it('a new skill from a pasted SKILL.md: its name and description fill in, and it is saved as v1', async () => {
    const app = await makeApp();
    const res = await post(app, '/skills/new', { name: '', description: '', body: PASTED });
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/^\/skills\/choose-vendors\?flash=/);
    expect(store().get('choose-vendors')).toMatchObject({ version: 1, description: 'Evaluate software for a job, with evidence.' });
    const page = await get(app, '/skills/choose-vendors');
    expect(page.text).toContain('YOURS · v1');
    expect(page.text).toContain('Delete skill');
  });

  it('refuses what no agent could use, and a name that is taken, keeping what was typed', async () => {
    const app = await makeApp();
    const big = await post(app, '/skills/new', { name: 'big', description: 'Too long', body: 'x'.repeat(7000) });
    expect(big.status).toBe(400);
    expect(big.text).toContain('its text is over 6 KB');
    const tpl = await post(app, '/skills/new', { name: 'tpl', description: 'A template', body: 'Use {{inputs.x}}' });
    expect(tpl.text).toContain('{{…}} template');
    const taken = await post(app, '/skills/new', { name: 'web-search', description: 'Mine', body: 'Rules.' });
    expect(taken.status).toBe(400);
    expect(taken.text).toContain('already a skill called web-search');
    expect(taken.text).toContain('Rules.');
  });

  it('editing a shipped skill saves your copy; versions restore; going back drops it', async () => {
    const app = await makeApp();
    const edit = await post(app, '/skills/web-search/edit', { description: 'My search rules', body: 'Search twice.', message: 'shorter' });
    expect(edit.status).toBe(303);
    expect(store().get('web-search')).toMatchObject({ version: 1, body: 'Search twice.' });
    await post(app, '/skills/web-search/edit', { description: 'My search rules', body: 'Search three times.' });
    expect(store().get('web-search')?.version).toBe(2);
    const page = await get(app, '/skills/web-search');
    expect(page.text).toContain('YOUR COPY · v2');
    expect(page.text).toContain('action="/skills/web-search/restore"');
    await post(app, '/skills/web-search/restore', { version: '1' });
    expect(store().get('web-search')).toMatchObject({ version: 3, body: 'Search twice.' });
    await post(app, '/skills/web-search/reset', {});
    expect(store().get('web-search')).toBeUndefined();
    expect((await get(app, '/skills/web-search')).text).toContain('SHIPPED');
  });

  it('adds a skill to an agent and takes it off, each as a new version of the agent', async () => {
    const app = await makeApp([{ id: 'helper' }]);
    await post(app, '/skills/new', { name: 'house-style', description: 'How we write', body: 'Short sentences.' });
    const add = await post(app, '/skills/house-style/agents', { agentId: 'helper' });
    expect(decodeURIComponent(add.headers.location)).toContain('helper uses house-style now');
    expect(t!.ctx.agentStore.getAgent('helper')).toMatchObject({ skills: ['house-style'], version: 2 });
    // Used: it can't be deleted.
    const del = await post(app, '/skills/house-style/delete', {});
    expect(decodeURIComponent(del.headers.location)).toContain('Take it off helper first');
    await post(app, '/skills/house-style/agents/helper/remove', {});
    expect(t!.ctx.agentStore.getAgent('helper')?.skills).toBeUndefined();
    await post(app, '/skills/house-style/delete', {});
    expect(store().get('house-style')).toBeUndefined();
  });

  it("won't put an agent's skills over 16 KB together, by adding or by editing", async () => {
    const app = await makeApp([{ id: 'busy' }]);
    for (const n of ['a-one', 'a-two', 'a-three']) await post(app, '/skills/new', { name: n, description: n, body: 'y'.repeat(5500) });
    await post(app, '/skills/a-one/agents', { agentId: 'busy' });
    await post(app, '/skills/a-two/agents', { agentId: 'busy' });
    const third = await post(app, '/skills/a-three/agents', { agentId: 'busy' });
    expect(decodeURIComponent(third.headers.location)).toContain("busy's skills would be over 16 KB together");
    expect(t!.ctx.agentStore.getAgent('busy')?.skills).toEqual(['a-one', 'a-two']);
    await post(app, '/skills/new', { name: 'small', description: 'small', body: 'z' });
    await post(app, '/skills/small/agents', { agentId: 'busy' });
    const grow = await post(app, '/skills/small/edit', { description: 'small', body: 'z'.repeat(6000) });
    expect(grow.status).toBe(400);
    expect(grow.text).toContain('skills would be over 16 KB together');
  });
});

describe("a skill's text on its page", () => {
  it('joins lines wrapped by hand, and keeps lists, headings and code as they are', async () => {
    const { unwrap } = await import('../views/skills.js');
    expect(unwrap('When a step researches a list,\nuse research-fanout:\n- one\n- two\n\n## Never\none node\n```\na\nb\n```')).toBe('When a step researches a list, use research-fanout:\n- one\n- two\n\n## Never\none node\n```\na\nb\n```');
  });
});
