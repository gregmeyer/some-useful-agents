/**
 * Notebook files in the dashboard (docs/notebooks.md "Send a copy to another
 * machine"): Download / share → Notebook file, and New notebook → Import a
 * notebook file. Importing is two steps: the file is checked and what will
 * happen is shown (core checkNotebookBundle), then Import does it. The
 * checked file waits in memory, by a random key, for 30 minutes.
 */
import { randomBytes } from 'node:crypto';
import {
  NotebookStore,
  checkNotebookBundle,
  importNotebookBundle,
  unpackNotebookBundle,
  type BundleStores,
  type NotebookBundle,
  type NotebookImportPlan,
} from '@some-useful-agents/core';
import type { getContext } from '../context.js';

type Ctx = ReturnType<typeof getContext>;

const PENDING_MS = 30 * 60 * 1000;

interface Pending { bundle: NotebookBundle; at: number }

const pending = new Map<string, Pending>();

function prune(now = Date.now()): void {
  for (const [k, p] of pending) if (now - p.at > PENDING_MS) pending.delete(k);
}

export function bundleStores(ctx: Ctx): BundleStores {
  return { notebooks: NotebookStore.fromHandle(ctx.runStore.databaseHandle()), agents: ctx.agentStore, tools: ctx.toolStore };
}

/** Which of these secret names this machine has (a locked or missing store counts as not having them). */
export async function secretsHere(ctx: Ctx, names: readonly string[]): Promise<Set<string>> {
  const have = new Set<string>();
  for (const n of names) {
    try { if (await ctx.secretsStore.has(n)) have.add(n); } catch { /* locked: say it's missing */ }
  }
  return have;
}

/** Read and check an uploaded notebook file: what importing would do, and the key to do it with. */
export async function checkUploadedNotebookFile(ctx: Ctx, bytes: Uint8Array): Promise<{ key: string; plan: NotebookImportPlan }> {
  const bundle = unpackNotebookBundle(bytes);
  const have = await secretsHere(ctx, bundle.secrets);
  const plan = checkNotebookBundle(bundleStores(ctx), bundle, { hasSecret: (n) => have.has(n) });
  prune();
  const key = randomBytes(16).toString('hex');
  pending.set(key, { bundle, at: Date.now() });
  return { key, plan };
}

/** Import a checked file by its key. Undefined when the key is unknown or expired. */
export async function importCheckedNotebookFile(ctx: Ctx, key: string): Promise<{ notebookId: string; plan: NotebookImportPlan } | undefined> {
  prune();
  const p = pending.get(key);
  if (!p) return undefined;
  const have = await secretsHere(ctx, p.bundle.secrets);
  const r = importNotebookBundle(bundleStores(ctx), p.bundle, { hasSecret: (n) => have.has(n) });
  pending.delete(key);
  return { notebookId: r.notebookId, plan: r.plan };
}

/** A file name for the notebook's file: its title, made safe. Pure. */
export function notebookFileName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'notebook';
  return `${base}.suanb`;
}
