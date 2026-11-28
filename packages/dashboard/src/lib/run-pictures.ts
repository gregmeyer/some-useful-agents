/**
 * Pictures a run made (an agent's `preview` output fields that name an image),
 * found on this computer, so a conversation can show them and add one to an
 * answer. A picture a tool server saved inside its container can't be read;
 * that's said plainly rather than shown as a broken image.
 */
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { NOTEBOOK_PICTURE_MAX_BYTES, NotebookStore, mcpSharedFolders, type McpServerConfig, type Notebook } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { extractField } from '../views/output-widgets.js';
import { dataRootIn, mcpServersIn, resolveOutputFile } from '../routes/output-files.js';

type Ctx = ReturnType<typeof getContext>;

const PICTURE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

/** One picture a run named: where it said it is, and the file here (or why there's none). */
export interface RunPicture {
  field: string;
  label: string;
  /** The path the run gave. */
  said: string;
  /** The file on this computer, when it could be found. */
  file?: string;
  contentType: string;
  /** Why it can't be shown, when it can't. */
  why?: string;
}

/** Why a picture can't be shown, in words: a Docker server's is almost always still inside its container. */
function whyNot(status: number, servers: readonly McpServerConfig[]): string {
  const shared = mcpSharedFolders(servers);
  if (shared.length) {
    const where = [...new Set(shared.map((f) => f.inside))].join(' or ');
    return `A tool server running in Docker keeps what it saves inside its container unless it saves into a folder it shares (${where}), so this file never reached this computer. Have the agent save there.`;
  }
  return status === 404 ? "sua can't find that file on this computer." : "That file is in a folder sua doesn't show files from.";
}

/** The pictures a finished run named in its output (its agent's preview fields), each found or not. */
export function runPictures(ctx: Ctx, agentId: string, runId: string): RunPicture[] {
  const agent = ctx.agentStore.getAgent(agentId);
  const fields = (agent?.outputWidget?.fields ?? []).filter((f) => f.type === 'preview');
  if (!fields.length) return [];
  const run = ctx.runStore.getRun(runId);
  if (!run?.result || run.status !== 'completed') return [];
  const servers = mcpServersIn(ctx);
  const out: RunPicture[] = [];
  for (const f of fields) {
    const said = extractField(run.result, f.name)?.trim();
    if (!said) continue;
    const contentType = PICTURE_TYPES[extname(said).toLowerCase()];
    if (!contentType) continue;
    const found = resolveOutputFile(said, servers, dataRootIn(ctx));
    if ('path' in found) out.push({ field: f.name, label: f.label ?? f.name, said, file: found.path, contentType });
    else out.push({ field: f.name, label: f.label ?? f.name, said, contentType, why: whyNot(found.status, servers) });
  }
  return out;
}

/** A run's picture as bytes, to keep in an answer. */
export function readRunPicture(p: RunPicture): { bytes: Uint8Array; contentType: string } | { error: string } {
  if (!p.file) return { error: p.why ?? "sua can't find that picture." };
  try {
    if (statSync(p.file).size > NOTEBOOK_PICTURE_MAX_BYTES) return { error: 'That picture is over 10 MB.' };
    return { bytes: new Uint8Array(readFileSync(p.file)), contentType: p.contentType };
  } catch {
    return { error: "sua couldn't read that picture." };
  }
}

/**
 * Answers to offer for a picture from a conversation: `linked`, the ones it's
 * about (it links to them, latest mention first, or they were asked from it),
 * and `others`, your latest other answers, up to `max` in all.
 */
export function answersForThread(ctx: Ctx, messageId: string, max = 8): { linked: Notebook[]; others: Notebook[] } {
  let s: NotebookStore;
  try { s = NotebookStore.fromHandle(ctx.runStore.databaseHandle()); } catch { return { linked: [], others: [] }; }
  const seen = new Set<string>();
  const take = (into: Notebook[]) => (nb: Notebook | undefined) => {
    if (!nb || seen.has(nb.id) || nb.experimentRun) return;
    seen.add(nb.id);
    into.push(nb);
  };
  const texts: string[] = [];
  const msg = ctx.inboxStore?.get(messageId);
  if (msg) texts.push(msg.title, msg.body, msg.contextJson ?? '');
  for (const r of ctx.inboxStore?.listResponses(messageId) ?? []) texts.push(r.body);
  const ids: string[] = [];
  for (const t of texts) for (const m of t.matchAll(/\/notebooks\/([a-z0-9][a-z0-9-]*)/g)) ids.push(m[1]);
  const linked: Notebook[] = [];
  for (const id of ids.reverse()) take(linked)(s.get(id));
  for (const nb of s.askedInThread(messageId)) take(linked)(nb);
  const others: Notebook[] = [];
  for (const nb of s.list()) { if (linked.length + others.length >= max) break; take(others)(nb); }
  return { linked, others };
}

/**
 * When a run in a conversation about one answer made pictures, add them to
 * that answer and say so in the conversation (Remove is under the picture).
 * A conversation about none, or several, waits for you to choose.
 */
export function fileRunPictures(ctx: Ctx, messageId: string, meta: { agentId: string; runId: string }): number {
  const pics = runPictures(ctx, meta.agentId, meta.runId).filter((p) => p.file);
  if (!pics.length || !ctx.inboxStore) return 0;
  const { linked } = answersForThread(ctx, messageId);
  if (linked.length !== 1) return 0;
  const nb = linked[0];
  const s = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
  let added = 0;
  for (const p of pics) {
    const image = readRunPicture(p);
    if ('error' in image) continue;
    if (s.picturesFromRun(meta.runId).some((x) => x.notebookId === nb.id)) continue;
    const title = pictureTitle(ctx, meta, p);
    try {
      s.addPicture(nb.id, { title, body: `Made by ${ctx.agentStore.getAgent(meta.agentId)?.name ?? meta.agentId}, from [a conversation](/inbox/${encodeURIComponent(messageId)}).`, by: `agent:${meta.agentId}`, runId: meta.runId, ...image });
      added += 1;
      ctx.inboxStore.addResponse(messageId, 'system', `Added **${title.replace(/[*_[\]]/g, '')}** to [${nb.title.replace(/[[\]]/g, '')}](/notebooks/${encodeURIComponent(nb.id)}). It's under Pictures on its page.`);
    } catch { /* left for you to add */ }
  }
  return added;
}

/** A picture's title: the run's own `title`, else what made it. */
export function pictureTitle(ctx: Ctx, meta: { agentId: string; runId: string }, p: RunPicture): string {
  const run = ctx.runStore.getRun(meta.runId);
  const t = run?.result ? extractField(run.result, 'title')?.trim() : '';
  return t || `${p.label} from ${ctx.agentStore.getAgent(meta.agentId)?.name ?? meta.agentId}`;
}
