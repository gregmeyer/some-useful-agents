/**
 * Today's edition (ADR-0074): the page Pulse opens on. A board that is
 * generated each time and never stored: the scheduled agents that produced
 * something in the last day, laid out as a front page by code
 * (`editionDoc`, in the vocabulary of ADR-0070's front page), each agent's
 * result drawn as its own view. Nothing here
 * is written by a model, and there is nothing to arrange or save.
 */
import { SYSTEM_AGENT_IDS, boardFlag, boardLeadNumber, type Agent, type AgentSignal, type BoardAgentShape, type BoardDoc, type Run, type ViewComponent } from '@some-useful-agents/core';
import { buildPulseTile, attachLayoutHints, withTileSignal } from '../views/pulse-tile-builder.js';
import { boardAgentShape } from './board-widgets.js';
import { homeBrief } from './home-brief.js';
import type { PulseTile } from '../views/pulse-types.js';
import type { getContext } from '../context.js';

type Ctx = ReturnType<typeof getContext>;

export const TODAY_BOARD_ID = 'today';
export const TODAY_BOARD_NAME = "Today's edition";
const DAY = 86_400_000;

/**
 * Who is in today's edition, in order: active, scheduled agents (not sua's
 * own) whose latest finished run is from the last 24 hours, newest first,
 * with `lead` (the agent Home's brief leads with) moved to the front. Pure.
 */
export function editionAgents<A extends Pick<Agent, 'id' | 'status' | 'schedule'>>(agents: readonly A[], latest: (agentId: string) => Pick<Run, 'startedAt' | 'completedAt'> | undefined, now = Date.now(), lead?: string): A[] {
  const fresh: Array<{ a: A; at: string }> = [];
  for (const a of agents) {
    if (a.status !== 'active' || !a.schedule || SYSTEM_AGENT_IDS.has(a.id)) continue;
    const run = latest(a.id);
    const at = run?.completedAt ?? run?.startedAt;
    if (!at || now - Date.parse(at) > DAY) continue;
    fresh.push({ a, at });
  }
  fresh.sort((x, y) => y.at.localeCompare(x.at) || x.a.id.localeCompare(y.a.id));
  const out = fresh.map((x) => x.a);
  const i = lead ? out.findIndex((a) => a.id === lead) : -1;
  if (i > 0) out.unshift(...out.splice(i, 1));
  return out;
}

const slug = (id: string) => id.replace(/[^a-zA-Z0-9]+/g, '_');

/**
 * A result that needs the wide column: its view has a table (columns of
 * text don't survive a third of the page), or its tile asks for two rows.
 * A list of cards, a checklist or a single card reads fine narrow.
 */
export function editionWide(agent: Pick<Agent, 'view'>, shape: Pick<BoardAgentShape, 'size'>): boolean {
  const parts = (agent.view as { components?: Array<{ component?: string }> } | undefined)?.components ?? [];
  return parts.some((c) => c.component === 'Table') || shape.size === '2x2';
}

/**
 * The edition's page, by code: a masthead; a lede (the day's headline, in
 * the lead agent's own words); then the results that need width as the
 * story column (lead agent first) beside a narrower column of the others,
 * ones with a number first, that number set large over its result. The
 * narrow column takes half of the narrow results; the rest run three
 * abreast underneath, so neither column trails off. With only one kind,
 * three abreast. Each agent's result is its own view (`AgentTile`, bare,
 * in a Panel). Pure.
 */
export function editionDoc(shapes: readonly BoardAgentShape[], opts: { lede?: { agentId: string; headline: string }; wide?: ReadonlySet<string> } = {}): BoardDoc {
  const parts: ViewComponent[] = [
    { id: 'masthead', component: 'Panel', title: { path: '/board/name' }, note: { path: '/board/date' }, child: 'masthead_updated', treatment: 'feature', hero: true },
    { id: 'masthead_updated', component: 'Text', text: { path: '/board/updated' }, variant: 'caption' },
  ];
  const root: string[] = ['masthead'];
  const lead = opts.lede ? shapes.find((a) => a.id === opts.lede!.agentId) : undefined;
  if (lead && opts.lede) {
    parts.push(
      { id: 'lede', component: 'Panel', title: lead.title, child: 'lede_c', treatment: 'lede', when: boardFlag(lead.id) },
      { id: 'lede_c', component: 'Callout', text: opts.lede.headline },
    );
    root.push('lede');
  }
  const part = (a: BoardAgentShape, treatment: 'feature' | 'aside' | 'plain'): string => {
    const id = `${treatment}_${slug(a.id)}`;
    const number = treatment === 'aside' ? boardLeadNumber(a) : undefined;
    const kids: string[] = [];
    if (number) { parts.push({ id: `${id}_lead`, component: 'Lead', stat: { path: `/board/agents/${a.id}/stats/${number}` } }); kids.push(`${id}_lead`); }
    parts.push({ id: `${id}_tile`, component: 'AgentTile', agentId: a.id, chrome: 'bare' });
    kids.push(`${id}_tile`);
    if (kids.length > 1) parts.push({ id: `${id}_col`, component: 'Column', children: kids });
    parts.push({ id, component: 'Panel', title: a.title, child: kids.length > 1 ? `${id}_col` : kids[0], treatment, when: boardFlag(a.id) });
    return id;
  };
  /** Rows of up to three, side by side. */
  const abreast = (ids: readonly string[], name: string): void => {
    for (let i = 0; i < ids.length; i += 3) {
      const row = ids.slice(i, i + 3);
      if (row.length === 1) { root.push(row[0]); continue; }
      const id = `${name}_${String(i / 3)}`;
      parts.push({ id, component: 'Columns', children: [...row], widths: row.map(() => 1), align: 'start' });
      root.push(id);
    }
  };
  const wide = shapes.filter((a) => opts.wide?.has(a.id));
  // Ones with a number lead the narrow column (its number set large); the order is otherwise as given.
  const narrowAll = shapes.filter((a) => !opts.wide?.has(a.id));
  const narrow = [...narrowAll.filter((a) => boardLeadNumber(a)), ...narrowAll.filter((a) => !boardLeadNumber(a))];
  if (wide.length && narrow.length) {
    const beside = narrow.slice(0, Math.max(1, Math.ceil(narrow.length / 2)));
    parts.push(
      { id: 'top', component: 'Columns', children: ['story', 'rail'], widths: [2, 1], align: 'start' },
      { id: 'story', component: 'Column', children: wide.map((a) => part(a, 'feature')) },
      { id: 'rail', component: 'Column', children: beside.map((a) => part(a, 'aside')) },
    );
    root.push('top');
    abreast(narrow.slice(beside.length).map((a) => part(a, 'plain')), 'more');
  } else if (wide.length) {
    root.push(...wide.map((a) => part(a, 'feature')));
  } else {
    abreast(narrow.map((a) => part(a, 'aside')), 'row');
  }
  return { components: [{ id: 'root', component: 'Column', children: root }, ...parts] };
}

export interface TodayEdition {
  /** In page order; an agent with no view or tile of its own isn't in it. */
  tiles: Map<string, PulseTile>;
  doc: BoardDoc;
}

/** Today's edition from the stores, or undefined when no scheduled agent produced anything in the last day. Never throws. */
export function todayEdition(ctx: Ctx, now = Date.now()): TodayEdition | undefined {
  try {
    const brief = homeBrief(ctx, now);
    const lead = brief?.lead.agentId;
    const agents = editionAgents(ctx.agentStore.listAgents({ status: 'active' }), (id) => ctx.runStore.listRuns({ agentName: id, status: 'completed', limit: 1 })[0], now, lead);
    const ids = new Set(agents.map((a) => a.id));
    const tiles = new Map<string, PulseTile>();
    const built: PulseTile[] = [];
    for (const a of agents) {
      const agent = withTileSignal(a);
      if (!agent.signal) continue;
      const tile = buildPulseTile(agent as Agent & { signal: AgentSignal }, { runStore: ctx.runStore, runTargets: ids });
      built.push(tile);
      tiles.set(a.id, tile);
    }
    if (!tiles.size) return undefined;
    attachLayoutHints(built, ctx.layoutHintsStore);
    const shapes = [...tiles.values()].map((t) => boardAgentShape(t, ctx.runStore));
    const wide = new Set(shapes.filter((sh) => editionWide(agents.find((a) => a.id === sh.id) ?? {}, sh)).map((sh) => sh.id));
    return { tiles, doc: editionDoc(shapes, { ...(brief && tiles.has(brief.lead.agentId) ? { lede: { agentId: brief.lead.agentId, headline: brief.headline } } : {}), wide }) };
  } catch {
    return undefined;
  }
}
