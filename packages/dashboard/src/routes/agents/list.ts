import { Router, type Request, type Response } from 'express';
import { catalogRelevance, catalogTokens } from '@some-useful-agents/core';
import type { Agent, AgentDefinition, Run, RunStatus } from '@some-useful-agents/core';
import { getContext } from '../../context.js';
import { renderAgentsList, type HomeStats } from '../../views/agents-list.js';
import { buildAgentGraph, orchestrators } from '../../lib/agent-graph.js';

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
  // Keep the raw text for display + URLs, and a lowercased copy for matching.
  // Previously only the lowercased form survived, so typing "Weather Forecast"
  // echoed back "weather forecast" in the box.
  const qRaw = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : undefined;
  const qSearch = qRaw?.toLowerCase();
  const searchTokens = qRaw ? catalogTokens(qRaw) : [];

  // `sort` is now optional so "no preference" is distinguishable from an
  // explicit ?sort=name — that's what lets relevance be the implicit default
  // while a deliberate choice still wins.
  const qSortRaw = typeof req.query.sort === 'string' && req.query.sort ? req.query.sort : undefined;
  // Gate on TOKENS, not on qSearch: "pr" / "ci" / "what" tokenize to nothing,
  // so ranking them would silently collapse to id order under a "best match"
  // label. Fall back to name ordering and say so.
  const qSort = qSortRaw ?? (searchTokens.length > 0 ? 'relevance' : 'name');
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
  // Relevance WIDENS and reorders; it never removes. Everything the old
  // substring match found still matches — the ranker only adds agents whose
  // tags / entryConditions / sampleQuestions hit, which is how
  // "watch a website for changes" finds starter-watch at all.
  const matchesSearch = (a: Agent): boolean => {
    if (!qSearch) return true;
    if (
      a.id.toLowerCase().includes(qSearch) ||
      (a.description ?? '').toLowerCase().includes(qSearch) ||
      a.name.toLowerCase().includes(qSearch)
    ) return true;
    return catalogRelevance(a, searchTokens) > 0;
  };
  const tabCounts = {
    user: allAgentsForCounts.filter((a) => a.source === 'local' && matchesSearch(a)).length,
    examples: allAgentsForCounts.filter((a) => a.source === 'examples' && matchesSearch(a)).length,
    community: allAgentsForCounts.filter((a) => a.source === 'community' && matchesSearch(a)).length,
  };

  // Built before filtering so the graph reflects the whole store — an agent's
  // callers do not stop existing because you searched for something.
  const agentGraph = buildAgentGraph(allAgentsForCounts);
  const orchestratorIds = orchestrators(agentGraph);

  // One predicate, used for both the counts above and the list itself. These
  // were two byte-identical copies; the tab counts and the list could silently
  // disagree the moment one was edited.
  let v2Agents = allAgentsForCounts.filter((a) => a.source === qSource && matchesSearch(a));

  // `?composed=1` narrows to agents that call other agents — the fastest way
  // to see that sua composes agents at all, and to find the working examples.
  // The count is scoped to THIS tab and search, so the number on the chip is
  // the number of results you get by clicking it. A store-wide count would
  // promise 8 and deliver 1 on a tab that holds one of them.
  const composedCount = v2Agents.filter((a) => orchestratorIds.has(a.id)).length;
  const qComposed = req.query.composed === '1';
  if (qComposed) v2Agents = v2Agents.filter((a) => orchestratorIds.has(a.id));

  // Unify for the list view. v2 agents take precedence when ids collide.
  const mergedV1: AgentDefinition[] = [];
  const v2Ids = new Set(v2Agents.map((a) => a.id));
  for (const [id, a] of v1Agents) {
    if (v2Ids.has(id)) continue;
    // v1 agents used to ignore `q` entirely, so searching "weather" still
    // listed every unrelated legacy agent. They carry no routing metadata, so
    // substring is all there is to match on.
    if (qSearch && !(
      a.name.toLowerCase().includes(qSearch) ||
      (a.description ?? '').toLowerCase().includes(qSearch)
    )) continue;
    mergedV1.push(a);
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

  // The overview strip counts the whole tab, independent of the status/search
  // filters applied to the list below — Total Runs / In Flight are already global,
  // so the agent tiles must be too. Otherwise filtering the list to e.g. "paused"
  // makes the strip read a contradictory "N active". v1 agents have no status, so
  // they count as active by convention (mergedV1 is already unfiltered).
  const tabAgentsAll = ctx.agentStore
    .listAgents(undefined)
    .filter((a) => a.dashboardVisible !== false && a.source === qSource);

  const stats: HomeStats = {
    agents: tabAgentsAll.length + mergedV1.length,
    activeAgents: tabAgentsAll.filter((a) => a.status === 'active').length + mergedV1.length,
    totalRuns: total.total,
    runningRuns: inFlight.total,
    latestRunAt: recent.rows[0]?.startedAt,
  };

  // Cross-agent call graph, for the "used by" / "calls" badges and the
  // orchestrators filter. Built in one pass: this previously called
  // `getAgentInvokers` once per agent, and each of those rescanned every
  // agent — ~14k node visits for a 120-agent store, to render some badges.
  const invokerCounts = new Map<string, number>();
  const calleeCounts = new Map<string, number>();
  for (const [id, edges] of agentGraph.invokedBy) invokerCounts.set(id, edges.length);
  for (const [id, edges] of agentGraph.invokes) calleeCounts.set(id, edges.length);

  // Apply sorting.
  const lastRunByAgent = new Map<string, Run>();
  for (const r of recent.rows) {
    if (!lastRunByAgent.has(r.agentName)) lastRunByAgent.set(r.agentName, r);
  }

  if (qSort === 'relevance') {
    // Score once per agent rather than inside the comparator — catalogRelevance
    // builds a concatenated string each call, so scoring in the sort would run
    // it O(n log n) times.
    const scores = new Map(v2Agents.map((a) => [a.id, catalogRelevance(a, searchTokens)]));
    v2Agents.sort((a, b) =>
      (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) || a.id.localeCompare(b.id));
  } else if (qSort === 'status') {
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
    // The control is labeled "name" — sort by name. This sorted by id, so
    // "Weather Forecast" (id: forecast-weather) landed under F.
    v2Agents.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
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

  const availableDashboards = ctx.dashboardsStore
    ? ctx.dashboardsStore.listDashboards().filter((d) => !d.packId).map((d) => ({ id: d.id, name: d.name }))
    : [];

  res.type('html').send(renderAgentsList({
    v1: mergedV1,
    v2: paginatedV2,
    recentRuns: recent.rows,
    stats,
    invokerCounts,
    calleeCounts,
    composedCount,
    composedOnly: qComposed,
    // `q` raw so the box echoes what was typed; `sort` raw (possibly
    // undefined) so agentBuildUrl keeps tab/pager URLs clean; `sortEffective`
    // only drives which dropdown option shows as selected.
    filter: { status: qStatus, q: qRaw, sort: qSortRaw, sortEffective: qSort },
    tab: qTab,
    tabCounts,
    limit,
    offset,
    total: totalV2,
    flash,
    availableDashboards,
  }));
});
