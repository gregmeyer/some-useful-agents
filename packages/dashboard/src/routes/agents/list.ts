import { Router, type Request, type Response } from 'express';
import type { Agent, AgentDefinition, Run, RunStatus } from '@some-useful-agents/core';
import { getContext } from '../../context.js';
import { renderAgentsList, type HomeStats } from '../../views/agents-list.js';

export const agentListRouter: Router = Router();

agentListRouter.get('/agents', (req: Request, res: Response) => {
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
  // Honor dashboardVisible:false at the source so counts stay consistent with
  // what the list actually shows. Hidden agents are still reachable by direct
  // URL, MCP, scheduler, and the runs page.
  const allAgentsForCounts = ctx.agentStore
    .listAgents(Object.keys(storeFilter).length > 0 ? storeFilter : undefined)
    .filter((a) => a.dashboardVisible !== false);
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
