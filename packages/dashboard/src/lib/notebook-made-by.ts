/**
 * What made a notebook, in a line for its page (the made-by strip under its
 * steps) and for How it was made: how many runs, by which agents, when last,
 * and each step's latest pass. A pass that didn't record its step (one from
 * before passes kept it) is matched to the one step its agent does.
 */
import type { LineagePass, Notebook, NotebookLineage } from '@some-useful-agents/core';
import { suaStepAgent, suaStepAgentName } from './notebook-step-agents.js';

export interface NotebookMadeBy {
  runs: number;
  /** Who made it, by name ("sua’s finder", "Firmographic research"), most runs first. */
  agents: string[];
  /** When its last run started (ISO). */
  lastAt?: string;
  /** Each step's latest pass, by step id. */
  stepPass: Record<string, string>;
}

/** The step a pass ran for: the one it recorded, else the one step its agent does. Pure. */
export function passStep(nb: Pick<Notebook, 'steps'>, p: Pick<LineagePass, 'stepId' | 'feeders'>): string | undefined {
  const steps = nb.steps ?? [];
  if (p.stepId) return steps.some((s) => s.id === p.stepId) ? p.stepId : undefined;
  const agent = p.feeders[0]?.run.agentId;
  if (!agent) return undefined;
  const doing = steps.filter((s) => (s.agentId ?? suaStepAgent(s.kind)) === agent);
  return doing.length === 1 ? doing[0].id : undefined;
}

/** The made-by summary from a notebook's lineage. `nameOf` gives an agent's name. Pure. */
export function notebookMadeBy(nb: Pick<Notebook, 'steps'>, lineage: Pick<NotebookLineage, 'passes'>, nameOf: (agentId: string) => string | undefined = () => undefined): NotebookMadeBy {
  const count = new Map<string, number>();
  let runs = 0;
  let lastAt: string | undefined;
  const stepPass: Record<string, string> = {};
  for (const p of lineage.passes) {
    for (const f of p.feeders) {
      for (const r of [f.run, ...f.subRuns]) {
        runs++;
        count.set(r.agentId, (count.get(r.agentId) ?? 0) + 1);
        if (!lastAt || r.startedAt > lastAt) lastAt = r.startedAt;
      }
    }
    // Passes come newest first: the first one seen for a step is its latest.
    const step = passStep(nb, p);
    if (step && !stepPass[step]) stepPass[step] = p.id;
  }
  // sua's own step agents by their role ("sua’s finder"); the rest by name.
  const sua = new Map((['find', 'check', 'profile', 'write'] as const).map((k) => [suaStepAgent(k)!, suaStepAgentName(k)!]));
  const agents = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => sua.get(id) ?? nameOf(id) ?? id);
  return { runs, agents: [...new Set(agents)], ...(lastAt ? { lastAt } : {}), stepPass };
}
