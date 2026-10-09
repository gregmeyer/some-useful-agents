/**
 * New notebook's suggestion pills: up to three notebooks you might want,
 * from your recent conversations with sua (the `notebook-suggester` agent).
 * Kept in `.sua/notebook-suggestions.json` for half a day; a stale or missing
 * list is refreshed in the background while the page shows what it has.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NotebookStore, executeAgentDag, extractTaggedJson } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';

type Ctx = ReturnType<typeof getContext>;

export const NOTEBOOK_SUGGESTER_ID = 'notebook-suggester';
const FRESH_MS = 12 * 60 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000;

export interface NotebookSuggestion { label: string; text: string; from?: string }
interface Stored { at: number; items: NotebookSuggestion[]; tried?: number }

const path = (dataDir: string) => join(dataDir, '.sua', 'notebook-suggestions.json');

function read(dataDir: string): Stored | undefined {
  try { return JSON.parse(readFileSync(path(dataDir), 'utf-8')) as Stored; } catch { return undefined; }
}

function write(dataDir: string, s: Stored): void {
  const p = path(dataDir);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(s, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, p);
}

/** The agent's <suggestions>, cleaned: at most three, with a label and a sentence each. Pure. */
export function parseSuggestions(raw: string): NotebookSuggestion[] {
  const block = extractTaggedJson(raw, 'suggestions');
  if (!block) return [];
  let v: unknown;
  try { v = JSON.parse(block); } catch { return []; }
  if (!Array.isArray(v)) return [];
  const out: NotebookSuggestion[] = [];
  for (const x of v as Array<Record<string, unknown>>) {
    const label = typeof x?.label === 'string' ? x.label.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
    const text = typeof x?.text === 'string' ? x.text.replace(/\s+/g, ' ').trim().slice(0, 400) : '';
    if (!label || !text || out.some((o) => o.label.toLowerCase() === label.toLowerCase())) continue;
    const from = typeof x.from === 'string' && x.from.trim() ? x.from.trim().slice(0, 120) : undefined;
    out.push({ label, text, ...(from ? { from } : {}) });
    if (out.length === 3) break;
  }
  return out;
}

/**
 * Your recent conversations, as the agent reads them: ones you started,
 * not a notebook's own and not sua fixing its agents, newest first, each
 * with the first thing you said.
 */
export function recentConversations(ctx: Ctx, limit = 30): string[] {
  if (!ctx.inboxStore) return [];
  const notebookThreads = new Set(NotebookStore.fromHandle(ctx.runStore.databaseHandle()).list({ archived: 'include' }).map((n) => n.conversationId).filter(Boolean));
  const out: string[] = [];
  // Finished and dismissed ones too: dismissing tidies the inbox, it doesn't mean you've lost interest.
  for (const m of ctx.inboxStore.list({ source: 'manual', statuses: ['open', 'triaged', 'awaiting_user', 'verifying', 'resolved', 'dismissed'], limit: 80 })) {
    if (notebookThreads.has(m.id) || /^(Fix|Change|Notebook:)\b/.test(m.title)) continue;
    const first = ctx.inboxStore.listResponses(m.id).find((r) => r.role === 'user')?.body ?? '';
    out.push(`${m.title.replace(/\s+/g, ' ').trim().slice(0, 100)} — ${first.replace(/\s+/g, ' ').trim().slice(0, 240)}`);
    if (out.length === limit) break;
  }
  return out;
}

/** What to show now (possibly stale), and whether a refresh is under way. */
export function notebookSuggestions(ctx: Ctx): { items: NotebookSuggestion[]; refreshing: boolean } {
  const s = read(ctx.dataDir);
  const now = Date.now();
  const stale = !s || now - s.at > FRESH_MS;
  const triedLately = !!s?.tried && now - s.tried < RETRY_MS;
  if (stale && !triedLately) refreshSuggestions(ctx);
  return { items: s?.items ?? [], refreshing: !!ctx.notebookSuggesting };
}

/** Ask the suggester again, in the background (once at a time). */
export function refreshSuggestions(ctx: Ctx): boolean {
  if (ctx.notebookSuggesting) return false;
  const conversations = recentConversations(ctx);
  const prev = read(ctx.dataDir);
  if (conversations.length === 0) { write(ctx.dataDir, { at: Date.now(), items: [] }); return false; }
  const fake = ctx.notebookSuggesterRun;
  if (!fake && !ensureSystemAgentCurrent(ctx, NOTEBOOK_SUGGESTER_ID, 'notebook suggestions')) return false;
  const agent = fake ? undefined : ctx.agentStore.getAgent(NOTEBOOK_SUGGESTER_ID);
  if (!fake && !agent) return false;
  ctx.notebookSuggesting = true;
  write(ctx.dataDir, { at: prev?.at ?? 0, items: prev?.items ?? [], tried: Date.now() });
  const notebooks = NotebookStore.fromHandle(ctx.runStore.databaseHandle()).list({ archived: 'include' }).map((n) => n.title);
  const inputs = { CONVERSATIONS: conversations.join('\n'), NOTEBOOKS: notebooks.length ? notebooks.join('\n') : '(none)' };
  const runId = randomUUID();
  const ac = new AbortController();
  ctx.activeRuns.set(runId, ac);
  void (async () => {
    try {
      let result: string | undefined;
      if (fake) result = await fake(inputs);
      else {
        await executeAgentDag(agent!, { triggeredBy: 'dashboard', runId, signal: ac.signal, inputs }, {
          runStore: ctx.runStore, secretsStore: ctx.secretsStore, variablesStore: ctx.variablesStore,
          dataRoot: ctx.agentStore.dataRoot, llmSettings: buildLlmSettingsSnapshot(ctx), spawnNode: ctx.workflowSpawnNode,
        });
        const run = ctx.runStore.getRun(runId);
        if (run?.status === 'completed') result = run.result ?? undefined;
      }
      // A failed run keeps what was there; the retry waits RETRY_MS.
      if (result !== undefined) write(ctx.dataDir, { at: Date.now(), items: parseSuggestions(result) });
    } catch { /* keep what was there */ } finally {
      ctx.activeRuns.delete(runId);
      ctx.notebookSuggesting = false;
    }
  })();
  return true;
}
