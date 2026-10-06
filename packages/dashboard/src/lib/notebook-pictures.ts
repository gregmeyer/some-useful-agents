/**
 * Representative pictures (notebooks): for options with no photo of their
 * own, the `notebook-picture` agent finds a representative image (a press
 * photo of the model, the product's image, the company's logo) or draws an
 * SVG illustration. Found images go through core's guarded fetchImage; SVG is
 * rebuilt by sanitizeSvg; each is kept with its kind, so the card can say
 * "example photo" or "illustration" and never pass it off as the real thing.
 */
import { randomUUID } from 'node:crypto';
import {
  NotebookStore, executeAgentDag, extractTaggedJson, fetchImage as coreFetchImage,
  type FetchedImage,
} from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';

type Ctx = ReturnType<typeof getContext>;

export const NOTEBOOK_PICTURE_ID = 'notebook-picture';

export interface PictureDeps {
  fetchImage: (url: string) => Promise<Pick<FetchedImage, 'bytes' | 'contentType'>>;
}

/**
 * A Wikimedia original is often several MB; ask for its 500px thumbnail (a size Wikimedia serves)
 * instead (`…/commons/a/ab/File.jpg` → `…/commons/thumb/a/ab/File.jpg/640px-File.jpg`).
 */
export function smallerImageUrl(url: string): string {
  const m = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/(commons|en)\/([0-9a-f])\/([0-9a-f]{2})\/([^/?#]+)$/i.exec(url);
  if (!m) return url;
  return `https://upload.wikimedia.org/wikipedia/${m[1]}/thumb/${m[2]}/${m[3]}/${m[4]}/500px-${m[4]}`;
}

/** Fetch with patience: Wikimedia and others answer 429 (or 5xx) when asked quickly. */
async function fetchWithRetry(fetchImage: PictureDeps['fetchImage'], url: string, waits: readonly number[]): Promise<Pick<FetchedImage, 'bytes' | 'contentType'>> {
  for (let i = 0; ; i++) {
    try {
      return await fetchImage(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (i >= waits.length || !/\b(429|5\d\d)\b|timed out|network/i.test(msg)) throw err;
      await new Promise((r) => setTimeout(r, waits[i]));
    }
  }
}

/**
 * Apply the agent's <pictures> block: a found image is fetched (patiently)
 * and kept as an example photo; every other asked option gets an
 * illustration drawn by sua (the route draws it; a model's SVG isn't used).
 * Returns how many photos and drawings were kept.
 */
export async function applyPictures(store: NotebookStore, notebookId: string, askedIds: readonly string[], raw: string, deps: PictureDeps = { fetchImage: (u) => coreFetchImage(u) }, waits: readonly number[] = [1500, 4000]): Promise<{ kept: number; drawn: number; found: number }> {
  const asked = new Set(askedIds);
  let found = 0;
  let drawn = 0;
  const block = extractTaggedJson(raw, 'pictures');
  let items: unknown[] = [];
  try { items = (JSON.parse(block ?? '{}') as { items?: unknown[] }).items ?? []; } catch { items = []; }
  const done = new Set<string>();
  // One at a time: hosts rate-limit bursts.
  for (const it of items.slice(0, 20)) {
    const x = it as { id?: unknown; url?: unknown; what?: unknown };
    const id = typeof x.id === 'string' ? x.id : '';
    if (!asked.has(id) || done.has(id) || store.photoKind(id) === 'listing' || store.photoKind(id) === 'representative') continue;
    const what = typeof x.what === 'string' ? x.what : undefined;
    if (typeof x.url === 'string' && /^https:\/\//i.test(x.url) && !/\.svg(\?|$)/i.test(x.url)) {
      try {
        const img = await fetchWithRetry(deps.fetchImage, smallerImageUrl(x.url), waits);
        store.savePhoto(notebookId, id, x.url, { contentType: img.contentType, bytes: img.bytes }, { kind: 'representative', ...(what ? { what } : {}) });
        found++;
        done.add(id);
      } catch { /* drawn below */ }
    }
  }
  // Everything else asked: an illustration (kept as a marker; the route draws it).
  for (const id of askedIds) {
    if (done.has(id) || store.photoKind(id)) continue;
    store.savePhoto(notebookId, id, 'illustration', { contentType: 'image/svg+xml', bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>') }, { kind: 'illustration' });
    drawn++;
  }
  store.markPictureTried(askedIds);
  return { kept: found + drawn, drawn, found };
}

/**
 * Find or draw pictures for up to 8 options with none, in the background,
 * one pass per notebook at a time. Returns whether a pass started.
 */
export function startNotebookPictures(ctx: Ctx, notebookId: string): boolean {
  const store = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
  const nb = store.get(notebookId);
  if (!nb) return false;
  const candidates = store.pictureCandidates(notebookId, 8);
  if (candidates.length === 0) return false;
  ctx.notebookPictures ??= new Set();
  if (ctx.notebookPictures.has(notebookId)) return false;
  if (!ensureSystemAgentCurrent(ctx, NOTEBOOK_PICTURE_ID, 'notebook pictures')) return false;
  const agent = ctx.agentStore.getAgent(NOTEBOOK_PICTURE_ID);
  if (!agent) return false;
  ctx.notebookPictures.add(notebookId);
  const ids = candidates.map((e) => e.id);
  const options = candidates.map((e) => ({ id: e.id, name: e.title.split(',')[0].trim(), facts: e.data ?? {} }));
  const runId = randomUUID();
  const ac = new AbortController();
  ctx.activeRuns.set(runId, ac);
  void (async () => {
    try {
      // No onRunFailure: a picture hiccup shouldn't open an inbox thread.
      await executeAgentDag(agent, {
        triggeredBy: 'dashboard', runId, signal: ac.signal,
        inputs: { NOTEBOOK: nb.statement || nb.title, OPTIONS: JSON.stringify(options) },
      }, {
        runStore: ctx.runStore, secretsStore: ctx.secretsStore, variablesStore: ctx.variablesStore,
        dataRoot: ctx.agentStore.dataRoot, llmSettings: buildLlmSettingsSnapshot(ctx), spawnNode: ctx.workflowSpawnNode,
      });
      const run = ctx.runStore.getRun(runId);
      if (run?.status === 'completed' && run.result) await applyPictures(store, notebookId, ids, run.result);
      else store.markPictureTried(ids);
    } catch {
      store.markPictureTried(ids);
    } finally {
      ctx.activeRuns.delete(runId);
      ctx.notebookPictures?.delete(notebookId);
      // The page redraws on the notebook's change mark.
      try { store.touch(notebookId); } catch { /* gone */ }
    }
  })();
  return true;
}

export function picturesRunning(ctx: Ctx, notebookId: string): boolean {
  return !!ctx.notebookPictures?.has(notebookId);
}
