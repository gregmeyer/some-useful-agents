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
  NotebookStore, NOTEBOOK_LAYOUT_PRESETS, checkNotebookLayout, pageRhythm, cleanLayout, executeAgentDag, extractTaggedJson, notebookLayoutGuide, suaComponentDocs,
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
export async function decideNotebookPage(ctx: Ctx, notebookId: string, opts: { again?: boolean } = {}): Promise<PageOutcome> {
  const store = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
  const nb = store.get(notebookId);
  if (!nb || (nb.layout && !opts.again)) return 'skipped';
  ctx.notebookPages ??= new Set();
  if (ctx.notebookPages.has(notebookId)) return 'skipped';
  ctx.notebookPages.add(notebookId);
  try {
    const { answer } = await drawNotebookPage(nb, (inputs) => runNotebookPageAgent(ctx, inputs));
    const now = store.get(notebookId);
    // Gone, or given a page meanwhile (a card, a template, by hand): that stands.
    if (!now || (!opts.again && now.layout) || (opts.again && JSON.stringify(now.layout) !== JSON.stringify(nb.layout))) return 'skipped';
    if ('error' in answer) return 'failed';
    if ('keep' in answer) {
      if (now.layout) store.setLayout(notebookId, undefined, 'notebook');
      return 'kept';
    }
    store.setLayout(notebookId, answer.layout, 'notebook');
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
