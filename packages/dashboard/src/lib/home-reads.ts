/**
 * Home's "Today's reads": what your scheduled agents produced in the last
 * day, a line each, newest first. Pure (`pickReads`) with a reader
 * (`homeReads`). The agents you read every morning, without opening Pulse.
 */
import { SYSTEM_AGENT_IDS, type Agent, type Run } from '@some-useful-agents/core';
import { runOutputObject, summarizeRunOutput } from './daily-digest.js';
import type { getContext } from '../context.js';

type Ctx = ReturnType<typeof getContext>;

export interface HomeRead { agentId: string; name: string; runId: string; at: string; line: string }

export const READS_SHOWN = 6;
const DAY = 86_400_000;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.replace(/\s+/g, ' ').trim() ? v.replace(/\s+/g, ' ').trim() : undefined);
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
/** What a thing in a list is called. */
const ITEM_NAME = ['title', 'headline', 'name', 'label'];
/** What an output says about itself, after its headline. */
const DETAIL = ['summary', 'description', 'bio', 'message', 'text'];

/** The first list of things with names in an output ("stories", "articles", "items"): its first name and how many there are. */
function firstList(obj: Record<string, unknown>): { first: string; count: number } | undefined {
  for (const v of Object.values(obj)) {
    if (!Array.isArray(v) || !v.length) continue;
    const one = v[0] as Record<string, unknown> | null;
    if (!one || typeof one !== 'object') continue;
    const first = ITEM_NAME.map((k) => str(one[k])).find(Boolean);
    if (first) return { first, count: v.length };
  }
  return undefined;
}

/**
 * What an agent's output says, in one line worth reading on Home. An output
 * is often a JSON object made for a tile, where the headline is a label
 * ("Markets", "HN Top 5") and the news is beside it. So:
 * - a short headline is followed by what it's about: its summary, else the
 *   first thing in its list and how many more ("HN Top 5: <story>, and 4 more");
 * - a longer headline, or a summary with no headline, stands alone;
 * - with neither, what it names ("hero_name") with its description, or
 *   the first thing in its list;
 * - anything else as the daily digest sums it up. Pure.
 */
export function readLine(result: string | undefined | null, cap = 150): string | undefined {
  if (!result) return undefined;
  const { obj } = runOutputObject(result);
  if (!obj) return summarizeRunOutput(result, cap);
  const headline = str(obj.headline) ?? str(obj.title);
  const detail = DETAIL.map((k) => str(obj[k])).find(Boolean);
  const list = firstList(obj);
  const listed = list ? `${list.first.replace(/[.;,]+$/, '')}${list.count > 1 ? `, and ${String(list.count - 1)} more` : ''}` : undefined;
  if (headline) {
    // A label, not news: say what it's about.
    if (words(headline) <= 3 && (detail ?? listed)) return clip(`${headline}: ${detail ?? listed!}`, cap);
    return clip(headline, cap);
  }
  // What it names ("hero_name") leads what it says about it.
  const named = Object.entries(obj).find(([k, v]) => /(^|_)name$/i.test(k) && !!str(v));
  if (named) {
    const about = detail ?? str(Object.entries(obj).find(([k, v]) => k !== named[0] && /about|tagline|quote/i.test(k) && !!str(v))?.[1]);
    return clip(about ? `${str(named[1])!}: ${about}` : str(named[1])!, cap);
  }
  if (detail) return clip(detail, cap);
  if (listed) return clip(listed, cap);
  return summarizeRunOutput(result, cap);
}

/** One line per scheduled agent whose latest finished run is from the last 24 hours and says something. Pure. */
export function pickReads(agents: readonly Agent[], latest: (agentId: string) => Pick<Run, 'id' | 'startedAt' | 'completedAt' | 'result'> | undefined, now = Date.now(), max = READS_SHOWN): HomeRead[] {
  const out: HomeRead[] = [];
  for (const a of agents) {
    if (a.status !== 'active' || !a.schedule || SYSTEM_AGENT_IDS.has(a.id)) continue;
    const run = latest(a.id);
    const at = run?.completedAt ?? run?.startedAt;
    if (!run || !at || now - Date.parse(at) > DAY) continue;
    const line = readLine(run.result);
    if (!line) continue;
    out.push({ agentId: a.id, name: a.name, runId: run.id, at, line });
  }
  return out.sort((x, y) => y.at.localeCompare(x.at)).slice(0, max);
}

/** Today's reads, from the stores. Never throws. */
export function homeReads(ctx: Ctx, now = Date.now()): HomeRead[] {
  try {
    return pickReads(ctx.agentStore.listAgents({ status: 'active' }), (id) => ctx.runStore.listRuns({ agentName: id, status: 'completed', limit: 1 })[0], now);
  } catch {
    return [];
  }
}
