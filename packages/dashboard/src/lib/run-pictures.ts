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
import { mcpServersIn, resolveOutputFile } from '../routes/output-files.js';

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
    const found = resolveOutputFile(said, servers);
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
 * Answers to offer for a picture from a conversation: the ones it links to
 * (latest mention first) and the ones asked from it, then the latest others.
 * The first is the one the conversation is about.
 */
export function answersForThread(ctx: Ctx, messageId: string, max = 12): Notebook[] {
  let s: NotebookStore;
  try { s = NotebookStore.fromHandle(ctx.runStore.databaseHandle()); } catch { return []; }
  const seen = new Set<string>();
  const out: Notebook[] = [];
  const add = (nb: Notebook | undefined) => {
    if (!nb || seen.has(nb.id) || nb.experimentRun) return;
    seen.add(nb.id);
    out.push(nb);
  };
  const texts: string[] = [];
  const msg = ctx.inboxStore?.get(messageId);
  if (msg) texts.push(msg.title, msg.body, msg.contextJson ?? "");
  for (const r of ctx.inboxStore?.listResponses(messageId) ?? []) texts.push(r.body);
  const linked: string[] = [];
  for (const t of texts) for (const m of t.matchAll(/\/notebooks\/([a-z0-9][a-z0-9-]*)/g)) linked.push(m[1]);
  for (const id of linked.reverse()) add(s.get(id));
  for (const nb of s.askedInThread(messageId)) add(nb);
  for (const nb of s.list()) { if (out.length >= max) break; add(nb); }
  return out.slice(0, max);
}
