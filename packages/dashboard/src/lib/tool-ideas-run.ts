/**
 * Tools → New tool → Describe it → Or start from…: the tool-suggester agent
 * suggests tools from one of your agents, an input you have, or an outcome
 * you want (lib/tool-ideas.ts has the pure half). Runs in the background;
 * the same ask within the hour gets the same ideas back.
 */
import { createHash, randomUUID } from 'node:crypto';
import { executeAgentDag } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';
import { inBackground } from './background.js';
import { existingToolsText } from './tool-drafter.js';
import { TOOL_SUGGESTER_ID, parseToolIdeas, readToolIdeaJob, type ToolIdeaJob, type ToolIdeaLens } from './tool-ideas.js';

type Ctx = ReturnType<typeof getContext>;

/**
 * Start (or reuse) ideas for this lens and context. Its job id, or an error
 * when the suggester isn't available.
 */
export function startToolIdeas(ctx: Ctx, lens: ToolIdeaLens, context: string): { id: string } | { error: string } {
  const fake = ctx.toolSuggesterRun;
  if (!fake && !ensureSystemAgentCurrent(ctx, TOOL_SUGGESTER_ID, 'suggesting tools')) {
    return { error: "sua can't suggest tools right now (its tool suggester isn't installed)." };
  }
  const suggester = fake ? undefined : ctx.agentStore.getAgent(TOOL_SUGGESTER_ID);
  if (!fake && !suggester) return { error: "sua can't suggest tools right now (its tool suggester isn't installed)." };

  const hash = createHash('sha256').update(`${lens}\n${context}`).digest('hex').slice(0, 16);
  readToolIdeaJob(ctx, ''); // prune old jobs
  const jobs = (ctx.toolIdeaJobs ??= new Map<string, ToolIdeaJob>());
  for (const [id, j] of jobs) if (j.hash === hash && j.status !== 'failed') return { id };

  const id = randomUUID();
  const at = () => new Date().toISOString();
  jobs.set(id, { status: 'working', lens, hash, at: at() });
  const inputs = { LENS: lens, CONTEXT: context, TOOLS: existingToolsText(ctx) };

  inBackground(ctx, 'tool-suggester', (async () => {
    try {
      let text: string | undefined;
      let error = 'sua stopped before it finished.';
      if (fake) {
        text = await fake(inputs);
      } else {
        const runId = randomUUID();
        const ac = new AbortController();
        ctx.activeRuns.set(runId, ac);
        try {
          await executeAgentDag(suggester!, { triggeredBy: 'dashboard', runId, signal: ac.signal, inputs }, {
            runStore: ctx.runStore, secretsStore: ctx.secretsStore, variablesStore: ctx.variablesStore,
            dataRoot: ctx.agentStore.dataRoot, llmSettings: buildLlmSettingsSnapshot(ctx), spawnNode: ctx.workflowSpawnNode,
          });
          const run = ctx.runStore.getRun(runId);
          if (run?.status === 'completed') text = run.result ?? '';
          else error = run?.error ?? error;
        } finally {
          ctx.activeRuns.delete(runId);
        }
      }
      const ideas = text === undefined ? [] : parseToolIdeas(text);
      jobs.set(id, ideas.length
        ? { status: 'ready', lens, hash, at: at(), ideas }
        : { status: 'failed', lens, hash, at: at(), error: text === undefined ? error : "sua didn't come back with ideas it could use. Try saying a little more." });
    } catch (err) {
      jobs.set(id, { status: 'failed', lens, hash, at: at(), error: err instanceof Error ? err.message : String(err) });
    }
  })());
  return { id };
}
