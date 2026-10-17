/**
 * The agents catalog, sorted by what agents do: the `agent-catalog-sorter`
 * system agent puts each agent in a group ("Jobs & companies") with a one-line
 * "use it for", kept in core's AgentCatalogStore. /agents shows a shelf per
 * group. It runs in the background when the page opens and some agent is new
 * or changed since it was sorted; a failed try waits CATALOG_RETRY_MS.
 */
import { randomUUID } from 'node:crypto';
import { AgentCatalogStore, executeAgentDag, extractTaggedJson, type Agent } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';

type Ctx = ReturnType<typeof getContext>;

export const CATALOG_SORTER_ID = 'agent-catalog-sorter';
/** Agents sent in one run. */
export const SORT_BATCH = 40;
const MAX_GROUP_CHARS = 24;
const MAX_USE_FOR_CHARS = 80;

export function catalogStore(ctx: Ctx): AgentCatalogStore {
  return AgentCatalogStore.fromHandle(ctx.runStore.databaseHandle());
}

/** The sorter's inputs for a batch. Pure. */
export function sortInputs(batch: readonly Agent[], groups: readonly string[]): Record<string, string> {
  return {
    AGENTS: JSON.stringify(batch.map((a) => ({
      id: a.id,
      name: a.name,
      description: (a.description ?? '').slice(0, 300),
      tags: a.tags ?? [],
      questions: (a.sampleQuestions ?? []).slice(0, 3),
    }))),
    GROUPS: JSON.stringify(groups),
  };
}

/** Keep the sorter's answer; agents it didn't place are marked failed. Returns how many were sorted. */
export function applySort(store: AgentCatalogStore, batch: readonly Agent[], raw: string | undefined): number {
  let items: unknown[] = [];
  try {
    const parsed = JSON.parse(extractTaggedJson(raw ?? '', 'groups') ?? '{}') as { items?: unknown };
    items = Array.isArray(parsed.items) ? parsed.items : [];
  } catch { items = []; }
  const byId = new Map(batch.map((a) => [a.id, a]));
  const saved: Array<{ agent: Agent; group: string; useFor?: string }> = [];
  for (const item of items) {
    const { id, group, useFor } = (item ?? {}) as { id?: unknown; group?: unknown; useFor?: unknown };
    const agent = typeof id === 'string' ? byId.get(id) : undefined;
    const name = typeof group === 'string' ? group.replace(/\s+/g, ' ').trim() : '';
    if (!agent || !name || name.length > MAX_GROUP_CHARS || saved.some((s) => s.agent.id === agent.id)) continue;
    const line = typeof useFor === 'string' ? useFor.replace(/\s+/g, ' ').trim().replace(/\.$/, '') : '';
    saved.push({ agent, group: name, ...(line ? { useFor: line.slice(0, MAX_USE_FOR_CHARS) } : {}) });
  }
  if (saved.length) store.save(saved);
  const placed = new Set(saved.map((s) => s.agent.id));
  const missed = batch.filter((a) => !placed.has(a.id));
  if (missed.length) store.markFailed(missed);
  return saved.length;
}

/** Install or refresh the sorter from its bundled YAML (dashboard startup). */
export function installCatalogSorter(ctx: Ctx): boolean {
  return ensureSystemAgentCurrent(ctx, CATALOG_SORTER_ID, 'agent catalog groups');
}

/**
 * Sort the agents that need it, in the background, one batch at a time.
 * Returns whether it started (false: nothing stale, already sorting, or the
 * sorter isn't available).
 */
export function startCatalogSort(ctx: Ctx, agents: readonly Agent[]): boolean {
  if (ctx.agentCatalogSorting) return false;
  const store = catalogStore(ctx);
  const stale = store.stale(agents);
  if (!stale.length) return false;
  const fake = ctx.agentCatalogSortRun;
  // Only when installed: the dashboard installs it at startup
  // (installCatalogSorter), so a page load never imports agents or runs a model
  // in a setup that didn't ask for it (tests).
  const agent = fake ? undefined : ctx.agentStore.getAgent(CATALOG_SORTER_ID);
  if (!fake && !agent) return false;
  ctx.agentCatalogSorting = true;
  void (async () => {
    try {
      for (let i = 0; i < stale.length; i += SORT_BATCH) {
        const batch = stale.slice(i, i + SORT_BATCH);
        const inputs = sortInputs(batch, store.groups());
        let result: string | undefined;
        const runId = randomUUID();
        const ac = new AbortController();
        ctx.activeRuns.set(runId, ac);
        try {
          if (fake) result = await fake(inputs);
          else {
            // No onRunFailure: a sorting hiccup shouldn't open an inbox thread.
            await executeAgentDag(agent!, { triggeredBy: 'dashboard', runId, signal: ac.signal, inputs }, {
              runStore: ctx.runStore, secretsStore: ctx.secretsStore, variablesStore: ctx.variablesStore,
              dataRoot: ctx.agentStore.dataRoot, llmSettings: buildLlmSettingsSnapshot(ctx), spawnNode: ctx.workflowSpawnNode,
            });
            const run = ctx.runStore.getRun(runId);
            result = run?.status === 'completed' ? run.result ?? undefined : undefined;
          }
        } catch { result = undefined; }
        ctx.activeRuns.delete(runId);
        try { applySort(store, batch, result); } catch { /* best effort */ }
      }
    } finally {
      ctx.agentCatalogSorting = false;
    }
  })();
  return true;
}
