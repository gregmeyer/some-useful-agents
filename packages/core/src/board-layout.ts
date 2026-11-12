/**
 * A board's page as a layout (ADR-0070): the same mechanism as a notebook's
 * page (notebook-layout.ts, ADR-0056), bound to the board's data instead.
 * The board's document stays an A2UI document; a composed one binds parts
 * (a Callout, a Lead, a Table) to its agents' latest outputs at
 * `/board/agents/<id>/outputs/<field>`, keeps `AgentTile` where an agent's
 * own view is the best representation, and uses `when` to draw a part only
 * once its agent has run. A grid of tiles is such a document too (nothing
 * bound, nothing conditional), so every board is already a page.
 */
import type { ViewComponent } from './a2ui/view.js';
import { resolveLayout, checkLayout, hasSomething } from './layout-resolve.js';

/** What a board's page can bind to (bind with `{ "path": ... }`). Paths are added, never renamed. */
export const BOARD_LAYOUT_DATA: Readonly<Record<string, string>> = {
  '/board/name': "The board's name.",
  '/board/date': 'Today, written out ("Thursday 6 November").',
  '/board/updated': 'How fresh the newest result is ("Updated 12m ago"; "Nothing has run yet").',
  '/board/agentIds': "The agents on the board, in the document's order.",
  '/board/statItems': "The numbers that matter across the agents (a change, a price, a score; up to 2 per agent) as StatStrip rows, {label, value, sub}, at most 8.",
  '/board/agents/<id>/title': "The agent's tile title.",
  '/board/agents/<id>/icon': 'Its icon, when it has one.',
  '/board/agents/<id>/href': "The agent's page (/agents/<id>).",
  '/board/agents/<id>/outputs/<field>': "A field of the agent's latest result (its declared outputs, or the fields its last run printed): a string, number, list or object.",
  '/board/agents/<id>/run/status': "The latest completed run's status, and /run/age ('3h ago'), /run/completedAt, /run/href (the run page), /run/running (true while a new run is going).",
  '/board/agents/<id>/stats/<field>': 'A numeric output as a Lead stat: {value, label, note (the agent and when), href (the run)}.',
  '/board/agents/<id>/statItems': "That agent's numeric outputs as StatStrip rows.",
};

/** The page's settings (`/board/layout/<key>`): none yet; reserved. */
export const BOARD_LAYOUT_VALUES: Readonly<Record<string, string>> = {};

/** What `when` can test on a board: an agent id (it has a result), `running:<id>`, `numbers:<id>` (it has a numeric output). */
/**
 * A board's figures (ADR-0074, ADR-0075): numbers in its agents' results
 * that change from day to day. The count that leads, with its last days,
 * and a few others with theirs. Absent when no agent on the board has one.
 */
export const BOARD_FIGURES_DATA: Record<string, string> = {
  '/board/figures/lead': 'the count that leads the day, as a Lead stat {value, label, note, href}',
  '/board/figures/lead/days': 'that count on each of the last days it ran, for DayBars: [{label, value, text}], oldest first',
  '/board/figures/others/<n>': 'another figure {value, label, note, href, values}: `values` is its number on each of the last days, for a Sparkline',
};

export const BOARD_LAYOUT_FLAGS: Readonly<Record<string, string>> = {
  '<agentId>': 'The agent has a completed run with a result to show.',
  'running:<agentId>': 'A run of the agent is going right now.',
  'numbers:<agentId>': 'The agent has a numeric output (a Lead, Bars or a StatStrip can draw it).',
};

/** The shape of an agent's output as the page agent sees it: names and kinds, never values. */
export interface BoardAgentOutputShape {
  name: string;
  type: 'string' | 'number' | 'list' | 'object';
  /** A list's length, or a string's length. */
  length?: number;
}

/** An agent on a board, as what a layout can know about it. */
export interface BoardAgentShape {
  id: string;
  title: string;
  icon?: string;
  /** The tile size its signal asks for (1x1, 2x1, 1x2, 2x2). */
  size?: string;
  /** Its template kind (widget, text-headline, comparison…), when the signal names one. */
  kind?: string;
  outputs: BoardAgentOutputShape[];
  /** It has a completed run with a result. */
  ran: boolean;
  /** A run is going now. */
  running?: boolean;
}

/** The flag name for an agent's state. */
export const boardFlag = (agentId: string, kind?: 'running' | 'numbers'): string => (kind ? `${kind}:${agentId}` : agentId);

/** Whether a `when` name is one a board with these agents can have. */
export function boardFlagKnown(name: string, agentIds: ReadonlySet<string> | readonly string[]): boolean {
  const ids = agentIds instanceof Set ? agentIds : new Set(agentIds);
  const m = /^(?:(running|numbers):)?(.+)$/.exec(name);
  return !!m && ids.has(m[2]);
}

/** The agent a flag is about. */
export function boardFlagAgent(when: unknown): string | undefined {
  if (typeof when !== 'string') return undefined;
  return when.replace(/^!/, '').replace(/^(running|numbers):/, '') || undefined;
}

/** The `when` flags of a board from its agents' shapes. */
export function boardLayoutFlags(agents: ReadonlyArray<Pick<BoardAgentShape, 'id' | 'ran' | 'running' | 'outputs'>>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const a of agents) {
    out[boardFlag(a.id)] = a.ran;
    out[boardFlag(a.id, 'running')] = !!a.running;
    out[boardFlag(a.id, 'numbers')] = a.ran && a.outputs.some((o) => o.type === 'number');
  }
  return out;
}

/** Whether a document is a composed page (something conditional or bound to the board), not a plain grid of tiles. */
export function isComposedBoardDoc(components: readonly ViewComponent[]): boolean {
  const bound = (v: unknown): boolean => {
    if (Array.isArray(v)) return v.some(bound);
    if (!v || typeof v !== 'object') return false;
    const o = v as Record<string, unknown>;
    if (typeof o.path === 'string' && Object.keys(o).length === 1) return o.path.startsWith('/board/');
    return Object.values(o).some(bound);
  };
  return components.some((c) => c.when !== undefined || bound(c));
}

/** Agents a document binds parts to (by `when` or a `/board/agents/<id>/` path), besides its tiles. */
export function boardDocBoundAgentIds(components: readonly ViewComponent[]): string[] {
  const out = new Set<string>();
  const collect = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(collect); return; }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (typeof o.path === 'string' && Object.keys(o).length === 1) { const m = /^\/board\/agents\/([^/]+)\//.exec(o.path); if (m) out.add(m[1]); return; }
    Object.values(o).forEach(collect);
  };
  for (const c of components) {
    const a = boardFlagAgent(c.when);
    if (a) out.add(a);
    collect(c);
  }
  return [...out];
}

/**
 * A board's page as plain A2UI for one draw: parts whose agent hasn't run
 * go (or stay as a skeleton while it runs), `when` and empties resolved as
 * on a notebook page. A plain grid of tiles comes back as it is.
 */
export function resolveBoardLayout(
  components: readonly ViewComponent[],
  flags: Readonly<Partial<Record<string, boolean>>>,
  data?: unknown,
  opts: { running?: ReadonlySet<string> } = {},
): ViewComponent[] {
  return resolveLayout(components, {
    prefix: '/board',
    flags,
    values: {},
    ...(data !== undefined ? { data } : {}),
    // A part of an agent whose run is going keeps its place as a skeleton.
    pending: (c) => { const a = boardFlagAgent(c.when); return !!a && !!opts.running?.has(a); },
  });
}

/** A board with every flag on, for checking a layout as a board with everything would draw it. */
function allFlags(agentIds: readonly string[]): Record<string, boolean> {
  return Object.fromEntries(agentIds.flatMap((id) => [[boardFlag(id), true], [boardFlag(id, 'running'), true], [boardFlag(id, 'numbers'), true]]));
}

/**
 * Check a board's page: every `when` names an agent of the board (or its
 * running:/numbers: state), and, as a board with everything would draw it,
 * it's a valid board document.
 */
export function checkBoardLayout(components: unknown, agentIds: readonly string[]): { ok: true; components: ViewComponent[] } | { ok: false; errors: string[] } {
  return checkLayout(components, {
    knownFlag: (w) => boardFlagKnown(w, agentIds),
    flagsAre: `an agent of this board (${agentIds.join(', ') || 'none yet'}), or running:<agent> / numbers:<agent>`,
    resolve: (cs) => resolveBoardLayout(cs, allFlags(agentIds)),
    board: true,
  });
}

export interface BoardLayoutPreset {
  id: 'grid' | 'front-page';
  label: string;
  /** When it fits, in a line. */
  when: string;
}

/** The ready-made pages a board can take. `grid` is the document as it is (sections of tiles). */
export const BOARD_LAYOUT_PRESETS: readonly BoardLayoutPreset[] = [
  { id: 'grid', label: 'Grid', when: 'Tiles in sections, each with its own frame: a board to glance over and run things from.' },
  { id: 'front-page', label: 'Front page', when: 'A newspaper front page: a masthead, a lede, a story column beside a rail of numbers, a band of figures. For a board you read every morning.' },
];

/** A numeric field that reads as the number that matters (a change, a price, a score), not a count of rows or a UV index. */
export const BOARD_LEAD_NUMBER = /change|price|total|score|rate|pct|percent|temp|value|close|balance|revenue|stars|visits|users/i;
/** Tile kinds that are numbers by nature: they go in the rail. */
const RAIL_KINDS = new Set(['metric', 'comparison', 'key-value', 'status', 'time-series']);

/** The agent's number that matters, when it has one. */
export function boardLeadNumber(a: Pick<BoardAgentShape, 'outputs'>): string | undefined {
  return a.outputs.find((o) => o.type === 'number' && BOARD_LEAD_NUMBER.test(o.name))?.name;
}

/** Whether an agent belongs in the rail (numbers and facts) rather than the story column (lists, tables, long views). */
export function boardInRail(a: Pick<BoardAgentShape, 'outputs' | 'kind'>): boolean {
  if (a.kind && RAIL_KINDS.has(a.kind)) return true;
  return a.outputs.some((o) => o.type === 'number') && !a.outputs.some((o) => o.type === 'list');
}

const HEADLINE = /headline|^lead$|^title$|^lead_/i;
const SUMMARY = /summary|subtitle|standfirst|blurb|dek/i;
const slug = (s: string): string => s.replace(/[^A-Za-z0-9_]/g, '_');
const titled = (s: string): string => s.replace(/[_-]+/g, ' ').replace(/^\w/, (ch) => ch.toUpperCase());

/** The agent's headline field, when it has one; a string the eye reads first. */
function headlineField(a: BoardAgentShape): BoardAgentOutputShape | undefined {
  const strings = a.outputs.filter((o) => o.type === 'string');
  return strings.find((o) => /lead_headline|^headline$/i.test(o.name)) ?? strings.find((o) => HEADLINE.test(o.name));
}
function summaryField(a: BoardAgentShape, not?: string): BoardAgentOutputShape | undefined {
  return a.outputs.filter((o) => o.type === 'string' && o.name !== not).find((o) => SUMMARY.test(o.name));
}

/**
 * The front page, filled for a board's agents: a masthead (the board's name
 * and the date), a lede (the lead agent's headline and summary, as a
 * Callout), a story column of the agents whose own view is the story beside
 * a rail of the agents with numbers (a Lead over each one's tile), and a
 * band of figures when two or more have numbers. Every part of an agent is
 * drawn only once it has run (`when`). Deterministic, so the picker can use
 * it without a model; the page agent starts from it.
 */
export function frontPageDoc(agents: readonly BoardAgentShape[]): ViewComponent[] {
  const parts: ViewComponent[] = [];
  const rootKids: string[] = [];
  const outputs = (a: BoardAgentShape, field: string) => ({ path: `/board/agents/${a.id}/outputs/${field}` });
  parts.push(
    { id: 'masthead', component: 'Panel', title: { path: '/board/name' }, note: { path: '/board/date' }, child: 'masthead_updated', treatment: 'feature', hero: true },
    { id: 'masthead_updated', component: 'Text', text: { path: '/board/updated' }, variant: 'caption' },
  );
  rootKids.push('masthead');

  const lead = agents.find((a) => headlineField(a));
  if (lead) {
    const h = headlineField(lead)!;
    const s = summaryField(lead, h.name);
    const id = `lede_${slug(lead.id)}`;
    parts.push(
      { id, component: 'Panel', title: lead.title, child: `${id}_c`, treatment: 'lede', when: boardFlag(lead.id) },
      { id: `${id}_c`, component: 'Callout', text: outputs(lead, h.name), ...(s ? { next: outputs(lead, s.name), nextLabel: ' ' } : {}) },
    );
    rootKids.push(id);
  }

  // The lead agent's own tile repeats its headline: it goes last in the story column, as "More from …".
  const story = [...agents.filter((a) => !boardInRail(a) && a !== lead), ...(lead && !boardInRail(lead) ? [lead] : [])];
  const rail = agents.filter((a) => boardInRail(a));
  const tilePart = (a: BoardAgentShape, treatment: 'feature' | 'aside'): string => {
    const id = `${treatment}_${slug(a.id)}`;
    const leadField = treatment === 'aside' ? boardLeadNumber(a) : undefined;
    const kids: string[] = [];
    if (leadField) {
      parts.push({ id: `${id}_lead`, component: 'Lead', stat: { path: `/board/agents/${a.id}/stats/${leadField}` } });
      kids.push(`${id}_lead`);
    }
    parts.push({ id: `${id}_tile`, component: 'AgentTile', agentId: a.id, chrome: 'bare' });
    kids.push(`${id}_tile`);
    const child = kids.length === 1 ? kids[0] : `${id}_col`;
    if (kids.length > 1) parts.push({ id: `${id}_col`, component: 'Column', children: kids });
    parts.push({ id, component: 'Panel', title: a === lead && treatment === 'feature' ? `More from ${a.title}` : a.title, child, treatment, when: boardFlag(a.id) });
    return id;
  };
  const storyIds = story.map((a) => tilePart(a, 'feature'));
  const railIds = rail.map((a) => tilePart(a, 'aside'));
  // A band of figures when two or more agents have a number that matters: at the end of the
  // rail when the story column is the longer one (so the rail doesn't end early), else full width.
  const withLead = rail.filter((a) => boardLeadNumber(a));
  const bandInRail = withLead.length >= 2 && storyIds.length > railIds.length;
  if (withLead.length >= 2) {
    parts.push(
      { id: 'band', component: 'Panel', title: 'By the numbers', child: 'band_stats', treatment: bandInRail ? 'aside' : 'band', when: boardFlag(withLead[0].id, 'numbers') },
      { id: 'band_stats', component: 'StatStrip', items: { path: '/board/statItems' } },
    );
    if (bandInRail) railIds.push('band');
  }
  if (storyIds.length && railIds.length) {
    parts.push(
      { id: 'top', component: 'Columns', children: ['story', 'rail'], widths: [2, 1], align: 'start' },
      { id: 'story', component: 'Column', children: storyIds },
      { id: 'rail', component: 'Column', children: railIds },
    );
    rootKids.push('top');
  } else if (storyIds.length || railIds.length) {
    const ids = storyIds.length ? storyIds : railIds;
    // Up to three abreast; the rest below.
    const abreast = ids.slice(0, Math.min(3, ids.length));
    if (abreast.length > 1) { parts.push({ id: 'top', component: 'Columns', children: abreast, widths: abreast.map(() => 1), align: 'start' }); rootKids.push('top'); }
    else rootKids.push(abreast[0]);
    rootKids.push(...ids.slice(abreast.length));
  }

  if (withLead.length >= 2 && !bandInRail) rootKids.push('band');
  return [{ id: 'root', component: 'Column', children: rootKids }, ...parts];
}

/** A plain grid of the same agents: one section, every tile framed (the `grid` preset). */
export function gridDoc(agents: readonly Pick<BoardAgentShape, 'id' | 'size'>[], title = 'Tiles'): ViewComponent[] {
  const kids: string[] = [];
  const parts: ViewComponent[] = [];
  agents.forEach((a, i) => {
    const tile = `tile_${i + 1}`;
    parts.push({ id: tile, component: 'AgentTile', agentId: a.id });
    if (a.size?.startsWith('2')) { parts.push({ id: `cell_${i + 1}`, component: 'Cell', child: tile, span: 2, ...(a.size === '2x2' ? { rows: 2 } : {}) }); kids.push(`cell_${i + 1}`); }
    else kids.push(tile);
  });
  return [
    { id: 'root', component: 'Column', children: ['section_1'] },
    { id: 'section_1', component: 'Section', title, child: 'grid_1' },
    { id: 'grid_1', component: 'Grid', children: kids },
    ...parts,
  ];
}

/**
 * How to draw a board's page, for sua: what it can bind to (this board's
 * agents and their fields spelled out), the `when` flags, the components,
 * and the rules a front page follows.
 */
export function boardLayoutGuide(
  components: ReadonlyArray<{ name: string; summary: string; example?: Record<string, unknown> }>,
  agents: readonly BoardAgentShape[],
  /** The board's day-by-day figures, when it has any: what leads and how many others (see BOARD_FIGURES_DATA). */
  figures?: { lead: string; others: readonly string[] },
): string {
  const line = (k: string, v: string) => `- ${k}: ${v}`;
  const figureLines = figures ? `\n\nThis board has figures that change from day to day (${[figures.lead, ...figures.others].join('; ')}):\n${Object.entries(BOARD_FIGURES_DATA).map(([k, v]) => line(k, v)).join('\n')}\n- Draw them as one band (a Panel, treatment band, titled "By the numbers"): a Lead with "stat": { "path": "/board/figures/lead" }, a DayBars with "days": { "path": "/board/figures/lead/days" } and a "title" saying what is counted, and for each of the ${String(figures.others.length)} others a Sparkline with "values": { "path": "/board/figures/others/<n>/values" } (n from 0), its "label" and "current" typed from the list above. These parts take no "when".` : '';
  const props = (c: { example?: Record<string, unknown> }) => {
    if (!c.example) return '';
    const { id: _id, component: _c, ...rest } = c.example;
    return ` Props, e.g. ${JSON.stringify(rest)}`;
  };
  const fields = agents.map((a) => `- ${a.id} ("${a.title}"${a.kind ? `, ${a.kind}` : ''}${a.ran ? '' : ', not run yet'}): ${a.outputs.length ? a.outputs.map((o) => `${o.name} (${o.type}${o.length !== undefined ? ` ${String(o.length)}` : ''})`).join(', ') : 'no fields seen yet (use its tile)'}`).join('\n');
  return `## A board's page (its document): an A2UI document
A flat list of components; \`root\` is the top; children/child name other ids. Each prop is a literal or { "path": "/board/..." }.

Data (bind with { "path": ... }):
${Object.entries(BOARD_LAYOUT_DATA).map(([k, v]) => line(k, v)).join('\n')}

This board's agents and the fields their latest results have (bind only to these; <field> is one of them):
${fields || '- none'}${figureLines}

"when" on any component draws it only when the board has it ("!flag" for not):
${Object.entries(BOARD_LAYOUT_FLAGS).map(([k, v]) => line(k, v)).join('\n')}

Components: Text (text, variant: h3 / body / caption), Row, Column, Card (child), Tabs (tabs: [{ title, child }]), Divider, Image (url), plus sua's and the board's:
${components.map((c) => line(c.name, c.summary.split(/(?<=[.!?])\s/)[0] + props(c))).join('\n')}

Rules:
- Draw it like a front page, not a grid of equal boxes. One masthead leads (a Panel with "hero": true and treatment feature, titled { "path": "/board/name" } with the date as its note), then one lede (treatment lede: the lead story as a Callout bound to an agent's headline field, its summary as "next"), then a story column beside a rail (Columns widths [2, 1], align start): the story holds feature Panels, the rail aside Panels. A band (treatment band) is a full-width strip of figures (a StatStrip of /board/statItems). Plain (framed) Panels are for tools, at most 3.
- Say it with the agent's own fields when they carry the point: a Callout for a headline and its summary, a Lead for the one number that matters (/board/agents/<id>/stats/<field>), a Table for a list field (rows: its path, columns by the list's keys), a StatStrip for several numbers. Where an agent's own view is the story (scores, a digest, a chart), place its AgentTile with "chrome": "bare" inside a Panel that titles it.
- Every part of one agent goes in a Panel with "when": "<agentId>", so it's drawn once the agent has run; a Lead or StatStrip gets "when": "numbers:<agentId>".
- Rows are full width or Columns of 2:1, 1:2, 3:2, 2:3, 1:1 or 1:1:1, and two rows in a row never share a shape. Never put a short part (a callout, a lead) beside a long one (a table, a tile with a list): it leaves a hole. Lists are cut to a few rows (Table 8–12).
- Bind to paths; never type a value from today's results into the layout: it is redrawn as the agents run. Use each component's props exactly as named above; a prop it doesn't have fails the whole page. "when" takes only the flags above.
- Keep every id unique (short word characters), at most about 60 components.`;
}

/** Whether a data value has something to show (for tests and callers that shape board data). */
export { hasSomething as boardValueHasSomething };
