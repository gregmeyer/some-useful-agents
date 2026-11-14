/**
 * The agent a step runs when its notebook is a copy an experiment made
 * (ADR-0079). A version of a notebook experiment may say that one agent
 * runs at an earlier version, or that the steps run on another model; the
 * step runners ask here for the agent to use, so nothing about a copy's
 * setup has to be installed or changed in the catalog. Any agent a copy
 * runs is filed under the experiment's id, as an agent experiment's runs
 * are, so the real agent's history and spend never see them.
 *
 * Kept apart from the runner so the step code can ask without pulling the
 * runner in.
 */
import { agentForCondition, type Agent, type ExperimentLevel } from '@some-useful-agents/core';
import type { getContext } from '../context.js';

type Ctx = ReturnType<typeof getContext>;

/** How a copy's agents are swapped: the levels of its version (their provider and model), and any agent pinned to a version. */
export interface CopySwap { levels: ExperimentLevel[]; versions: Record<string, number> }

/** The agent to run for a notebook: itself, unless the notebook is a copy an experiment is running. */
export function agentForCopy(ctx: Ctx, notebookId: string | undefined, agent: Agent): Agent {
  const swap = notebookId ? ctx.experimentCopies?.get(notebookId) : undefined;
  if (!swap) return agent;
  const version = swap.versions[agent.id];
  let base = agent;
  if (version !== undefined) { try { base = ctx.agentStore.getAgentAtVersion(agent.id, version) ?? agent; } catch { base = agent; } }
  // The version is applied here; what's left of the levels is the provider and model.
  // In this process, as an agent experiment's runs are: the copy is never an agent a worker could look up.
  return { ...agentForCondition(base, swap.levels.map(({ version: _v, ...l }) => l)), runOn: 'local' };
}
