/**
 * Experiments (ADR-0078): the list, setting one up, and an experiment's
 * page with Run, Stop, Go on and Archive. The runs themselves are made by
 * lib/experiment-runner.ts; what they found is counted by core
 * experimentVerdict from the stored cells on every page load.
 */
import { Router, type Request, type Response } from 'express';
import {
  ExperimentStore, NotebookStore, cleanCases, experimentConditions, experimentRunCount, experimentVerdict, notebookViewData, scoreSummaries,
  EXPERIMENT_MAX_LEVELS, type Experiment, type ExperimentCase,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { parseFlash as parseQueryFlash } from './inbox-shared.js';
import { renderNotFoundPage } from '../views/not-found.js';
import { renderExperimentNew, renderExperimentPage, renderExperimentsList, experimentStateKey, type ExperimentStanding } from '../views/experiments.js';
import { notebookForExperiment } from '../lib/experiment-notebook.js';
import { EXPERIMENT_RANKER_ID, caseFromPaste, costPerRun, freezeNotebook, runningPass, startExperimentPass, stopExperimentPass } from '../lib/experiment-runner.js';
import { buildLlmSettingsSnapshot } from '../lib/llm-settings-snapshot.js';

export const experimentsRouter: Router = Router();

type Ctx = ReturnType<typeof getContext>;
const store = (ctx: Ctx) => ExperimentStore.fromHandle(ctx.runStore.databaseHandle());
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
function flashOf(req: Request): { kind: 'ok' | 'error' | 'info'; message: string } | undefined {
  return parseQueryFlash(req) ?? (typeof req.query.flash === 'string' && req.query.flash ? { kind: 'info', message: req.query.flash } : undefined);
}
const back = (id: string, flash: string) => `/experiments/${encodeURIComponent(id)}?flash=${encodeURIComponent(flash)}`;

/** How an experiment stands: its latest pass, that pass's cells, and what they measured. */
export function experimentStanding(ctx: Ctx, e: Experiment): ExperimentStanding {
  const s = store(ctx);
  const pass = s.passes(e.id, 1)[0];
  const cells = pass ? s.cells(pass.id) : [];
  const ranked = cells.flatMap((c) => (c.status === 'done' && c.ranking ? [{ caseId: c.caseId, conditionId: c.conditionId, repeat: c.repeat, ranking: c.ranking }] : []));
  return {
    running: !!runningPass(ctx, e.id),
    ...(pass ? { pass } : {}),
    cells,
    scores: pass ? s.scores(pass.id) : [],
    summaries: pass ? scoreSummaries(e.scorers, cells, s.scores(pass.id)) : [],
    ...(pass ? { verdict: experimentVerdict({ factors: e.factors, conditions: experimentConditions(e.factors), cells: ranked, topK: e.topK }) } : {}),
  };
}

/**
 * The things to change that the new-experiment form describes: c1…c3, each
 * one kind of change with versions v1…v4. A version is a name and the one
 * thing its kind sets; a version with neither is left out, and one with no
 * name is called A, B, C or D.
 */
export function factorsFromForm(body: Record<string, unknown>): unknown[] {
  const out: unknown[] = [];
  for (let c = 1; c <= 3; c++) {
    const k = `c${String(c)}`;
    const kind = str(body[`${k}_kind`]) || 'instructions';
    const levels: unknown[] = [];
    for (let n = 1; n <= EXPERIMENT_MAX_LEVELS; n++) {
      const v = `${k}_v${String(n)}`;
      const name = str(body[`${v}_name`]).trim();
      const text = str(body[`${v}_text`]).trim();
      const provider = str(body[`${v}_provider`]).trim();
      const model = str(body[`${v}_model`]).trim();
      const version = str(body[`${v}_version`]).trim();
      const sets = kind === 'model' ? { provider, model } : kind === 'version' ? (version ? { version: Number(version) } : {})
        : kind === 'preferences' ? (text ? { inputs: { PREFERENCES: text } } : {}) : (text ? { instructions: text } : {});
      const set = Object.values(sets).some((x) => (typeof x === 'object' ? true : !!x));
      if (!name && !set) continue;
      levels.push({ name: name || String.fromCharCode(64 + n), ...sets });
    }
    if (levels.length < 2) continue;
    out.push({ name: str(body[`${k}_name`]).trim() || `Change ${String(c)}`, levels });
  }
  return out;
}

/**
 * The scorers the new-experiment form describes: items that should be near
 * the top (lines, each part of an item's title) and up to two judges.
 * Throws when a line matches no item, so a typo isn't silently dropped.
 */
export function scorersFromForm(body: Record<string, unknown>, cases: readonly ExperimentCase[]): unknown[] {
  const out: unknown[] = [];
  const wanted = str(body.top_items).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (wanted.length) {
    const all = cases.flatMap((c) => c.items);
    const ids: string[] = [];
    for (const w of wanted) {
      const hits = all.filter((i) => i.title.toLowerCase().includes(w.toLowerCase()) || i.id === w);
      if (!hits.length) throw new Error(`"${w}" matches none of the items. Use part of an item's title.`);
      ids.push(...hits.map((i) => i.id));
    }
    out.push({ kind: 'top', name: str(body.top_name).trim() || 'Should be near the top', items: ids });
  }
  for (const n of [1, 2]) {
    const rubric = str(body[`j${String(n)}_rubric`]).trim();
    if (!rubric) continue;
    out.push({ kind: 'judge', name: str(body[`j${String(n)}_name`]).trim() || `Judge ${String(n)}`, rubric, provider: str(body[`j${String(n)}_provider`]), model: str(body[`j${String(n)}_model`]) });
  }
  return out;
}

/** A name for an experiment that was given only its question: the question's first words, without the question mark. */
export function nameFromQuestion(question: string): string {
  const q = question.replace(/\s+/g, ' ').trim().replace(/[?.!]+$/, '');
  if (q.length <= 70) return q;
  return `${q.slice(0, 70).replace(/\s+\S*$/, '')}…`;
}

function newPage(req: Request, res: Response, values?: Parameters<typeof renderExperimentNew>[0]['values'], error?: string): void {
  const ctx = getContext(req.app.locals);
  const nbs = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
  const notebooks = nbs.list().filter((n) => !n.archivedAt).map((n) => ({ id: n.id, title: n.title, options: notebookViewData(n, nbs.entries(n.id, 1000)).notebook.options.filter((o) => !o.ruledOut).length })).filter((n) => n.options >= 2);
  const agents = ctx.agentStore.listAgents().map((a) => { const cost = costPerRun(ctx, a.id); return { id: a.id, name: a.name, ...(cost !== undefined ? { costPerRun: cost } : {}) }; }).sort((a, b) => Number(b.id === EXPERIMENT_RANKER_ID) - Number(a.id === EXPERIMENT_RANKER_ID) || a.name.localeCompare(b.name));
  let providers: string[] = [];
  try { providers = [...(buildLlmSettingsSnapshot(ctx)?.providers ?? [])]; } catch { /* none offered */ }
  res.status(error ? 400 : 200).type('html').send(renderExperimentNew({
    notebooks, agents, providers, defaultAgent: EXPERIMENT_RANKER_ID,
    // A link can fill the page in (sua offers one from a conversation): any of the form's fields, by name.
    values: values ?? { from: str(req.query.from), name: str(req.query.name), question: str(req.query.question), agent: str(req.query.agent), repeats: str(req.query.repeats), paste: str(req.query.paste), body: req.query as Record<string, unknown> },
    ...(error ? { flash: { kind: 'error' as const, message: error } } : flashOf(req) ? { flash: flashOf(req)! } : {}),
  }));
}

experimentsRouter.get('/experiments', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const s = store(ctx);
  const archived = req.query.archived === '1';
  const all = s.list({ archived: true });
  const shown = all.filter((e) => !!e.archivedAt === archived);
  res.type('html').send(renderExperimentsList({
    experiments: shown.map((e) => ({ e, standing: experimentStanding(ctx, e), items: s.cases(e.id).reduce((n, c) => n + c.items.length, 0) })),
    archived, archivedCount: all.filter((e) => e.archivedAt).length,
    ...(flashOf(req) ? { flash: flashOf(req)! } : {}),
  }));
});

experimentsRouter.get('/experiments/new', (req: Request, res: Response) => { newPage(req, res); });

experimentsRouter.post('/experiments', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const values = { name: str(body.name), question: str(body.question), agent: str(body.agent), from: str(body.from), paste: str(body.paste), repeats: str(body.repeats), body };
  try {
    const from = str(body.from) === 'paste' ? '' : str(body.from);
    if (!from && !str(body.paste).trim()) throw new Error('Choose the notebook whose options to hold fixed, or paste a list.');
    const frozen = from ? freezeNotebook(ctx, from) : { cases: [caseFromPaste(str(body.paste))] };
    if ('error' in frozen) throw new Error(frozen.error);
    const cases = cleanCases(frozen.cases);
    const e = store(ctx).create({
      name: str(body.name).trim() || nameFromQuestion(str(body.question)), question: str(body.question), task: { agentId: str(body.agent) || EXPERIMENT_RANKER_ID },
      factors: factorsFromForm(body), cases, repeats: Number(body.repeats) || 3, scorers: scorersFromForm(body, cases),
      ...('from' in frozen ? { from: frozen.from } : {}),
    });
    const runs = experimentRunCount(e, cases.length);
    res.redirect(303, back(e.id, `Set up. Nothing has run yet: a pass makes ${String(runs)} ${runs === 1 ? 'run' : 'runs'}. Check the setup below, then press Run.`));
  } catch (err) {
    newPage(req, res, values, err instanceof Error ? err.message : String(err));
  }
});

experimentsRouter.get('/experiments/:id', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const s = store(ctx);
  const e = s.get(String(req.params.id));
  if (!e) { res.status(404).type('html').send(renderNotFoundPage({ path: req.path, message: 'No such experiment. It may have been removed.' })); return; }
  const agent = ctx.agentStore.getAgent(e.task.agentId);
  const cost = costPerRun(ctx, e.task.agentId);
  res.type('html').send(renderExperimentPage({
    e, cases: s.cases(e.id), standing: experimentStanding(ctx, e),
    ...(cost !== undefined ? { costPerRun: cost } : {}),
    ...(() => { const nb = NotebookStore.fromHandle(ctx.runStore.databaseHandle()).forExperiment(e.id); return nb && !nb.archivedAt ? { notebook: { id: nb.id, title: nb.title } } : {}; })(),
    ...(agent ? { agent: { name: agent.name, ...(agent.version !== undefined ? { version: agent.version } : {}) } } : {}),
    ...(flashOf(req) ? { flash: flashOf(req)! } : {}),
  }));
});

/** What the page polls: a key that changes as the pass moves on. */
experimentsRouter.get('/experiments/:id/state', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const e = store(ctx).get(String(req.params.id));
  if (!e) { res.status(404).json({ error: 'No such experiment.' }); return; }
  const standing = experimentStanding(ctx, e);
  res.set('Cache-Control', 'no-store').json({ key: experimentStateKey(standing), running: standing.running });
});

experimentsRouter.post('/experiments/:id/run', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const out = startExperimentPass(getContext(req.app.locals), id);
  res.redirect(303, back(id, out.started ? 'Running. This page fills in as the runs come back.' : out.reason ?? 'It could not start.'));
});

experimentsRouter.post('/experiments/:id/resume', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = String(req.params.id);
  const pass = store(ctx).passes(id, 1)[0];
  const out = pass ? startExperimentPass(ctx, id, { resume: pass.id, retry: req.body?.retry === '1' }) : { started: false, reason: 'It has not been run yet.' };
  res.redirect(303, back(id, out.started ? 'Going on from where it stopped.' : out.reason ?? 'It could not go on.'));
});

experimentsRouter.post('/experiments/:id/stop', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const stopped = stopExperimentPass(getContext(req.app.locals), id);
  res.redirect(303, back(id, stopped ? 'Stopping. What has run is kept; Go on picks it up again.' : 'It isn\'t running.'));
});

/** Its notebook: where its results show and you can talk to sua about them. Made on the first ask, opened after. */
experimentsRouter.post('/experiments/:id/notebook', (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    const { notebook, made } = notebookForExperiment(getContext(req.app.locals), id);
    res.redirect(303, `/notebooks/${encodeURIComponent(notebook.id)}?flash=${encodeURIComponent(made ? 'This notebook shows the experiment\'s results as they stand, and updates as it runs. Ask sua about them here.' : 'This is the notebook that shows it.')}`);
  } catch (err) {
    res.redirect(303, back(id, err instanceof Error ? err.message : String(err)));
  }
});

experimentsRouter.post('/experiments/:id/archive', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const id = String(req.params.id);
  const s = store(ctx);
  if (!s.get(id)) { res.redirect(303, '/experiments'); return; }
  if (req.body?.restore === '1') { s.archive(id, false); res.redirect(303, back(id, 'Restored.')); return; }
  stopExperimentPass(ctx, id);
  s.archive(id);
  res.redirect(303, `/experiments?flash=${encodeURIComponent('Archived. Its runs and results are kept.')}`);
});
