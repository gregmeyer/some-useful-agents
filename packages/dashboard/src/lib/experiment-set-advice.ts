/**
 * sua reads an experiment's question (ADR-0078): the `experiment-set-advisor`
 * agent says which facts the rankings will turn on and which notebook suits,
 * and code checks that against the sets (lib/experiment-set.ts). It runs in
 * the background while the person looks at the counted ranking, which
 * stands whether or not a reading arrives. Readings are kept in memory by
 * what was asked, so going back and forth between steps asks once.
 */
import { createHash, randomUUID } from 'node:crypto';
import { executeAgentDag } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';
import { parseSetAdvice, setAdviceInputs, type SetAdvice, type SetCandidate } from './experiment-set.js';

type Ctx = ReturnType<typeof getContext>;

export const EXPERIMENT_SET_ADVISOR_ID = 'experiment-set-advisor';
/** A reading that hasn't come back in this long is given up on. */
const STALE_MS = 2 * 60 * 1000;
/** Readings kept. */
const KEPT = 30;

export interface SetAdviceState { status: 'working' | 'ready' | 'failed'; since: string; advice?: SetAdvice }

export function installSetAdvisor(ctx: Ctx): boolean {
  return ensureSystemAgentCurrent(ctx, EXPERIMENT_SET_ADVISOR_ID, 'reading an experiment\'s question to suggest its set');
}

/** What a reading is kept under: the question, what changes, and which sets there were. */
export function setAdviceKey(question: string, changes: string, candidates: readonly Pick<SetCandidate, 'id' | 'options'>[]): string {
  return createHash('sha1').update(JSON.stringify([question.trim(), changes.trim(), candidates.map((c) => [c.id, c.options])])).digest('hex').slice(0, 20);
}

/** How a reading stands (one that has gone stale has failed). */
export function setAdviceState(ctx: Ctx, key: string): SetAdviceState | undefined {
  const s = ctx.experimentSetAdvice?.get(key);
  if (s?.status === 'working' && Date.now() - Date.parse(s.since) > STALE_MS) return { ...s, status: 'failed' };
  return s;
}

async function runAdvisor(ctx: Ctx, inputs: Record<string, string>): Promise<string | undefined> {
  try {
    if (ctx.experimentSetAdvisorRun) return await ctx.experimentSetAdvisorRun(inputs);
    const agent = ctx.agentStore.getAgent(EXPERIMENT_SET_ADVISOR_ID);
    if (!agent) return undefined;
    const runId = randomUUID();
    const ac = new AbortController();
    ctx.activeRuns.set(runId, ac);
    try {
      await executeAgentDag(agent, { triggeredBy: 'dashboard', runId, signal: ac.signal, inputs, suppressNotify: true }, {
        runStore: ctx.runStore, secretsStore: ctx.secretsStore, variablesStore: ctx.variablesStore,
        dataRoot: ctx.agentStore.dataRoot, llmSettings: buildLlmSettingsSnapshot(ctx), spawnNode: ctx.workflowSpawnNode,
      });
      const run = ctx.runStore.getRun(runId);
      return run?.status === 'completed' ? run.result ?? undefined : undefined;
    } finally {
      ctx.activeRuns.delete(runId);
    }
  } catch {
    return undefined;
  }
}

/**
 * Ask for a reading of the question, in the background. Nothing is asked
 * with no question or no sets, when one is under way or done for the same
 * ask, or when the advisor isn't here. Returns how it stands.
 */
export function startSetAdvice(ctx: Ctx, question: string, changes: string, candidates: readonly SetCandidate[], opts: { onDone?: (p: Promise<void>) => void } = {}): SetAdviceState | undefined {
  if (!question.trim() || !candidates.length) return undefined;
  if (!ctx.experimentSetAdvisorRun && !ctx.agentStore.getAgent(EXPERIMENT_SET_ADVISOR_ID)) return undefined;
  const key = setAdviceKey(question, changes, candidates);
  const have = setAdviceState(ctx, key);
  if (have && have.status !== 'failed') return have;
  ctx.experimentSetAdvice ??= new Map();
  // The oldest go when there are too many.
  while (ctx.experimentSetAdvice.size >= KEPT) ctx.experimentSetAdvice.delete(ctx.experimentSetAdvice.keys().next().value as string);
  const state: SetAdviceState = { status: 'working', since: new Date().toISOString() };
  ctx.experimentSetAdvice.set(key, state);
  const work = (async () => {
    let out = parseSetAdvice(await runAdvisor(ctx, setAdviceInputs(question, changes, candidates)), candidates);
    if ('error' in out) out = parseSetAdvice(await runAdvisor(ctx, setAdviceInputs(question, changes, candidates, out.error)), candidates);
    if (ctx.experimentSetAdvice?.get(key) !== state) return;
    ctx.experimentSetAdvice.set(key, 'error' in out ? { ...state, status: 'failed' } : { ...state, status: 'ready', advice: out.advice });
  })();
  opts.onDone?.(work);
  return state;
}
