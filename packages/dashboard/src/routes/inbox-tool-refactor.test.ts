/**
 * sua's tool-refactor (lib/tool-refactor-draft.ts): from a conversation, a
 * shared tool and each agent's change, worked out without changing anything
 * and shown as one tool-refactor-apply card.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStore, InboxStore, RunStore, ToolStore, parseAgent, saveUserTool, type Agent, type InboxActionMeta } from '@some-useful-agents/core';
import { pickRefactorAgents, startToolRefactor, idsFrom, stepsText } from '../lib/tool-refactor-draft.js';
import { readToolRefactorInputs, applyToolRefactor, TOOL_REFACTOR_APPLY } from '../lib/tool-refactor.js';
import { BackgroundTasks } from '../lib/background.js';
import { parseActionMeta } from './inbox-shared.js';
import { parseProposedActions } from './inbox-plan.js';

let dir: string;
let agentStore: AgentStore;
let inboxStore: InboxStore;
let runStore: RunStore;
let toolStore: ToolStore;
type Ctx = ReturnType<typeof import('../context.js').getContext>;

const FETCH = (board: string) => `curl -sf "https://api.boards.test/${board}/jobs" | jq -c '{jobs: [.[] | {title, url}]}'`;

function agentYaml(id: string, board: string, extra = ''): string {
  return [`id: ${id}`, `name: ${id.replace(/-/g, ' ')}`, 'status: draft', 'source: local',
    'outputs:', '  jobs: { type: array }',
    'nodes:', '  - id: fetch', '    type: shell', '    command: |', `      ${FETCH(board)}`, extra].filter(Boolean).join('\n');
}

function setup(): Ctx {
  dir = mkdtempSync(join(tmpdir(), 'sua-tool-refactor-draft-'));
  const db = join(dir, 'runs.db');
  agentStore = new AgentStore(db);
  inboxStore = new InboxStore(db);
  runStore = new RunStore(db);
  toolStore = new ToolStore(db);
  agentStore.upsertAgent(parseAgent(agentYaml('acme-jobs', 'acme')), 'cli', 'fixture');
  agentStore.upsertAgent(parseAgent(agentYaml('globex-jobs', 'globex')), 'cli', 'fixture');
  agentStore.upsertAgent(parseAgent(agentYaml('initech-jobs', 'initech')), 'cli', 'fixture');
  agentStore.upsertAgent(parseAgent(['id: weather', 'name: Weather', 'source: local', 'nodes:', '  - id: w', '    type: shell', '    command: curl -sf https://weather.test/today | jq .temp'].join('\n')), 'cli', 'fixture');
  return { agentStore, inboxStore, runStore, toolStore, background: new BackgroundTasks() } as never as Ctx;
}

afterEach(() => {
  for (const s of [agentStore, inboxStore, runStore, toolStore]) { try { s.close(); } catch { /* ignore */ } }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const TOOL_REPLY = `<tool>
id: board-jobs
name: Board jobs
description: Lists a company's open jobs from the boards API.
inputs:
  company: { type: string, required: true }
outputs:
  jobs: { type: array }
implementation:
  type: shell
  command: |
    curl -sf "https://api.boards.test/\${company}/jobs" | jq -c '{jobs: [.[] | {title, url}]}'
</tool>
<why>One fetch for every company's board.</why>`;

const retooled = (id: string, company: string) => `<yaml>
id: ${id}
name: ${id.replace(/-/g, ' ')}
source: local
outputs:
  jobs: { type: array }
nodes:
  - id: fetch
    type: shell
    tool: board-jobs
    toolInputs:
      company: ${company}
</yaml>
<why>fetch now calls board-jobs.</why>`;

async function workItOut(ctx: Ctx, inputs: Record<string, string>) {
  const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 'chat', body: 'share a tool' });
  const meta: InboxActionMeta = { kind: 'action', status: 'running', agentId: 'tool-refactor', effect: 'read', inputs };
  const r = startToolRefactor(ctx, msg.id, meta);
  await (ctx as unknown as { background: BackgroundTasks }).background.drain(5000);
  const responses = inboxStore.listResponses(msg.id);
  const card = responses.map((x) => parseActionMeta(x)).find((m): m is InboxActionMeta => !!m && m.agentId === TOOL_REFACTOR_APPLY);
  const said = responses.filter((x) => x.role === 'triage').map((x) => x.body).join('\n');
  return { r, card, said };
}

describe('picking the agents', () => {
  it('takes the ids sua named, or matches the ask against your agents', () => {
    const ctx = setup();
    void ctx;
    const all = agentStore.listAgents();
    expect(pickRefactorAgents(all, 'x', ['acme-jobs', 'nope', 'weather']).picked.map((a) => a.id)).toEqual(['acme-jobs', 'weather']);
    expect(pickRefactorAgents(all, 'x', ['nope']).leftOut).toEqual([{ agentId: 'nope', why: "it isn't installed" }]);
    const byWords = pickRefactorAgents(all, 'point my boards.test agents at a shared tool').picked.map((a) => a.id);
    expect(byWords.sort()).toEqual(['acme-jobs', 'globex-jobs', 'initech-jobs']);
    expect(pickRefactorAgents(all, 'share a tool').picked).toEqual([]);
    const many = Array.from({ length: 10 }, (_, i) => ({ ...all[0], id: `a${i}` })) as Agent[];
    const capped = pickRefactorAgents(many, 'x', many.map((a) => a.id));
    expect(capped.picked).toHaveLength(8);
    expect(capped.leftOut[0].why).toMatch(/more than 8/);
    expect(idsFrom('a, b  c,a')).toEqual(['a', 'b', 'c']);
    expect(stepsText([all.find((a) => a.id === 'acme-jobs')!])).toMatch(/agent "acme-jobs".*step "fetch":\ncurl -sf/);
  });
});

describe('working it out from a conversation', () => {
  it('drafts the tool, rewrites each agent, and posts one card that applies', async () => {
    const ctx = setup();
    const seen: Array<Record<string, string>> = [];
    ctx.toolRefactorRun = async (inputs) => { seen.push(inputs); return TOOL_REPLY; };
    ctx.agentRetoolerRun = async (inputs) => {
      const id = /^id: (\S+)/m.exec(inputs.AGENT_YAML)![1];
      return retooled(id, id.split('-')[0]);
    };
    const { r, card } = await workItOut(ctx, { ASK: 'point my job agents at one tool', AGENT_IDS: 'acme-jobs,globex-jobs,initech-jobs' });
    expect(r.status).toBe('completed');
    expect(r.summary).toMatch(/Looking at 3 agents/);
    expect(seen[0].STEPS).toMatch(/acme-jobs[\s\S]*globex-jobs[\s\S]*initech-jobs/);
    expect(card).toBeDefined();
    expect(card!.status).toBe('proposed');
    expect(card!.rationale).toMatch(/A shared tool, `board-jobs`, for 3 agents/);
    const inputs = readToolRefactorInputs(card!.inputs);
    if ('error' in inputs) throw new Error(inputs.error);
    expect(inputs.edits.map((e) => e.agentId)).toEqual(['acme-jobs', 'globex-jobs', 'initech-jobs']);
    // Nothing changed yet; approving saves it all.
    expect(toolStore.getTool('board-jobs')).toBeUndefined();
    const applied = applyToolRefactor(ctx, inputs);
    expect(applied.status).toBe('completed');
    expect(agentStore.getAgent('globex-jobs')!.nodes[0].tool).toBe('board-jobs');
  });

  it('retries a rewrite told what was wrong, and leaves out one that still fails or skips', async () => {
    const ctx = setup();
    ctx.toolRefactorRun = async () => TOOL_REPLY;
    const fixes: Record<string, string[]> = {};
    ctx.agentRetoolerRun = async (inputs) => {
      const id = /^id: (\S+)/m.exec(inputs.AGENT_YAML)![1];
      (fixes[id] ??= []).push(inputs.FIX);
      if (id === 'acme-jobs') return fixes[id].length === 1 ? retooled(id, 'acme').replace('tool: board-jobs', 'tool: nope') : retooled(id, 'acme');
      if (id === 'globex-jobs') return retooled(id, 'globex').replace('  jobs: { type: array }', '  items: { type: array }');
      return '<skip>it lists people, not jobs</skip>';
    };
    const { card } = await workItOut(ctx, { ASK: 'share it', AGENT_IDS: 'acme-jobs globex-jobs initech-jobs' });
    expect(fixes['acme-jobs'][1]).toMatch(/`nope`, which isn't a tool/);
    const inputs = readToolRefactorInputs(card!.inputs);
    if ('error' in inputs) throw new Error(inputs.error);
    expect(inputs.edits.map((e) => e.agentId)).toEqual(['acme-jobs']);
    expect(inputs.leftOut.map((l) => l.agentId).sort()).toEqual(['globex-jobs', 'initech-jobs']);
    expect(inputs.leftOut.find((l) => l.agentId === 'globex-jobs')!.why).toMatch(/what it gives back/);
    expect(inputs.leftOut.find((l) => l.agentId === 'initech-jobs')!.why).toBe('it lists people, not jobs');
  });

  it('reuses a tool of yours, leaving out agents that already use it', async () => {
    const ctx = setup();
    saveUserTool(toolStore, TOOL_REPLY.replace(/^<tool>\n|\n<\/tool>[\s\S]*$/g, ''));
    agentStore.upsertAgent(parseAgent(retooled('initech-jobs', 'initech').replace(/<\/?yaml>|<why>.*<\/why>/g, '').trim()), 'cli', 'already');
    ctx.toolRefactorRun = async () => '<reuse>board-jobs</reuse><why>Your board-jobs already does this.</why>';
    ctx.agentRetoolerRun = async (inputs) => { const id = /^id: (\S+)/m.exec(inputs.AGENT_YAML)![1]; return retooled(id, id.split('-')[0]); };
    const { card } = await workItOut(ctx, { ASK: 'share it', AGENT_IDS: 'acme-jobs,globex-jobs,initech-jobs' });
    const inputs = readToolRefactorInputs(card!.inputs);
    if ('error' in inputs) throw new Error(inputs.error);
    expect(inputs.reuseToolId).toBe('board-jobs');
    expect(inputs.toolYaml).toBe('');
    expect(inputs.leftOut).toEqual([{ agentId: 'initech-jobs', why: 'it already calls board-jobs' }]);
    expect(card!.ctaLabel).toBe('Change them');
  });

  it('says so, and changes nothing, when it can\'t: one agent, no tool, no usable change', async () => {
    const ctx = setup();
    ctx.toolRefactorRun = async () => 'no tool';
    ctx.agentRetoolerRun = async () => '<skip>no</skip>';
    expect((await workItOut(ctx, { ASK: 'share it', AGENT_IDS: 'acme-jobs' })).r.refusalReason).toMatch(/a shared tool is for several agents/);
    const noTool = await workItOut(ctx, { ASK: 'share it', AGENT_IDS: 'acme-jobs,globex-jobs' });
    expect(noTool.card).toBeUndefined();
    expect(noTool.said).toMatch(/couldn't draft a shared tool[\s\S]*Nothing changed/);
    ctx.toolRefactorRun = async () => TOOL_REPLY;
    const none = await workItOut(ctx, { ASK: 'share it', AGENT_IDS: 'acme-jobs,globex-jobs' });
    expect(none.card).toBeUndefined();
    expect(none.said).toMatch(/none of the agents' changes checked out/);
    expect(toolStore.getTool('board-jobs')).toBeUndefined();
  });
});

describe('the plan', () => {
  it('accepts a tool-refactor action with its ask and agent ids', () => {
    const { accepted, rejected } = parseProposedActions([
      { type: 'tool-refactor', rationale: 'share it', inputs: { ASK: 'point my job agents at one tool', AGENT_IDS: ['acme-jobs', 'globex-jobs'] } },
      { type: 'tool-refactor', inputs: {} },
    ], [], []);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ agentId: 'tool-refactor', effect: 'read', inputs: { ASK: 'point my job agents at one tool', AGENT_IDS: 'acme-jobs,globex-jobs' } });
    expect(rejected[0].reason).toMatch(/needs inputs.ASK/);
  });
});
