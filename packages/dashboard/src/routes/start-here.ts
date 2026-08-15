/**
 * `/start` — the curated first surface.
 *
 * `sua init` installs every example agent (~40), which is a wall for someone
 * four minutes into the product: the zero-agent onboarding in views/home.ts is
 * effectively dead code because `agentCount` is never 0. Rather than install
 * fewer agents (they're all useful eventually), this curates the *view*: the
 * `playground-starters` pack names the three a newcomer should meet, and
 * everything else stays one click away under Agents → Examples.
 *
 * The pack is the source of truth for WHICH three, so re-curating is a YAML
 * edit rather than a code change.
 */

import { Router, type Request, type Response } from 'express';
import { getContext } from '../context.js';
import { renderStartHerePage } from '../views/start-here.js';

export const startHereRouter: Router = Router();

export const STARTER_PACK_ID = 'playground-starters';

startHereRouter.get('/start', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);

  const pack = ctx.packsStore?.getPack(STARTER_PACK_ID);
  const refs = pack?.manifest.agents ?? [];

  // Resolve each curated id against the agent store. An id that isn't
  // installed is simply dropped: the examples importer and the pack are
  // independent code paths, and a half-populated page beats a 500.
  const starters = refs
    .map((ref) => ctx.agentStore.getAgent(ref.id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a))
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      scheduled: Boolean(agent.schedule),
      nodeCount: agent.nodes.length,
      // Shape of the graph, so the card can draw it without the viewer
      // opening the agent and finding the Nodes tab.
      shape: agent.nodes.map((n) => ({
        id: n.id,
        dependsOn: n.dependsOn,
        conditional: Boolean(n.onlyIf),
        type: n.type,
        tools: n.tools,
        condition: n.onlyIf
          ? `${n.onlyIf.upstream}.${n.onlyIf.field} = ${String(n.onlyIf.equals ?? n.onlyIf.notEquals ?? '')}`
          : undefined,
      })),
      // Two nodes sharing a parent = a visible fan-out in the graph.
      parallel: agent.nodes.some((n) => {
        const deps = JSON.stringify(n.dependsOn ?? []);
        return deps !== '[]' && agent.nodes.filter((m) => JSON.stringify(m.dependsOn ?? []) === deps).length > 1;
      }),
      // Surfaced so a newcomer can see, before running anything, that an
      // agent is "instructions + tools" — the one idea this page exists
      // to land.
      tools: Array.from(new Set(
        agent.nodes.flatMap((n) => n.tools ?? []),
      )),
      inputs: Object.keys(agent.inputs ?? {}),
    }));

  const exampleCount = ctx.agentStore.listAgents()
    .filter((a) => a.source === 'examples').length;

  res.type('html').send(renderStartHerePage({
    starters,
    exampleCount,
    packMissing: !pack,
    flash: typeof req.query.ok === 'string' ? req.query.ok : undefined,
  }));
});
