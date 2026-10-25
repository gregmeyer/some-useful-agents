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
  NotebookStore, NOTEBOOK_LAYOUT_PRESETS, checkNotebookLayout, cleanLayout, executeAgentDag, extractTaggedJson, notebookLayoutGuide, suaComponentDocs,
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
    steps: (nb.steps ?? []).map((s) => ({ title: s.title, kind: s.kind, ...(s.target ? { target: s.target } : {}) })),
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

async function runPageAgent(ctx: Ctx, inputs: Record<string, string>): Promise<string | undefined> {
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
    const base = {
      NOTEBOOK: JSON.stringify(notebookForPage(nb)),
      PRESETS: NOTEBOOK_LAYOUT_PRESETS.map((p) => `${p.id}: ${p.when}`).join('\n'),
      GUIDE: notebookLayoutGuide(suaComponentDocs()),
    };
    let answer = parsePageAnswer(await runPageAgent(ctx, { ...base, ERRORS: '' }));
    if ('error' in answer) answer = parsePageAnswer(await runPageAgent(ctx, { ...base, ERRORS: answer.error }));
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
