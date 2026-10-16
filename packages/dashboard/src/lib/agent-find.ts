/**
 * "What do you want to do?" on /agents: the question goes to sua's agent
 * finder (`agent-catalog-search`, the same one sua runs in a conversation),
 * in the background, while the page shows the keyword matches it already
 * has. The page polls for the answer: sua's recommendation and up to three
 * picks, each with why it fits. Answers are kept for an hour per question,
 * so Back or a reload doesn't ask again.
 */
import { randomUUID } from 'node:crypto';
import { executeAgentDag, extractTaggedJson } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { buildAgentCatalogJson } from '../routes/inbox-catalog.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';

type Ctx = ReturnType<typeof getContext>;

export const AGENT_FINDER_ID = 'agent-catalog-search';
const KEEP_MS = 60 * 60 * 1000;
/** Picks scored below this aren't offered (the finder's own floor). */
const MIN_SCORE = 0.3;

export interface AgentPick { agentId: string; why: string; score: number }
export interface AgentFind {
  id: string;
  question: string;
  at: number;
  status: 'working' | 'ready' | 'failed';
  recommendation?: string;
  picks?: AgentPick[];
}

/** The finder's <matches>, cleaned: installed agents only, best first, at most three. Pure. */
export function parseMatches(raw: string, installed: ReadonlySet<string>): { recommendation: string; picks: AgentPick[] } | undefined {
  const block = extractTaggedJson(raw, 'matches');
  if (!block) return undefined;
  let v: Record<string, unknown>;
  try { v = JSON.parse(block) as Record<string, unknown>; } catch { return undefined; }
  const recommendation = typeof v.recommendation === 'string' ? sentences(v.recommendation, 480) : '';
  const picks: AgentPick[] = [];
  for (const m of Array.isArray(v.matches) ? v.matches as Array<Record<string, unknown>> : []) {
    const agentId = typeof m?.agentId === 'string' ? m.agentId : '';
    const score = typeof m.score === 'number' ? m.score : Number(m.score);
    if (!installed.has(agentId) || !Number.isFinite(score) || score < MIN_SCORE || picks.some((p) => p.agentId === agentId)) continue;
    const why = typeof m.why === 'string' ? m.why.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
    picks.push({ agentId, why, score });
  }
  picks.sort((a, b) => b.score - a.score);
  return { recommendation, picks: picks.slice(0, 3) };
}

/** Whole sentences, up to `max` characters (a long answer isn't cut mid-word). Pure. */
export function sentences(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > 40 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

const key = (q: string) => `q:${q.toLowerCase().replace(/\s+/g, ' ').trim()}`;

function finds(ctx: Ctx): Map<string, AgentFind> {
  ctx.agentFinds ??= new Map();
  const now = Date.now();
  for (const [k, f] of ctx.agentFinds) if (now - f.at > KEEP_MS) ctx.agentFinds.delete(k);
  return ctx.agentFinds;
}

export function readAgentFind(ctx: Ctx, id: string): AgentFind | undefined {
  return finds(ctx).get(id);
}

/**
 * Ask the finder which agents do `question`. The same question asked within
 * the hour gets the answer already found (or being found); a failed one is
 * asked again. Undefined when the finder isn't installed (or is archived).
 */
export function startAgentFind(ctx: Ctx, question: string): AgentFind | undefined {
  const all = finds(ctx);
  const k = key(question);
  const known = all.get(k);
  if (known && known.status !== 'failed') return known;
  const fake = ctx.agentFindRun;
  // Only when it's installed (sua's conversations use it too); it isn't added from here.
  const agent = fake ? undefined : ctx.agentStore.getAgent(AGENT_FINDER_ID);
  if (!fake && (!agent || agent.status === 'archived')) return undefined;
  const find: AgentFind = { id: randomUUID(), question, at: Date.now(), status: 'working' };
  all.set(k, find);
  all.set(find.id, find);
  const inputs = { QUERY: question, AGENT_CATALOG: buildAgentCatalogJson(ctx) };
  const runId = randomUUID();
  const ac = new AbortController();
  ctx.activeRuns.set(runId, ac);
  void (async () => {
    let result: string | undefined;
    try {
      if (fake) result = await fake(inputs);
      else {
        // No onRunFailure: a search that didn't work shouldn't open an inbox thread.
        await executeAgentDag(agent!, { triggeredBy: 'dashboard', runId, signal: ac.signal, inputs }, {
          runStore: ctx.runStore, secretsStore: ctx.secretsStore, variablesStore: ctx.variablesStore,
          dataRoot: ctx.agentStore.dataRoot, llmSettings: buildLlmSettingsSnapshot(ctx), spawnNode: ctx.workflowSpawnNode,
        });
        const run = ctx.runStore.getRun(runId);
        result = run?.status === 'completed' ? run.result ?? undefined : undefined;
      }
    } catch { result = undefined; }
    const installed = new Set(ctx.agentStore.listAgents().filter((a) => a.status !== 'archived').map((a) => a.id));
    const parsed = result ? parseMatches(result, installed) : undefined;
    if (parsed) Object.assign(find, { status: 'ready', ...parsed });
    else find.status = 'failed';
    ctx.activeRuns.delete(runId);
  })();
  return find;
}
