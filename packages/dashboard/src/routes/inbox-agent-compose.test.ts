/**
 * Build and wire: a helper built for another agent (agent-builder with
 * FOR_AGENT) is wired in by an analyzer run (proposeWiring), whose YAML
 * becomes ONE agent-compose card: approve turns the helper on and saves the
 * agent that calls it, or puts the helper back if that save fails.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStore, InboxStore, RunStore, parseAgent, type InboxActionMeta } from '@some-useful-agents/core';
import { executeAgentCompose, maybeAutoProposeEditorAction, proposeWiring } from './inbox-engine.js';
import { enrichAgentBuilderInputs } from './inbox-catalog.js';
import { parseActionMeta } from './inbox-shared.js';

let dir: string;
let agentStore: AgentStore;
let inboxStore: InboxStore;
let runStore: RunStore;
type Ctx = ReturnType<typeof import('../context.js').getContext>;

function setup(): Ctx {
  dir = mkdtempSync(join(tmpdir(), 'sua-compose-'));
  const db = join(dir, 'runs.db');
  agentStore = new AgentStore(db);
  inboxStore = new InboxStore(db);
  runStore = new RunStore(db);
  agentStore.upsertAgent(parseAgent(PARENT), 'cli', 'fixture');
  agentStore.upsertAgent({ ...parseAgent(HELPER), status: 'draft' }, 'import', 'built');
  return { agentStore, inboxStore, runStore } as never as Ctx;
}

afterEach(() => {
  for (const s of [agentStore, inboxStore, runStore]) { try { s.close(); } catch { /* ignore */ } }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const PARENT = ['id: peer-research', 'name: Peer research', 'status: active', 'source: local',
  'nodes:', '  - id: search', '    type: llm-prompt', '    prompt: "List five companies like Example Co."'].join('\n');
const HELPER = ['id: firmo-lookup', 'name: Firmo lookup', 'description: Looks up revenue and headcount', 'source: local',
  'inputs:', '  COMPANIES:', '    type: string', '    default: ""',
  'nodes:', '  - id: look', '    type: llm-prompt', '    prompt: "Revenue and headcount for {{inputs.COMPANIES}}"'].join('\n');
const WIRED = `${PARENT}\n  - id: enrich\n    type: agent-invoke\n    dependsOn: [search]\n    agentInvokeConfig:\n      agentId: firmo-lookup\n      inputMapping:\n        COMPANIES: "$upstream.search.result"`;

/** A finished wiring run (an analyzer action for peer-research, wiring firmo-lookup) whose YAML is `yaml`. */
function seedWiringRun(messageId: string, runId: string, yaml: string, helper = 'firmo-lookup'): void {
  const now = new Date().toISOString();
  runStore.createRun({ id: runId, agentName: 'agent-analyzer', status: 'completed', startedAt: now, completedAt: now, triggeredBy: 'dashboard' });
  runStore.createNodeExecution({ runId, nodeId: 'analyze', workflowVersion: 1, status: 'completed', startedAt: now, completedAt: now, result: `<yaml>\n${yaml}\n</yaml>` });
  const meta: InboxActionMeta = { kind: 'action', status: 'completed', agentId: 'agent-analyzer', effect: 'read', runId, inputs: { AGENT_ID: 'peer-research', COMPOSE_HELPER: helper } };
  inboxStore.addResponse(messageId, 'action', 'wire it', JSON.stringify(meta));
}

const cards = (messageId: string) => inboxStore.listResponses(messageId).map((r) => parseActionMeta(r)).filter((m): m is InboxActionMeta => !!m);

describe('build and wire', () => {
  it('a wiring run that calls the helper becomes one agent-compose card; one that does not, a plain fix', () => {
    const ctx = setup();
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 'chat', body: 'add revenue' });
    seedWiringRun(msg.id, 'w-1', WIRED);
    maybeAutoProposeEditorAction(ctx, msg.id, 'w-1');
    const compose = cards(msg.id).find((m) => m.agentId === 'agent-compose')!;
    expect(compose).toMatchObject({ status: 'proposed', effect: 'write', ctaLabel: 'Add it and wire it in' });
    expect(compose.inputs).toMatchObject({ AGENT_ID: 'peer-research', HELPER_ID: 'firmo-lookup', HELPER_ABOUT: 'Looks up revenue and headcount. Takes COMPANIES.' });
    expect(compose.base?.yaml).toContain('id: peer-research');
    expect(cards(msg.id).some((m) => m.agentId === 'agent-editor')).toBe(false);

    const other = inboxStore.add({ priority: 'medium', source: 'manual', title: 'chat', body: 'add revenue' });
    seedWiringRun(other.id, 'w-2', PARENT.replace('five', 'six'));
    maybeAutoProposeEditorAction(ctx, other.id, 'w-2');
    expect(cards(other.id).map((m) => m.agentId)).toEqual(['agent-analyzer', 'agent-editor']);
  });

  it('approving turns the helper on, marked as a helper, and saves the agent that calls it', () => {
    const ctx = setup();
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 'chat', body: 'x' });
    const base = { version: agentStore.getAgent('peer-research')!.version, yaml: PARENT };
    const res = executeAgentCompose(ctx, msg.id, { kind: 'action', status: 'running', agentId: 'agent-compose', effect: 'write', base, inputs: { AGENT_ID: 'peer-research', NEW_YAML: WIRED, HELPER_ID: 'firmo-lookup' } });
    expect(res.status).toBe('completed');
    expect(res.summary).toContain('Turned on `firmo-lookup` as a helper.');
    expect(agentStore.getAgent('firmo-lookup')).toMatchObject({ status: 'active', description: 'Helper for peer-research: Looks up revenue and headcount' });
    const parent = agentStore.getAgent('peer-research')!;
    expect(parent.nodes.find((n) => n.id === 'enrich')?.agentInvokeConfig?.agentId).toBe('firmo-lookup');
    expect(parent.status).toBe('active');
  });

  it('puts the helper back when saving the agent fails (it changed since)', () => {
    const ctx = setup();
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 'chat', body: 'x' });
    const base = { version: agentStore.getAgent('peer-research')!.version, yaml: PARENT };
    agentStore.upsertAgent(parseAgent(PARENT.replace('five', 'seven')), 'cli', 'someone edited it');
    const res = executeAgentCompose(ctx, msg.id, { kind: 'action', status: 'running', agentId: 'agent-compose', effect: 'write', base, inputs: { AGENT_ID: 'peer-research', NEW_YAML: WIRED, HELPER_ID: 'firmo-lookup' } });
    expect(res.status).toBe('failed');
    expect(res.refusalReason).toContain('changed since this fix was proposed');
    expect(res.refusalReason).toContain('`firmo-lookup` is left as it was');
    expect(agentStore.getAgent('firmo-lookup')).toMatchObject({ status: 'draft', description: 'Looks up revenue and headcount' });
    expect(agentStore.getAgent('peer-research')!.nodes.some((n) => n.id === 'enrich')).toBe(false);
  });

  it('proposeWiring asks the analyzer where the agent calls the helper (waiting for approval when autonomy is off)', () => {
    const ctx = setup();
    inboxStore.setAutonomyMode('off');
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 'chat', body: 'x' });
    expect(proposeWiring(ctx, msg.id, 'peer-research', 'firmo-lookup')).toBeTruthy();
    const card = cards(msg.id)[0];
    expect(card).toMatchObject({ agentId: 'agent-analyzer', status: 'proposed', effect: 'read' });
    expect(card.inputs).toMatchObject({ AGENT_ID: 'peer-research', COMPOSE_HELPER: 'firmo-lookup' });
    expect(card.inputs.FOCUS).toContain('Add ONE agent-invoke node in `peer-research` that calls `firmo-lookup`');
    expect(card.inputs.FOCUS).toContain('inputs: COMPANIES');
    expect(proposeWiring(ctx, msg.id, 'not-installed', 'firmo-lookup')).toBeUndefined();
  });

  it('the builder gets a helper brief for FOR_AGENT, not as an input', () => {
    const ctx = setup();
    const out = enrichAgentBuilderInputs(ctx, { GOAL: 'look up revenue', FOR_AGENT: 'peer-research' });
    expect(out.FOR_AGENT).toBeUndefined();
    expect(out.FOCUS).toContain('`peer-research` will call it as one step');
    expect(out.FOCUS).toContain('Start its description with "Helper for peer-research: "');
    expect(out.FOCUS).not.toContain('output widget for the final');
    expect(enrichAgentBuilderInputs(ctx, { GOAL: 'x' }).FOCUS).toContain('output widget for the final');
  });
});
