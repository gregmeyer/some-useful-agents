import { Router, type Request, type Response } from 'express';
import type { Agent, AgentDefinition, RunStatus } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { renderAgentsList, type HomeStats } from '../views/agents-list.js';
import { renderAgentDetail } from '../views/agent-detail.js';
import { renderAgentDetailV2 } from '../views/agent-detail-v2.js';
import { renderAgentNew, type AgentNewFormValues } from '../views/agent-new.js';
import { renderAgentAddNode, type AddNodeFormValues } from '../views/agent-add-node.js';
import { renderAgentEditNode, type EditNodeFormValues } from '../views/agent-edit-node.js';
import { deriveBack } from '../views/page-header.js';

export const agentsRouter: Router = Router();

const AGENT_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * GET  /agents/new — show the create-agent form.
 * POST /agents/new — create a single-node v2 DAG agent via AgentStore.
 *
 * The dashboard was missing any in-UI create path until this route; every
 * "make a new agent" instruction dead-ended at `sua agent new` in the
 * terminal. This brings the create flow into the dashboard for the most
 * common case (single-node agent); multi-node DAGs still need the CLI
 * or the tutorial's scaffold-demo-dag button until the drag-drop editor
 * lands in PR 3.
 *
 * Registered BEFORE `/agents/:name` so Express matches this exact path
 * first instead of treating "new" as an agent id.
 */
agentsRouter.get('/agents/new', (_req: Request, res: Response) => {
  res.type('html').send(renderAgentNew({}));
});

agentsRouter.post('/agents/new', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as Record<string, unknown>;

  const values: AgentNewFormValues = {
    id: typeof body.id === 'string' ? body.id.trim() : undefined,
    name: typeof body.name === 'string' ? body.name.trim() : undefined,
    description: typeof body.description === 'string' ? body.description.trim() : undefined,
    type: body.type === 'claude-code' ? 'claude-code' : 'shell',
    command: typeof body.command === 'string' ? body.command : undefined,
    prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
  };

  // Validate in order of what the user typed top-to-bottom so the error
  // points at the first thing wrong rather than a buried field.
  if (!values.id || !AGENT_ID_RE.test(values.id)) {
    res.status(400).type('html').send(renderAgentNew({
      values,
      error: 'Id must be lowercase letters, digits, or hyphens, starting with a letter or digit.',
    }));
    return;
  }
  if (!values.name) {
    res.status(400).type('html').send(renderAgentNew({
      values,
      error: 'Name is required.',
    }));
    return;
  }
  if (ctx.agentStore.getAgent(values.id)) {
    res.status(400).type('html').send(renderAgentNew({
      values,
      error: `An agent with id "${values.id}" already exists.`,
    }));
    return;
  }
  if (values.type === 'shell' && (!values.command || values.command.trim() === '')) {
    res.status(400).type('html').send(renderAgentNew({
      values,
      error: 'Shell agents need a command.',
    }));
    return;
  }
  if (values.type === 'claude-code' && (!values.prompt || values.prompt.trim() === '')) {
    res.status(400).type('html').send(renderAgentNew({
      values,
      error: 'Claude-Code agents need a prompt.',
    }));
    return;
  }

  try {
    ctx.agentStore.createAgent(
      {
        id: values.id,
        name: values.name,
        description: values.description || undefined,
        status: 'active',
        source: 'local',
        mcp: false,
        nodes: [
          values.type === 'shell'
            ? { id: 'main', type: 'shell', command: values.command! }
            : { id: 'main', type: 'claude-code', prompt: values.prompt! },
        ],
      },
      'dashboard',
      'Created via /agents/new',
    );
    // Land on the add-node form with a flag — gives the user the option
    // to chain another node downstream right away, or click "Done" to
    // jump straight to the agent detail. Replaces the v0.15-PR1.6 flow
    // that redirected to /agents/:id alone.
    res.redirect(303, `/agents/${encodeURIComponent(values.id)}/add-node?fromCreate=1`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).type('html').send(renderAgentNew({
      values,
      error: `Create failed: ${msg}`,
    }));
  }
});

/**
 * GET  /agents/:name/add-node — form to append a node to an existing
 *                               v2 agent. v1 agents are not editable;
 *                               redirects to the v1 detail page.
 * POST /agents/:name/add-node — append the node, bump to a new agent
 *                               version via upsertAgent, redirect back
 *                               to this same form so the user can chain
 *                               another node if they want.
 *
 * Registered alongside the rest of the agent routes so Express resolves
 * paths consistently.
 */
const NODE_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

agentsRouter.get('/agents/:name/add-node', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const agent = ctx.agentStore.getAgent(name);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }
  const fromCreate = req.query.fromCreate === '1';
  const flashParam = typeof req.query.flash === 'string' ? req.query.flash : undefined;
  res.type('html').send(renderAgentAddNode({ agent, fromCreate, flash: flashParam, toolStore: ctx.toolStore }));
});

agentsRouter.post('/agents/:name/add-node', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const agent = ctx.agentStore.getAgent(name);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawDeps = body.dependsOn;
  const dependsOn: string[] = Array.isArray(rawDeps)
    ? rawDeps.filter((d): d is string => typeof d === 'string')
    : typeof rawDeps === 'string' ? [rawDeps] : [];

  const values: AddNodeFormValues = {
    id: typeof body.id === 'string' ? body.id.trim() : undefined,
    type: body.type === 'claude-code' ? 'claude-code' : 'shell',
    command: typeof body.command === 'string' ? body.command : undefined,
    prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
    dependsOn,
  };

  // Validate.
  if (!values.id || !NODE_ID_RE.test(values.id)) {
    res.status(400).type('html').send(renderAgentAddNode({
      agent, values, error: 'Node id must be lowercase letters, digits, hyphens, or underscores.',
    }));
    return;
  }
  if (agent.nodes.some((n) => n.id === values.id)) {
    res.status(400).type('html').send(renderAgentAddNode({
      agent, values, error: `A node with id "${values.id}" already exists in this agent.`,
    }));
    return;
  }
  // Every declared dependency must be a real node in this agent.
  const existingIds = new Set(agent.nodes.map((n) => n.id));
  const badDep = dependsOn.find((d) => !existingIds.has(d));
  if (badDep) {
    res.status(400).type('html').send(renderAgentAddNode({
      agent, values, error: `Unknown upstream node: "${badDep}".`,
    }));
    return;
  }
  if (values.type === 'shell' && (!values.command || values.command.trim() === '')) {
    res.status(400).type('html').send(renderAgentAddNode({
      agent, values, error: 'Shell nodes need a command.',
    }));
    return;
  }
  if (values.type === 'claude-code' && (!values.prompt || values.prompt.trim() === '')) {
    res.status(400).type('html').send(renderAgentAddNode({
      agent, values, error: 'Claude-Code nodes need a prompt.',
    }));
    return;
  }

  const newNode = values.type === 'shell'
    ? { id: values.id, type: 'shell' as const, command: values.command!, ...(dependsOn.length > 0 ? { dependsOn } : {}) }
    : { id: values.id, type: 'claude-code' as const, prompt: values.prompt!, ...(dependsOn.length > 0 ? { dependsOn } : {}) };

  try {
    ctx.agentStore.upsertAgent(
      {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        status: agent.status,
        schedule: agent.schedule,
        source: agent.source,
        mcp: agent.mcp,
        nodes: [...agent.nodes, newNode],
      },
      'dashboard',
      `Added node "${values.id}" via dashboard`,
    );
    res.redirect(303, `/agents/${encodeURIComponent(agent.id)}/add-node?flash=${encodeURIComponent(`Added "${values.id}". Add another or click Done.`)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).type('html').send(renderAgentAddNode({
      agent, values, error: `Save failed: ${msg}`,
    }));
  }
});

/**
 * GET  /agents/:name/nodes/:nodeId/edit    — form pre-filled with node's state
 * POST /agents/:name/nodes/:nodeId/edit    — validate + write new agent version
 * POST /agents/:name/nodes/:nodeId/delete  — remove the node (rejects if any
 *                                             other node depends on it; users
 *                                             delete downstream first)
 *
 * Node ids are immutable across edits — renaming would break every
 * downstream `{{upstream.<id>.result}}` / `$UPSTREAM_<ID>_RESULT`
 * reference. Users who want a different id delete + recreate.
 */
agentsRouter.get('/agents/:name/nodes/:nodeId/edit', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const nodeId = Array.isArray(req.params.nodeId) ? req.params.nodeId[0] : req.params.nodeId;
  const agent = ctx.agentStore.getAgent(name);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }
  const node = agent.nodes.find((n) => n.id === nodeId);
  if (!node) {
    res.status(404).redirect(303, `/agents/${encodeURIComponent(agent.id)}?flash=${encodeURIComponent(`Node "${nodeId}" not found.`)}`);
    return;
  }
  res.type('html').send(renderAgentEditNode({ agent, node, toolStore: ctx.toolStore }));
});

agentsRouter.post('/agents/:name/nodes/:nodeId/edit', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const nodeId = Array.isArray(req.params.nodeId) ? req.params.nodeId[0] : req.params.nodeId;
  const agent = ctx.agentStore.getAgent(name);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }
  const node = agent.nodes.find((n) => n.id === nodeId);
  if (!node) {
    res.status(404).redirect(303, `/agents/${encodeURIComponent(agent.id)}`);
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawDeps = body.dependsOn;
  const dependsOn: string[] = Array.isArray(rawDeps)
    ? rawDeps.filter((d): d is string => typeof d === 'string')
    : typeof rawDeps === 'string' ? [rawDeps] : [];

  const values: EditNodeFormValues = {
    type: body.type === 'claude-code' ? 'claude-code' : 'shell',
    command: typeof body.command === 'string' ? body.command : undefined,
    prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
    dependsOn,
  };

  // Every declared dependency must be a node that's not the current
  // node itself, not a downstream (cycle), and exists.
  const existingIds = new Set(agent.nodes.map((n) => n.id));
  if (dependsOn.includes(nodeId)) {
    res.status(400).type('html').send(renderAgentEditNode({
      agent, node, values, error: 'A node cannot depend on itself.',
    }));
    return;
  }
  const badDep = dependsOn.find((d) => !existingIds.has(d));
  if (badDep) {
    res.status(400).type('html').send(renderAgentEditNode({
      agent, node, values, error: `Unknown upstream node: "${badDep}".`,
    }));
    return;
  }
  // Cycle guard: the view already filters downstreams from the picker,
  // but a hand-crafted POST could bypass it. Re-check.
  if (hasCycleAfterEdit(agent, nodeId, dependsOn)) {
    res.status(400).type('html').send(renderAgentEditNode({
      agent, node, values, error: 'Those dependencies would create a cycle in the DAG.',
    }));
    return;
  }
  if (values.type === 'shell' && (!values.command || values.command.trim() === '')) {
    res.status(400).type('html').send(renderAgentEditNode({
      agent, node, values, error: 'Shell nodes need a command.',
    }));
    return;
  }
  if (values.type === 'claude-code' && (!values.prompt || values.prompt.trim() === '')) {
    res.status(400).type('html').send(renderAgentEditNode({
      agent, node, values, error: 'Claude-Code nodes need a prompt.',
    }));
    return;
  }

  // Build the updated node. Preserve any fields we don't let the form
  // edit (inputs, secrets, env, envAllowlist, allowedTools, model,
  // maxTurns, timeout, redactSecrets, position) — those come back in
  // a follow-up when the inspector can render them.
  const updatedNode = values.type === 'shell'
    ? { ...node, type: 'shell' as const, command: values.command!, prompt: undefined, ...(dependsOn.length > 0 ? { dependsOn } : { dependsOn: undefined }) }
    : { ...node, type: 'claude-code' as const, prompt: values.prompt!, command: undefined, ...(dependsOn.length > 0 ? { dependsOn } : { dependsOn: undefined }) };

  const updatedNodes = agent.nodes.map((n) => n.id === nodeId ? updatedNode : n);

  try {
    ctx.agentStore.createNewVersion(
      agent.id,
      {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        status: agent.status,
        schedule: agent.schedule,
        source: agent.source,
        mcp: agent.mcp,
        nodes: updatedNodes,
        inputs: agent.inputs,
        author: agent.author,
        tags: agent.tags,
      },
      'dashboard',
      `Edited node "${nodeId}"`,
    );
    res.redirect(303, `/agents/${encodeURIComponent(agent.id)}?flash=${encodeURIComponent(`Updated "${nodeId}". New version created.`)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).type('html').send(renderAgentEditNode({
      agent, node, values, error: `Save failed: ${msg}`,
    }));
  }
});

agentsRouter.post('/agents/:name/nodes/:nodeId/delete', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const nodeId = Array.isArray(req.params.nodeId) ? req.params.nodeId[0] : req.params.nodeId;
  const agent = ctx.agentStore.getAgent(name);
  if (!agent) {
    res.status(404).redirect(303, '/agents');
    return;
  }
  if (!agent.nodes.some((n) => n.id === nodeId)) {
    res.status(404).redirect(303, `/agents/${encodeURIComponent(agent.id)}`);
    return;
  }

  // Refuse if anyone depends on this node. Explicit is better than
  // auto-trimming dependsOn — user may be surprised to discover their
  // downstream node silently lost an input.
  const dependents = agent.nodes.filter((n) => n.dependsOn?.includes(nodeId));
  if (dependents.length > 0) {
    const names = dependents.map((n) => `"${n.id}"`).join(', ');
    const msg = `Cannot delete "${nodeId}" \u2014 ${names} depend${dependents.length === 1 ? 's' : ''} on it. Delete or edit ${dependents.length === 1 ? 'it' : 'them'} first.`;
    res.redirect(303, `/agents/${encodeURIComponent(agent.id)}?flash=${encodeURIComponent(msg)}`);
    return;
  }

  if (agent.nodes.length === 1) {
    res.redirect(303, `/agents/${encodeURIComponent(agent.id)}?flash=${encodeURIComponent('Cannot delete the last node. Delete the agent itself from the CLI if you want to remove it entirely.')}`);
    return;
  }

  const updatedNodes = agent.nodes.filter((n) => n.id !== nodeId);
  try {
    ctx.agentStore.createNewVersion(
      agent.id,
      {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        status: agent.status,
        schedule: agent.schedule,
        source: agent.source,
        mcp: agent.mcp,
        nodes: updatedNodes,
        inputs: agent.inputs,
        author: agent.author,
        tags: agent.tags,
      },
      'dashboard',
      `Deleted node "${nodeId}"`,
    );
    res.redirect(303, `/agents/${encodeURIComponent(agent.id)}?flash=${encodeURIComponent(`Deleted "${nodeId}". New version created.`)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.redirect(303, `/agents/${encodeURIComponent(agent.id)}?flash=${encodeURIComponent(`Delete failed: ${msg}`)}`);
  }
});

/**
 * Cycle guard used by the edit route. Simulates the edit and walks the
 * DAG from each root — if we revisit a node, the graph has a cycle.
 */
function hasCycleAfterEdit(agent: Agent, editedNodeId: string, newDependsOn: string[]): boolean {
  const depsByNode = new Map<string, string[]>();
  for (const n of agent.nodes) {
    depsByNode.set(n.id, n.id === editedNodeId ? newDependsOn : (n.dependsOn ?? []));
  }
  const white = new Set(depsByNode.keys());
  const gray = new Set<string>();
  const black = new Set<string>();
  function visit(id: string): boolean {
    if (black.has(id)) return false;
    if (gray.has(id)) return true;
    gray.add(id);
    white.delete(id);
    for (const d of depsByNode.get(id) ?? []) {
      if (visit(d)) return true;
    }
    gray.delete(id);
    black.add(id);
    return false;
  }
  for (const id of [...white]) {
    if (visit(id)) return true;
  }
  return false;
}

agentsRouter.get('/agents', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const v1Agents = ctx.loadAgents().agents;
  const v2Agents = ctx.agentStore.listAgents();

  // Unify for the list view. v2 agents take precedence when ids collide
  // (expected post-migration: the user imported their YAML into the DB).
  const mergedV1: AgentDefinition[] = [];
  const v2Ids = new Set(v2Agents.map((a) => a.id));
  for (const [id, a] of v1Agents) {
    if (!v2Ids.has(id)) mergedV1.push(a);
  }
  mergedV1.sort((a, b) => a.name.localeCompare(b.name));
  v2Agents.sort((a, b) => a.id.localeCompare(b.id));

  // Stats for the overview strip. One queryRuns per dimension keeps the
  // SQL simple and the numbers honest — this page loads once per view.
  const total = ctx.runStore.queryRuns({ limit: 1, offset: 0, statuses: [] as RunStatus[] });
  const inFlight = ctx.runStore.queryRuns({
    limit: 1,
    offset: 0,
    statuses: ['running', 'pending'] as RunStatus[],
  });
  // Recent runs for per-agent "last run" lookups. 100 covers realistic
  // per-user fleets; the list view only reads the first hit per agent.
  const recent = ctx.runStore.queryRuns({
    limit: 100,
    offset: 0,
    statuses: [] as RunStatus[],
  });

  const stats: HomeStats = {
    agents: v2Agents.length + mergedV1.length,
    activeAgents: v2Agents.filter((a) => a.status === 'active').length + mergedV1.length,
    totalRuns: total.total,
    runningRuns: inFlight.total,
    latestRunAt: recent.rows[0]?.startedAt,
  };

  res.type('html').send(renderAgentsList({
    v1: mergedV1,
    v2: v2Agents,
    recentRuns: recent.rows,
    stats,
  }));
});

agentsRouter.get('/agents/:name', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;

  // Prefer v2: if this id is in the AgentStore, render the DAG view.
  const v2Agent = ctx.agentStore.getAgent(name);
  if (v2Agent) {
    const { rows } = ctx.runStore.queryRuns({
      agentName: v2Agent.id,
      limit: 20,
      offset: 0,
      statuses: [] as RunStatus[],
    });
    const flashParam = typeof req.query.flash === 'string' ? req.query.flash : undefined;
    const fromParam = typeof req.query.from === 'string' ? req.query.from : undefined;
    // Messages passed via ?flash= from scaffold redirects are informational;
    // anything surfaced by a failed mutation route sends ?error= instead.
    const flash = flashParam ? { kind: 'ok' as const, message: flashParam } : undefined;
    const referer = typeof req.headers.referer === 'string' ? req.headers.referer : undefined;
    const back = deriveBack(referer, `127.0.0.1:${ctx.port}`, fromParam);
    const html = await renderAgentDetailV2({
      agent: v2Agent,
      recentRuns: rows,
      secretsStore: ctx.secretsStore,
      flash,
      back,
      from: fromParam,
    });
    res.type('html').send(html);
    return;
  }

  // Fall back to v1 YAML-loaded agents.
  const { agents } = ctx.loadAgents();
  const agent = agents.get(name);
  if (!agent) {
    const v2 = ctx.agentStore.listAgents().sort((a, b) => a.id.localeCompare(b.id));
    const v1 = Array.from(agents.values()).sort((a, b) => a.name.localeCompare(b.name));
    const total404 = ctx.runStore.queryRuns({ limit: 1, offset: 0, statuses: [] as RunStatus[] });
    const inFlight404 = ctx.runStore.queryRuns({
      limit: 1, offset: 0, statuses: ['running', 'pending'] as RunStatus[],
    });
    const recent404 = ctx.runStore.queryRuns({ limit: 100, offset: 0, statuses: [] as RunStatus[] });
    const stats: HomeStats = {
      agents: v2.length + v1.length,
      activeAgents: v2.filter((a) => a.status === 'active').length + v1.length,
      totalRuns: total404.total,
      runningRuns: inFlight404.total,
      latestRunAt: recent404.rows[0]?.startedAt,
    };
    res.status(404).type('html').send(renderAgentsList({ v1, v2, recentRuns: recent404.rows, stats }));
    return;
  }

  const { rows } = ctx.runStore.queryRuns({
    agentName: agent.name,
    limit: 20,
    offset: 0,
    statuses: [] as RunStatus[],
  });

  const flashParam = typeof req.query.flash === 'string' ? req.query.flash : undefined;
  const flash = flashParam ? { kind: 'error' as const, message: flashParam } : undefined;

  const html = await renderAgentDetail({
    agent,
    recentRuns: rows,
    secretsStore: ctx.secretsStore,
    flash,
  });
  res.type('html').send(html);
});

// Export for tests
export type { Agent, AgentDefinition };
