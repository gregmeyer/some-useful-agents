/**
 * Topic tags for notebooks: the `notebook-tagger` system agent gives each
 * notebook a few short tags ("used cars", "fundraising") and says who or
 * what it's about, kept on the notebook (NotebookStore.setAutoTags). The
 * Notebooks list filters and searches by them. It runs in the background, a
 * batch at a time, when the list opens or a notebook is made and some
 * notebook was never tagged or its title, goal or limits changed since; a
 * failed try waits a day. Tags you added or removed are never touched.
 */
import { randomUUID } from 'node:crypto';
import { NotebookStore, cleanTag, executeAgentDag, extractTaggedJson, notebookTags, subjectOut, tagsStale, type Notebook } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';

type Ctx = ReturnType<typeof getContext>;

export const NOTEBOOK_TAGGER_ID = 'notebook-tagger';
/** Notebooks sent in one run. */
export const TAG_BATCH = 20;
/** Tags in use sent with a batch, most used first. */
const VOCABULARY_MAX = 40;
/** Batches in one go, at most (a notebook made meanwhile is picked up too). */
const MAX_ROUNDS = 10;

/** The tags in use across these notebooks, most used first (ties A–Z), each with how many have it. Pure. */
export function tagCounts(notebooks: readonly Pick<Notebook, 'tags'>[]): Array<{ tag: string; count: number }> {
  const n = new Map<string, number>();
  for (const nb of notebooks) for (const t of notebookTags(nb)) n.set(t, (n.get(t) ?? 0) + 1);
  return [...n].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** The tagger's inputs for a batch. Pure. */
export function tagInputs(batch: readonly Notebook[], vocabulary: readonly string[]): Record<string, string> {
  return {
    NOTEBOOKS: JSON.stringify(batch.map((nb) => ({ id: nb.id, title: nb.title, for: nb.statement.slice(0, 200), limits: nb.params.slice(0, 5).map((p) => p.slice(0, 80)) }))),
    VOCABULARY: JSON.stringify(vocabulary.slice(0, VOCABULARY_MAX)),
  };
}

/**
 * Keep the tagger's answer; notebooks it gave no tags are marked failed.
 * A subject is kept only when it's in the notebook's own title or goal.
 * Returns how many were tagged.
 */
export function applyTags(store: NotebookStore, batch: readonly Notebook[], raw: string | undefined): number {
  let items: unknown[] = [];
  try {
    const parsed = JSON.parse(extractTaggedJson(raw ?? '', 'tags') ?? '{}') as { items?: unknown };
    items = Array.isArray(parsed.items) ? parsed.items : [];
  } catch { items = []; }
  const byId = new Map(batch.map((nb) => [nb.id, nb]));
  const done = new Set<string>();
  for (const item of items) {
    const { id, tags, subject } = (item ?? {}) as { id?: unknown; tags?: unknown; subject?: unknown };
    const nb = typeof id === 'string' ? byId.get(id) : undefined;
    // No usable tag: a failed try (kept as one, so it's tried again later).
    if (!nb || done.has(nb.id) || !Array.isArray(tags) || !tags.some((t) => cleanTag(t))) continue;
    const about = typeof subject === 'string' ? subject.replace(/\s+/g, ' ').trim() : '';
    const named = !!about && (subjectOut(nb.title, about) !== nb.title || subjectOut(nb.statement, about) !== nb.statement);
    try {
      store.setAutoTags(nb.id, { tags, ...(named ? { subject: about } : {}) });
      done.add(nb.id);
    } catch { /* the notebook is gone */ }
  }
  for (const nb of batch) if (!done.has(nb.id)) { try { store.markTagsFailed(nb.id); } catch { /* gone */ } }
  return done.size;
}

/** Install or refresh the tagger from its bundled YAML (dashboard startup). */
export function installNotebookTagger(ctx: Ctx): boolean {
  return ensureSystemAgentCurrent(ctx, NOTEBOOK_TAGGER_ID, 'notebook tags');
}

/**
 * Tag the notebooks that need it (archived ones too), in the background, a
 * batch at a time. Returns whether it started (false: nothing to tag,
 * already tagging, or the tagger isn't installed).
 */
export function startNotebookTags(ctx: Ctx): boolean {
  if (ctx.notebookTagging) return false;
  const store = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
  const stale = () => store.list({ archived: 'include' }).filter((nb) => tagsStale(nb));
  if (!stale().length) return false;
  const fake = ctx.notebookTaggerRun;
  // Only when installed: the dashboard installs it at startup
  // (installNotebookTagger), so a page load never imports agents or runs a
  // model in a setup that didn't ask for it (tests).
  const agent = fake ? undefined : ctx.agentStore.getAgent(NOTEBOOK_TAGGER_ID);
  if (!fake && !agent) return false;
  ctx.notebookTagging = true;
  void (async () => {
    try {
      // Each round reads what's stale now: a batch that failed is waiting, so this ends.
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const batch = stale().slice(0, TAG_BATCH);
        if (!batch.length) break;
        const inputs = tagInputs(batch, tagCounts(store.list({ archived: 'include' })).map((t) => t.tag));
        let result: string | undefined;
        const runId = randomUUID();
        const ac = new AbortController();
        ctx.activeRuns.set(runId, ac);
        try {
          if (fake) result = await fake(inputs);
          else {
            // No onRunFailure: a tagging hiccup shouldn't open an inbox thread.
            await executeAgentDag(agent!, { triggeredBy: 'dashboard', runId, signal: ac.signal, inputs }, {
              runStore: ctx.runStore, secretsStore: ctx.secretsStore, variablesStore: ctx.variablesStore,
              dataRoot: ctx.agentStore.dataRoot, llmSettings: buildLlmSettingsSnapshot(ctx), spawnNode: ctx.workflowSpawnNode,
            });
            const run = ctx.runStore.getRun(runId);
            result = run?.status === 'completed' ? run.result ?? undefined : undefined;
          }
        } catch { result = undefined; }
        ctx.activeRuns.delete(runId);
        try { applyTags(store, batch, result); } catch { /* best effort */ }
      }
    } finally {
      ctx.notebookTagging = false;
    }
  })();
  return true;
}
