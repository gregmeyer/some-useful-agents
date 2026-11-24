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
    expect(parseSampleInputs('text: hi\nn: 2')).toEqual({ text: 'hi', n: '2' });
    expect(parseSampleInputs("title: Don't Panic: The Café")).toEqual({ title: "Don't Panic: The Café" });
    expect(parseSampleInputs('items: [1, 2]')).toEqual({ items: [1, 2] });
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

describe('Describe it', () => {
  const GOOD = `Here it is.
<tool>
  id: shout
  name: Shout
  description: Says the text in capitals.
  inputs:
    text: { type: string, required: true }
  outputs:
    loud: { type: string }
  implementation:
    type: shell
    command: |
      python3 -c 'import json,os; print(json.dumps({"loud": os.environ["text"].upper()}))'
</tool>
<samples>
text: hello there
</samples>
<why>Upper-cases text; no network.</why>`;

  async function drafted(app: Parameters<typeof request>[0], description: string) {
    const start = await post(app, '/tools/draft', { description });
    expect(start.body.ok).toBe(true);
    let d = await get(app, `/tools/draft/${start.body.id}`);
    for (let i = 0; i < 100 && d.body.status === 'working'; i++) {
      await new Promise((r) => setTimeout(r, 20));
      d = await get(app, `/tools/draft/${start.body.id}`);
    }
    return d.body as { status: string; tries: number; url?: string; error?: string };
  }

  it('opens on Describe it, with Write it a tab away', async () => {
    const app = await makeApp();
    const res = await get(app, '/tools/new');
    expect(res.text).toContain('Describe the tool you want');
    expect(res.text).not.toContain('data-tool-form');
    const write = await get(app, '/tools/new?tab=write');
    expect(write.text).toContain('data-tool-form');
  });

  it('drafts a tool and opens it in the form, filled in, without running it', async () => {
    const app = await makeApp();
    const seen: Array<Record<string, string>> = [];
    t!.ctx.toolDrafterRun = async (inputs) => { seen.push(inputs); return GOOD; };
    const d = await drafted(app, 'say some text loudly, in capitals');
    expect(d).toMatchObject({ status: 'ready', tries: 1 });
    expect(seen[0].DESCRIPTION).toBe('say some text loudly, in capitals');
    expect(seen[0].TOOLS).toMatch(/- http-get:/);
    const page = await get(app, d.url!);
    expect(page.text).toContain('sua drafted this');
    expect(page.text).toContain('value="shout"');
    expect(page.text).toContain('text: hello there');
    expect(t!.ctx.toolStore!.getTool('shout')).toBeUndefined();
    expect(t!.ctx.runStore.listRuns({ limit: 5 })).toHaveLength(0);
  });

  it('tries again, told what was wrong, then gives up after three', async () => {
    const app = await makeApp();
    const fixes: string[] = [];
    t!.ctx.toolDrafterRun = async (inputs) => {
      fixes.push(inputs.FIX);
      return fixes.length < 2 ? GOOD.replace('os.environ["text"]', '"x"') : GOOD;
    };
    const d = await drafted(app, 'say some text loudly, in capitals');
    expect(d).toMatchObject({ status: 'ready', tries: 2 });
    expect(fixes[1]).toMatch(/never uses: text/);

    t!.ctx.toolDrafterRun = async () => 'no tool here';
    const bad = await drafted(app, 'something it cannot draft at all');
    expect(bad).toMatchObject({ status: 'failed', tries: 3 });
    expect(bad.error).toMatch(/no <tool> block/);
  });

  it('refuses a draft with a key written into it, or an id that exists', async () => {
    const { parseToolDraft } = await import('../lib/tool-drafter.js');
    expect(parseToolDraft(GOOD.replace('import json,os', 'import json,os # sk-abcdefghijklmnopqrstuv'))).toMatchObject({ error: expect.stringMatching(/key written/) });
    const app = await makeApp();
    void app;
    await post(app, '/tools/new', { ...WORD_COUNT, id: 'shout', action: 'save' });
    expect(parseToolDraft(GOOD, t!.ctx.toolStore)).toMatchObject({ error: expect.stringMatching(/already a tool "shout"/) });
    const ok = parseToolDraft(GOOD);
    expect('error' in ok ? ok.error : ok.tool.id).toBe('shout');
  });
});

describe('ideas from your agents', () => {
  const curl = (n: number) => `curl -s "https://api.stories.test/v1/top?limit=${n}" | jq '.items[] | {title: .title}'`;

  it('shows ideas on Describe it, and Make a tool from a step', async () => {
    const app = await makeApp();
    const { agentStore } = t!.ctx;
    agentStore.createAgent({ id: 'top-three', name: 'Top three', status: 'active', source: 'local', mcp: false, nodes: [{ id: 'fetch', type: 'shell', command: curl(3) }] }, 'cli');
    agentStore.createAgent({ id: 'top-ten', name: 'Top ten', status: 'active', source: 'local', mcp: false, nodes: [{ id: 'fetch', type: 'shell', command: curl(10) }] }, 'cli');
    const page = await get(app, '/tools/new');
    expect(page.text).toContain('Ideas from your agents');
    expect(page.text).toContain('Fetch from api.stories.test');
    expect(page.text).toContain('data-use-idea');

    const fromStep = await get(app, '/tools/new?from=top-three/fetch');
    expect(fromStep.text).toMatch(/the &quot;fetch&quot; step of my agent &quot;Top three&quot;|the "fetch" step of my agent "Top three"/);
    expect(fromStep.text).not.toContain('Ideas from your agents');

    const nodes = await get(app, '/agents/top-three/nodes');
    expect(nodes.text).toContain('/tools/new?from=top-three/fetch');
  });

  it('says so when there are none', async () => {
    const app = await makeApp();
    const page = await get(app, '/tools/new');
    expect(page.text).toMatch(/No ideas from your agents yet/);
  });
});

describe('Or start from… an agent, an input, an outcome', () => {
  const IDEAS = `<ideas>[{"label": "Parse a bank CSV", "text": "Take csv (a bank statement's text) and give back date, payee, amount for each row.", "why": "Turns your export into fields."}, {"label": "Parse a bank CSV", "text": "dup", "why": "x"}]</ideas>`;

  async function ideas(app: Parameters<typeof request>[0], body: Record<string, unknown>) {
    const start = await post(app, '/tools/ideas', body);
    if (!start.body.ok) return start.body;
    let d = await get(app, `/tools/ideas/${start.body.id}`);
    for (let i = 0; i < 100 && d.body.status === 'working'; i++) {
      await new Promise((r) => setTimeout(r, 20));
      d = await get(app, `/tools/ideas/${start.body.id}`);
    }
    return { ...d.body, id: start.body.id };
  }

  it('offers the three ways in, with your agents to pick from', async () => {
    const app = await makeApp();
    t!.ctx.agentStore.createAgent({ id: 'news', name: 'News', status: 'active', source: 'local', mcp: false, nodes: [{ id: 'f', type: 'shell', command: 'curl -s https://api.stories.test/v1/top' }] }, 'cli');
    const page = await get(app, '/tools/new');
    expect(page.text).toContain('Or start from');
    expect(page.text).toMatch(/value="agent"[\s\S]*value="input"[\s\S]*value="outcome"/);
    expect(page.text).toContain('<option value="news">News</option>');
    // Use this fills the Describe it box, not the first text box on the panel.
    expect(page.text).toContain("root.querySelector('textarea[name=description]')");
  });

  it('sends each lens its context and shows the ideas as cards', async () => {
    const app = await makeApp();
    t!.ctx.agentStore.createAgent({ id: 'news', name: 'News', description: 'Top stories', status: 'active', source: 'local', mcp: false, nodes: [{ id: 'f', type: 'shell', command: 'curl -s https://api.stories.test/v1/top' }] }, 'cli');
    const seen: Array<Record<string, string>> = [];
    t!.ctx.toolSuggesterRun = async (inputs) => { seen.push(inputs); return IDEAS; };

    const fromAgent = await ideas(app, { lens: 'agent', agent: 'news' });
    expect(fromAgent.status).toBe('ready');
    expect(seen[0]).toMatchObject({ LENS: 'agent' });
    expect(seen[0].CONTEXT).toMatch(/Agent "News": Top stories[\s\S]*- f \(shell\): curl -s https:\/\/api\.stories\.test/);
    expect(seen[0].TOOLS).toMatch(/- http-get:/);
    expect(fromAgent.html).toContain('Parse a bank CSV');
    expect(fromAgent.html.match(/data-use-idea/g)).toHaveLength(1);

    await ideas(app, { lens: 'input', text: 'date,payee,amount\n2026-11-01,Grocer,42.10' });
    expect(seen[1]).toMatchObject({ LENS: 'input', CONTEXT: 'date,payee,amount\n2026-11-01,Grocer,42.10' });
    await ideas(app, { lens: 'outcome', text: 'a weekly summary of what changed in my repos' });
    expect(seen[2]).toMatchObject({ LENS: 'outcome' });

    // The same ask within the hour reuses its ideas.
    const again = await ideas(app, { lens: 'outcome', text: 'a weekly summary of what changed in my repos' });
    expect(again.status).toBe('ready');
    expect(seen).toHaveLength(3);
  });

  it('says what is missing, and when the reply has no usable ideas', async () => {
    const app = await makeApp();
    expect((await ideas(app, { lens: 'agent', agent: 'nope' })).error).toMatch(/Choose one of your agents/);
    expect((await ideas(app, { lens: 'input', text: '' })).error).toMatch(/Paste or describe/);
    t!.ctx.toolSuggesterRun = async () => 'no ideas here';
    const bad = await ideas(app, { lens: 'outcome', text: 'something else entirely' });
    expect(bad.status).toBe('failed');
    expect(bad.error).toMatch(/didn.t come back with ideas/);
  });
});
