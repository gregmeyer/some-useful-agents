/**
 * Who is in Today's edition and how fresh each part is, from the stores'
 * data alone (pure): shared by the dashboard's edition and the MCP
 * `edition-read` / `edition-apply` tools (ADR-0074, ADR-0076, ADR-0099).
 */
import { SYSTEM_AGENT_IDS } from './items/system-agents.js';
import type { Agent } from './agent-v2-types.js';
import type { Run } from './types.js';
import { describeEditionOp, type EditionPrefs } from './edition-prefs.js';

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


/** One agent as the edition sees it: whether it's in today's edition, how fresh, and why. */
export interface EditionAgentFact {
  id: string;
  title: string;
  /** In today's edition now. */
  showing: boolean;
  /** Hours since its last result (none: it has never finished a run). */
  ageHours?: number;
  /** Its newest run failed after that result. */
  failed: boolean;
  /** Why it's in (or could be): it runs on a schedule, or you always show it. */
  why?: 'scheduled' | 'always shown';
  /** You left it out. */
  leftOut: boolean;
}

/**
 * The edition's agents with how fresh each is: those in it now, then the
 * others that could be (active, not sua's own, with a tile and a result).
 * `hasTile`: whether an agent can be drawn (a signal or a view). Pure.
 */
export function editionFacts<A extends Pick<Agent, 'id' | 'name' | 'status' | 'schedule'>>(agents: readonly A[], hasTile: (a: A) => boolean, latestOk: (id: string) => Pick<Run, 'startedAt' | 'completedAt'> | undefined, latestAny: (id: string) => Pick<Run, 'status' | 'startedAt' | 'completedAt'> | undefined, prefs: EditionPrefs, now = Date.now()): EditionAgentFact[] {
  const usable = agents.filter((a) => a.status === 'active' && !SYSTEM_AGENT_IDS.has(a.id) && hasTile(a));
  const inIt = new Set(editionAgents(usable, latestOk, now, prefs.lead, prefs).map((a) => a.id));
  const out: EditionAgentFact[] = [];
  for (const a of usable) {
    const ok = latestOk(a.id);
    const at = ok ? ok.completedAt ?? ok.startedAt : undefined;
    const newest = latestAny(a.id);
    const newestAt = newest ? newest.completedAt ?? newest.startedAt : undefined;
    if (!at && !inIt.has(a.id)) continue;
    out.push({
      id: a.id, title: a.name || a.id, showing: inIt.has(a.id),
      ...(at ? { ageHours: Math.max(0, Math.round((now - Date.parse(at)) / 360_000) / 10) } : {}),
      failed: !!(newest && newest.status === 'failed' && newestAt && (!at || newestAt > at)),
      ...(prefs.include.includes(a.id) ? { why: 'always shown' as const } : a.schedule ? { why: 'scheduled' as const } : {}),
      leftOut: prefs.hidden.includes(a.id),
    });
  }
  return out.sort((x, y) => Number(y.showing) - Number(x.showing) || (x.ageHours ?? 1e9) - (y.ageHours ?? 1e9));
}

/** The edition's preferences in plain lines ("Leads with Markets"), for a reader. Pure. */
export function editionPrefsLines(p: EditionPrefs, title: (id: string) => string): string[] {
  const out: string[] = [];
  if (p.lead) out.push(describeEditionOp({ op: 'lead', agentId: p.lead }, title));
  for (const id of p.include) out.push(describeEditionOp({ op: 'include', agentId: id }, title));
  for (const id of p.hidden) out.push(describeEditionOp({ op: 'hide', agentId: id }, title));
  for (const id of p.wide) out.push(describeEditionOp({ op: 'width', agentId: id, width: 'wide' }, title));
  for (const id of p.narrow) out.push(describeEditionOp({ op: 'width', agentId: id, width: 'narrow' }, title));
  if (p.numbers === false) out.push(describeEditionOp({ op: 'numbers', on: false }, title));
  if (p.topStory) out.push(describeEditionOp({ op: 'top-story', agentId: p.topStory }, title));
  if (p.note) out.push(describeEditionOp({ op: 'note', text: p.note }, title));
  return out;
}
