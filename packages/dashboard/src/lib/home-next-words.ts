/**
 * "Code picks, sua words it" (ADR-0073). Home's Next up is picked by code
 * (lib/home-next.ts). Once the list is known, the `home-next` agent puts it
 * in the best order and writes each item's line of why, from the facts code
 * gives it. What it writes is checked (only known ids; a why with a number
 * its facts don't have is dropped) and kept in `.sua/home-next.json` for
 * half a day. Home never waits for it: the code version shows until the
 * worded one is ready, and whenever the agent fails.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { executeAgentDag, extractTaggedJson } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';
import type { HomeNext, NextItem } from './home-next.js';

type Ctx = ReturnType<typeof getContext>;

export const HOME_NEXT_ID = 'home-next';
const FRESH_MS = 12 * 60 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000;
export const WHY_MAX = 140;

export interface NextWords { order: string[]; why: Record<string, string> }
interface Stored { at: number; key: string; words: NextWords; tried?: number; triedKey?: string }

const path = (dataDir: string) => join(dataDir, '.sua', 'home-next.json');

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

/** Which list this wording is for: the same items, in any order. */
export function nextKey(items: readonly Pick<NextItem, 'id'>[]): string {
  return createHash('sha1').update([...items.map((x) => x.id)].sort().join('\n')).digest('hex').slice(0, 16);
}

const numbers = (text: string): string[] => text.match(/\d+(?:[.,]\d+)*/g) ?? [];

/**
 * The agent's `<next>` answer, checked against the items it was given: ids
 * it wasn't given are dropped, and a why is kept only when it is one short
 * line whose numbers all appear in that item's own title and facts. Pure.
 */
export function parseNextWords(raw: string | undefined, items: readonly NextItem[]): NextWords | undefined {
  const block = extractTaggedJson(raw ?? '', 'next');
  if (!block) return undefined;
  let v: { order?: unknown; why?: unknown };
  try { v = JSON.parse(block) as typeof v; } catch { return undefined; }
  if (!v || typeof v !== 'object') return undefined;
  const byId = new Map(items.map((x) => [x.id, x]));
  const order = [...new Set((Array.isArray(v.order) ? v.order : []).filter((id): id is string => typeof id === 'string' && byId.has(id)))];
  const why: Record<string, string> = {};
  for (const [id, text] of Object.entries(v.why && typeof v.why === 'object' ? (v.why as Record<string, unknown>) : {})) {
    const item = byId.get(id);
    if (!item || typeof text !== 'string') continue;
    const line = text.replace(/\s+/g, ' ').trim();
    if (line.length < 12 || line.length > WHY_MAX || /[!]/.test(line)) continue;
    const known = new Set(numbers(`${item.title} ${item.facts.join(' ')}`));
    if (numbers(line).some((n) => !known.has(n))) continue;
    why[id] = line;
  }
  return order.length || Object.keys(why).length ? { order, why } : undefined;
}

/** The list as worded: sua's order first (anything it left out keeps code's order after), and its why where it gave a good one. Pure. */
export function applyNextWords(items: readonly NextItem[], words: NextWords | undefined): NextItem[] {
  if (!words) return [...items];
  const byId = new Map(items.map((x) => [x.id, x]));
  const ordered = [...words.order.map((id) => byId.get(id)).filter((x): x is NextItem => !!x), ...items.filter((x) => !words.order.includes(x.id))];
  return ordered.map((x) => (words.why[x.id] ? { ...x, why: words.why[x.id] } : x));
}

/**
 * Next up as Home shows it now: worded when there's wording for this list
 * (or for some of its items), else as code wrote it. Starts a refresh in
 * the background when the list changed or the wording is half a day old.
 */
export function wordedNext(ctx: Ctx, next: HomeNext, now = Date.now()): HomeNext {
  if (next.next.length < 2) return next;
  try {
    const key = nextKey(next.next);
    const s = read(ctx.dataDir);
    const fresh = !!s && s.key === key && now - s.at < FRESH_MS;
    const triedLately = !!s?.tried && s.triedKey === key && now - s.tried < RETRY_MS;
    if (!fresh && !triedLately) refreshNextWords(ctx, next.next, key);
    // Wording for the same list is used whole; for a changed list, only the lines for items still on it (code's order).
    if (!s) return next;
    return { ...next, next: applyNextWords(next.next, s.key === key ? s.words : { order: [], why: s.words.why }) };
  } catch {
    return next;
  }
}

/** Ask the agent for this list's order and wording, in the background (one at a time). */
export function refreshNextWords(ctx: Ctx, items: readonly NextItem[], key = nextKey(items)): boolean {
  if (ctx.homeNextWording) return false;
  const fake = ctx.homeNextRun;
  // Any page test that loads Home would otherwise start a real model run.
  if (!fake && process.env.VITEST) return false;
  if (!fake && !ensureSystemAgentCurrent(ctx, HOME_NEXT_ID, "Home's Next up")) return false;
  const agent = fake ? undefined : ctx.agentStore.getAgent(HOME_NEXT_ID);
  if (!fake && !agent) return false;
  ctx.homeNextWording = true;
  const prev = read(ctx.dataDir);
  write(ctx.dataDir, { at: prev?.at ?? 0, key: prev?.key ?? '', words: prev?.words ?? { order: [], why: {} }, tried: Date.now(), triedKey: key });
  const inputs = {
    ITEMS: JSON.stringify(items.map((x) => ({ id: x.id, kind: x.kind, title: x.title, facts: x.facts }))),
    TODAY: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
  };
  const runId = randomUUID();
  const ac = new AbortController();
  ctx.activeRuns.set(runId, ac);
  const work = (async () => {
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
      const words = parseNextWords(result, items);
      // A failed run or an answer that can't be used keeps what was there; the retry waits.
      if (words) write(ctx.dataDir, { at: Date.now(), key, words });
    } catch { /* keep what was there */ } finally {
      ctx.activeRuns.delete(runId);
      ctx.homeNextWording = false;
    }
  })();
  ctx.homeNextWork = work;
  return true;
}
