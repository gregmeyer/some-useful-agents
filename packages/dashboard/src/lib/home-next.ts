/**
 * Home's "Next up": a few specific things to do next, picked from what you
 * have (your notebooks, agents and conversations), each with one button
 * that does it. Pure (`pickNext`) with a reader (`homeNext`).
 *
 * Code picks the candidates, so every one is real and its button works.
 * Archived notebooks are used only as patterns (what kinds you make, about
 * what): never as something to reopen.
 */
import { ItemDismissals, NotebookStore, SYSTEM_AGENT_IDS, notebookTags, threadAsk, type Agent, type Notebook, type NotebookDraftRecord, type NotebookTemplate } from '@some-useful-agents/core';
import { agentShelves, DEMO_RE } from '../routes/agents/list.js';
import { currentStep, isYourStep } from './notebook-steps.js';
import { perItemInputs } from './notebook-pipeline.js';
import { runFill, runsAsIs } from './home-suggestions.js';
import type { getContext } from '../context.js';

type Ctx = ReturnType<typeof getContext>;

export type NextKind = 'your-step' | 'reply' | 'start-template' | 'start-like' | 'run-agent' | 'schedule-agent' | 'failing' | 'draft-notebook' | 'sleeping-schedule';

export interface NextAction {
  label: string;
  /** A page to open. */
  href?: string;
  /** A form to post (runs an agent in a conversation). */
  post?: string;
  /** Words to put in Ask sua, for you to finish and send. */
  fill?: string;
  /** A conversation to open in the panel. */
  thread?: string;
}

export interface NextItem {
  /** Stable for the same thing, so "Not now" sticks: `next:<kind>:<key>`. */
  id: string;
  kind: NextKind;
  title: string;
  /** Why it's here, in a line, from the facts. */
  why: string;
  /** What `why` rests on (for sua, when it words the list). */
  facts: string[];
  action: NextAction;
  /** A second, quieter link. */
  open?: { label: string; href: string };
  score: number;
  /** Clean-up, not something to do next: shown folded under Housekeeping. */
  tidy?: boolean;
  /** Shown only when there's little else to offer (an agent you haven't tried). */
  filler?: boolean;
}

export interface NextThread { id: string; title: string; at: number; source: string; notebookId?: string; lastRole?: string; userSpoke: boolean; asks: boolean;
  /** What sua asked you at the end of its last message, when it ended on a question. */
  question?: string }

export interface NextData {
  /** Every notebook, archived ones too (they're the patterns). */
  notebooks: readonly Notebook[];
  /** Ids of notebooks with an option chosen. */
  chosen?: ReadonlySet<string>;
  templates: readonly NotebookTemplate[];
  drafts: readonly NotebookDraftRecord[];
  agents: readonly Agent[];
  lastRunAt: ReadonlyMap<string, string>;
  runCounts: ReadonlyMap<string, number>;
  /** Runs you started yourself in the last 30 days (not a schedule's, not another agent's), for agents worth asking about. */
  handRuns?: ReadonlyMap<string, number>;
  /** Failed runs in the last 30 days, by agent. */
  failures: ReadonlyMap<string, number>;
  threads: readonly NextThread[];
  /** item id → when you said "Not now". */
  dismissed: ReadonlyMap<string, string>;
  now?: number;
}

const DAY = 86_400_000;
/** "Not now" hides it this long. */
export const NOT_NOW_DAYS = 7;
export const NEXT_SHOWN = 5;
const PER_KIND = 2;
/** Below this many, agents you haven't tried fill in. */
const FILL_TO = 3;

function ago(iso: string | number | undefined, now: number): string {
  if (iso === undefined) return '';
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = Math.floor((now - t) / DAY);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 14) return `${String(d)} days ago`;
  if (d < 60) return `${String(Math.floor(d / 7))} weeks ago`;
  return `${String(Math.floor(d / 30))} months ago`;
}

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t);

/** Whether "Not now" still hides it. */
export function notNow(dismissed: ReadonlyMap<string, string>, id: string, now: number): boolean {
  const at = dismissed.get(id);
  return !!at && now - Date.parse(at) < NOT_NOW_DAYS * DAY;
}

/** Everything worth offering, best first; `tidy` ones are for Housekeeping. Pure. */
export function nextCandidates(d: NextData): NextItem[] {
  const now = d.now ?? Date.now();
  const out: NextItem[] = [];
  const add = (item: NextItem) => { if (!notNow(d.dismissed, item.id, now)) out.push(item); };

  // ── Notebooks you have open: a step that's yours, or one you picked from but never closed.
  const waiting = new Set(d.threads.filter((t) => t.asks).map((t) => t.id));
  for (const nb of d.notebooks) {
    if (nb.archivedAt || nb.status !== 'active') continue;
    // Its conversation is already under Needs you.
    if (nb.conversationId && waiting.has(nb.conversationId)) continue;
    const step = currentStep(nb);
    const href = `/notebooks/${encodeURIComponent(nb.id)}`;
    if (step && isYourStep(step)) {
      add({ id: `next:your-step:${nb.id}`, kind: 'your-step', title: `${step.title}: ${clip(nb.title, 60)}`, why: `The next step is yours. Last touched ${ago(nb.updatedAt, now)}.`, facts: [`notebook: ${nb.title}`, `step waiting on you: ${step.title}`, `last touched ${ago(nb.updatedAt, now)}`], action: { label: 'Open it', href }, score: 100 });
    } else if (d.chosen?.has(nb.id)) {
      add({ id: `next:your-step:${nb.id}`, kind: 'your-step', title: `Finish ${clip(nb.title, 60)}`, why: `You picked one but didn't mark it decided. Last touched ${ago(nb.updatedAt, now)}.`, facts: [`notebook: ${nb.title}`, 'an option is chosen, the notebook is not marked decided', `last touched ${ago(nb.updatedAt, now)}`], action: { label: 'Open it', href }, score: 95 });
    }
  }

  // ── Conversations sua left on a question to you (one it answered and you read isn't something to do).
  const archivedNb = new Set(d.notebooks.filter((n) => n.archivedAt).map((n) => n.id));
  for (const t of [...d.threads].sort((a, b) => b.at - a.at)) {
    if (t.asks || !t.userSpoke || t.lastRole !== 'triage' || t.source !== 'manual' || !t.question) continue;
    if (now - t.at > 14 * DAY) continue;
    // A conversation about a notebook you've put away isn't something to pick back up.
    if (t.notebookId && archivedNb.has(t.notebookId)) continue;
    add({ id: `next:reply:${t.id}`, kind: 'reply', title: clip(t.title.replace(/^Notebook:\s*/, ''), 70), why: `sua asked ${ago(t.at, now)}: “${clip(t.question, 110)}”`, facts: [`conversation: ${t.title}`, `sua asked, ${ago(t.at, now)}: ${clip(t.question, 200)}`], action: { label: 'Open it', thread: t.id }, score: 80 - Math.min(20, Math.floor((now - t.at) / DAY) * 2) });
  }

  // ── Start another of what you make: your templates, then the topic you keep coming back to.
  const usedTemplates = d.templates.filter((t) => !t.archivedAt && t.uses > 0).sort((a, b) => b.uses - a.uses || (b.usedAt ?? '').localeCompare(a.usedAt ?? ''));
  for (const t of usedTemplates.slice(0, PER_KIND)) {
    const fill = t.setup.subject ? `Start a new notebook from my “${t.name}” template for ` : `Start a new notebook from my “${t.name}” template.`;
    add({ id: `next:start-template:${t.id}`, kind: 'start-template', title: t.setup.subject ? `Start a ${lower(t.name)} for…` : `Start a ${lower(t.name)}`, why: `Your template, used ${times(t.uses)}${t.usedAt ? `, last ${ago(t.usedAt, now)}` : ''}.`, facts: [`template: ${t.name}`, `used ${times(t.uses)}`, ...(t.usedAt ? [`last used ${ago(t.usedAt, now)}`] : [])], action: { label: 'Start', fill }, score: 60 + Math.min(8, t.uses) });
  }
  // The tag most of your recent notebooks share, and the latest notebook with it as the one to set up like.
  const recent = d.notebooks.filter((n) => now - Date.parse(n.createdAt) < 60 * DAY);
  const byTag = new Map<string, Notebook[]>();
  for (const nb of recent) for (const tag of notebookTags(nb)) byTag.set(tag, [...(byTag.get(tag) ?? []), nb]);
  const topics = [...byTag.entries()].filter(([, nbs]) => nbs.length >= 3).sort((a, b) => b[1].length - a[1].length);
  const used = new Set<string>();
  let likes = 0;
  for (const [tag, nbs] of topics) {
    if (likes === 1) break;
    const latest = [...nbs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    // One suggestion per notebook, and not one a template of yours already covers by name.
    if (used.has(latest.id)) continue;
    used.add(latest.id);
    likes++;
    add({ id: `next:start-like:${tag}`, kind: 'start-like', title: `Start another on ${tag}`, why: `You've made ${String(nbs.length)} notebooks on ${tag}; the last was ${ago(latest.createdAt, now)}.`, facts: [`topic: ${tag}`, `${String(nbs.length)} notebooks on it in the last 60 days`, `latest: “${latest.title}”, started ${ago(latest.createdAt, now)}`], action: { label: 'Start', fill: `Set up a new notebook like “${latest.title}”, for ` }, score: 50 + Math.min(8, nbs.length) });
  }

  // ── Agents: run a go-to you haven't run today, put one you run by hand on a schedule.
  const weekAgo = new Date(now - 7 * DAY).toISOString();
  const dayAgo = new Date(now - DAY).toISOString();
  const yours = d.agents.filter((a) => a.status === 'active' && !SYSTEM_AGENT_IDS.has(a.id) && !(DEMO_RE.test(a.id) || DEMO_RE.test(a.name)) && !perItemInputs(a));
  const shelves = agentShelves(yours, { lastRunAt: d.lastRunAt, runCounts: d.runCounts, feeds: new Map(), weekAgo });
  const goTo = new Set(shelves.goTo.map((a) => a.id));
  let runs = 0;
  for (const a of [...shelves.goTo, ...shelves.recent.filter((x) => !goTo.has(x.id))]) {
    if (runs === PER_KIND) break;
    const last = d.lastRunAt.get(a.id);
    // Ran today already, runs on its own, or can't run as it is.
    if ((last ?? '') >= dayAgo || a.schedule || !runsAsIs(a)) continue;
    const n = d.handRuns?.get(a.id) ?? d.runCounts.get(a.id) ?? 0;
    const fill = runFill(a);
    runs++;
    add({ id: `next:run-agent:${a.id}`, kind: 'run-agent', title: `Run ${a.name}`, why: `${a.starred ? 'One you starred' : goTo.has(a.id) ? 'One you use a lot' : 'You used it this week'}: run ${times(n)} this month${last ? `, last ${ago(last, now)}` : ''}.`, facts: [`agent: ${a.name}`, `${times(n)} run in the last 30 days`, ...(last ? [`last ran ${ago(last, now)}`] : []), ...(a.description?.trim() ? [`does: ${clip(a.description.trim(), 140)}`] : [])], action: fill ? { label: 'Run it…', fill } : { label: 'Run it', post: `/home/try/${encodeURIComponent(a.id)}` }, open: { label: 'Open', href: `/agents/${encodeURIComponent(a.id)}` }, score: 42 + Math.min(12, n) });
  }
  // Ones you haven't tried, for when there's little else: a real description, tutorials last.
  const untried = yours.filter((a) => !d.lastRunAt.has(a.id) && runsAsIs(a) && !a.schedule && !!a.description?.trim())
    .sort((a, b) => Number(/\bTeaches\b/.test(a.description ?? '')) - Number(/\bTeaches\b/.test(b.description ?? '')));
  for (const a of untried.slice(0, PER_KIND)) {
    const fill = runFill(a);
    add({ id: `next:run-agent:${a.id}`, kind: 'run-agent', title: `Try ${a.name}`, why: `New to you: ${clip(a.description!.trim(), 110)}`, facts: [`agent: ${a.name}`, 'never run', `does: ${clip(a.description!.trim(), 140)}`], action: fill ? { label: 'Run it…', fill } : { label: 'Run it', post: `/home/try/${encodeURIComponent(a.id)}` }, open: { label: 'Open', href: `/agents/${encodeURIComponent(a.id)}` }, score: 15, filler: true });
  }
  // Only runs you started count: one that other agents call all day isn't asking for a schedule.
  // And only one that runs as it is: one that needs something each time (a list to research) can't run on a clock.
  const unscheduled = shelves.goTo.find((a) => !a.schedule && runsAsIs(a) && (d.handRuns?.get(a.id) ?? 0) >= 5);
  if (unscheduled) {
    const n = d.handRuns?.get(unscheduled.id) ?? 0;
    add({ id: `next:schedule-agent:${unscheduled.id}`, kind: 'schedule-agent', title: `Put ${unscheduled.name} on a schedule`, why: `You ran it by hand ${times(n)} this month.`, facts: [`agent: ${unscheduled.name}`, `run by hand ${times(n)} in the last 30 days`, 'has no schedule'], action: { label: 'Schedule it…', fill: `Put ${unscheduled.name} (${unscheduled.id}) on a schedule that suits what it does.` }, open: { label: 'Open', href: `/agents/${encodeURIComponent(unscheduled.id)}` }, score: 40 });
  }

  // ── Agents that keep failing. The worst is worth a look now; the rest is clean-up.
  // Four or more failures, and at least one run in eight: a busy agent with the odd failure isn't failing.
  const failing = d.agents.filter((a) => a.status === 'active' && !SYSTEM_AGENT_IDS.has(a.id) && (d.failures.get(a.id) ?? 0) >= 4
    && (d.failures.get(a.id) ?? 0) * 8 >= Math.max(d.runCounts.get(a.id) ?? 0, d.failures.get(a.id) ?? 0))
    .sort((a, b) => (d.failures.get(b.id) ?? 0) - (d.failures.get(a.id) ?? 0));
  failing.forEach((a, i) => {
    const f = d.failures.get(a.id) ?? 0;
    const n = d.runCounts.get(a.id) ?? f;
    add({ id: `next:failing:${a.id}`, kind: 'failing', title: `${a.name} keeps failing`, why: `${String(f)} of its ${String(Math.max(n, f))} runs failed this month.`, facts: [`agent: ${a.name}`, `${String(f)} failed runs of ${String(Math.max(n, f))} in the last 30 days`, ...(a.schedule ? ['runs on a schedule'] : [])], action: { label: 'See why…', fill: `Why does ${a.name} (${a.id}) keep failing, and can you fix it?` }, open: { label: 'Open', href: `/agents/${encodeURIComponent(a.id)}` }, score: (i > 0 ? 30 : 58) + Math.min(10, f), ...(i > 0 ? { tidy: true } : {}) });
  });

  // ── Housekeeping.
  for (const dr of d.drafts) {
    if (dr.status !== 'ready') continue;
    const title = draftTitle(dr);
    add({ id: `next:draft-notebook:${dr.id}`, kind: 'draft-notebook', title: `Start or drop the draft “${clip(title, 50)}”`, why: `Drafted ${ago(dr.createdAt, now)}, never started.`, facts: [`notebook draft: ${title}`, `drafted ${ago(dr.createdAt, now)}`], action: { label: 'Open the draft', href: `/notebooks/new?draft=${encodeURIComponent(dr.id)}` }, score: 20, tidy: true });
  }
  for (const a of d.agents) {
    // Paused is your call; a draft with a schedule looks set up but never runs.
    if (!a.schedule || SYSTEM_AGENT_IDS.has(a.id) || a.status !== 'draft') continue;
    add({ id: `next:sleeping-schedule:${a.id}`, kind: 'sleeping-schedule', title: `${a.name} has a schedule but is still a draft`, why: 'It never runs on its own until you turn it on.', facts: [`agent: ${a.name}`, `status: ${a.status}`, `schedule: ${a.schedule}`], action: { label: 'Open it', href: `/agents/${encodeURIComponent(a.id)}` }, score: 10, tidy: true });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** The question a message ends on ("…Blue or green?"), in plain words; none when it ends on a statement. */
export function closingQuestion(body: string): string | undefined {
  const text = body.replace(/```[\s\S]*?```/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  if (!text.endsWith('?')) return undefined;
  const start = Math.max(text.lastIndexOf('. ', text.length - 2), text.lastIndexOf('! ', text.length - 2), text.lastIndexOf('? ', text.length - 2), text.lastIndexOf(': ', text.length - 2));
  const q = text.slice(start < 0 ? 0 : start + 2).trim();
  return q.length >= 8 ? q : text.slice(-160).trim();
}

function lower(name: string): string {
  // "Meeting briefing" → "meeting briefing"; a name with its own capitals inside ("RAV4 tires") is kept.
  return /^[A-Z][a-z]+(\s[a-z]+)*$/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name;
}

function times(n: number): string {
  return n === 1 ? 'once' : n === 2 ? 'twice' : `${String(n)} times`;
}

function draftTitle(dr: NotebookDraftRecord): string {
  const t = (dr.draft as { title?: unknown } | undefined)?.title;
  return typeof t === 'string' && t.trim() ? t.trim() : dr.text.replace(/\s+/g, ' ').trim();
}

export interface HomeNext { next: NextItem[]; tidy: NextItem[] }

/** Next up (at most `NEXT_SHOWN`, at most two of a kind) and Housekeeping. Pure. */
export function pickNext(d: NextData): HomeNext {
  const all = nextCandidates(d);
  const next: NextItem[] = [];
  const per = new Map<NextKind, number>();
  const group = (k: NextKind): NextKind => (k === 'start-like' ? 'start-template' : k);
  for (const item of all) {
    if (item.tidy || next.length === NEXT_SHOWN) continue;
    // Something to try only fills a short list.
    if (item.filler && next.length >= FILL_TO) continue;
    const n = per.get(group(item.kind)) ?? 0;
    if (n === PER_KIND) continue;
    per.set(group(item.kind), n + 1);
    next.push(item);
  }
  const shown = new Set(next.map((x) => x.id));
  // What didn't fit above isn't clean-up, except an agent that keeps failing: the tidy kinds go under Housekeeping.
  return { next, tidy: all.filter((x) => (x.tidy || x.kind === 'failing') && !shown.has(x.id)).slice(0, 12) };
}

/** Home's Next up, from the stores. Never throws: an empty list on any failure. */
export function homeNext(ctx: Ctx, now = Date.now()): HomeNext {
  try {
    const db = ctx.runStore.databaseHandle();
    const nbs = NotebookStore.fromHandle(db);
    const notebooks = nbs.list({ archived: 'include' });
    const chosen = new Set<string>();
    for (const nb of notebooks) {
      if (nb.archivedAt || nb.status !== 'active') continue;
      if (nbs.entries(nb.id, 500).some((e) => e.kind === 'option' && !!e.chosenAt && !e.ruledOut)) chosen.add(nb.id);
    }
    const since = new Date(now - 30 * DAY).toISOString();
    const failures = new Map<string, number>();
    for (const r of ctx.runStore.queryRuns({ statuses: ['failed'], since, limit: 500 }).rows) failures.set(r.agentName, (failures.get(r.agentName) ?? 0) + 1);
    const threads: NextThread[] = [];
    for (const m of ctx.inboxStore?.list({ statuses: ['open', 'triaged', 'awaiting_user', 'verifying'], limit: 60 }) ?? []) {
      const responses = ctx.inboxStore!.listResponses(m.id);
      const said = responses.filter((r) => r.role === 'user' || r.role === 'triage');
      let notebookId: string | undefined;
      try { const page = (JSON.parse(m.contextJson ?? '{}') as { page?: { kind?: string; id?: string } }).page; if (page?.kind === 'notebook' && page.id) notebookId = page.id; } catch { /* no page */ }
      threads.push({
        id: m.id, title: m.title, source: m.source, at: m.lastActivityAt ?? responses[responses.length - 1]?.createdAt ?? m.createdAt,
        ...(notebookId ? { notebookId } : {}), ...(said.length ? { lastRole: said[said.length - 1].role } : {}),
        userSpoke: said.some((r) => r.role === 'user'), asks: !!threadAsk(m, responses),
        ...(said.length && said[said.length - 1].role === 'triage' && closingQuestion(said[said.length - 1].body) ? { question: closingQuestion(said[said.length - 1].body) } : {}),
      });
    }
    // For the busiest unscheduled agents, how many of those runs you started yourself.
    const agents = ctx.agentStore.listAgents();
    const runCounts = ctx.runStore.runCountsByAgent(since);
    const handRuns = new Map<string, number>();
    const busy = agents.filter((a) => a.status === 'active' && !a.schedule && !SYSTEM_AGENT_IDS.has(a.id) && (runCounts.get(a.id) ?? 0) >= 1)
      .sort((a, b) => (runCounts.get(b.id) ?? 0) - (runCounts.get(a.id) ?? 0)).slice(0, 12);
    for (const a of busy) handRuns.set(a.id, ctx.runStore.queryRuns({ agentName: a.id, since, limit: 200 }).rows.filter((r) => !r.parentRunId && r.triggeredBy !== 'schedule').length);
    return pickNext({
      notebooks, chosen, templates: nbs.listTemplates(), drafts: nbs.listDrafts(10),
      agents, lastRunAt: ctx.runStore.latestRunAtByAgent(), runCounts, handRuns,
      failures, threads, dismissed: ItemDismissals.fromHandle(db).all(), now,
    });
  } catch {
    return { next: [], tidy: [] };
  }
}

/** "Not now": hide it for a week. Only ids Next up makes. */
export function dismissNext(ctx: Ctx, id: string): boolean {
  if (!/^next:[a-z-]+:.{1,200}$/.test(id)) return false;
  ItemDismissals.fromHandle(ctx.runStore.databaseHandle()).dismiss(id);
  return true;
}
