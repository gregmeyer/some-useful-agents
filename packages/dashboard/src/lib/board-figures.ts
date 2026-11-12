/**
 * A board's figures (core BOARD_FIGURES_DATA): numbers in its agents'
 * results that change from day to day. The largest count found in the
 * latest results leads, with its last days; up to three others follow
 * (percentages first), each with its values by day. Read from the agents'
 * own outputs (lib/home-brief.ts `figuresOf`); nothing is written by a model.
 */
import type { Agent } from '@some-useful-agents/core';
import { figuresOf, type BriefFigure } from './home-brief.js';
import type { BoardFigures } from './board-widgets.js';
import type { getContext } from '../context.js';

type Ctx = ReturnType<typeof getContext>;

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayLabel = (iso: string): string => WEEKDAY[new Date(`${iso}T12:00:00Z`).getUTCDay()] ?? iso;
const said = (f: BriefFigure, v: number): string => (f.kind === 'percent' ? `${v > 0 ? '+' : ''}${String(Math.round(v * 100) / 100)}%` : String(Math.round(v * 100) / 100));

export const BOARD_FIGURES_OTHERS = 3;

/** The figures as the page's data, from every figure the board's agents have. The lead's last day reads "Today" only when it is today. Pure. */
export function boardFiguresFrom(all: readonly BriefFigure[], today = new Date().toISOString().slice(0, 10)): BoardFigures | undefined {
  const lead = all.filter((f) => f.kind === 'count' && f.value > 0).sort((a, b) => b.value - a.value)[0];
  if (!lead || lead.days.length < 3) return undefined;
  const rest = all.filter((f) => f !== lead);
  const others = [...rest.filter((f) => f.kind === 'percent'), ...rest.filter((f) => f.kind === 'count')].slice(0, BOARD_FIGURES_OTHERS);
  const href = (f: BriefFigure) => `/runs/${encodeURIComponent(f.runId)}`;
  return {
    lead: {
      value: lead.text, label: lead.label, note: lead.agent, href: href(lead),
      days: lead.days.map((d, i) => ({ label: i === lead.days.length - 1 && d.day === today ? 'Today' : dayLabel(d.day), value: d.value, text: said(lead, d.value) })),
    },
    others: others.map((f) => ({ value: f.text, label: f.label, note: f.agent, href: href(f), values: f.days.map((d) => d.value) })),
  };
}

/** Each of these agents' figures, from its recent finished runs. */
export function agentFigures(ctx: Ctx, agents: readonly Pick<Agent, 'id' | 'name'>[]): BriefFigure[] {
  return agents.flatMap((a) => {
    try { return figuresOf(a, ctx.runStore.listRuns({ agentName: a.id, status: 'completed', limit: 12 })); } catch { return []; }
  });
}

/** The figures of the agents on a board, or undefined when none has a count that changes by day. */
export function boardFigures(ctx: Ctx, agentIds: readonly string[]): BoardFigures | undefined {
  const agents = agentIds.map((id) => ctx.agentStore.getAgent(id)).filter((a): a is Agent => !!a);
  return boardFiguresFrom(agentFigures(ctx, agents));
}

/** The figures in a line each, for sua ("6 matches (Job Digest), by day"). */
export function figuresInWords(f: BoardFigures): { lead: string; others: string[] } {
  return { lead: `${f.lead.value} ${f.lead.label} (${f.lead.note}), ${String(f.lead.days.length)} days`, others: f.others.map((o) => `${o.value} ${o.label} (${o.note})`) };
}
