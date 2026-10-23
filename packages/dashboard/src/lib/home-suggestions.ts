/**
 * Home's Try next: agents you can run in one click, and questions to ask sua, picked from
 * what you use and what happened today. Pure (`pickSuggestions`) with a reader (`homeSuggestions`).
 */
import { SYSTEM_AGENT_IDS, type Agent } from '@some-useful-agents/core';
import { agentShelves, DEMO_RE } from '../routes/agents/list.js';
import { cachedNotebookSuggestions } from './notebook-suggestions.js';
import { perItemInputs } from './notebook-pipeline.js';
import type { getContext } from '../context.js';

type Ctx = ReturnType<typeof getContext>;

export interface SuggestedAgent { id: string; name: string; description: string; lastRunAt?: string }
export interface SuggestedAsk { label: string; text: string }
export interface HomeSuggestions { agents: SuggestedAgent[]; asks: SuggestedAsk[] }

/** An input it can't run without: required (the resolver's default) and no default. */
export function needsInputs(agent: Pick<Agent, 'inputs'>): boolean {
  return Object.values(agent.inputs ?? {}).some((spec) => spec.default === undefined && spec.required !== false);
}

/**
 * Worth one click: every input already has a real value. An empty default ("" for a page to read,
 * a list to research) runs but does nothing useful, and a page reader is a helper for notebooks.
 */
export function runsAsIs(agent: Pick<Agent, 'inputs'>): boolean {
  if (perItemInputs(agent)) return false;
  return Object.values(agent.inputs ?? {}).every((spec) => spec.default !== undefined && String(spec.default).trim() !== '' && String(spec.default).trim() !== '[]');
}

export function pickSuggestions(d: {
  agents: readonly Agent[];
  lastRunAt: ReadonlyMap<string, string>;
  runCounts: ReadonlyMap<string, number>;
  notebookIdeas: ReadonlyArray<{ label: string; text: string }>;
  failedToday: number;
  ranToday: number;
  now?: number;
}): HomeSuggestions {
  const now = d.now ?? Date.now();
  const dayAgo = new Date(now - 86_400_000).toISOString();
  const weekAgo = new Date(now - 7 * 86_400_000).toISOString();
  const runnable = d.agents.filter((a) => a.status === 'active' && !SYSTEM_AGENT_IDS.has(a.id) && runsAsIs(a)
    && !(DEMO_RE.test(a.id) || DEMO_RE.test(a.name)));
  const shelves = agentShelves(runnable, { lastRunAt: d.lastRunAt, runCounts: d.runCounts, feeds: new Map(), weekAgo });
  const ranRecently = (a: Agent) => (d.lastRunAt.get(a.id) ?? '') >= dayAgo;
  const order = [
    ...shelves.goTo.filter((a) => !ranRecently(a)),
    ...shelves.recent.filter((a) => !ranRecently(a)),
    ...runnable.filter((a) => !d.lastRunAt.has(a.id) && a.description?.trim()),
    ...shelves.goTo, ...shelves.recent,
  ];
  const seen = new Set<string>();
  const agents: SuggestedAgent[] = [];
  for (const a of order) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    agents.push({ id: a.id, name: a.name, description: (a.description ?? '').trim(), ...(d.lastRunAt.get(a.id) ? { lastRunAt: d.lastRunAt.get(a.id) } : {}) });
    if (agents.length === 3) break;
  }

  const asks: SuggestedAsk[] = [];
  for (const idea of d.notebookIdeas.slice(0, 2)) asks.push({ label: `Start a notebook: ${idea.label}`, text: idea.text });
  if (d.failedToday > 0) asks.push({ label: 'What failed today?', text: 'What failed today, and what should I do about it?' });
  if (d.ranToday > 0) asks.push({ label: 'What did my agents do today?', text: 'What did my agents do today? Anything worth a look?' });
  // Only one you run often by hand: a starred one you rarely run isn't asking for a schedule.
  const unscheduled = shelves.goTo.find((a) => !a.schedule && (d.runCounts.get(a.id) ?? 0) >= 3);
  if (unscheduled) asks.push({ label: `Put ${unscheduled.name} on a schedule`, text: `Put ${unscheduled.name} (${unscheduled.id}) on a schedule that suits what it does.` });
  if (asks.length < 2) asks.push({ label: 'What can sua do for me?', text: 'What can you do for me with the agents I have? Suggest a few things to try.' });
  if (asks.length < 3) asks.push({ label: 'Build me an agent that checks something every morning', text: 'Build me an agent that checks something useful every morning. Ask me what to check.' });
  return { agents, asks: asks.slice(0, 4) };
}

/** Try next for Home, from the stores (cheap: two GROUP BYs, two counts, a cached file). */
export function homeSuggestions(ctx: Ctx, now = Date.now()): HomeSuggestions {
  try {
    const dayAgo = new Date(now - 86_400_000).toISOString();
    return pickSuggestions({
      agents: ctx.agentStore.listAgents(),
      lastRunAt: ctx.runStore.latestRunAtByAgent(),
      runCounts: ctx.runStore.runCountsByAgent(new Date(now - 30 * 86_400_000).toISOString()),
      notebookIdeas: cachedNotebookSuggestions(ctx),
      failedToday: ctx.runStore.queryRuns({ statuses: ['failed'], since: dayAgo, limit: 1 }).total,
      ranToday: ctx.runStore.queryRuns({ since: dayAgo, limit: 1 }).total,
      now,
    });
  } catch {
    return { agents: [], asks: [] };
  }
}
