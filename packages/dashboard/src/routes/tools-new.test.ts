/**
 * New tool / Edit / Remove / Try it on /tools (docs/tools.md "Tools you add").
 */
import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { ToolStore } from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import { SESSION_COOKIE } from '../auth-middleware.js';
import { createTestContext, closeTestContext, type TestContext } from '../test-harness.js';
import { toolFormFromBody, toolFormToYaml, toolFormFromYaml, parseSampleInputs } from '../lib/tool-form.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3994;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;
const HOST = `127.0.0.1:${PORT}`;

let t: TestContext | undefined;

async function makeApp() {
  t = await createTestContext({ port: PORT, prefix: 'sua-tools-new-', extra: ({ dbPath }) => ({ toolStore: new ToolStore(dbPath) }) });
  return buildDashboardApp(t.ctx);
}

afterEach(async () => {
  await closeTestContext(t);
  t = undefined;
});

const get = (app: Parameters<typeof request>[0], p: string) => request(app).get(p).set('Host', HOST).set('Cookie', COOKIE);
const post = (app: Parameters<typeof request>[0], p: string, body: Record<string, unknown>) =>
  request(app).post(p).set('Host', HOST).set('Origin', `http://${HOST}`).set('Cookie', COOKIE).type('form').send(body);

const WORD_COUNT = {
  view: 'fields',
  id: 'word-count',
  name: 'Word count',
  description: 'Counts the words in some text',
  kind: 'command',
  body: `n=$(printf '%s' "$text" | wc -w | tr -d ' ')\necho "{\\"count\\": $n}"`,
  in_name: 'text', in_type: 'string', in_required: 'yes', in_default: '', in_description: 'The text',
  out_name: 'count', out_type: 'number', out_description: '',
  sample: 'text: one two three',
};

describe('the form and its YAML', () => {
  it('turns fields into the tool YAML and back', () => {
    const v = toolFormFromBody({ ...WORD_COUNT, in_name: ['text', 'max'], in_type: ['string', 'number'], in_required: ['yes', 'no'], in_default: ['', '5'], in_description: ['', ''] });
    const yaml = toolFormToYaml(v);
    expect(yaml).toMatch(/type: shell/);
    expect(yaml).toMatch(/default: 5/);
    const back = toolFormFromYaml(yaml);
    expect('error' in back).toBe(false);
    expect(back).toMatchObject({ id: 'word-count', kind: 'command', inputs: [{ name: 'text', required: true }, { name: 'max', type: 'number', default: '5' }] });
  });

  it('drops empty rows and reads sample inputs', () => {
    expect(toolFormFromBody({ ...WORD_COUNT, in_name: ['text', ''], in_type: ['string', 'string'], in_required: ['yes', 'no'], in_default: ['', ''], in_description: ['', ''] }).inputs).toHaveLength(1);
    expect(parseSampleInputs('text: hi\nn: 2')).toEqual({ text: 'hi', n: 2 });
    expect('error' in parseSampleInputs('- a')).toBe(true);
  });
});

describe('New tool', () => {
  it('shows the form and is linked from /tools', async () => {
    const app = await makeApp();
    const list = await get(app, '/tools');
    expect(list.text).toContain('href="/tools/new"');
    expect(list.text).toContain('Your tools');
    const res = await get(app, '/tools/new');
    expect(res.status).toBe(200);
    expect(res.text).toContain('New tool');
    expect(res.text).toContain('Try it');
    expect(res.text).not.toMatch(/implementation|builtin|DAG/i);
  });

  it('saves a tool and shows it with Edit, Remove and its YAML', async () => {
    const app = await makeApp();
    const res = await post(app, '/tools/new', { ...WORD_COUNT, action: 'save' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/^\/tools\/word-count\?flash=/);
    expect(t!.ctx.toolStore!.getTool('word-count')?.implementation.command).toContain('wc -w');
    const page = await get(app, res.headers.location);
    expect(page.text).toContain('href="/tools/word-count/edit"');
    expect(page.text).toContain('/tools/word-count/remove');
    expect(page.text).toContain('As YAML');
  });

  it('shows what stops it saving, and keeps what you wrote', async () => {
    const app = await makeApp();
    const res = await post(app, '/tools/new', { ...WORD_COUNT, in_name: 'PATH', action: 'save' });
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/can&#39;t be an input name|can't be an input name/);
    expect(res.text).toContain('value="word-count"');
    expect(t!.ctx.toolStore!.getTool('word-count')).toBeUndefined();
  });

  it('refuses an id that is taken', async () => {
    const app = await makeApp();
    await post(app, '/tools/new', { ...WORD_COUNT, action: 'save' });
    const res = await post(app, '/tools/new', { ...WORD_COUNT, action: 'save' });
    expect(res.text).toMatch(/already a tool/);
    const builtin = await post(app, '/tools/new', { ...WORD_COUNT, id: 'http-get', action: 'save' });
    expect(builtin.text).toMatch(/built-in/);
  });

  it('asks before saving a tool worth a second look', async () => {
    const app = await makeApp();
    const risky = { ...WORD_COUNT, body: 'echo $text' };
    const first = await post(app, '/tools/new', { ...risky, action: 'save' });
    expect(first.status).toBe(200);
    expect(first.text).toContain('Save anyway');
    expect(t!.ctx.toolStore!.getTool('word-count')).toBeUndefined();
    const second = await post(app, '/tools/new', { ...risky, action: 'save_anyway' });
    expect(second.status).toBe(303);
    expect(t!.ctx.toolStore!.getTool('word-count')).toBeDefined();
  });

  it('switches to YAML and back without losing anything', async () => {
    const app = await makeApp();
    const asYaml = await post(app, '/tools/new', { ...WORD_COUNT, action: 'to_yaml' });
    expect(asYaml.text).toContain('name="yaml"');
    expect(asYaml.text).toMatch(/id: word-count/);
    const yaml = toolFormToYaml(toolFormFromBody(WORD_COUNT));
    const saved = await post(app, '/tools/new', { view: 'yaml', yaml, action: 'save' });
    expect(saved.status).toBe(303);
    expect(t!.ctx.toolStore!.getTool('word-count')?.yamlText).toBe(yaml);
  });
});

describe('Edit and Remove', () => {
  it('edits a tool in place; its id stays', async () => {
    const app = await makeApp();
    await post(app, '/tools/new', { ...WORD_COUNT, action: 'save' });
    const form = await get(app, '/tools/word-count/edit');
    expect(form.text).toContain('readonly');
    const res = await post(app, '/tools/word-count/edit', { ...WORD_COUNT, description: 'Counts words', action: 'save' });
    expect(res.status).toBe(303);
    expect(t!.ctx.toolStore!.getTool('word-count')?.description).toBe('Counts words');
    const renamed = await post(app, '/tools/word-count/edit', { ...WORD_COUNT, id: 'other', action: 'save' });
    expect(renamed.text).toMatch(/id can(&#39;|')t change/);
  });

  it('removes a tool you added but not a built-in', async () => {
    const app = await makeApp();
    await post(app, '/tools/new', { ...WORD_COUNT, action: 'save' });
    const res = await post(app, '/tools/word-count/remove', {});
    expect(res.status).toBe(303);
    expect(t!.ctx.toolStore!.getTool('word-count')).toBeUndefined();
    const builtin = await post(app, '/tools/http-get/remove', {});
    expect(builtin.headers.location).toMatch(/error=/);
  });
});

describe('Try it', () => {
  it('runs the unsaved tool once and reports its output fields', async () => {
    const app = await makeApp();
    const start = await post(app, '/tools/try', WORD_COUNT);
    expect(start.body.ok).toBe(true);
    let r = await get(app, `/tools/try/${start.body.runId}`);
    for (let i = 0; i < 100 && !r.body.done; i++) {
      await new Promise((res) => setTimeout(res, 50));
      r = await get(app, `/tools/try/${start.body.runId}`);
    }
    expect(r.body).toMatchObject({ done: true, status: 'completed', outputs: { count: 3 } });
    expect(t!.ctx.toolStore!.getTool('word-count')).toBeUndefined();
  });

  it('says what stops it running', async () => {
    const app = await makeApp();
    const missing = await post(app, '/tools/try', { ...WORD_COUNT, in_name: 'PATH' });
    expect(missing.body.ok).toBe(false);
    expect(missing.body.errors.join()).toMatch(/input name/);
  });
});
