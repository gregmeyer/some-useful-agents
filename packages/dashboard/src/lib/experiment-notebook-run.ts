/**
 * One cell of a notebook experiment (ADR-0079): a fresh copy of the
 * notebook, with what its version changes laid over its setup, taken
 * through its steps with nobody pressing Continue, then read.
 *
 * - The copy has the source's setup (what it's for, limits, checks, fields,
 *   steps, what it was given) and none of what it found. It is marked as an
 *   experiment's, so it stays out of every notebook list, has no
 *   conversation and raises nothing in the inbox.
 * - A step that reaches its goal goes on to the next. A step that stops
 *   short moves on with what it has, and the cell's note says so. It ends
 *   before the first step that is yours (Decide): nothing is ever chosen.
 * - What is read out: the options still in the running, sua's picks first,
 *   then in the order they were found (by name when found together). These are the cell's items.
 * - The copy is kept, archived, for opening from the experiment's page.
 */
import { NotebookStore, conditionLevels, experimentConditions, itemKey, optionLink, templateFromNotebook, type Experiment, type ExperimentCell, type ExperimentLevel, type ExperimentStore, type Notebook, type NotebookStep, type OutputItem } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { currentStep, fitStepAgents, isYourStep, moveOnFromStep, startNotebookStep, stopNotebookStep } from './notebook-steps.js';
import { suaStepAgent } from './notebook-step-agents.js';
import { startGivenRead } from './notebook-given-read.js';
import type { CopySwap } from './experiment-copy-agent.js';

type Ctx = ReturnType<typeof getContext>;

/** How long one copy may take, start to finish. */
export const COPY_TIMEOUT_MS = 45 * 60 * 1000;
const POLL_MS = 100;

const notebooks = (ctx: Ctx) => NotebookStore.fromHandle(ctx.runStore.databaseHandle());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Why a notebook can't be the subject of an experiment, or undefined when it can. */
export function notebookUntestable(nb: Notebook | undefined): string | undefined {
  if (!nb) return 'That notebook is gone.';
  if (nb.experimentId || nb.experimentRun) return 'That notebook shows or belongs to an experiment; choose one of your own.';
  if (!nb.fields.length) return 'That notebook isn\'t set up yet (it has no facts to record).';
  const steps = (nb.steps ?? []).filter((s) => !isYourStep(s));
  if (!steps.length) return 'That notebook has no steps sua runs, so there is nothing to run again.';
  return undefined;
}

/**
 * The copy's setup: the source's, with a version's limits, checks, given
 * text and step agents in place of its own. Also how its agents are swapped
 * while it runs (versions pinned, provider and model). Pure but for reading
 * which agent sua uses for a step.
 */
export function copySetup(source: Notebook, levels: readonly ExperimentLevel[]): { params: string[]; checks: string[]; steps: NotebookStep[]; given: unknown[]; changedGiven: string[]; swap: CopySwap; problem?: string } {
  const t = templateFromNotebook(source);
  let params = [...t.params];
  let checks = [...(t.checks ?? [])];
  let steps = (t.steps ?? []).map((s) => ({ ...s }));
  const given = (source.given ?? []).map((g) => ({ ...g }));
  const changedGiven: string[] = [];
  const versions: Record<string, number> = {};
  let problem: string | undefined;
  for (const l of levels) {
    if (l.params) params = [...l.params];
    if (l.checks) checks = [...l.checks];
    for (const [key, text] of Object.entries(l.given ?? {})) {
      const g = given.find((x) => x.key === key);
      if (!g) { problem = `The notebook isn't given anything called "${key}".`; continue; }
      // Its reading was of the old text: read again before its steps run.
      Object.assign(g, { text, state: 'given', read: undefined, link: undefined, cut: undefined, why: undefined });
      changedGiven.push(key);
    }
    if (l.step) {
      const step = steps.find((s) => s.id === l.step!.id);
      if (!step) { problem = `The notebook has no step "${l.step.id}".`; continue; }
      if (l.step.agentId !== undefined) steps = steps.map((s) => (s.id === step.id ? { ...s, agentId: l.step!.agentId || undefined } : s));
      const agentId = l.step.agentId || step.agentId || suaStepAgent(step.kind);
      if (l.version !== undefined && agentId) versions[agentId] = l.version;
    }
  }
  return { params, checks, steps, given, changedGiven, swap: { levels: levels.map((l) => ({ id: l.id, name: l.name, ...(l.provider ? { provider: l.provider } : {}), ...(l.model ? { model: l.model } : {}) })), versions }, ...(problem ? { problem } : {}) };
}

/** A fresh copy of `source` for one cell, set up and marked as the experiment's. Nothing of it runs yet. */
function makeCopy(ctx: Ctx, e: Experiment, source: Notebook, label: string, setup: ReturnType<typeof copySetup>): Notebook {
  const store = notebooks(ctx);
  const t = templateFromNotebook(source);
  const nb = store.create({
    title: `${source.title} · ${label}`.slice(0, 200), statement: t.statement, params: setup.params, criteria: t.criteria, pipeline: t.pipeline ?? [], cadence: '',
    ...(source.asked ? { asked: source.asked } : {}),
    ...(setup.given.length ? { given: setup.given } : {}),
  });
  store.setExperimentRun(nb.id, { experimentId: e.id, label });
  store.setFields(nb.id, t.fields);
  if (t.stages?.length) store.setStages(nb.id, t.stages);
  if (setup.checks.length) store.setChecks(nb.id, setup.checks);
  store.markSetup(nb.id);
  store.setSteps(nb.id, fitStepAgents(ctx, setup.steps).steps);
  // Its page as the source's, so it never spends a run deciding one.
  if (t.layout) store.setLayout(nb.id, t.layout, 'template');
  if (source.meeting) store.setMeeting(nb.id, source.meeting);
  store.addEntry(nb.id, { kind: 'note', title: 'An experiment\'s copy', body: `A copy of [${source.title}](/notebooks/${encodeURIComponent(source.id)}) that the experiment [${e.name}](/experiments/${encodeURIComponent(e.id)}) ran as **${label}**. It has that notebook's setup and none of what it found.`, by: 'you' });
  return store.get(nb.id)!;
}

/** What a copy is left with, as items: its options still in the running, sua's picks first, then as found. Pure. */
export function copyItems(nb: Notebook, entries: ReturnType<NotebookStore['entries']>): { items: OutputItem[]; ruledOut: number } {
  const options = entries.filter((x) => x.kind === 'option');
  const running = options.filter((x) => !x.ruledOut).sort((a, b) => Number(!!b.suggestedAt) - Number(!!a.suggestedAt) || a.createdAt.localeCompare(b.createdAt) || a.title.localeCompare(b.title));
  const seen = new Set<string>();
  const items: OutputItem[] = [];
  for (const o of running) {
    const link = optionLink(nb.fields, o.data);
    const facts: Record<string, string> = {};
    let org: string | undefined;
    for (const f of nb.fields) {
      const v = o.data?.[f.key];
      if (v === undefined || v === null || v === '') continue;
      const s = String(v).replace(/\s+/g, ' ').trim();
      if (!s || /^https?:\/\/\S+$/i.test(s)) continue;
      if (/^(company|employer|org|organi[sz]ation|brand|seller)$/i.test(f.key) && !org) org = s;
      if (Object.keys(facts).length < 12) facts[f.label || f.key] = s.slice(0, 300);
    }
    if (o.suggestedAt) facts['sua\'s pick'] = 'yes';
    const key = itemKey(o.title, link, org);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ key, title: o.title.slice(0, 200), ...(link ? { link } : {}), facts });
    if (items.length === 100) break;
  }
  return { items, ruledOut: options.length - running.length };
}

/** Wait for the step a notebook is running to pause. False when it was stopped or ran out of time first. */
async function settled(ctx: Ctx, notebookId: string, until: number, stopped: () => boolean): Promise<boolean> {
  while (ctx.notebookPipelines?.has(notebookId)) {
    if (stopped() || Date.now() > until) { stopNotebookStep(ctx, notebookId); while (ctx.notebookPipelines?.has(notebookId) && Date.now() < until + 30_000) await sleep(POLL_MS); return false; }
    await sleep(POLL_MS);
  }
  return true;
}

export interface CopyOutcome { status: 'done' | 'failed' | 'stopped' | 'invalid'; notebookId?: string; items?: OutputItem[]; note?: string; error?: string; asked: Record<string, string> }

/**
 * Run one cell: make the copy, take it through its steps, read it, archive
 * it. Never throws. `stopped` is asked between and during steps.
 */
export async function runNotebookCopy(ctx: Ctx, store: ExperimentStore, e: Experiment, cell: ExperimentCell, stopped: () => boolean): Promise<CopyOutcome> {
  const nbs = notebooks(ctx);
  const source = e.task.notebookId ? nbs.get(e.task.notebookId) : undefined;
  const asked: Record<string, string> = source ? { 'What it is for': source.statement, ...(source.params.length ? { Limits: source.params.join('; ') } : {}) } : {};
  const why = notebookUntestable(source);
  if (!source || why) return { status: 'failed', error: why ?? 'That notebook is gone.', asked };
  const condition = experimentConditions(e.factors).find((x) => x.id === cell.conditionId);
  if (!condition) return { status: 'failed', error: 'Its version is no longer part of the experiment.', asked };
  const levels = conditionLevels(e.factors, condition);
  const setup = copySetup(source, levels);
  if (setup.problem) return { status: 'failed', error: setup.problem, asked };
  if (setup.params.length) asked.Limits = setup.params.join('; ');
  if (setup.checks.length) asked.Checks = setup.checks.join('; ');
  const label = `${condition.name}, run ${String(cell.repeat)}`;
  let copy: Notebook;
  try { copy = makeCopy(ctx, e, source, label, setup); } catch (err) { return { status: 'failed', error: err instanceof Error ? err.message : String(err), asked }; }
  store.updateCell(cell.id, { notebookId: copy.id });
  ctx.experimentCopies ??= new Map();
  ctx.experimentCopies.set(copy.id, setup.swap);
  const until = Date.now() + COPY_TIMEOUT_MS;
  const notes: string[] = [];
  let outcome: CopyOutcome['status'] = 'done';
  let error: string | undefined;
  try {
    // Something it was given changed: sua reads it first, as it would for you.
    for (const key of setup.changedGiven) await new Promise<void>((res) => { if (!startGivenRead(ctx, copy.id, key, { then: res })) res(); });
    for (let guard = 0; guard < 24; guard++) {
      if (stopped()) { outcome = 'stopped'; error = 'Stopped.'; break; }
      const nb = nbs.get(copy.id);
      const step = nb ? currentStep(nb) : undefined;
      if (!nb || !step || isYourStep(step)) break;
      if (step.status === 'stuck') {
        // Where you would be asked Try again or Move on: it moves on with what it has.
        const moved = moveOnFromStep(ctx, copy.id, { stepId: step.id });
        if (!moved.moved) { outcome = 'failed'; error = `${step.title}: ${moved.reason ?? 'it could not move on'}`; break; }
        notes.push(`${step.title}: ${nbs.get(copy.id)?.steps?.find((s) => s.id === step.id)?.note ?? 'moved on'}`);
        if (moved.next && !moved.next.started && moved.next.reason && moved.next.step && !isYourStep(moved.next.step)) { outcome = 'failed'; error = `${moved.next.step.title}: ${moved.next.reason}`; break; }
      } else {
        const started = startNotebookStep(ctx, copy.id);
        if (!started.started) {
          const after = nbs.get(copy.id);
          const next = after ? currentStep(after) : undefined;
          // A met step with nothing after it but yours: that's the end, not a failure.
          if (!next || isYourStep(next)) { if (step.status === 'met') notes.push(`${step.title}: ${step.note ?? 'done'}`); break; }
          outcome = 'failed'; error = `${next.title}: ${started.reason ?? 'it did not start'}`; break;
        }
        if (step.status === 'met') notes.push(`${step.title}: ${step.note ?? 'done'}`);
      }
      if (!(await settled(ctx, copy.id, until, stopped))) { outcome = stopped() ? 'stopped' : 'failed'; error = stopped() ? 'Stopped.' : 'It ran out of time.'; break; }
    }
  } catch (err) {
    outcome = 'failed'; error = err instanceof Error ? err.message : String(err);
  } finally {
    ctx.experimentCopies.delete(copy.id);
  }
  const end = nbs.get(copy.id);
  const read = end ? copyItems(end, nbs.entries(copy.id, 1000)) : { items: [], ruledOut: 0 };
  // Each step's last word, for the ones not noted on the way.
  for (const s of end?.steps ?? []) if (!isYourStep(s) && s.note && !notes.some((n) => n.startsWith(`${s.title}:`))) notes.push(`${s.title}: ${s.note}`);
  const note = [...notes, `${String(read.ruledOut)} ruled out`].join(' · ');
  try { if (end && !end.archivedAt) nbs.archive(copy.id); } catch { /* it stays hidden either way */ }
  if (outcome !== 'done') return { status: outcome, notebookId: copy.id, note, error, asked };
  // No step found anything and none ever ran to an end: there is nothing to compare.
  const ran = (end?.steps ?? []).some((s) => !isYourStep(s) && s.status === 'done');
  if (!ran) return { status: 'invalid', notebookId: copy.id, note, error: 'None of its steps ran to an end.', asked };
  return { status: 'done', notebookId: copy.id, items: read.items, note, asked };
}
