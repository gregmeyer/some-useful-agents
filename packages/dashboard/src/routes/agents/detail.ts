import { Router, type Request, type Response } from 'express';
import type { RunStatus } from '@some-useful-agents/core';
import { getContext } from '../../context.js';
import { renderAgentsList, type HomeStats } from '../../views/agents-list.js';
import { renderAgentDetail } from '../../views/agent-detail.js';
import { renderAgentDetailV2 } from '../../views/agent-detail-v2.js';

/**
 * Can each declared behavior actually condition a run?
 *
 * A declaration that will not resolve makes the agent UNRUNNABLE — conditioning
 * fails the run before any node executes. Showing that here turns a runtime
 * failure into a visible design-time problem, which is the whole point of
 * putting it on the page rather than just listing names.
 */
function resolveBehaviorStatus(
  ctx: ReturnType<typeof getContext>,
  names: string[] | undefined,
): Array<{ name: string; usable: boolean; reason?: string }> | undefined {
  if (!names || names.length === 0) return undefined;
  if (!ctx.loadBehaviors) return undefined;
  let discovered;
  try {
    discovered = ctx.loadBehaviors();
  } catch {
    return undefined;
  }
  return names.map((name) => {
    const hit = discovered.byName.get(name)
      ?? discovered.shadowed.find((sh) => sh.name === name);
    if (!hit) return { name, usable: false, reason: 'No spec with this name was found in this project.' };
    if (hit.location.scope !== 'project') {
      return {
        name,
        usable: false,
        reason: `Found in ${hit.location.scope} scope, which cannot condition a run. Copy it into this project's .agents/behaviors/.`,
      };
    }
    return { name, usable: true };
  });
}
import { deriveBack } from '../../views/page-header.js';
import {
  parseHiddenFieldsParam,
  parseSortParamsFromQuery,
  parseFilterParamsFromQuery,
  parsePageParamsFromQuery,
} from '../../views/output-widgets.js';

export const agentDetailRouter: Router = Router();

agentDetailRouter.get('/agents/:name', async (req: Request, res: Response) => {
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
    const wv = typeof req.query.wv === 'string' ? req.query.wv : undefined;
    const wh = typeof req.query.wh === 'string' ? req.query.wh : undefined;
    const widgetControls = {
      view: wv,
      hiddenFields: parseHiddenFieldsParam(wh),
      sort: parseSortParamsFromQuery(req.query as Record<string, unknown>),
      filter: parseFilterParamsFromQuery(req.query as Record<string, unknown>),
      page: parsePageParamsFromQuery(req.query as Record<string, unknown>),
    };
    const html = await renderAgentDetailV2({
      agent: v2Agent,
      recentRuns: rows,
      secretsStore: ctx.secretsStore,
      flash,
      back,
      from: fromParam,
      widgetControls,
      behaviorStatus: resolveBehaviorStatus(ctx, v2Agent.behaviors),
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
