/**
 * A notebook decides its own page (ADR-0058): once a new notebook is set up
 * (what it's for, the facts it notes, its steps), the `notebook-page` agent
 * keeps the ready-made shortlist for a choice among many, or draws a page
 * that fits another outcome (a briefing, an answer, a plan) as an A2UI
 * document. Nobody picks or approves it; Undo on Edit puts it back. A page a
 * template brought, or one already set, is never replaced. A page that
 * doesn't check out gets one more try with the reasons, then the shortlist stays.
 */
import { randomUUID } from 'node:crypto';
import {
  NotebookStore, NOTEBOOK_LAYOUT_PRESETS, checkNotebookLayout, pageRhythm, cleanLayout, executeAgentDag, extractTaggedJson, notebookLayoutGuide, suaComponentDocs, sectionKey, writesUp,
  type Notebook, type NotebookLayout,
} from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';

type Ctx = ReturnType<typeof getContext>;

export const NOTEBOOK_PAGE_ID = 'notebook-page';

/** What the page agent reads about a notebook: its goal and shape, not its options. Pure. */
export function notebookForPage(nb: Notebook): Record<string, unknown> {
  return {
    title: nb.title,
    for: nb.statement,
    limits: nb.params,
    doneWhen: nb.criteria.map((c) => c.text),
    facts: nb.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, ...(f.role ? { role: f.role } : {}) })),
    steps: (nb.steps ?? []).map((s) => ({ title: s.title, kind: s.kind, ...(s.target ? { target: s.target } : {}), ...(s.shape ? { shape: s.shape } : {}) })),
    ...(nb.checks.length ? { checks: nb.checks } : {}),
    ...(nb.stages.length ? { stages: nb.stages } : {}),
    // A notebook that searches on a schedule is likely keeping watch.
    ...(nb.cadence ? { searchesOnASchedule: nb.cadence } : {}),
    ...(written(nb) ? { written: written(nb) } : {}),
  };
}

/**
 * What was written, as its shape (never its words): the answer's or plan's
 * parts with their keys, kinds and sizes, and what each delivers, so the page
 * can be composed around them (a hero, the rest placed), plus how much it
 * rests on. A shortlist's write-up is kind "writeup": the page keeps its
 * kind and shows it. Undefined before a write step wrote anything. Pure.
 */
export function written(nb: Pick<Notebook, 'answer' | 'plan' | 'steps'>): Record<string, unknown> | undefined {
  const a = nb.answer;
  const p = nb.plan;
  const sections = a?.text ? a.sections : p?.items.length ? p.sections : undefined;
  if (!a?.text && !p?.items.length) return undefined;
  const size = (s: NonNullable<typeof sections>[number]) =>
    s.kind === 'steps' ? { steps: s.items.length } : s.kind === 'table' ? { rows: s.rows.length, columns: s.columns } : s.kind === 'diagram' ? { diagram: s.diagram.type, parts: s.diagram.type === 'ladder' ? s.diagram.rungs.length : s.diagram.type === 'split' ? s.diagram.parts.length : s.diagram.nodes.length, ...(s.diagram.type !== 'flow' && s.diagram.params?.length ? { whatIf: s.diagram.params.map((p) => p.key) } : {}) } : { words: s.body.split(/\s+/).length };
  return {
    kind: a?.text ? (writesUp(nb) ? 'writeup' : 'answer') : 'plan',
    ...(a?.text ? { confidence: a.confidence, findings: a.findings.length, open: a.open.length } : {}),
    ...(p?.items.length ? { days: new Set(p.items.map((i) => i.when)).size, before: p.before.length, open: p.open.length } : {}),
    parts: (sections ?? []).map((s) => ({ key: sectionKey(s), title: s.title, kind: s.kind, ...size(s), ...(s.delivers ? { delivers: s.delivers } : {}) })),
  };
}

export type PageAnswer =
  /** Keep the default (the shortlist): nothing to set. */
  | { keep: true; about?: string }
  | { layout: NotebookLayout }
  | { error: string };

/** The agent's <page>: the shortlist kept, a page that checks out, or why it doesn't. Pure. */
export function parsePageAnswer(raw: string | undefined): PageAnswer {
  const block = extractTaggedJson(raw ?? '', 'page');
  if (!block) return { error: 'There was no <page> block.' };
  let v: { preset?: unknown; components?: unknown; about?: unknown };
  try { v = JSON.parse(block) as typeof v; } catch { return { error: 'The <page> block wasn\'t valid JSON.' }; }
  const about = typeof v.about === 'string' ? v.about.trim().slice(0, 200) : undefined;
  if (v.components === undefined) {
    if (v.preset === 'shortlist' || v.preset === undefined) return { keep: true, ...(about ? { about } : {}) };
    const preset = typeof v.preset === 'string' ? cleanLayout(v.preset) : undefined;
    return preset ? { layout: { ...preset, ...(about ? { about } : {}) } } : { error: `There's no ready-made page "${String(v.preset)}"; use one of ${NOTEBOOK_LAYOUT_PRESETS.map((p) => p.id).join(', ')}, or draw one.` };
  }
  const check = checkNotebookLayout(v.components);
  if (!check.ok) return { error: check.errors.slice(0, 6).join('; ') };
  return { layout: { components: check.components, ...(about ? { about } : {}) } };
}

/** One run of the page agent (or the test's stand-in): its answer, or undefined. Never throws. */
export async function runNotebookPageAgent(ctx: Ctx, inputs: Record<string, string>): Promise<string | undefined> {
  if (ctx.notebookPageRun) return ctx.notebookPageRun(inputs);
  if (!ensureSystemAgentCurrent(ctx, NOTEBOOK_PAGE_ID, 'notebook pages')) return undefined;
  const agent = ctx.agentStore.getAgent(NOTEBOOK_PAGE_ID);
  if (!agent) return undefined;
  const runId = randomUUID();
  const ac = new AbortController();
  ctx.activeRuns.set(runId, ac);
  try {
    // No onRunFailure: a page that can't be drawn leaves the shortlist, not an inbox thread.
    await executeAgentDag(agent, { triggeredBy: 'dashboard', runId, signal: ac.signal, inputs }, {
      runStore: ctx.runStore, secretsStore: ctx.secretsStore, variablesStore: ctx.variablesStore,
      dataRoot: ctx.agentStore.dataRoot, llmSettings: buildLlmSettingsSnapshot(ctx), spawnNode: ctx.workflowSpawnNode,
    });
    const run = ctx.runStore.getRun(runId);
    return run?.status === 'completed' ? run.result ?? undefined : undefined;
  } catch {
    return undefined;
  } finally {
    ctx.activeRuns.delete(runId);
  }
}

export type PageOutcome = 'drawn' | 'kept' | 'skipped' | 'failed';

/** What the page agent is given for a notebook: it, the ready-made pages, and how to draw one. Pure. */
export function pageAgentInputs(nb: Notebook): Record<string, string> {
  return {
    NOTEBOOK: JSON.stringify(notebookForPage(nb)),
    // The shortlist by name; the others with their documents, to use as they are or start from.
    PRESETS: NOTEBOOK_LAYOUT_PRESETS.map((p) => `${p.id}: ${p.when}${p.id === 'shortlist' ? '' : `\n  its page: ${JSON.stringify(p.layout.components)}`}`).join('\n'),
    GUIDE: notebookLayoutGuide(suaComponentDocs()),
    ERRORS: '',
    ASK: '',
    CURRENT: '',
  };
}

export interface DrawnPage {
  answer: PageAnswer;
  /** 1, or 2 when the first answer couldn't be used or read like a grid. */
  tries: number;
  /** Why the first answer got another try (an error, or the rhythm notes), if it did. */
  firstNotes?: string;
}

/**
 * Ask for a notebook's page with `ask` (the agent, or a recorded answer):
 * a page drawn for it that can't be used, or breaks the editorial rhythm (a
 * grid of frames, one shape after another), gets one more try with the
 * reasons; if that try can't be drawn, the first stands. With a `request`
 * ("put who they are at the top"), it changes `current` to do it.
 */
export async function drawNotebookPage(nb: Notebook, ask: (inputs: Record<string, string>) => Promise<string | undefined>, opts: { request?: string; current?: NotebookLayout } = {}): Promise<DrawnPage> {
  // Asked for a change (the Edit page): what they said, and the page it changes (none: the shortlist).
  const base = { ...pageAgentInputs(nb), ...(opts.request ? { ASK: opts.request, CURRENT: opts.current ? JSON.stringify(opts.current.components) : '' } : {}) };
  const first = parsePageAnswer(await ask(base));
  const rhythm = 'layout' in first && !first.layout.preset ? pageRhythm(first.layout.components) : [];
  if (!('error' in first) && !rhythm.length) return { answer: first, tries: 1 };
  const firstNotes = 'error' in first ? first.error : `It can be drawn, but it reads like a grid: ${rhythm.join(' ')}`;
  const again = parsePageAnswer(await ask({ ...base, ERRORS: firstNotes }));
  return { answer: !('error' in again) || 'error' in first ? again : first, tries: 2, firstNotes };
}

/**
 * Let a notebook decide its page. `again`: decide even though it has a page
 * already (Edit's "Let it pick its page"); otherwise a notebook with a page
 * (a template's, or one drawn since) keeps it. Never throws.
 */
export async function decideNotebookPage(ctx: Ctx, notebookId: string, opts: { again?: boolean; /** Compose the page it has (a ready-made one you picked) around what's written, keeping its kind; saved as `picked`. */ keep?: boolean } = {}): Promise<PageOutcome> {
  const store = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
  const nb = store.get(notebookId);
  if (!nb || (nb.layout && !opts.again)) return 'skipped';
  ctx.notebookPages ??= new Set();
  if (ctx.notebookPages.has(notebookId)) return 'skipped';
  ctx.notebookPages.add(notebookId);
  try {
    const { answer } = await drawNotebookPage(nb, (inputs) => runNotebookPageAgent(ctx, inputs), opts.keep ? { request: writesUp(nb) && nb.answer?.text ? KEEP_AND_ADD_WRITEUP : KEEP_AND_COMPOSE, ...(nb.layout ? { current: nb.layout } : {}) } : {});
    const now = store.get(notebookId);
    // Gone, or given a page meanwhile (a card, a template, by hand): that stands.
    if (!now || (!opts.again && now.layout) || (opts.again && JSON.stringify(now.layout) !== JSON.stringify(nb.layout))) return 'skipped';
    if ('error' in answer) return 'failed';
    if ('keep' in answer) {
      // A picked page that sua would keep as is: it stays yours as picked.
      if (now.layout && !opts.keep) store.setLayout(notebookId, undefined, 'notebook');
      return 'kept';
    }
    store.setLayout(notebookId, answer.layout, opts.keep ? 'picked' : 'notebook');
    return 'drawn';
  } catch {
    return 'failed';
  } finally {
    ctx.notebookPages.delete(notebookId);
  }
}

/**
 * Its page is still the notebook's own pick (or the shortlist it started
 * with), not one you changed, approved on a card, or a template brought:
 * the notebook may decide it again. Pure.
 */
export function pageIsItsOwn(nb: Pick<Notebook, 'layout' | 'layoutBy'>): boolean {
  return nb.layoutBy === 'notebook' || (!nb.layout && !nb.layoutBy);
}

/** A ready-made page you picked on Edit: sua composes it around what's written, but never swaps it for another kind. */
export function pageIsPicked(nb: Pick<Notebook, 'layout' | 'layoutBy'>): boolean {
  return nb.layoutBy === 'picked';
}

/** What the page agent is asked when a picked page is composed around what was written. */
export const KEEP_AND_COMPOSE = 'Keep this page\'s kind and its parts, but compose it around what was written: one hero (a diagram or a rubric as a Figure, or the answer), each written part placed by its key, a Lead where a number decides it, the rest as it is.';
/** A drawn page gets the write-up's parts added (no hero; the page keeps its kind), ADR-0069. */
export const KEEP_AND_ADD_WRITEUP = 'Keep this page\'s kind and its parts, and add the write-up where it reads: its Callout (/notebook/answer/*) near the top in place of where it stands, its parts (AnswerSections of /notebook/answerSections) in a feature Panel after the options, and what it rests on (an Agenda of /notebook/findings and /notebook/openQuestions), each "when": "answered". No hero; everything else stays.';
