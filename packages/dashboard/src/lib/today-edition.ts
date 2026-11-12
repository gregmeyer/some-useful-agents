/**
 * Today's edition (ADR-0074): the page Pulse opens on. A board that is
 * generated each time and never stored: the scheduled agents that produced
 * something in the last day, laid out as a front page by code
 * (`editionDoc`, in the vocabulary of ADR-0070's front page), each agent's
 * result drawn as its own view. Nothing here
 * is written by a model, and there is nothing to arrange or save.
 */
import { EditionPrefsStore, SYSTEM_AGENT_IDS, boardFlag, boardLeadNumber, type Agent, type AgentSignal, type BoardAgentShape, type BoardDoc, type EditionPrefs, type Run, type ViewComponent } from '@some-useful-agents/core';
import { buildPulseTile, attachLayoutHints, withTileSignal } from '../views/pulse-tile-builder.js';
import { boardAgentShape, type BoardFigures } from './board-widgets.js';
import { firstSentence, homeBrief, topOf, type BriefFigure, type HomeBrief } from './home-brief.js';
import { runOutputObject } from './daily-digest.js';
import { readLine } from './home-reads.js';
import type { PulseTile } from '../views/pulse-types.js';
import type { getContext } from '../context.js';

type Ctx = ReturnType<typeof getContext>;

export const TODAY_BOARD_ID = 'today';
export const TODAY_BOARD_NAME = "Today's edition";
const DAY = 86_400_000;

/**
 * Who is in today's edition, in order: active, scheduled agents (not sua's
 * own) whose latest finished run is from the last 24 hours, newest first,
 * with `lead` moved to the front. Your preferences (ADR-0076) come first:
 * an agent you left out isn't in it, and one you said to always show is,
 * whenever it has a result, schedule or not. Pure.
 */
export function editionAgents<A extends Pick<Agent, 'id' | 'status' | 'schedule'>>(agents: readonly A[], latest: (agentId: string) => Pick<Run, 'startedAt' | 'completedAt'> | undefined, now = Date.now(), lead?: string, prefs?: Pick<EditionPrefs, 'hidden' | 'include'>): A[] {
  const fresh: Array<{ a: A; at: string }> = [];
  const hidden = new Set(prefs?.hidden ?? []);
  const always = new Set(prefs?.include ?? []);
  for (const a of agents) {
    if (a.status !== 'active' || SYSTEM_AGENT_IDS.has(a.id) || hidden.has(a.id)) continue;
    if (!a.schedule && !always.has(a.id)) continue;
    const run = latest(a.id);
    const at = run?.completedAt ?? run?.startedAt;
    if (!at || (now - Date.parse(at) > DAY && !always.has(a.id))) continue;
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
export function editionDoc(shapes: readonly BoardAgentShape[], opts: { lede?: { agentId: string; headline: string }; wide?: ReadonlySet<string>; figures?: BoardFigures; /** A line of the person's own, under the masthead. */ note?: string; /** The top item of one agent's list, linked, under the headline. */ top?: { title: string; url: string; agent: string } } = {}): BoardDoc {
  const parts: ViewComponent[] = [
    { id: 'masthead', component: 'Panel', title: { path: '/board/name' }, note: { path: '/board/date' }, child: 'masthead_updated', treatment: 'feature', hero: true },
    { id: 'masthead_updated', component: 'Text', text: { path: '/board/updated' }, variant: 'caption' },
  ];
  const root: string[] = ['masthead'];
  if (opts.note) {
    parts.push({ id: 'note', component: 'Text', text: opts.note, variant: 'body' });
    root.push('note');
  }
  const lead = opts.lede ? shapes.find((a) => a.id === opts.lede!.agentId) : undefined;
  if (lead && opts.lede) {
    parts.push(
      { id: 'lede', component: 'Panel', title: lead.title, child: 'lede_c', treatment: 'lede', when: boardFlag(lead.id) },
      { id: 'lede_c', component: 'Callout', text: opts.lede.headline },
    );
    root.push('lede');
  }
  if (opts.top) {
    parts.push(
      { id: 'top_story', component: 'Panel', title: `Top of ${opts.top.agent}`, child: 'top_story_link', treatment: 'plain' },
      { id: 'top_story_link', component: 'Link', text: opts.top.title, url: opts.top.url },
    );
    root.push('top_story');
  }
  // The day's figures, as drawings: the lead count large beside its last days as columns, then the others each over its trend.
  if (opts.figures) {
    const f = opts.figures;
    const kids = ['band_lead', 'band_days', ...f.others.map((_, i) => `band_fig_${String(i)}`)];
    parts.push(
      { id: 'band', component: 'Panel', title: 'By the numbers', child: 'band_row', treatment: 'band' },
      { id: 'band_row', component: 'Columns', children: kids, widths: [1, 2, ...f.others.map(() => 1)], align: 'start' },
      { id: 'band_lead', component: 'Lead', stat: { path: '/board/figures/lead' } },
      { id: 'band_days', component: 'DayBars', days: { path: '/board/figures/lead/days' }, title: `${f.lead.label}, last ${String(f.lead.days.length)} days` },
      ...f.others.map((o, i): ViewComponent => ({ id: `band_fig_${String(i)}`, component: 'Sparkline', values: { path: `/board/figures/others/${String(i)}/values` }, label: `${o.label} · ${o.note}`, current: o.value })),
    );
    root.push('band');
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

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayLabel = (iso: string): string => WEEKDAY[new Date(`${iso}T12:00:00Z`).getUTCDay()] ?? iso;
const said = (f: BriefFigure, v: number): string => (f.kind === 'percent' ? `${v > 0 ? '+' : ''}${String(Math.round(v * 100) / 100)}%` : String(Math.round(v * 100) / 100));

/** Home's brief as the edition's figures: the lead with its days (the last one "Today"), the others with their values. Only agents in the edition. Pure. */
export function editionFigures(brief: HomeBrief | undefined, inEdition: ReadonlySet<string>): BoardFigures | undefined {
  if (!brief || !inEdition.has(brief.lead.agentId) || brief.lead.days.length < 3) return undefined;
  const { lead } = brief;
  return {
    lead: {
      value: lead.text, label: lead.label, note: lead.agent, href: `/runs/${encodeURIComponent(lead.runId)}`,
      days: lead.days.map((d, i) => ({ label: i === lead.days.length - 1 ? 'Today' : dayLabel(d.day), value: d.value, text: said(lead, d.value) })),
    },
    others: brief.figures.filter((f) => inEdition.has(f.agentId)).map((f) => ({ value: f.text, label: f.label, note: f.agent, href: `/runs/${encodeURIComponent(f.runId)}`, values: f.days.map((d) => d.value) })),
  };
}

/** How you want the edition (ADR-0076): the stored preferences its generator follows. */
export const editionPrefsStoreOf = (ctx: Ctx) => new EditionPrefsStore(ctx.runStore.databaseHandle());
export function editionPrefsOf(ctx: Ctx): EditionPrefs {
  try { return editionPrefsStoreOf(ctx).get(); } catch { return { hidden: [], include: [], wide: [], narrow: [] }; }
}

export interface TodayEdition {
  /** In page order; an agent with no view or tile of its own isn't in it. */
  tiles: Map<string, PulseTile>;
  doc: BoardDoc;
  /** The day's figures, for the page's data (`/board/figures`). */
  figures?: BoardFigures;
}

/** Today's edition from the stores, or undefined when no scheduled agent produced anything in the last day. Never throws. */
export function todayEdition(ctx: Ctx, now = Date.now()): TodayEdition | undefined {
  try {
    const brief = homeBrief(ctx, now);
    const prefs = editionPrefsOf(ctx);
    const latestRun = (id: string) => ctx.runStore.listRuns({ agentName: id, status: 'completed', limit: 1 })[0];
    // What leads: the agent you chose while it's in the edition, else the one the day's figures lead with.
    const all = editionAgents(ctx.agentStore.listAgents({ status: 'active' }), latestRun, now, undefined, prefs);
    const lead = prefs.lead && all.some((a) => a.id === prefs.lead) ? prefs.lead : brief?.lead.agentId;
    const agents = editionAgents(ctx.agentStore.listAgents({ status: 'active' }), latestRun, now, lead, prefs);
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
    const wide = new Set(shapes.filter((sh) => (editionWide(agents.find((a) => a.id === sh.id) ?? {}, sh) || prefs.wide.includes(sh.id)) && !prefs.narrow.includes(sh.id)).map((sh) => sh.id));
    const figures = prefs.numbers === false ? undefined : editionFigures(brief, new Set(tiles.keys()));
    // The headline is the lead agent's own first sentence: the brief's when it leads, else read from the result of the one you chose.
    const headline = lead && tiles.has(lead)
      ? (brief && brief.lead.agentId === lead ? brief.headline : firstSentence(readLine(latestRun(lead)?.result, 400) ?? ''))
      : '';
    const topAgent = prefs.topStory && tiles.has(prefs.topStory) ? prefs.topStory : undefined;
    const topObj = topAgent ? runOutputObject(latestRun(topAgent)?.result).obj : undefined;
    const top = topAgent && topObj ? topOf(topObj) : undefined;
    return {
      tiles,
      doc: editionDoc(shapes, {
        ...(lead && headline ? { lede: { agentId: lead, headline } } : {}), wide, ...(figures ? { figures } : {}),
        ...(prefs.note ? { note: prefs.note } : {}), ...(top && topAgent ? { top: { ...top, agent: tiles.get(topAgent)!.signal.title || topAgent } } : {}),
      }),
      ...(figures ? { figures } : {}),
    };
  } catch {
    return undefined;
  }
}
