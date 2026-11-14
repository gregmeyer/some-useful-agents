/**
 * Experiments (ADR-0078): the list, setting one up, and an experiment's
 * page with Run, Stop, Go on and Archive. The runs themselves are made by
 * lib/experiment-runner.ts; what they found is counted from the stored
 * cells on every page load (core experimentPageData).
 */
import { Router, type Request, type Response } from 'express';
import { ExperimentStore, NotebookStore, experimentConditions, EXPERIMENT_MAX_LEVELS, type Experiment } from '@some-useful-agents/core';
import { getContext } from '../context.js';
import { parseFlash as parseQueryFlash } from './inbox-shared.js';
import { renderNotFoundPage } from '../views/not-found.js';
import { renderExperimentNew, renderExperimentPage, renderExperimentsList, experimentStateKey, experimentStepForError, type ExperimentStanding } from '../views/experiments.js';
import { notebookForExperiment } from '../lib/experiment-notebook.js';
import { costPerRun, runningPass, startExperimentPass, stopExperimentPass, testableAgents } from '../lib/experiment-runner.js';
import { buildLlmSettingsSnapshot } from '../lib/llm-settings-snapshot.js';

export const experimentsRouter: Router = Router();

type Ctx = ReturnType<typeof getContext>;
const store = (ctx: Ctx) => ExperimentStore.fromHandle(ctx.runStore.databaseHandle());
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const lines = (v: unknown): string[] => str(v).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
function flashOf(req: Request): { kind: 'ok' | 'error' | 'info'; message: string } | undefined {
  return parseQueryFlash(req) ?? (typeof req.query.flash === 'string' && req.query.flash ? { kind: 'info', message: req.query.flash } : undefined);
}
const back = (id: string, flash: string) => `/experiments/${encodeURIComponent(id)}?flash=${encodeURIComponent(flash)}`;

/** How an experiment stands: its latest pass, that pass's cells and scores. */
export function experimentStanding(ctx: Ctx, e: Experiment): ExperimentStanding {
  const s = store(ctx);
  const pass = s.passes(e.id, 1)[0];
  return { running: !!runningPass(ctx, e.id), ...(pass ? { pass } : {}), cells: pass ? s.cells(pass.id) : [], scores: pass ? s.scores(pass.id) : [] };
}

/**
 * The changes the new-experiment form describes: c1…c3, each one kind of
 * change with versions v1…v4. A version is a name and the one thing its
 * kind sets (an agent version, a provider and model, or a value for the
 * input the change names); a version with neither is left out, and one
 * with no name is called A, B, C or D.
 */
export function factorsFromForm(body: Record<string, unknown>): unknown[] {
  const out: unknown[] = [];
  for (let c = 1; c <= 3; c++) {
    const k = `c${String(c)}`;
    const kind = str(body[`${k}_kind`]) || 'input';
    const input = str(body[`${k}_input`]).trim();
    const levels: unknown[] = [];
    for (let n = 1; n <= EXPERIMENT_MAX_LEVELS; n++) {
      const v = `${k}_v${String(n)}`;
      const name = str(body[`${v}_name`]).trim();
      const text = str(body[`${v}_text`]).trim();
      const provider = str(body[`${v}_provider`]).trim();
      const model = str(body[`${v}_model`]).trim();
      const version = str(body[`${v}_version`]).trim();
      const sets = kind === 'model' ? { provider, model } : kind === 'version' ? (version ? { version: Number(version) } : {})
        : (text && input ? { inputs: { [input]: text } } : {});
      const set = Object.values(sets).some((x) => (typeof x === 'object' ? true : !!x));
      if (!name && !set) continue;
      levels.push({ name: name || String.fromCharCode(64 + n), ...sets });
    }
    if (levels.length < 2) continue;
    out.push({ name: str(body[`${k}_name`]).trim() || (kind === 'version' ? 'Agent version' : kind === 'model' ? 'Model' : input || `Change ${String(c)}`), levels });
  }
  return out;
}

/** The scorers the form describes: things that should, and should not, be in the results (a line each), and up to two judges. */
export function scorersFromForm(body: Record<string, unknown>): unknown[] {
  const out: unknown[] = [];
  const inn = lines(body.should_find);
  const not = lines(body.should_not_find);
  if (inn.length) out.push({ kind: 'found', name: 'Found what it should', items: inn });
  if (not.length) out.push({ kind: 'found', avoid: true, name: 'Left out what it should', items: not });
  for (const n of [1, 2]) {
    const rubric = str(body[`j${String(n)}_rubric`]).trim();
    if (!rubric) continue;
    out.push({ kind: 'judge', name: str(body[`j${String(n)}_name`]).trim() || `Judge ${String(n)}`, rubric, provider: str(body[`j${String(n)}_provider`]), model: str(body[`j${String(n)}_model`]) });
  }
  return out;
}

/** The ask the form describes: a value for each of the agent's inputs (`in_<NAME>`). */
export function askFromForm(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) if (k.startsWith('in_') && str(v).trim()) out[k.slice(3)] = str(v).trim();
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
  let providers: string[] = [];
  try { providers = [...(buildLlmSettingsSnapshot(ctx)?.providers ?? [])]; } catch { /* none offered */ }
  res.status(error ? 400 : 200).type('html').send(renderExperimentNew({
    agents: testableAgents(ctx), providers,
    // A link can fill the page in (sua offers one from a conversation): any of the form's fields, by name.
    values: values ?? { name: str(req.query.name), question: str(req.query.question), agent: str(req.query.agent), repeats: str(req.query.repeats), ...(Object.keys(req.query).length ? { body: req.query as Record<string, unknown> } : {}) },
    ...(error ? { flash: { kind: 'error' as const, message: error } } : flashOf(req) ? { flash: flashOf(req)! } : {}),
    // Where to start: where a refusal belongs; the summary when a link filled the changes in; the agent when it gave only the question.
    open: error ? experimentStepForError(error) : Object.keys(req.query).some((k) => /^c\d_v\d_/.test(k)) && str(req.query.agent) ? 6 : str(req.query.question) ? 2 : 1,
  }));
}

experimentsRouter.get('/experiments', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const s = store(ctx);
  const archived = req.query.archived === '1';
  const all = s.list({ archived: true });
  const shown = all.filter((e) => !!e.archivedAt === archived);
  res.type('html').send(renderExperimentsList({
    experiments: shown.map((e) => ({ e, standing: experimentStanding(ctx, e) })),
    archived, archivedCount: all.filter((e) => e.archivedAt).length,
    ...(flashOf(req) ? { flash: flashOf(req)! } : {}),
  }));
});

experimentsRouter.get('/experiments/new', (req: Request, res: Response) => { newPage(req, res); });

experimentsRouter.post('/experiments', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const values = { name: str(body.name), question: str(body.question), agent: str(body.agent), repeats: str(body.repeats), body };
  try {
    const agentId = str(body.agent).trim();
    if (!agentId) throw new Error('Choose the agent to run.');
    const agent = ctx.agentStore.getAgent(agentId);
    if (!agent) throw new Error(`No such agent: ${agentId}.`);
    const ask = askFromForm(body);
    const factors = factorsFromForm(body);
    // An input the agent needs has to come from the ask, or from every version of a change that sets it.
    const changed = new Set((factors as Array<{ levels: Array<{ inputs?: Record<string, string> }> }>).flatMap((f) => (f.levels.every((l) => l.inputs && Object.keys(l.inputs).length) ? Object.keys(f.levels[0].inputs ?? {}) : [])));
    const missing = Object.entries(agent.inputs ?? {}).filter(([name, spec]) => (spec as { required?: boolean; default?: unknown }).required && (spec as { default?: unknown }).default === undefined && !ask[name] && !changed.has(name)).map(([name]) => name);
    if (missing.length) throw new Error(`${agent.name} needs a value for ${missing.join(', ')}. Give it under "What you ask it".`);
    const e = store(ctx).create({
      name: str(body.name).trim() || nameFromQuestion(str(body.question)) || `${agent.name} experiment`, question: str(body.question), task: { agentId },
      inputs: ask, factors, repeats: Number(body.repeats) || 2, scorers: scorersFromForm(body),
    });
    const runs = experimentConditions(e.factors).length * e.repeats;
    // Asked for with it: the notebook that shows its results (made empty; it fills in as the experiment runs).
    let also = '';
    if (str(body.notebook) === '1') { try { notebookForExperiment(ctx, e.id); also = ' Its notebook is made too: Open its notebook, above.'; } catch { /* the page still offers it */ } }
    res.redirect(303, back(e.id, `Set up. Nothing has run yet: a pass runs ${agent.name} ${String(runs)} ${runs === 1 ? 'time' : 'times'}. Check the setup below, then press Run.${also}`));
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
    e, standing: experimentStanding(ctx, e),
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
  res.redirect(303, back(id, out.started ? 'Running. Each run is the whole agent, so it can take a while; this page fills in as they come back.' : out.reason ?? 'It could not start.'));
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
