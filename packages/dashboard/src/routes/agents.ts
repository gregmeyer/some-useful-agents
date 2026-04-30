import { Router, type Request, type Response } from 'express';
import type { Agent, AgentDefinition, Run, RunStatus } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { renderAgentsList, type HomeStats } from '../views/agents-list.js';
import { renderAgentDetail } from '../views/agent-detail.js';
import { renderAgentDetailV2, renderAgentOverview, renderAgentNodes, renderAgentConfig, renderAgentRuns } from '../views/agent-detail-v2.js';
import { renderAgentNew, type AgentNewFormValues } from '../views/agent-new.js';
import { deriveBack } from '../views/page-header.js';

export const agentsRouter: Router = Router();

const AGENT_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

// ── Create agent ────────────────────────────────────────────────────────

/**
 * GET  /agents/new — show the create-agent form.
 * POST /agents/new — create a single-node v2 DAG agent via AgentStore.
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
    res.redirect(303, `/agents/${encodeURIComponent(values.id)}/add-node?fromCreate=1`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).type('html').send(renderAgentNew({
      values,
      error: `Create failed: ${msg}`,
    }));
  }
});

// ── Star/unstar toggle ──────────────────────────────────────────────────

// ── Hard delete ────────────────────────────────────────────────────────
//
// POST /agents/:name/delete with body { confirm: <agent-id> }.
//
// The form requires the user to type the agent id to enable the delete
// button, so a stray click can't fire. Runs are intentionally NOT
// cascade-deleted — they reference agentName as a string (no FK), so
// they survive as orphaned history. A future utility can sweep orphans
// independently.
agentsRouter.post('/agents/:name/delete', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const agent = ctx.agentStore.getAgent(name);
  if (!agent) {
    res.redirect(303, `/agents?flash=${encodeURIComponent(`Agent "${name}" not found.`)}`);
    return;
  }
  // Belt-and-suspenders: even if a client bypasses the form, require
  // the confirm token to match the agent id before we delete.
  const body = req.body as Record<string, unknown> | undefined;
  const confirm = typeof body?.confirm === 'string' ? body.confirm : '';
  if (confirm !== agent.id) {
    res.redirect(
      303,
      `/agents/${encodeURIComponent(agent.id)}?flash=${encodeURIComponent('Confirmation mismatch — delete cancelled.')}`,
    );
    return;
  }

  try {
    ctx.agentStore.deleteAgent(agent.id);
  } catch (err) {
    // Most likely: another agent invokes this one.
    res.redirect(
      303,
      `/agents/${encodeURIComponent(agent.id)}?flash=${encodeURIComponent((err as Error).message)}`,
    );
    return;
  }

  res.redirect(303, `/agents?flash=${encodeURIComponent(`Deleted "${agent.id}".`)}`);
});

agentsRouter.post('/agents/:name/star', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const agent = ctx.agentStore.getAgent(name);
  if (!agent) {
    res.redirect(303, '/agents');
    return;
  }
  ctx.agentStore.updateAgentMeta(agent.id, { starred: !agent.starred });
  // Redirect back to wherever the user came from.
  const referer = typeof req.headers.referer === 'string' ? req.headers.referer : undefined;
  res.redirect(303, referer ?? `/agents/${encodeURIComponent(agent.id)}`);
});

// ── List agents ─────────────────────────────────────────────────────────

agentsRouter.get('/agents', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const v1Agents = ctx.loadAgents().agents;

  // Parse filter/sort query params.
  const qStatus = typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
  const qTabRaw = typeof req.query.tab === 'string' ? req.query.tab : 'user';
  const qTab: 'user' | 'examples' | 'community' =
    qTabRaw === 'examples' || qTabRaw === 'community' ? qTabRaw : 'user';
  const tabToSource: Record<typeof qTab, 'local' | 'examples' | 'community'> = {
    user: 'local', examples: 'examples', community: 'community',
  };
  const qSource = tabToSource[qTab];
  const qSearch = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim().toLowerCase() : undefined;
  const qSort = typeof req.query.sort === 'string' ? req.query.sort : 'name';
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 12));
  const offset = Math.max(0, parseInt(String(req.query.offset), 10) || 0);

  // Use store-level filtering for status.
  const storeFilter: { status?: 'active' | 'paused' | 'archived' | 'draft' } = {};
  if (qStatus && ['active', 'paused', 'draft', 'archived'].includes(qStatus)) {
    storeFilter.status = qStatus as 'active' | 'paused' | 'archived' | 'draft';
  }

  // Fetch all (status-filtered, search-applied later) agents once for tab counts.
  const allAgentsForCounts = ctx.agentStore.listAgents(Object.keys(storeFilter).length > 0 ? storeFilter : undefined);
  const matchesSearch = (a: Agent): boolean => {
    if (!qSearch) return true;
    return (
      a.id.toLowerCase().includes(qSearch) ||
      (a.description ?? '').toLowerCase().includes(qSearch) ||
      a.name.toLowerCase().includes(qSearch)
    );
  };
  const tabCounts = {
    user: allAgentsForCounts.filter((a) => a.source === 'local' && matchesSearch(a)).length,
    examples: allAgentsForCounts.filter((a) => a.source === 'examples' && matchesSearch(a)).length,
    community: allAgentsForCounts.filter((a) => a.source === 'community' && matchesSearch(a)).length,
  };

  let v2Agents = allAgentsForCounts.filter((a) => a.source === qSource);

  // Client-side search filter (id or description substring).
  if (qSearch) {
    v2Agents = v2Agents.filter((a) =>
      a.id.toLowerCase().includes(qSearch) ||
      (a.description ?? '').toLowerCase().includes(qSearch) ||
      a.name.toLowerCase().includes(qSearch)
    );
  }

  // Unify for the list view. v2 agents take precedence when ids collide.
  const mergedV1: AgentDefinition[] = [];
  const v2Ids = new Set(v2Agents.map((a) => a.id));
  for (const [id, a] of v1Agents) {
    if (!v2Ids.has(id)) mergedV1.push(a);
  }
  mergedV1.sort((a, b) => a.name.localeCompare(b.name));

  // Sort v2 agents based on query param.
  // "recent" sort needs the run lookup below, so we defer it.

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

  // Compute cross-agent invoker counts for "used by" badges.
  const invokerCounts = new Map<string, number>();
  for (const a of v2Agents) {
    const invokers = ctx.agentStore.getAgentInvokers(a.id);
    if (invokers.length > 0) invokerCounts.set(a.id, invokers.length);
  }

  // Apply sorting.
  const lastRunByAgent = new Map<string, Run>();
  for (const r of recent.rows) {
    if (!lastRunByAgent.has(r.agentName)) lastRunByAgent.set(r.agentName, r);
  }

  if (qSort === 'status') {
    v2Agents.sort((a, b) => a.status.localeCompare(b.status) || a.id.localeCompare(b.id));
  } else if (qSort === 'recent') {
    v2Agents.sort((a, b) => {
      const ra = lastRunByAgent.get(a.id)?.startedAt ?? '';
      const rb = lastRunByAgent.get(b.id)?.startedAt ?? '';
      return rb.localeCompare(ra) || a.id.localeCompare(b.id);
    });
  } else if (qSort === 'starred') {
    v2Agents.sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0) || a.id.localeCompare(b.id));
  } else {
    v2Agents.sort((a, b) => a.id.localeCompare(b.id));
  }

  // Paginate v2 agents.
  const totalV2 = v2Agents.length;
  const paginatedV2 = v2Agents.slice(offset, offset + limit);

  // Flash from mutation redirects (e.g. delete success). `?error=` is
  // reserved for mutation failures so the banner kind matches user intent.
  const flashOk = typeof req.query.flash === 'string' ? req.query.flash : undefined;
  const flashErr = typeof req.query.error === 'string' ? req.query.error : undefined;
  const flash = flashErr
    ? { kind: 'error' as const, message: flashErr }
    : flashOk
    ? { kind: 'ok' as const, message: flashOk }
    : undefined;

  res.type('html').send(renderAgentsList({
    v1: mergedV1,
    v2: paginatedV2,
    recentRuns: recent.rows,
    stats,
    invokerCounts,
    filter: { status: qStatus, q: qSearch, sort: qSort },
    tab: qTab,
    tabCounts,
    limit,
    offset,
    total: totalV2,
    flash,
  }));
});

// ── Agent detail ────────────────────────────────────────────────────────

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
    res.status(404).type('html').send(renderAgentsList({ v1, v2, recentRuns: recent404.rows, stats, limit: 12, offset: 0, total: v2.length }));
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

// ── Agent detail tab routes ──────────────────────────────────────────────

/** Shared helper: build the common args for all agent detail tabs. */
async function buildTabArgs(req: Request, ctx: ReturnType<typeof getContext>, name: string) {
  const agent = ctx.agentStore.getAgent(name);
  if (!agent) return null;
  const flashParam = typeof req.query.flash === 'string' ? req.query.flash : undefined;
  const fromParam = typeof req.query.from === 'string' ? req.query.from : undefined;
  const flash = flashParam ? { kind: 'ok' as const, message: flashParam } : undefined;
  const referer = typeof req.headers.referer === 'string' ? req.headers.referer : undefined;
  const back = deriveBack(referer, `127.0.0.1:${ctx.port}`, fromParam);
  const { rows } = ctx.runStore.queryRuns({
    agentName: agent.id, limit: 50, offset: 0, statuses: [] as RunStatus[],
  });

  // Extract previous run's agent-level inputs for the Run Now modal.
  let previousInputs: Record<string, string> | undefined;
  if (rows.length > 0 && agent.inputs) {
    try {
      const execs = ctx.runStore.listNodeExecutions(rows[0].id);
      if (execs.length > 0 && execs[0].inputsJson) {
        const allEnv = JSON.parse(execs[0].inputsJson) as Record<string, string>;
        const inputNames = new Set(Object.keys(agent.inputs));
        previousInputs = {};
        for (const [k, v] of Object.entries(allEnv)) {
          if (inputNames.has(k) && v !== '') previousInputs[k] = v;
        }
      }
    } catch { /* no node executions yet */ }
  }

  return { agent, recentRuns: rows, secretsStore: ctx.secretsStore, flash, back, from: fromParam, previousInputs };
}

agentsRouter.get('/agents/:name/nodes', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const args = await buildTabArgs(req, ctx, name);
  if (!args) { res.status(404).redirect(303, '/agents'); return; }
  res.type('html').send(await renderAgentNodes({ ...args, activeTab: 'nodes' }));
});

agentsRouter.get('/agents/:name/config', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const args = await buildTabArgs(req, ctx, name);
  if (!args) { res.status(404).redirect(303, '/agents'); return; }
  res.type('html').send(await renderAgentConfig({ ...args, activeTab: 'config' }));
});

agentsRouter.get('/agents/:name/runs', async (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
  const args = await buildTabArgs(req, ctx, name);
  if (!args) { res.status(404).redirect(303, '/agents'); return; }
  res.type('html').send(renderAgentRuns({ ...args, activeTab: 'runs' }));
});
