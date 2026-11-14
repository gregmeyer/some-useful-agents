/**
 * Experiments (ADR-0078): the list, the steps that set one up, and an
 * experiment's own page: what it found in a sentence, the numbers behind
 * it, each version against the baseline, what each version found, and
 * every run. All of it is drawn from the stored runs; nothing on these
 * pages is written by a model.
 */
import {
  experimentConditions, experimentPageData, experimentRunCount, passProgress,
  EXPERIMENT_MAX_REPEATS, EXPERIMENT_MAX_RUNS,
  type Experiment, type ExperimentCell, type ExperimentLevel, type ExperimentPass, type ExperimentScore,
} from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { working } from './working.js';
import type { TestableAgent } from '../lib/experiment-runner.js';

type Flash = { kind: 'error' | 'info' | 'ok'; message: string };
const list = (xs: SafeHtml[]) => xs as unknown as SafeHtml[];
const pct = (n: number) => `${String(Math.round(n * 100))}%`;
const money = (n: number) => (n < 0.01 ? 'under $0.01' : `$${n.toFixed(2)}`);
const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** How an experiment stands, for its list row and its page. */
export interface ExperimentStanding {
  /** A pass is running in this process. */
  running: boolean;
  pass?: ExperimentPass;
  cells: ExperimentCell[];
  /** Judges' scores for the pass. */
  scores: ExperimentScore[];
}

function standingBadge(s: ExperimentStanding): SafeHtml {
  const p = passProgress(s.cells);
  if (s.running) return html`<span class="badge badge--info">running ${String(p.done)} of ${String(p.total)}</span>`;
  if (!s.pass) return html`<span class="badge badge--muted">not run yet</span>`;
  if (p.stopped) return html`<span class="badge badge--warn">stopped at ${String(p.done)} of ${String(p.total)}</span>`;
  if (p.invalid + p.failed) return html`<span class="badge badge--warn">${String(p.done)} of ${String(p.total)} usable</span>`;
  return html`<span class="badge badge--ok">run</span>`;
}

export function renderExperimentsList(args: { experiments: Array<{ e: Experiment; standing: ExperimentStanding }>; archived?: boolean; archivedCount?: number; flash?: Flash }): string {
  const rows = args.experiments.map(({ e, standing }) => {
    const d = standing.pass ? experimentPageData(e, standing.cells, standing.scores, { running: standing.running }) : undefined;
    const found = d ? (/^\*\*(.+?)\*\*/.exec(d.headline)?.[1] ?? '') : '';
    return html`<li class="exp-row${e.archivedAt ? ' exp-row--archived' : ''}">
      <div class="exp-row__main">
        <a class="exp-row__name" href="/experiments/${encodeURIComponent(e.id)}">${e.name}</a>
        ${standingBadge(standing)}
        <p class="exp-row__line">${found || e.question || 'No question written down.'}</p>
      </div>
      <p class="exp-row__meta">${e.task.agentId} · ${plural(experimentConditions(e.factors).length, 'version')} · ${plural(e.repeats, 'run')} of each</p>
    </li>`;
  });
  const body = html`
    ${pageHeader({
      crumbs: [{ label: 'Home', href: '/' }, { label: 'Experiments' }],
      title: 'Experiments',
      meta: [html`<span class="badge badge--muted">${String(args.experiments.length)}</span>`],
      cta: html`<a class="btn btn--primary" href="/experiments/new">New experiment</a>`,
      description: 'Give one agent the same ask under different versions of it, and see how what it produces changes. The numbers are counted from the runs, not written by a model.',
    })}
    ${rows.length ? html`<ul class="exp-list">${list(rows)}</ul>` : html`
      <div class="card card--muted exp-empty">
        <p><strong>${args.archived ? 'Nothing archived.' : 'No experiments yet.'}</strong></p>
        ${args.archived ? html`` : html`<p>An experiment answers a question like "does the new version of this agent find different things?" or "does the model change what it comes back with?" It runs the whole agent several times under each version you name, reads what each run produced, and counts how much the versions' results have in common, against how much two runs of the same version do.</p>
        <p><a class="btn btn--primary" href="/experiments/new">Set one up</a></p>`}
      </div>`}
    <p class="exp-foot">${args.archived ? html`<a href="/experiments">Back to experiments</a>` : args.archivedCount ? html`<a href="/experiments?archived=1">${plural(args.archivedCount, 'archived experiment')}</a>` : html``}</p>`;
  return render(layout({ title: 'Experiments', activeNav: 'experiments', ...(args.flash ? { flash: args.flash } : {}) }, body));
}

export interface ExperimentNewValues { name?: string; question?: string; agent?: string; repeats?: string; body?: Record<string, unknown> }

/** What one thing you change can be: the box each of its versions shows. */
export const EXPERIMENT_CHANGE_KINDS = [
  { id: 'version', title: 'Which version of the agent runs', says: 'An earlier version against a later one: did the change to the agent change what it produces?', call: 'Agent version' },
  { id: 'model', title: 'The model it runs on', says: 'The same agent on different models.', call: 'Model' },
  { id: 'input', title: 'Something you ask it', says: 'A different value for one of its inputs: other preferences, another topic, a different limit.', call: '' },
] as const;
export type ExperimentChangeKind = (typeof EXPERIMENT_CHANGE_KINDS)[number]['id'];

/** The wizard's steps, in order. */
export const EXPERIMENT_NEW_STEPS = ['The question', 'The agent', 'What you ask it', 'What changes', 'Which is better', 'Check it'] as const;

/** The step a refusal belongs to, so the page comes back where the problem is. */
export function experimentStepForError(message: string): number {
  if (/Choose the agent|isn't installed|No such agent/.test(message)) return 2;
  if (/needs a value/.test(message)) return 3;
  return 6;
}

/**
 * The page that sets an experiment up, as six steps: the question, the
 * agent, what it is asked (the same for every run), what changes (one
 * change at a time), whether results are scored, and a summary to check.
 * It is one form posted once; the steps are shown one at a time by the
 * page's script (EXPERIMENT_PAGE_JS), and without scripts they stack with
 * the same button at the end. `open` is the step to start on.
 */
export function renderExperimentNew(args: {
  /** The operator's agents, the most run first. */
  agents: readonly TestableAgent[];
  providers: readonly string[];
  values?: ExperimentNewValues;
  /** The step to open on (1 to 6). */
  open?: number;
  flash?: Flash;
}): string {
  const v = args.values ?? {};
  const b = (k: string) => { const x = v.body?.[k]; return typeof x === 'string' ? x : ''; };
  const fresh = !v.body || !Object.keys(v.body).length;
  const on = (yes: boolean, attr: string) => (yes ? unsafeHtml(` ${attr}`) : unsafeHtml(''));
  const chosen = args.agents.find((a) => a.id === v.agent);

  const version = (c: number, n: number, shown: boolean) => {
    const k = `c${String(c)}_v${String(n)}`;
    const letter = String.fromCharCode(64 + n);
    return html`<div class="exp-ver" data-exp-ver${on(!shown, 'hidden')}>
      <span class="exp-ver__letter" aria-hidden="true">${letter}</span>
      <input class="form-field__input exp-ver__name" name="${k}_name" value="${b(`${k}_name`)}" maxlength="60" placeholder="Name of version ${letter}" aria-label="Name of version ${letter}">
      <div class="exp-ver__value">
        <textarea class="form-field__textarea" name="${k}_text" rows="3" data-exp-for="input" aria-label="What version ${letter} asks" placeholder="The value this version gives it">${b(`${k}_text`)}</textarea>
        <span class="exp-ver__model" data-exp-for="model">
          <select class="form-field__input" name="${k}_provider" aria-label="Provider for version ${letter}">
            <option value="">the agent's own provider</option>
            ${list(args.providers.map((p) => html`<option value="${p}"${on(b(`${k}_provider`) === p, 'selected')}>${p}</option>`))}
          </select>
          <input class="form-field__input" name="${k}_model" value="${b(`${k}_model`)}" maxlength="80" placeholder="model (the provider's default if empty)" aria-label="Model for version ${letter}">
        </span>
        <input class="form-field__input exp-ver__num" name="${k}_version" type="number" min="1" value="${b(`${k}_version`)}" data-exp-for="version" list="exp-versions" placeholder="its current one" aria-label="Agent version for version ${letter}">
      </div>
    </div>`;
  };
  const change = (c: number) => {
    const k = `c${String(c)}`;
    const used = (n: number) => !!(b(`${k}_v${String(n)}_name`) || b(`${k}_v${String(n)}_text`) || b(`${k}_v${String(n)}_model`) || b(`${k}_v${String(n)}_provider`) || b(`${k}_v${String(n)}_version`));
    const kind = EXPERIMENT_CHANGE_KINDS.find((x) => x.id === b(`${k}_kind`))?.id ?? '';
    return html`<div class="exp-change" data-exp-change data-kind="${kind}">
      <fieldset class="exp-choices" data-exp-kinds>
        <legend class="exp-step__ask">${c === 1 ? 'What do you want to change?' : 'What else do you want to change?'}</legend>
        ${list(EXPERIMENT_CHANGE_KINDS.map((x) => html`<label class="exp-choice">
          <input type="radio" name="${k}_kind" value="${x.id}" data-exp-kind data-call="${x.call}"${on(kind === x.id, 'checked')}>
          <span class="exp-choice__title">${x.title}</span>
          <span class="exp-choice__says">${x.says}</span>
        </label>`))}
      </fieldset>
      <div class="exp-change__body" data-exp-change-body>
        <label class="exp-field" data-exp-for="input"><span class="exp-field__label">Which input</span>
          <select class="form-field__input exp-change__input" name="${k}_input" data-exp-input data-was="${b(`${k}_input`)}">
            ${chosen ? list(chosen.inputs.map((i) => html`<option value="${i.name}"${on(b(`${k}_input`) === i.name, 'selected')}>${i.name}</option>`)) : html``}
          </select></label>
        <label class="exp-field"><span class="exp-field__label">What to call this change</span>
          <input class="form-field__input exp-change__name" name="${k}_name" value="${b(`${k}_name`)}" maxlength="40" placeholder="Build"></label>
        <p class="exp-field__label">Its versions. A is what the others are compared with.</p>
        <p class="form-field__hint" data-exp-for="version" data-exp-versions-hint></p>
        <div class="exp-vers">${list([1, 2, 3, 4].map((n) => version(c, n, n <= 2 || used(n))))}</div>
        <div class="exp-change__acts">
          <button type="button" class="btn btn--ghost btn--sm" data-exp-add-version>+ another version</button>
          <button type="button" class="btn btn--ghost btn--sm" data-exp-rekind>Change a different thing</button>
          <button type="button" class="btn btn--ghost btn--sm" data-exp-remove-change>Remove this change</button>
        </div>
      </div>
    </div>`;
  };
  const judge = (n: number) => {
    const k = `j${String(n)}`;
    return html`<div class="exp-judge" data-exp-judge${on(n > 1 && !b(`${k}_rubric`), 'hidden')}>
      <label class="exp-field"><span class="exp-field__label">What a good result looks like${n > 1 ? ' (second judge)' : ''}</span>
        <textarea class="form-field__textarea" name="${k}_rubric" rows="3" placeholder="Every job listed is remote and at staff level or above; nothing older than two weeks.">${b(`${k}_rubric`)}</textarea></label>
      <div class="exp-judge__more">
        <input class="form-field__input" name="${k}_name" value="${b(`${k}_name`)}" maxlength="60" placeholder="What to call this score" aria-label="Name of judge ${String(n)}">
        <select class="form-field__input" name="${k}_provider" aria-label="Provider for judge ${String(n)}">
          <option value="">judged by the default model</option>
          ${list(args.providers.map((p) => html`<option value="${p}"${on(b(`${k}_provider`) === p, 'selected')}>${p}</option>`))}
        </select>
        <input class="form-field__input" name="${k}_model" value="${b(`${k}_model`)}" maxlength="80" placeholder="model (optional)" aria-label="Model for judge ${String(n)}">
      </div>
    </div>`;
  };
  const counting = !!(b('should_find') || b('should_not_find'));
  const judging = !!(b('j1_rubric') || b('j2_rubric'));
  const open = Math.min(6, Math.max(1, args.open ?? 1));
  // What the page's script needs of each agent: its inputs (with what it was last given) and its versions.
  const agentData = (a: TestableAgent) => JSON.stringify({ inputs: a.inputs, versions: a.versions });

  const body = html`
    ${pageHeader({
      crumbs: [{ label: 'Home', href: '/' }, { label: 'Experiments', href: '/experiments' }, { label: 'New' }],
      title: 'New experiment',
      description: 'Six short steps. Nothing is made until the last one, and nothing runs until you press Run after that.',
    })}
    <form method="POST" action="/experiments" class="exp-new" data-exp-new data-exp-open="${String(open)}" data-max-runs="${String(EXPERIMENT_MAX_RUNS)}">
      <ol class="exp-steps" data-exp-progress aria-label="Steps">
        ${list(EXPERIMENT_NEW_STEPS.map((s, i) => html`<li><button type="button" class="exp-steps__step" data-exp-go="${String(i + 1)}"><span class="exp-steps__n">${String(i + 1)}</span> ${s}</button></li>`))}
      </ol>

      <section class="exp-step" data-exp-step="1" aria-labelledby="exp-s1">
        <h2 class="exp-step__ask" id="exp-s1"><label for="exp-question">What do you want to find out?</label></h2>
        <textarea class="form-field__textarea exp-q__box" id="exp-question" name="question" rows="3" maxlength="1000" placeholder="Does the new version of my job search agent find different jobs than the old one?">${v.question ?? ''}</textarea>
        <p class="form-field__hint">In your own words. An experiment gives one agent the same ask under different versions of it, runs each a few times, and counts how much what they produce has in common.</p>
        <p class="exp-step__err" data-exp-err role="alert" hidden></p>
      </section>

      <section class="exp-step" data-exp-step="2" aria-labelledby="exp-s2">
        <fieldset class="exp-choices">
          <legend class="exp-step__ask" id="exp-s2">Which agent?</legend>
          <p class="form-field__hint">The whole agent runs each time, as it would for anyone: it searches, reads and uses its tools. Your agents, the most run first.</p>
          <input class="form-field__input exp-find" type="search" placeholder="Search your agents" aria-label="Search your agents" data-exp-find>
          <div class="exp-findlist" data-exp-findlist data-first="6">
            ${list(args.agents.map((a) => html`<label class="exp-choice" data-exp-findable data-text="${`${a.name} ${a.id} ${a.description ?? ''}`.toLowerCase()}">
              <input type="radio" name="agent" value="${a.id}" data-exp-agent data-title="${a.name}" data-agent="${agentData(a)}"${a.costPerRun !== undefined ? unsafeHtml(` data-cost="${String(a.costPerRun)}"`) : unsafeHtml('')}${on(v.agent === a.id, 'checked')}>
              <span class="exp-choice__title">${a.name}</span>
              <span class="exp-choice__says">${a.description ? clip(a.description, 160) : a.id}</span>
              <span class="exp-choice__says exp-choice__for">${a.runs ? `Run ${plural(a.runs, 'time')}` : 'Not run yet'} · ${plural(a.versions.length, 'version')}${a.current !== undefined ? `, now on ${String(a.current)}` : ''}${a.lists ? ` · its last run listed ${plural(a.lists, 'item')}` : ''}</span>
              ${a.lists === 0 ? html`<span class="exp-choice__says exp-choice__but">sua couldn't read a list of items out of its last run's results, so its runs may not be comparable. An experiment compares the lists runs produce.</span>` : html``}
            </label>`))}
          </div>
          <button type="button" class="btn btn--ghost btn--sm" data-exp-find-all hidden>Show all ${String(args.agents.length)}</button>
          <p class="form-field__hint" data-exp-find-none${on(args.agents.length > 0, 'hidden')}>${args.agents.length ? 'No agent matches that.' : 'You have no agents of your own yet. Build or install one first.'}</p>
        </fieldset>
        <p class="exp-step__err" data-exp-err role="alert" hidden></p>
      </section>

      <section class="exp-step" data-exp-step="3" aria-labelledby="exp-s3">
        <h2 class="exp-step__ask" id="exp-s3">What do you ask it?</h2>
        <p class="form-field__hint">This is the same for every run, so the only things that differ are the ones you change in the next step. It starts from what the agent was given on its last run.</p>
        <div class="exp-ask" data-exp-ask>
          ${chosen ? (chosen.inputs.length ? list(chosen.inputs.map((i) => html`<label class="exp-field"><span class="exp-field__label">${i.name}${i.required ? ' (needed)' : ''}${i.description ? ` — ${i.description}` : ''}</span>
            <textarea class="form-field__textarea" name="in_${i.name}" rows="2">${fresh ? (i.last ?? i.fallback ?? '') : b(`in_${i.name}`)}</textarea></label>`)) : html`<p class="form-field__hint">${chosen.name} takes no inputs: every run asks it the same thing already.</p>`) : html`<p class="form-field__hint">Choose the agent first.</p>`}
        </div>
        <p class="exp-step__err" data-exp-err role="alert" hidden></p>
      </section>

      <section class="exp-step" data-exp-step="4" aria-labelledby="exp-s4">
        <h2 class="exp-step__title" id="exp-s4">What changes</h2>
        <ul class="exp-made" data-exp-made hidden></ul>
        ${list([1, 2, 3].map(change))}
        <div class="exp-more" data-exp-more hidden>
          <button type="button" class="btn" data-exp-add-change>Change something else too</button>
          <p class="form-field__hint" data-exp-count></p>
        </div>
        <p class="form-field__hint" data-exp-nochange hidden>With nothing changed, it runs the agent as it is a few times and shows how steady it is: how much two runs of the same thing have in common.</p>
        <p class="exp-step__err" data-exp-err role="alert" hidden></p>
      </section>

      <section class="exp-step" data-exp-step="5" aria-labelledby="exp-s5">
        <fieldset class="exp-choices">
          <legend class="exp-step__ask" id="exp-s5">Do you also want to know which is better?</legend>
          <p class="form-field__hint">Comparing results shows which versions differ. To say which is better you need a standard. Leave both off to skip this.</p>
          <label class="exp-choice">
            <input type="checkbox" data-exp-reveal="count"${on(counting, 'checked')}>
            <span class="exp-choice__title">Count it</span>
            <span class="exp-choice__says">Name things a good result should have found, or should have left out. Counted the same way every time.</span>
          </label>
          <div class="exp-reveal" data-exp-revealed="count"${on(!counting, 'hidden')}>
            <label class="exp-field"><span class="exp-field__label">Should be in the results</span>
              <textarea class="form-field__textarea" name="should_find" rows="3" placeholder="Words from an item's title, or part of its link, one a line">${b('should_find')}</textarea></label>
            <label class="exp-field"><span class="exp-field__label">Should not be in the results</span>
              <textarea class="form-field__textarea" name="should_not_find" rows="2" placeholder="One a line">${b('should_not_find')}</textarea></label>
          </div>
          <label class="exp-choice">
            <input type="checkbox" data-exp-reveal="judge"${on(judging, 'checked')}>
            <span class="exp-choice__title">Have a model judge it</span>
            <span class="exp-choice__says">It reads what each run produced against your words and gives 0 to 100% with a reason. It never sees which version made the result. This adds a model run for every agent run.</span>
          </label>
          <div class="exp-reveal" data-exp-revealed="judge"${on(!judging, 'hidden')}>
            ${list([1, 2].map(judge))}
            <button type="button" class="btn btn--ghost btn--sm" data-exp-add-judge>+ another judge</button>
          </div>
        </fieldset>
        <p class="exp-step__err" data-exp-err role="alert" hidden></p>
      </section>

      <section class="exp-step" data-exp-step="6" aria-labelledby="exp-s6">
        <h2 class="exp-step__ask" id="exp-s6">Check it</h2>
        <dl class="exp-check" data-exp-summary></dl>
        <label class="exp-field"><span class="exp-field__label">Name</span>
          <input class="form-field__input" name="name" maxlength="120" value="${v.name ?? ''}" placeholder="sua uses your question if you leave this empty" data-exp-name></label>
        <label class="exp-field"><span class="exp-field__label">Runs of each version</span>
          <input class="form-field__input exp-new__short" name="repeats" type="number" min="1" max="${String(EXPERIMENT_MAX_REPEATS)}" value="${v.repeats || '2'}" data-exp-repeats></label>
        <p class="form-field__hint">Running each more than once shows how much the agent's results move by themselves. With one run, nothing can be concluded. Each run is the whole agent, so more runs cost more.</p>
        <label class="exp-also"><input type="checkbox" name="notebook" value="1"${on(fresh || b('notebook') === '1', 'checked')}> Also make a notebook that shows its results, to talk them over with sua</label>
        <p class="exp-step__err" data-exp-err role="alert" hidden></p>
      </section>

      <datalist id="exp-versions"></datalist>
      <div class="exp-nav">
        <button type="button" class="btn" data-exp-back>Back</button>
        <a class="btn btn--ghost" href="/experiments">Cancel</a>
        <button type="button" class="btn btn--primary" data-exp-next>Next</button>
        <button type="submit" class="btn btn--primary" data-exp-submit>Set it up</button>
      </div>
    </form>`;
  return render(layout({ title: 'New experiment', activeNav: 'experiments', ...(args.flash ? { flash: args.flash } : {}) }, body));
}

/** What a version sets, in words. */
function levelSays(l: ExperimentLevel): string[] {
  const out: string[] = [];
  if (l.version !== undefined) out.push(`agent version ${String(l.version)}`);
  if (l.provider || l.model) out.push(`runs on ${[l.provider, l.model].filter(Boolean).join(' ')}`);
  for (const [k, val] of Object.entries(l.inputs ?? {})) out.push(`${k}: “${clip(val, 220)}”`);
  return out.length ? out : ['the agent as it is'];
}

const CELL_BADGE: Record<ExperimentCell['status'], string> = { todo: 'badge--muted', running: 'badge--info', done: 'badge--ok', invalid: 'badge--warn', failed: 'badge--err', stopped: 'badge--muted' };
const CELL_WORD: Record<ExperimentCell['status'], string> = { todo: 'waiting', running: 'running', done: 'read', invalid: 'unusable', failed: 'failed', stopped: 'stopped' };

/** What changes as a pass runs: the page reloads when this does. */
export function experimentStateKey(s: ExperimentStanding): string {
  const p = passProgress(s.cells);
  return [s.pass?.id ?? '', s.running ? 'r' : '', p.done, p.invalid, p.failed, p.stopped, p.todo, p.running, s.scores.length].join('|');
}

/** Items shown in the per-item table before the fold. */
const ITEMS_SHOWN = 15;

export function renderExperimentPage(args: {
  e: Experiment;
  standing: ExperimentStanding;
  /** What a run of its agent has cost lately, when known. */
  costPerRun?: number;
  /** Its agent's name, and whether it is installed. */
  agent?: { name: string; version?: number };
  /** The notebook that shows it, when it has one. */
  notebook?: { id: string; title: string };
  flash?: Flash;
}): string {
  const { e, standing } = args;
  const conditions = experimentConditions(e.factors);
  const runs = experimentRunCount(e);
  const agentRuns = conditions.length * e.repeats;
  const p = passProgress(standing.cells);
  const d = experimentPageData(e, standing.cells, standing.scores, { running: standing.running });
  const act = (path: string) => `/experiments/${encodeURIComponent(e.id)}/${path}`;
  const post = (path: string, label: string, cls = 'btn', extra: SafeHtml = html``) => html`<form method="POST" action="${act(path)}" class="exp-act">${extra}<button type="submit" class="${cls}">${label}</button></form>`;
  const estimate = args.costPerRun !== undefined ? `, about ${money(args.costPerRun * agentRuns)}` : '';
  const left = p.stopped + (standing.running ? 0 : p.todo);
  const unusable = p.invalid + p.failed;
  const [headline, ...rest] = d.headline.split('** ');
  const said = headline.replace(/\*\*/g, '');
  const lines = rest.join('** ').split(/(?<=average\.)\s+/).filter(Boolean);

  const inNotebook = args.notebook
    ? html`<a class="btn" href="/notebooks/${encodeURIComponent(args.notebook.id)}">Open its notebook</a>`
    : post('notebook', 'Show it in a notebook');
  const actions = e.archivedAt
    ? post('archive', 'Restore', 'btn', html`<input type="hidden" name="restore" value="1">`)
    : standing.running
      ? post('stop', 'Stop', 'btn btn--warn')
      : html`
        ${standing.pass && left ? post('resume', `Go on (${plural(left, 'run')} left)`, 'btn btn--primary') : html``}
        ${standing.pass && !left && unusable ? post('resume', `Try the ${String(unusable)} unusable again`, 'btn', html`<input type="hidden" name="retry" value="1">`) : html``}
        ${post('run', standing.pass ? 'Run it again' : `Run it (${plural(agentRuns, 'run')} of the agent${estimate})`, standing.pass ? 'btn' : 'btn btn--primary')}
        ${inNotebook}`;

  const verdictBlock = !standing.pass
    ? html`<section class="exp-verdict exp-verdict--none"><p class="exp-verdict__headline">Not run yet.</p><p class="exp-verdict__sample">A pass runs ${args.agent?.name ?? e.task.agentId} ${plural(agentRuns, 'time')}: ${plural(conditions.length, 'version')} × ${plural(e.repeats, 'run')}${runs > agentRuns ? `, and a judge reads each (${String(runs - agentRuns)} more model runs)` : ''}${estimate}. Each is the whole agent, so it can take a while. Two run at a time.</p></section>`
    : html`<section class="exp-verdict" aria-label="What it found">
        <p class="exp-verdict__label">${d.label}</p>
        <p class="exp-verdict__headline">${said}</p>
        ${lines.length ? html`<ul class="exp-verdict__lines">${list(lines.map((l) => html`<li>${l}</li>`))}</ul>` : html``}
        <p class="exp-verdict__sample">${d.rests}</p>
      </section>`;

  const figures = d.figures.length ? html`<div class="exp-figures">
      ${list(d.figures.map((f) => html`<div class="exp-figure${f.tone ? ' exp-figure--on' : ''}">
        <p class="exp-figure__value">${f.value}</p>
        <p class="exp-figure__label">${f.label}</p>
        ${f.sub ? html`<p class="exp-figure__sub">${f.sub}</p>` : html``}
      </div>`))}
    </div>` : html``;

  const conditionRows = d.conditions.map((row) => html`<tr>
      <th scope="row">${row.condition}</th>
      <td class="exp-n">${row.runs || '—'}</td>
      <td class="exp-n">${row.found || '—'}</td>
      <td class="exp-n">${row.shared || '—'}</td>
      ${list(e.scorers.map((_, j) => html`<td class="exp-n">${row[`s${String(j)}`] || (standing.pass ? '…' : '—')}</td>`))}
    </tr>`);

  const itemRow = (row: Record<string, string>) => html`<tr>
      <th scope="row">${row.link ? html`<a href="${row.link}" target="_blank" rel="noopener noreferrer">${row.item}</a>` : row.item}</th>
      ${list(conditions.map((_, i) => { const cell = row[`c${String(i)}`] ?? ''; return html`<td class="exp-n${cell === 'not found' ? ' exp-n--miss' : ''}">${cell || '—'}</td>`; }))}
    </tr>`;
  const itemTable = (rows: Array<Record<string, string>>) => html`<div class="exp-scroll"><table class="table exp-table">
      <thead><tr><th scope="col">Item</th>${list(conditions.map((c) => html`<th scope="col" class="exp-n">${c.name}</th>`))}</tr></thead>
      <tbody>${list(rows.map(itemRow))}</tbody>
    </table></div>`;

  const body = html`
    ${pageHeader({
      crumbs: [{ label: 'Home', href: '/' }, { label: 'Experiments', href: '/experiments' }, { label: e.name }],
      title: e.name,
      meta: [standingBadge(standing), ...(e.archivedAt ? [html`<span class="badge badge--muted">archived</span>`] : [])],
      cta: html`<div class="exp-acts">${actions}</div>`,
      ...(e.question ? { description: e.question } : {}),
    })}
    <div data-exp-state="${experimentStateKey(standing)}" data-exp-id="${e.id}" data-exp-running="${standing.running ? '1' : ''}">
    ${standing.running ? html`<p class="exp-working">${working({ text: `Running ${String(Math.min(p.total, p.done + p.invalid + p.failed + 1))} of ${String(p.total)}. Each is the whole agent, so this can take a while. The page updates by itself; you can leave and come back.` })}</p>` : html``}
    ${!args.agent ? html`<p class="flash flash--error">Its agent, ${e.task.agentId}, isn't installed, so it can't run.</p>` : html``}
    ${standing.pass && args.agent?.version !== undefined && standing.pass.taskVersion !== undefined && args.agent.version !== standing.pass.taskVersion && !standing.running
      ? html`<p class="exp-note">${args.agent.name} has changed since this ran (it was version ${String(standing.pass.taskVersion)}, it is now ${String(args.agent.version)}). Run it again to see what that changed.</p>` : html``}
    ${verdictBlock}
    ${figures}

    <section class="exp-section">
      <h2>Each version against the baseline</h2>
      <p class="exp-section__note">How many items its runs listed on average, and how much of what it and the baseline found was in both.${e.scorers.length ? ' Then each score, averaged over the version\'s runs (with the lowest and highest when they differ).' : ''}</p>
      <div class="exp-scroll"><table class="table exp-table">
        <thead><tr><th scope="col">Version</th><th scope="col" class="exp-n">Runs</th><th scope="col" class="exp-n">Items found</th><th scope="col" class="exp-n">In both</th>${list(e.scorers.map((sc) => html`<th scope="col" class="exp-n">${sc.name}</th>`))}</tr></thead>
        <tbody>${list(conditionRows)}</tbody>
      </table></div>
    </section>

    ${d.changes.length ? html`<section class="exp-section">
      <h2>Each change by itself</h2>
      <p class="exp-section__note">The same change made with everything else held at one setting. When these differ a lot, the change matters under some settings and not others.</p>
      <div class="exp-scroll"><table class="table exp-table">
        <thead><tr><th scope="col">Changing</th><th scope="col">From</th><th scope="col">To</th><th scope="col" class="exp-n">In both</th></tr></thead>
        <tbody>${list(d.changes.map((c) => html`<tr><th scope="row">${c.changing}</th><td>${c.from}</td><td>${c.to}</td><td class="exp-n">${c.shared}</td></tr>`))}</tbody>
      </table></div>
    </section>` : html``}

    ${d.items.length ? html`<section class="exp-section">
      <h2>What each version found</h2>
      <p class="exp-section__note">Every item any run listed, with how many of each version's runs listed it and about where. The ones some versions found and others didn't are first. Two items are the same when their links are, or else their names.</p>
      ${itemTable(d.items.slice(0, ITEMS_SHOWN))}
      ${d.items.length > ITEMS_SHOWN ? html`<details class="exp-fold"><summary>${plural(d.items.length - ITEMS_SHOWN, 'more item')}</summary>${itemTable(d.items.slice(ITEMS_SHOWN))}</details>` : html``}
    </section>` : html``}

    <section class="exp-section">
      <h2>How it is set up</h2>
      <dl class="exp-setup">
        <div><dt>Runs</dt><dd>The whole of ${args.agent?.name ?? e.task.agentId}, ${plural(e.repeats, 'time')} for each version</dd></div>
        <div><dt>Asks it</dt><dd>${Object.keys(e.inputs).length ? html`<ul class="exp-levels-said">${list(Object.entries(e.inputs).map(([k, val]) => html`<li><strong>${k}:</strong> ${clip(val, 300)}</li>`))}</ul>` : 'Nothing: it runs as it does with no inputs given.'} <span class="exp-items__facts">The same for every run.</span></dd></div>
        ${list(e.factors.map((f) => html`<div><dt>Changes ${f.name.toLowerCase()}</dt><dd><ul class="exp-levels-said">${list(f.levels.map((l, i) => html`<li><strong>${l.name}${i === 0 ? ' (baseline)' : ''}:</strong> ${levelSays(l).join('; ')}</li>`))}</ul></dd></div>`))}
        ${list(e.scorers.map((sc) => html`<div><dt>Scores</dt><dd><strong>${sc.name}:</strong> ${sc.kind === 'found'
          ? `counted: the share of these its results ${sc.avoid ? 'leave out' : 'list'}: ${sc.items.join('; ')}`
          : `judged${sc.provider || sc.model ? ` by ${[sc.provider, sc.model].filter(Boolean).join(' ')}` : ''}: “${sc.rubric}”`}</dd></div>`))}
        ${e.factors.length ? html`` : html`<div><dt>Changes</dt><dd>Nothing: it runs the agent as it is, ${plural(e.repeats, 'time')}, which shows how steady it is.</dd></div>`}
      </dl>
    </section>

    ${standing.cells.length ? html`<section class="exp-section">
      <details class="exp-fold"><summary>Every run (${plural(standing.cells.length, 'run')}${p.costUsd ? `, ${money(p.costUsd)}` : ''})</summary>
        <div class="exp-scroll"><table class="table exp-table">
          <thead><tr><th scope="col">Version</th><th scope="col" class="exp-n">Run</th><th scope="col">How it went</th><th scope="col">What it listed</th></tr></thead>
          <tbody>${list(standing.cells.map((c) => html`<tr>
            <th scope="row">${conditions.find((x) => x.id === c.conditionId)?.name ?? c.conditionId}</th>
            <td class="exp-n">${String(c.repeat)}</td>
            <td><span class="badge ${CELL_BADGE[c.status]}">${CELL_WORD[c.status]}</span>${c.runId ? html` <a href="/runs/${encodeURIComponent(c.runId)}">the run</a>` : html``}${c.error ? html` <span class="exp-cell__why">${c.error}</span>` : html``}</td>
            <td>${c.items ? html`${plural(c.items.length, 'item')}${c.items.length ? `: ${c.items.slice(0, 3).map((i) => clip(i.title, 50)).join(' · ')}${c.items.length > 3 ? '…' : ''}` : ''}` : ''}${list(standing.scores.filter((x) => x.cellId === c.id).map((x) => { const sc = e.scorers.find((y) => y.id === x.scorerId); return html`<p class="exp-cell__score"><strong>${sc?.name ?? x.scorerId}:</strong> ${x.value !== undefined ? html`${pct(x.value)}. ${x.reason ?? ''}` : html`<span class="exp-cell__why">no score: ${x.error ?? 'it gave none'}</span>`}${x.runId ? html` <a href="/runs/${encodeURIComponent(x.runId)}">the judge's run</a>` : html``}</p>`; }))}</td>
          </tr>`))}</tbody>
        </table></div>
      </details>
    </section>` : html``}
    </div>

    ${e.archivedAt || standing.running ? html`` : html`<p class="exp-foot">${post('archive', 'Archive this experiment', 'btn btn--ghost btn--sm')}</p>`}`;
  return render(layout({ title: e.name, activeNav: 'experiments', wide: true, ...(args.flash ? { flash: args.flash } : {}) }, body));
}

/**
 * In the browser: an experiment's page reloads when its pass moves on; and
 * the New experiment page becomes six steps shown one at a time: Next
 * checks only the step you're on, the ask is drawn from the agent you
 * chose, the changes are made one at a time, and the last step writes the
 * whole setup out from what the form holds.
 */
export const EXPERIMENT_PAGE_JS = `
(function () {
  var el = document.querySelector('[data-exp-state]');
  if (!el) return;
  var id = el.getAttribute('data-exp-id');
  var key = el.getAttribute('data-exp-state');
  function check() {
    if (document.hidden) return;
    fetch('/experiments/' + encodeURIComponent(id) + '/state', { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.key !== key) location.reload(); })
      .catch(function () {});
  }
  setInterval(check, el.getAttribute('data-exp-running') ? 5000 : 20000);
})();
(function () {
  var form = document.querySelector('[data-exp-new]');
  if (!form) return;
  var MAX = Number(form.getAttribute('data-max-runs')) || 36;
  var LAST = 6;
  var S_AGENT = 2, S_ASK = 3, S_CHANGES = 4, S_SCORE = 5;
  function all(sel, root) { return Array.prototype.slice.call((root || form).querySelectorAll(sel)); }
  function one(sel, root) { return (root || form).querySelector(sel); }
  function text(f) { return f ? String(f.value || '').trim() : ''; }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }
  function nextHidden(list) { for (var i = 0; i < list.length; i++) if (list[i].hidden) return list[i]; return null; }
  function lines(s) { return String(s || '').split(/\\n/).map(function (l) { return l.trim(); }).filter(Boolean); }

  var steps = all('[data-exp-step]');
  var changes = all('[data-exp-change]');
  var cur = 1;
  /** The change being filled in (its index), or -1 when none is. */
  var editing = -1;
  /** The agent the ask and the version hints were last drawn for. */
  var drawnFor = null;

  // ----- the agent -----
  function agentRadio() { return one('[data-exp-agent]:checked'); }
  function agentData() {
    var a = agentRadio();
    try { return JSON.parse((a && a.getAttribute('data-agent')) || '{}'); } catch (e) { return {}; }
  }
  /** Show the agents that match what's typed; with nothing typed, the first few and the one chosen. */
  function findAgents() {
    var box = one('[data-exp-findlist]');
    if (!box) return;
    var q = text(one('[data-exp-find]')).toLowerCase();
    var first = box.getAttribute('data-all') ? 1e9 : Number(box.getAttribute('data-first')) || 6;
    var rows = all('[data-exp-findable]', box);
    var shown = 0;
    rows.forEach(function (r, i) {
      var chosen = !!one('input:checked', r);
      var hit = q ? q.split(/\\s+/).every(function (w) { return (r.getAttribute('data-text') || '').indexOf(w) >= 0; }) : (i < first || chosen);
      r.hidden = !hit;
      if (hit) shown++;
    });
    one('[data-exp-find-all]').hidden = !!q || shown >= rows.length;
    if (rows.length) one('[data-exp-find-none]').hidden = shown > 0;
  }
  /** The chosen agent's inputs as the ask, and its versions and inputs wherever a change needs them. Once per agent. */
  function drawForAgent() {
    var a = agentRadio();
    var idNow = a ? a.value : '';
    if (idNow === drawnFor) return;
    var wasNone = drawnFor === null;
    drawnFor = idNow;
    var d = agentData();
    var inputs = d.inputs || [];
    var vs = d.versions || [];
    var name = a ? a.getAttribute('data-title') : 'The agent';
    // The ask: as the page came for the agent it came with; rebuilt when another is chosen.
    var ask = one('[data-exp-ask]');
    if (ask && !(wasNone && one('textarea', ask))) {
      ask.textContent = '';
      if (!a) ask.appendChild(el('p', 'form-field__hint', 'Choose the agent first.'));
      else if (!inputs.length) ask.appendChild(el('p', 'form-field__hint', name + ' takes no inputs: every run asks it the same thing already.'));
      inputs.forEach(function (i) {
        var lab = el('label', 'exp-field');
        lab.appendChild(el('span', 'exp-field__label', i.name + (i.required ? ' (needed)' : '') + (i.description ? ' — ' + i.description : '')));
        var ta = el('textarea', 'form-field__textarea');
        ta.name = 'in_' + i.name; ta.rows = 2; ta.value = i.last || i.fallback || '';
        lab.appendChild(ta);
        ask.appendChild(lab);
      });
    }
    var dl = document.getElementById('exp-versions');
    if (dl) {
      dl.textContent = '';
      vs.forEach(function (v) { var o = document.createElement('option'); o.value = String(v.v); o.label = 'Version ' + v.v + ' · ' + v.at + (v.note ? ' · ' + v.note : ''); dl.appendChild(o); });
    }
    var hint = !vs.length ? name + ' has no versions recorded.'
      : vs.length === 1 ? name + ' has one version (' + vs[0].v + '), so there is no earlier one to compare it with.'
      : name + ' has versions ' + vs[vs.length - 1].v + ' to ' + vs[0].v + '. The newest are ' + vs.slice(0, 4).map(function (v) { return v.v + ' (' + v.at + ')'; }).join(', ') + '.';
    all('[data-exp-versions-hint]').forEach(function (p) { p.textContent = hint; });
    all('[data-exp-input]').forEach(function (sel) {
      var was = sel.value || sel.getAttribute('data-was') || '';
      sel.textContent = '';
      inputs.forEach(function (i) { var o = document.createElement('option'); o.value = i.name; o.textContent = i.name; if (i.name === was) o.selected = true; sel.appendChild(o); });
    });
  }

  // ----- what the form says -----
  function kindOf(c) { var r = one('[data-exp-kind]:checked', c); return r ? r.value : ''; }
  function versionsOf(c) {
    var kind = kindOf(c);
    var out = [];
    all('[data-exp-ver]', c).forEach(function (v, i) {
      var name = text(one('.exp-ver__name', v));
      var says = kind === 'model' ? [text(one('select', v)), text(one('.exp-ver__model input', v))].filter(Boolean).join(' ')
        : kind === 'version' ? (text(one('.exp-ver__num', v)) ? 'version ' + text(one('.exp-ver__num', v)) : '')
        : text(one('textarea', v));
      if (name || says) out.push({ name: name || String.fromCharCode(65 + i), says: says });
    });
    return out;
  }
  function info(c) {
    var vs = versionsOf(c);
    var r = one('[data-exp-kind]:checked', c);
    var kind = kindOf(c);
    var input = kind === 'input' ? text(one('[data-exp-input]', c)) : '';
    var what = kind === 'version' ? 'which version of the agent runs' : kind === 'model' ? 'the model it runs on' : input ? 'what it is given as ' + input : 'something you ask it';
    return { kind: kind, name: text(one('.exp-change__name', c)) || (r && r.getAttribute('data-call')) || input || 'Change', what: what, versions: vs, made: vs.length >= 2, touched: vs.length > 0 };
  }
  function made() { return changes.map(info).filter(function (x) { return x.made; }); }
  function judges() { var r = one('[data-exp-reveal="judge"]'); return r && r.checked ? all('[data-exp-judge]').filter(function (j) { return !j.hidden && text(one('textarea', j)); }).length : 0; }
  function repeats() { return Math.max(1, Math.min(5, Number(text(one('[data-exp-repeats]'))) || 2)); }
  function countLine() {
    var sizes = made().map(function (x) { return x.versions.length; });
    var combos = sizes.reduce(function (a, b) { return a * b; }, 1);
    var r = repeats();
    var j = judges();
    var agentRuns = combos * r;
    var runs = agentRuns * (1 + j);
    var a = agentRadio();
    var name = a ? a.getAttribute('data-title') : 'the agent';
    var line = (sizes.length > 1 ? sizes.join(' × ') + ' = ' : '') + combos + (combos === 1 ? ' version' : ' versions') + ' × ' + r + (r === 1 ? ' run' : ' runs') + ' = ' + name + ' runs ' + agentRuns + (agentRuns === 1 ? ' time' : ' times')
      + (j ? ', and a judge reads each (' + (runs - agentRuns) + ' more model runs)' : '');
    var cost = a ? Number(a.getAttribute('data-cost')) : 0;
    if (cost > 0) { var est = cost * agentRuns; line += ', about ' + (est < 0.01 ? 'under $0.01' : '$' + est.toFixed(2)); }
    var warn = '';
    if (runs > MAX) warn = 'That is more than the ' + MAX + ' runs one pass may make (each is the whole agent). Use fewer versions, runs or judges.';
    else if (r === 1) warn = 'With one run of each, nothing can be concluded. Use 2 or more.';
    return { line: line + '.', warn: warn, over: runs > MAX, combos: combos };
  }

  // ----- what changes: one change at a time -----
  function clearChange(c) {
    all('input[type="text"], input[type="number"], input:not([type]), textarea', c).forEach(function (x) { x.value = ''; });
    all('.exp-ver select', c).forEach(function (x) { x.selectedIndex = 0; });
    all('[data-exp-kind]', c).forEach(function (x) { x.checked = false; });
    all('[data-exp-ver]', c).forEach(function (v, i) { v.hidden = i > 1; });
    c.setAttribute('data-kind', '');
  }
  function applyKind(c) {
    var r = one('[data-exp-kind]:checked', c);
    c.setAttribute('data-kind', r ? r.value : '');
    if (!r) return;
    var name = one('.exp-change__name', c);
    var calls = all('[data-exp-kind]', c).map(function (x) { return x.getAttribute('data-call'); }).filter(Boolean);
    var inputNames = (agentData().inputs || []).map(function (i) { return i.name; });
    var want = r.value === 'input' ? text(one('[data-exp-input]', c)) : r.getAttribute('data-call') || '';
    if (name && (!text(name) || calls.indexOf(text(name)) >= 0 || inputNames.indexOf(text(name)) >= 0)) name.value = want;
  }
  function drawChanges() {
    var list = one('[data-exp-made]');
    list.textContent = '';
    var noInputs = !((agentData().inputs || []).length);
    changes.forEach(function (c, i) {
      c.hidden = i !== editing;
      var body = one('[data-exp-change-body]', c);
      if (body) body.hidden = !kindOf(c);
      // An agent with no inputs can't be asked anything different.
      all('[data-exp-kind][value="input"]', c).forEach(function (r) { r.disabled = noInputs; r.parentNode.classList.toggle('exp-choice--off', noInputs); });
      var add = one('[data-exp-add-version]', c);
      if (add) add.hidden = !nextHidden(all('[data-exp-ver]', c));
      var x = info(c);
      if (!x.made || i === editing) return;
      var li = el('li', 'exp-made__item');
      var words = el('span', 'exp-made__words');
      words.appendChild(el('strong', '', x.name));
      words.appendChild(document.createTextNode(' (' + x.what + '): ' + x.versions.map(function (v) { return v.name; }).join(' | ')));
      li.appendChild(words);
      var edit = el('button', 'btn btn--ghost btn--sm', 'Edit'); edit.type = 'button'; edit.setAttribute('data-exp-edit', String(i));
      var rm = el('button', 'btn btn--ghost btn--sm', 'Remove'); rm.type = 'button'; rm.setAttribute('data-exp-remove', String(i));
      li.appendChild(edit); li.appendChild(rm);
      list.appendChild(li);
    });
    list.hidden = !list.children.length;
    var more = one('[data-exp-more]');
    var free = changes.some(function (c, i) { return i !== editing && !info(c).made; });
    more.hidden = editing >= 0;
    one('[data-exp-add-change]', more).hidden = !free;
    one('[data-exp-add-change]', more).textContent = made().length ? 'Change something else too' : 'Change something';
    one('[data-exp-count]', more).textContent = made().length ? 'Every combination is run: ' + countLine().line : '';
    one('[data-exp-nochange]').hidden = !(editing < 0 && !made().length);
  }
  /** Finish the change being filled in. Returns what's wrong with it, or ''. */
  function closeEditing() {
    if (editing < 0) return '';
    var c = changes[editing];
    var x = info(c);
    if (x.made) { editing = -1; return ''; }
    if (!x.touched) { clearChange(c); editing = -1; return ''; }
    return 'Give it a second version to compare with, or remove this change.';
  }
  function enterChanges() {
    if (editing < 0 && !made().length) editing = 0;
    drawChanges();
  }

  // ----- the summary -----
  function row(dl, label, value, step) {
    var wrap = el('div', 'exp-check__row');
    wrap.appendChild(el('dt', '', label));
    var dd = el('dd');
    if (typeof value === 'string') dd.appendChild(el('span', '', value)); else dd.appendChild(value);
    if (step) { var b = el('button', 'btn btn--ghost btn--sm exp-check__edit', 'Edit'); b.type = 'button'; b.setAttribute('data-exp-go', String(step)); dd.appendChild(b); }
    wrap.appendChild(dd);
    dl.appendChild(wrap);
  }
  function drawSummary() {
    var dl = one('[data-exp-summary]');
    dl.textContent = '';
    var q = text(form.elements.question);
    row(dl, 'Finds out', q || 'No question written down.', 1);
    var a = agentRadio();
    row(dl, 'Runs', a ? 'The whole of ' + a.getAttribute('data-title') + ', each time.' : 'No agent chosen yet.', S_AGENT);
    var asks = all('[data-exp-ask] textarea').filter(function (t) { return text(t); });
    var ask = el('ul', 'exp-check__versions');
    asks.forEach(function (t) { var li = el('li'); li.appendChild(el('strong', '', t.name.replace(/^in_/, ''))); li.appendChild(document.createTextNode(': ' + (text(t).length > 160 ? text(t).slice(0, 159) + '…' : text(t)))); ask.appendChild(li); });
    row(dl, 'Asks it', asks.length ? ask : 'Nothing: it runs as it does with no inputs given.', S_ASK);
    var ms = made();
    if (!ms.length) row(dl, 'Changes', 'Nothing. It will show how steady the agent is from run to run.', S_CHANGES);
    ms.forEach(function (x) {
      var ul = el('ul', 'exp-check__versions');
      x.versions.forEach(function (v, i) {
        var li = el('li');
        li.appendChild(el('strong', '', v.name + (i === 0 ? ' (compared against)' : '')));
        if (v.says) li.appendChild(document.createTextNode(': ' + (v.says.length > 160 ? v.says.slice(0, 159) + '…' : v.says)));
        ul.appendChild(li);
      });
      var box = el('div');
      box.appendChild(el('span', 'exp-check__kind', x.what.charAt(0).toUpperCase() + x.what.slice(1)));
      box.appendChild(ul);
      row(dl, 'Changes ' + x.name.toLowerCase(), box, S_CHANGES);
    });
    var count = one('[data-exp-reveal="count"]');
    var inn = count && count.checked ? lines(form.elements.should_find.value) : [];
    var out = count && count.checked ? lines(form.elements.should_not_find.value) : [];
    var js = judges();
    var scored = [];
    if (inn.length) scored.push('counts how many of ' + inn.length + (inn.length === 1 ? ' named thing is' : ' named things are') + ' in the results');
    if (out.length) scored.push('counts how many of ' + out.length + (out.length === 1 ? ' is' : ' are') + ' left out');
    if (js) scored.push(js === 1 ? 'a model judges each result against your words' : js + ' models judge each result');
    var scores = scored.join('; and ');
    row(dl, 'Scores', scored.length ? scores.charAt(0).toUpperCase() + scores.slice(1) + '.' : 'Nothing. It shows which versions differ, not which is better.', S_SCORE);
    var c = countLine();
    var runs = el('div');
    runs.appendChild(el('span', 'exp-check__count', c.line));
    if (ms.length > 1 && c.combos <= 8) {
      var combos = [[]];
      ms.forEach(function (x) { var next = []; combos.forEach(function (p) { x.versions.forEach(function (v) { next.push(p.concat([v.name])); }); }); combos = next; });
      runs.appendChild(el('p', 'exp-check__combos', 'Every combination is run: ' + combos.map(function (p) { return p.join(' · '); }).join(', ') + '.'));
    }
    if (c.warn) runs.appendChild(el('p', 'exp-check__warn', c.warn));
    row(dl, 'Comes to', runs);
    var name = one('[data-exp-name]');
    if (name) name.placeholder = q ? q.replace(/[?.!]+$/, '').slice(0, 70) : 'A name for it';
    var submit = one('[data-exp-submit]');
    if (submit) submit.disabled = c.over;
  }

  // ----- moving between steps -----
  function say(n, msg) {
    var p = one('[data-exp-err]', steps[n - 1]);
    if (!p) return;
    p.textContent = msg || '';
    p.hidden = !msg;
  }
  function check(n) {
    if (n === S_AGENT && !agentRadio()) return 'Choose the agent to run.';
    if (n === S_CHANGES) return closeEditing();
    return '';
  }
  function show(n, focus) {
    cur = Math.max(1, Math.min(LAST, n));
    steps.forEach(function (s, i) { s.classList.toggle('is-on', i + 1 === cur); });
    all('[data-exp-progress] [data-exp-go]').forEach(function (b) {
      var k = Number(b.getAttribute('data-exp-go'));
      b.classList.toggle('is-on', k === cur);
      b.classList.toggle('is-done', k < cur);
      if (k === cur) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    one('[data-exp-back]').hidden = cur === 1;
    one('[data-exp-next]').hidden = cur === LAST;
    one('[data-exp-submit]').hidden = cur !== LAST;
    if (cur === S_AGENT) findAgents();
    if (cur >= S_ASK) drawForAgent();
    if (cur === S_CHANGES) enterChanges();
    if (cur === LAST) drawSummary();
    if (focus) {
      var f = one('textarea, input:not([type="hidden"]), select, button', steps[cur - 1]);
      if (f && cur !== LAST) f.focus();
      form.scrollIntoView({ block: 'start' });
    }
  }
  /** Go to a step, stopping at the first one on the way that isn't finished. */
  function go(n) {
    if (n <= cur) { say(cur, ''); show(n, true); return; }
    for (var k = cur; k < n; k++) {
      var msg = check(k);
      say(k, msg);
      if (msg) { show(k, true); if (k === S_CHANGES) drawChanges(); return; }
    }
    show(n, true);
  }

  form.addEventListener('change', function (e) {
    var t = e.target;
    if (!t.matches) return;
    if (t.matches('[data-exp-agent]')) { say(S_AGENT, ''); }
    if (t.matches('[data-exp-kind]')) { applyKind(t.closest('[data-exp-change]')); drawChanges(); var n = one('.exp-ver__name', t.closest('[data-exp-change]')); if (n) n.focus(); }
    if (t.matches('[data-exp-input]')) { applyKind(t.closest('[data-exp-change]')); }
    if (t.matches('[data-exp-reveal]')) {
      var box = one('[data-exp-revealed="' + t.getAttribute('data-exp-reveal') + '"]');
      box.hidden = !t.checked;
      if (!t.checked) all('textarea, input', box).forEach(function (x) { x.value = ''; });
      else { var f = one('textarea', box); if (f) f.focus(); }
    }
    if (cur === LAST) drawSummary();
  });
  form.addEventListener('input', function (e) {
    if (e.target.matches && e.target.matches('[data-exp-find]')) findAgents();
    if (cur === LAST) drawSummary();
  });
  form.addEventListener('click', function (e) {
    var t = e.target;
    if (!t.closest) return;
    var b;
    if ((b = t.closest('[data-exp-go]'))) { go(Number(b.getAttribute('data-exp-go'))); return; }
    if (t.closest('[data-exp-next]')) { go(cur + 1); return; }
    if (t.closest('[data-exp-back]')) { go(cur - 1); return; }
    if (t.closest('[data-exp-find-all]')) { one('[data-exp-findlist]').setAttribute('data-all', '1'); findAgents(); return; }
    if ((b = t.closest('[data-exp-add-version]'))) {
      var v = nextHidden(all('[data-exp-ver]', b.closest('[data-exp-change]')));
      if (v) { v.hidden = false; var f = one('input', v); if (f) f.focus(); }
    } else if (t.closest('[data-exp-add-change]')) {
      for (var i = 0; i < changes.length; i++) if (!info(changes[i]).made) { clearChange(changes[i]); editing = i; break; }
    } else if ((b = t.closest('[data-exp-rekind]'))) {
      var rc = b.closest('[data-exp-change]');
      all('[data-exp-kind]', rc).forEach(function (x) { x.checked = false; });
      rc.setAttribute('data-kind', '');
    } else if ((b = t.closest('[data-exp-remove-change]'))) {
      clearChange(b.closest('[data-exp-change]')); editing = -1; say(S_CHANGES, '');
    } else if ((b = t.closest('[data-exp-edit]'))) {
      var bad = closeEditing();
      if (bad) { say(S_CHANGES, bad); drawChanges(); return; }
      editing = Number(b.getAttribute('data-exp-edit'));
    } else if ((b = t.closest('[data-exp-remove]'))) {
      clearChange(changes[Number(b.getAttribute('data-exp-remove'))]);
    } else if (t.closest('[data-exp-add-judge]')) {
      var j = nextHidden(all('[data-exp-judge]'));
      if (j) { j.hidden = false; var jf = one('textarea', j); if (jf) jf.focus(); }
      t.closest('[data-exp-add-judge]').hidden = !nextHidden(all('[data-exp-judge]'));
      return;
    } else return;
    drawChanges();
  });
  // Enter in a one-line box goes on, as Next does; it never sends a half-made experiment. In a search box it only searches.
  form.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !e.target.matches || !e.target.matches('input:not([type="checkbox"]):not([type="radio"])')) return;
    if (e.target.matches('[data-exp-find]')) { e.preventDefault(); return; }
    if (cur === LAST) return;
    e.preventDefault();
    go(cur + 1);
  });
  form.addEventListener('submit', function (e) {
    for (var k = 1; k < LAST; k++) { var msg = check(k); if (msg) { e.preventDefault(); say(k, msg); show(k, true); return; } }
  });

  form.classList.add('exp-wiz');
  changes.forEach(function (c) { var r = one('[data-exp-kind]:checked', c); c.setAttribute('data-kind', r ? r.value : ''); });
  var addJudge = one('[data-exp-add-judge]');
  if (addJudge) addJudge.hidden = !nextHidden(all('[data-exp-judge]'));
  findAgents();
  show(Number(form.getAttribute('data-exp-open')) || 1, false);
})();
`;
