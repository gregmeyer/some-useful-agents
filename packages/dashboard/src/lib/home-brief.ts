/**
 * Home's brief: what your scheduled agents found today, as numbers. The
 * figure that leads (a count that changes from day to day, like matches
 * found) is set large under a headline in that agent's own words; a few
 * others stand beside it with their week; and the top thing a list agent
 * found is named. Pure (`figuresOf`, `pickBrief`) with a reader
 * (`homeBrief`). Nothing here is written by a model: every number is in an
 * agent's output, and a number that never changes isn't news.
 */
import { SYSTEM_AGENT_IDS, type Agent, type Run } from '@some-useful-agents/core';
import { runOutputObject } from './daily-digest.js';
import { readLine } from './home-reads.js';
import type { getContext } from '../context.js';

type Ctx = ReturnType<typeof getContext>;

export interface BriefFigure {
  agentId: string; agent: string; runId: string;
  key: string;
  /** What the number counts or measures, in a word or two ("matches", "NASDAQ"). */
  label: string;
  kind: 'count' | 'percent';
  value: number;
  /** As shown: "6", "-1.46%". */
  text: string;
  /** Its value on each of the last days it ran, oldest first, today last. */
  days: Array<{ day: string; value: number }>;
}

export interface HomeBrief {
  /** The lead agent's own first sentence. */
  headline: string;
  lead: BriefFigure;
  figures: BriefFigure[];
  /** The first thing a list agent found, when it links somewhere. */
  top?: { title: string; url: string; agent: string };
  agents: number;
  /** When the newest of them finished. */
  at: string;
}

const DAY = 86_400_000;
/** Not something that happened: a position, a setting, a duration. */
const NOT_NEWS = /(^|_)(index|id|idx|page|limit|max|min|minutes|seconds|hours|days|year|version|port|size|width|height)$/i;
const PERCENT = /(^|_)(pct|percent|percentage)$/i;

function words(key: string): string {
  return key.replace(/_/g, ' ').trim();
}

/** What a number is called: the list it counts ("matches"), else its key without the suffix ("NASDAQ" for nasdaq_change_pct). */
export function figureLabel(key: string, value: number, obj: Record<string, unknown>): string {
  if (PERCENT.test(key)) {
    const base = key.replace(/_?(change_)?(pct|percent|percentage)$/i, '');
    const w = words(base) || 'change';
    return w.length <= 6 ? w.toUpperCase() : w;
  }
  const list = Object.entries(obj).find(([k, v]) => Array.isArray(v) && v.length === value && value > 0 && !/^sources?$/i.test(k));
  if (list) return words(list[0]);
  const base = key.replace(/_?(count|total|num|number)$/i, '');
  return words(base) || 'items';
}

function show(kind: BriefFigure['kind'], value: number): string {
  if (kind === 'percent') return `${value > 0 ? '+' : ''}${String(Math.round(value * 100) / 100)}%`;
  return Number.isInteger(value) ? value.toLocaleString('en-US') : String(Math.round(value * 100) / 100);
}

/** The top-level numbers in an output that could be news (not flags, positions or settings). Pure. */
export function numbersOf(obj: Record<string, unknown>): Array<{ key: string; value: number; kind: BriefFigure['kind'] }> {
  const out: Array<{ key: string; value: number; kind: BriefFigure['kind'] }> = [];
  for (const [key, v] of Object.entries(obj)) {
    if (typeof v !== 'number' || !Number.isFinite(v) || NOT_NEWS.test(key)) continue;
    out.push({ key, value: v, kind: PERCENT.test(key) ? 'percent' : 'count' });
  }
  return out;
}

type RunLike = Pick<Run, 'id' | 'startedAt' | 'completedAt' | 'result'>;

/**
 * An agent's figures from its recent runs (newest first): each number in
 * its latest output, with its value on each day it ran (the day's last
 * run). A number that has been the same every day isn't a figure: it's how
 * the agent is set up ("5 stories"), not what it found. Pure.
 */
export function figuresOf(agent: Pick<Agent, 'id' | 'name'>, runs: readonly RunLike[], maxDays = 7): BriefFigure[] {
  const latest = runs[0];
  const obj = latest ? runOutputObject(latest.result).obj : undefined;
  if (!latest || !obj) return [];
  // One run per day, the latest that day; oldest first.
  const perDay = new Map<string, Record<string, unknown>>();
  for (const r of runs) {
    const day = (r.completedAt ?? r.startedAt).slice(0, 10);
    if (perDay.has(day)) continue;
    const o = runOutputObject(r.result).obj;
    if (o) perDay.set(day, o);
  }
  const days = [...perDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-maxDays);
  const out: BriefFigure[] = [];
  for (const n of numbersOf(obj)) {
    const series = days.map(([day, o]) => ({ day, value: o[n.key] })).filter((d): d is { day: string; value: number } => typeof d.value === 'number' && Number.isFinite(d.value));
    if (series.length < 3 || series.every((d) => d.value === series[0].value)) continue;
    out.push({ agentId: agent.id, agent: agent.name, runId: latest.id, key: n.key, label: figureLabel(n.key, n.value, obj), kind: n.kind, value: n.value, text: show(n.kind, n.value), days: series });
  }
  return out;
}

/** The first sentence of a line ("Six roles passed all checks on 2026-11-11, out of about 45 read."). */
export function firstSentence(line: string): string {
  const m = /^(.{20,}?[.!?])(\s|$)/.exec(line);
  return (m ? m[1] : line).replace(/[.]$/, '');
}

/** The first thing in a list an output links to (a story, a posting). */
export function topOf(obj: Record<string, unknown>): { title: string; url: string } | undefined {
  for (const v of Object.values(obj)) {
    if (!Array.isArray(v) || !v.length) continue;
    const one = v[0] as Record<string, unknown> | null;
    if (!one || typeof one !== 'object') continue;
    const title = typeof one.title === 'string' ? one.title.replace(/\s+/g, ' ').trim() : '';
    const url = typeof one.url === 'string' ? one.url.trim() : '';
    if (title && /^https?:\/\//i.test(url)) return { title, url };
  }
  return undefined;
}

export const BRIEF_FIGURES = 3;

/**
 * The brief from each scheduled agent's recent runs (newest first), or
 * nothing when no agent has a count that changes. The lead is the largest
 * count found today; beside it, up to three other figures (one agent's
 * percentages together, then other counts); the top story is from a list
 * agent that isn't the lead. Pure.
 */
export function pickBrief(agents: ReadonlyArray<{ agent: Pick<Agent, 'id' | 'name' | 'status' | 'schedule'>; runs: readonly RunLike[] }>, now = Date.now()): HomeBrief | undefined {
  const fresh = agents.filter(({ agent, runs }) => agent.status === 'active' && !!agent.schedule && !SYSTEM_AGENT_IDS.has(agent.id)
    && !!runs[0] && now - Date.parse(runs[0].completedAt ?? runs[0].startedAt) <= DAY);
  const all = fresh.flatMap(({ agent, runs }) => figuresOf(agent, runs));
  const lead = all.filter((f) => f.kind === 'count' && f.value > 0).sort((a, b) => b.value - a.value)[0];
  if (!lead) return undefined;
  const leadRun = fresh.find((x) => x.agent.id === lead.agentId)!.runs[0];
  const headline = firstSentence(readLine(leadRun.result, 400) ?? `${lead.text} ${lead.label}`);
  const rest = all.filter((f) => f !== lead && f.agentId !== lead.agentId);
  const figures = [...rest.filter((f) => f.kind === 'percent'), ...rest.filter((f) => f.kind === 'count' && f.value > 0)].slice(0, BRIEF_FIGURES);
  const used = new Set([lead.agentId, ...figures.map((f) => f.agentId)]);
  let top: HomeBrief['top'];
  for (const { agent, runs } of fresh) {
    if (used.has(agent.id)) continue;
    const obj = runOutputObject(runs[0].result).obj;
    const t = obj ? topOf(obj) : undefined;
    if (t) { top = { ...t, agent: agent.name }; break; }
  }
  const at = fresh.map((x) => x.runs[0].completedAt ?? x.runs[0].startedAt).sort().pop()!;
  return { headline, lead, figures, ...(top ? { top } : {}), agents: fresh.length, at };
}

/** Home's brief, from the stores. Never throws. */
export function homeBrief(ctx: Ctx, now = Date.now()): HomeBrief | undefined {
  try {
    const agents = ctx.agentStore.listAgents({ status: 'active' }).filter((a) => !!a.schedule && !SYSTEM_AGENT_IDS.has(a.id));
    return pickBrief(agents.map((agent) => ({ agent, runs: ctx.runStore.listRuns({ agentName: agent.id, status: 'completed', limit: 12 }) })), now);
  } catch {
    return undefined;
  }
}
