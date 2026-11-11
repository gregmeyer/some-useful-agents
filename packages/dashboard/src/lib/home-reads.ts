/**
 * Home's "Today's reads": what your scheduled agents produced in the last
 * day, a line each, newest first. Pure (`pickReads`) with a reader
 * (`homeReads`). The agents you read every morning, without opening Pulse.
 */
import { SYSTEM_AGENT_IDS, type Agent, type Run } from '@some-useful-agents/core';
import { summarizeRunOutput } from './daily-digest.js';
import type { getContext } from '../context.js';

type Ctx = ReturnType<typeof getContext>;

export interface HomeRead { agentId: string; name: string; runId: string; at: string; line: string }

export const READS_SHOWN = 6;
const DAY = 86_400_000;

/** One line per scheduled agent whose latest finished run is from the last 24 hours and says something. Pure. */
export function pickReads(agents: readonly Agent[], latest: (agentId: string) => Pick<Run, 'id' | 'startedAt' | 'completedAt' | 'result'> | undefined, now = Date.now(), max = READS_SHOWN): HomeRead[] {
  const out: HomeRead[] = [];
  for (const a of agents) {
    if (a.status !== 'active' || !a.schedule || SYSTEM_AGENT_IDS.has(a.id)) continue;
    const run = latest(a.id);
    const at = run?.completedAt ?? run?.startedAt;
    if (!run || !at || now - Date.parse(at) > DAY) continue;
    const line = summarizeRunOutput(run.result, 140);
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
