/**
 * The shared-tool card (lib/tool-refactor.ts): a tool and the agents pointed
 * at it, saved together or not at all.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStore, InboxStore, RunStore, ToolStore, exportAgent, parseAgent, saveUserTool, type InboxActionMeta } from '@some-useful-agents/core';
import { readToolRefactorInputs, applyToolRefactor, TOOL_REFACTOR_APPLY } from '../lib/tool-refactor.js';
import { renderInboxDetailFragment } from '../views/inbox-detail.js';

let dir: string;
let agentStore: AgentStore;
let inboxStore: InboxStore;
let runStore: RunStore;
let toolStore: ToolStore;
type Ctx = ReturnType<typeof import('../context.js').getContext>;

function setup(): Ctx {
  dir = mkdtempSync(join(tmpdir(), 'sua-tool-refactor-'));
  const db = join(dir, 'runs.db');
  agentStore = new AgentStore(db);
  inboxStore = new InboxStore(db);
  runStore = new RunStore(db);
  toolStore = new ToolStore(db);
  for (const id of ['news-a', 'news-b', 'news-c']) agentStore.upsertAgent(parseAgent(agentYaml(id)), 'cli', 'fixture');
  return { agentStore, inboxStore, runStore, toolStore } as never as Ctx;
}

afterEach(() => {
  for (const s of [agentStore, inboxStore, runStore, toolStore]) { try { s.close(); } catch { /* ignore */ } }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const TOOL = `id: stories
name: Stories
description: Top stories from the stories API
inputs:
  count: { type: number, default: 5 }
outputs:
  stories: { type: array }
implementation:
  type: shell
  command: |
    curl -sf "https://api.stories.test/v1/top?limit=$count" | jq -c '{stories: .}'
`;

function agentYaml(id: string): string {
  return [`id: ${id}`, `name: ${id}`, 'status: active', 'source: local', 'schedule: "0 8 * * *"',
    'outputs:', '  stories: { type: array }',
    'nodes:', '  - id: fetch', '    type: shell', '    command: |', `      curl -sf https://api.stories.test/v1/top | jq -c '{stories: .}'`].join('\n');
}

function retooled(id: string, tool = 'stories'): string {
  return [`id: ${id}`, `name: ${id}`, 'source: local',
    'outputs:', '  stories: { type: array }',
    'nodes:', '  - id: fetch', '    type: shell', `    tool: ${tool}`, '    toolInputs:', '      count: 5'].join('\n');
}

function edit(id: string, yaml = retooled(id)) {
  const a = agentStore.getAgent(id)!;
  return { agentId: id, baseVersion: a.version, baseYaml: exportAgent(a), yaml };
}

function inputs(over: Record<string, unknown> = {}): Record<string, string> {
  const base = { TOOL_YAML: TOOL, TOOL_BASE: '', REUSE_TOOL: '', EDITS: [edit('news-a'), edit('news-b'), edit('news-c')], LEFT_OUT: [{ agentId: 'news-d', why: 'its fetch is different' }], ...over };
  return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
}

const apply = (ctx: Ctx, i: Record<string, string>) => {
  const card = readToolRefactorInputs(i);
  if ('error' in card) throw new Error(card.error);
  return applyToolRefactor(ctx, card);
};

describe('the shared-tool card', () => {
  it('adds the tool and points every agent at it, keeping status and schedule', () => {
    const ctx = setup();
    const r = apply(ctx, inputs());
    expect(r.status).toBe('completed');
    expect(r.summary).toMatch(/Added the tool `stories` and changed 3 agents to use it/);
    expect(r.summary).toMatch(/`news-a` v1 → v2/);
    expect(r.summary).toMatch(/Left out: `news-d`/);
    expect(toolStore.getTool('stories')?.yamlText).toBe(TOOL);
    for (const id of ['news-a', 'news-b', 'news-c']) {
      const a = agentStore.getAgent(id)!;
      expect(a.nodes[0].tool).toBe('stories');
      expect(a.status).toBe('active');
      expect(a.schedule).toBe('0 8 * * *');
    }
  });

  it('changes nothing when one agent moved on since it was proposed', () => {
    const ctx = setup();
    const i = inputs();
    const b = agentStore.getAgent('news-b')!;
    agentStore.upsertAgent({ ...b, nodes: [{ ...b.nodes[0], command: 'echo edited meanwhile | cat' }] }, 'dashboard', 'edit');
    const r = apply(ctx, i);
    expect(r.status).toBe('failed');
    expect(r.refusalReason).toMatch(/Nothing was changed[\s\S]*`news-b` changed since/);
    expect(toolStore.getTool('stories')).toBeUndefined();
    expect(agentStore.getAgent('news-a')!.nodes[0].tool).toBeUndefined();
  });

  it('refuses an edit that does not use the tool, uses a tool that does not exist, or changes what the agent gives back', () => {
    const ctx = setup();
    expect(apply(ctx, inputs({ EDITS: [edit('news-a', agentYaml('news-a'))] })).refusalReason).toMatch(/doesn't use `stories`/);
    expect(apply(ctx, inputs({ EDITS: [edit('news-a', retooled('news-a', 'nope'))] })).refusalReason).toMatch(/`nope`, which isn't a tool/);
    const changedOutputs = retooled('news-a').replace('  stories: { type: array }', '  items: { type: array }');
    expect(apply(ctx, inputs({ EDITS: [edit('news-a', changedOutputs)] })).refusalReason).toMatch(/would change what it gives back/);
    expect(toolStore.getTool('stories')).toBeUndefined();
  });

  it('undoes the tool and the agents saved before a save that fails', () => {
    const ctx = setup();
    const i = inputs();
    const realUpsert = agentStore.upsertAgent.bind(agentStore);
    let saves = 0;
    agentStore.upsertAgent = ((a: Parameters<AgentStore['upsertAgent']>[0], by: Parameters<AgentStore['upsertAgent']>[1], msg?: string) => {
      if (/shared tool/.test(msg ?? '') && ++saves === 3) throw new Error('disk full');
      return realUpsert(a, by, msg);
    }) as AgentStore['upsertAgent'];
    const r = apply(ctx, i);
    expect(r.status).toBe('failed');
    expect(r.refusalReason).toMatch(/it was undone[\s\S]*disk full/);
    expect(toolStore.getTool('stories')).toBeUndefined();
    for (const id of ['news-a', 'news-b', 'news-c']) expect(agentStore.getAgent(id)!.nodes[0].tool).toBeUndefined();
  });

  it('reuses a tool you have, and refuses when it changed or a new one appeared meanwhile', () => {
    const ctx = setup();
    saveUserTool(toolStore, TOOL);
    expect(apply(ctx, inputs()).refusalReason).toMatch(/There's a tool `stories` now/);
    const reused = apply(ctx, inputs({ TOOL_YAML: '', REUSE_TOOL: 'stories', EDITS: [edit('news-a')] }));
    expect(reused.status).toBe('completed');
    expect(reused.summary).toMatch(/Changed 1 agent to use your tool `stories`/);
    expect(apply(ctx, inputs({ TOOL_BASE: 'something else', EDITS: [edit('news-b')] })).refusalReason).toMatch(/changed since this was proposed/);
  });

  it('shows the tool, each agent change, what was left out, and the effect', () => {
    const ctx = setup();
    void ctx;
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 'chat', body: 'share a tool' });
    const meta: InboxActionMeta = { kind: 'action', status: 'proposed', agentId: TOOL_REFACTOR_APPLY, effect: 'write', inputs: inputs(), rationale: 'One tool for the three stories fetches.' };
    inboxStore.addResponse(msg.id, 'action', 'share a tool', JSON.stringify(meta));
    const page = String(renderInboxDetailFragment({ message: inboxStore.get(msg.id)!, responses: inboxStore.listResponses(msg.id) } as never));
    expect(page).toContain('adds a tool and changes 3 agents');
    expect(page).toContain('New tool');
    expect(page).toMatch(/Inputs: <span class="mono">count<\/span>/);
    expect(page.match(/act-card__agent-edit/g)).toHaveLength(3);
    expect(page).toMatch(/Left out: <span class="mono">news-d<\/span> \(its fetch is different\)/);
    expect(page).toContain('saved together, or nothing is');
  });
});

describe('reading a tool step\'s result whole', () => {
  it('refuses a step that reads it from the cut-off environment variable', async () => {
    const { readsToolResultCutShort } = await import('../lib/tool-refactor.js');
    const nodes = (cmd: string) => ({ nodes: [
      { id: 'fetch-tool', type: 'shell' as const, tool: 'stories' },
      { id: 'fetch', type: 'shell' as const, command: cmd, dependsOn: ['fetch-tool'] },
    ] });
    expect(readsToolResultCutShort(nodes('python3 -c "import json,os; json.loads(os.environ[\'UPSTREAM_FETCH_TOOL_RESULT\'])"'), 'stories'))
      .toEqual({ step: 'fetch', toolStep: 'fetch-tool', name: 'UPSTREAM_FETCH_TOOL_RESULT' });
    expect(readsToolResultCutShort(nodes('jq .stories "$UPSTREAM_FETCH_TOOL_RESULT_FILE"'), 'stories')).toBeUndefined();
    expect(readsToolResultCutShort(nodes('python3 - <<\'PY\'\nfrom sua_helpers import upstream_json\nd = upstream_json("fetch-tool", {})\nPY'), 'stories')).toBeUndefined();
  });
});
