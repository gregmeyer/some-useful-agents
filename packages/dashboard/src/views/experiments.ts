/**
 * Experiments (ADR-0078): the list, the page that sets one up, and an
 * experiment's own page: what it found in a sentence, the numbers behind
 * it, each condition against the baseline, where each item landed, and
 * every run. All of it is drawn from the stored cells; nothing on these
 * pages is written by a model.
 */
import {
  experimentConditions, experimentRunCount, passProgress, verdictWords,
  EXPERIMENT_MAX_REPEATS, EXPERIMENT_MAX_RUNS,
  type Experiment, type ExperimentCase, type ExperimentCell, type ExperimentLevel, type ExperimentPass, type ExperimentScore, type ExperimentVerdict, type ScoreSummary,
} from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { working } from './working.js';
import type { GoldenSet, SetAdvice, SetCandidate } from '../lib/experiment-set.js';
import type { RunItem, RunSetCandidate } from '../lib/experiment-run-set.js';

type Flash = { kind: 'error' | 'info' | 'ok'; message: string };
const list = (xs: SafeHtml[]) => xs as unknown as SafeHtml[];
const num = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '');
const pct = (n: number) => `${String(Math.round(n * 100))}%`;
const money = (n: number) => (n < 0.01 ? 'under $0.01' : `$${n.toFixed(2)}`);
const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;

/** How an experiment stands, for its list row and its page. */
export interface ExperimentStanding {
  /** A pass is running in this process. */
  running: boolean;
  pass?: ExperimentPass;
  cells: ExperimentCell[];
  /** Judges' scores for the pass, and each scorer's average for each condition. */
  scores?: ExperimentScore[];
  summaries?: ScoreSummary[];
  verdict?: ExperimentVerdict;
}

function standingBadge(s: ExperimentStanding): SafeHtml {
  const p = passProgress(s.cells);
  if (s.running) return html`<span class="badge badge--info">running ${String(p.done)} of ${String(p.total)}</span>`;
  if (!s.pass) return html`<span class="badge badge--muted">not run yet</span>`;
  if (p.stopped) return html`<span class="badge badge--warn">stopped at ${String(p.done)} of ${String(p.total)}</span>`;
  if (p.invalid + p.failed) return html`<span class="badge badge--warn">${String(p.done)} of ${String(p.total)} usable</span>`;
  return html`<span class="badge badge--ok">run</span>`;
}

export function renderExperimentsList(args: { experiments: Array<{ e: Experiment; standing: ExperimentStanding; items: number }>; archived?: boolean; archivedCount?: number; flash?: Flash }): string {
  const rows = args.experiments.map(({ e, standing, items }) => {
    const words = standing.verdict ? verdictWords(standing.verdict) : undefined;
    return html`<li class="exp-row${e.archivedAt ? ' exp-row--archived' : ''}">
      <div class="exp-row__main">
        <a class="exp-row__name" href="/experiments/${encodeURIComponent(e.id)}">${e.name}</a>
        ${standingBadge(standing)}
        <p class="exp-row__line">${words && standing.pass ? words.headline : e.question || 'No question written down.'}</p>
      </div>
      <p class="exp-row__meta">${plural(items, 'item')} · ${plural(experimentConditions(e.factors).length, 'condition')} · ${plural(e.repeats, 'repeat')} · ${e.task.agentId}</p>
    </li>`;
  });
  const body = html`
    ${pageHeader({
      crumbs: [{ label: 'Home', href: '/' }, { label: 'Experiments' }],
      title: 'Experiments',
      meta: [html`<span class="badge badge--muted">${String(args.experiments.length)}</span>`],
      cta: html`<a class="btn btn--primary" href="/experiments/new">New experiment</a>`,
      description: 'Run one agent over the same fixed set several ways, and see what changed its answer. The numbers are counted from the runs, not written by a model.',
    })}
    ${rows.length ? html`<ul class="exp-list">${list(rows)}</ul>` : html`
      <div class="card card--muted exp-empty">
        <p><strong>${args.archived ? 'Nothing archived.' : 'No experiments yet.'}</strong></p>
        ${args.archived ? html`` : html`<p>An experiment answers a question like "does the way this agent was built change its picks more than what the person asks for?" It holds a set of items fixed, runs the agent under each combination you name, repeats each, and counts how far the results move.</p>
        <p><a class="btn btn--primary" href="/experiments/new">Set one up</a></p>`}
      </div>`}
    <p class="exp-foot">${args.archived ? html`<a href="/experiments">Back to experiments</a>` : args.archivedCount ? html`<a href="/experiments?archived=1">${plural(args.archivedCount, 'archived experiment')}</a>` : html``}</p>`;
  return render(layout({ title: 'Experiments', activeNav: 'experiments', ...(args.flash ? { flash: args.flash } : {}) }, body));
}

export interface ExperimentNewValues { name?: string; question?: string; agent?: string; from?: string; paste?: string; repeats?: string; body?: Record<string, unknown> }

/** What one thing you change can be: the box each of its versions shows. */
export const EXPERIMENT_CHANGE_KINDS = [
  { id: 'instructions', title: 'How it is told to decide', says: 'Two or more sets of instructions for the agent.', call: 'Build', placeholder: 'How this version tells the agent to decide what fits. Leave empty for the agent as it is.' },
  { id: 'preferences', title: 'What the person asks for', says: 'Two or more people\'s preferences, in their words.', call: 'Preferences', placeholder: 'What this person wants, in their words.' },
  { id: 'model', title: 'The model it runs on', says: 'The same instructions on different models.', call: 'Model', placeholder: '' },
  { id: 'version', title: 'The version of the agent', says: 'An earlier version of the agent against a later one.', call: 'Agent version', placeholder: '' },
] as const;
export type ExperimentChangeKind = (typeof EXPERIMENT_CHANGE_KINDS)[number]['id'];

/** The wizard's steps, in order. */
export const EXPERIMENT_NEW_STEPS = ['The question', 'What you\'re testing', 'What stays the same', 'What changes', 'Which is better', 'Check it'] as const;

/**
 * The step a refusal belongs to, so the page comes back where the problem
 * is: the agent (2), the set (3), a scorer that names no item (5), anything
 * else on the summary (6).
 */
export function experimentStepForError(message: string): number {
  if (/Choose the agent|isn't installed/.test(message)) return 2;
  if (/Choose the notebook|at least two items|in the running|No such notebook|No such run|run's results/.test(message)) return 3;
  if (/matches none of the items/.test(message)) return 5;
  return 6;
}

/**
 * The sets to choose from: your notebooks, the best fit for the question
 * first, each with what speaks for it and against it; then a list you
 * paste. The one that fits best is marked Suggested (never chosen for you).
 */
export function renderSetChoices(candidates: readonly SetCandidate[], selected: string, pasting: boolean, reading?: { status: 'working' | 'ready' | 'failed'; advice?: SetAdvice }, found?: { search: string; more: number }, runs: readonly RunSetCandidate[] = []): SafeHtml {
  const on = (yes: boolean) => (yes ? unsafeHtml(' checked') : unsafeHtml(''));
  const and = (xs: SafeHtml[]) => xs.map((x, i) => html`${i === 0 ? '' : i === xs.length - 1 ? ' and ' : ', '}${x}`);
  // sua's reading of the question, over the counted ranking: under way, done, or not to be had.
  const read = !reading ? html`<div data-exp-advice="none"></div>`
    : reading.status === 'working' ? html`<div class="exp-reading" data-exp-advice="working">${working({ text: 'sua is reading your question to see which facts it turns on. The list below is already ranked on what your notebooks hold.' })}</div>`
    : reading.status === 'ready' && reading.advice ? html`<div class="exp-reading" data-exp-advice="ready">
        <p class="exp-reading__says"><span class="exp-reading__label">sua's reading</span> ${reading.advice.turnsOn.length
          ? html`Your question turns on ${list(and(reading.advice.turnsOn.map((t) => html`<strong>${t.fact.toLowerCase()}</strong>${t.because ? ` (${t.because})` : ''}`)))}. Each notebook below says for how many of its options that is noted.`
          : html`It couldn't tie your question to a fact your notebooks note.`}</p>
        ${reading.advice.missing.length ? html`<p class="exp-reading__missing">Not noted in any of your notebooks: ${reading.advice.missing.join('; ')}. Runs can't tell items apart on what isn't there.</p>` : html``}
      </div>`
    : html`<div class="exp-reading" data-exp-advice="failed"><p class="form-field__hint">sua couldn't read your question just now. These are ranked on what your notebooks hold.</p></div>`;
  return html`${read}${list(candidates.map((n) => html`<label class="exp-choice${n.suggested ? ' exp-choice--suggested' : ''}">
      <input type="radio" name="from" value="${n.id}" data-exp-from data-title="${n.title}" data-label="${plural(n.options, 'option')} copied from ${n.title}"${on(selected === n.id)}>
      <span class="exp-choice__title">${n.title}${n.suggested ? html` <span class="badge badge--ok">Suggested</span>` : html``}${n.archived ? html` <span class="badge badge--muted">archived</span>` : html``}</span>
      <span class="exp-choice__says">${plural(n.options, 'option')}${n.sample.length ? `: ${n.sample.join(' · ')}${n.options > n.sample.length ? ` and ${String(n.options - n.sample.length)} more` : ''}` : ''}</span>
      ${n.reading ? html`<span class="exp-choice__says exp-choice__for">sua: ${n.reading}</span>` : html``}
      ${n.turnsOn?.length ? html`<span class="exp-choice__says exp-choice__for">What your question turns on: ${n.turnsOn.map((t) => (t.noted === undefined ? `nothing called ${t.label.toLowerCase()}` : `${t.label.toLowerCase()}${t.as ? ` (here “${t.as}”)` : ''} noted for ${String(t.noted)} of ${String(n.options)}`)).join('; ')}.</span>` : html``}
      ${n.why.length ? html`<span class="exp-choice__says exp-choice__for">For it: ${n.why.join('; ')}.</span>` : html``}
      ${n.but.length ? html`<span class="exp-choice__says exp-choice__but">Against it: ${n.but.join('; ')}.</span>` : html``}
    </label>`))}
    ${found?.search && !candidates.length && !runs.length ? html`<p class="form-field__hint">No notebook or run with two or more items matches “${found.search}”.</p>` : html``}
    ${runs.length ? html`<p class="exp-sets__label">Or the results of a run${found?.search ? '' : ' (your most-run agents; search for another)'}</p>` : html``}
    ${list(runs.map((r) => html`<label class="exp-choice">
      <input type="radio" name="from" value="run:${r.runId}" data-exp-from data-title="${r.title}" data-label="${plural(r.items, 'item')} from ${r.title}"${on(selected === `run:${r.runId}`)}>
      <span class="exp-choice__title">${r.title}</span>
      <span class="exp-choice__says">${plural(r.items, 'item')} read from its results: ${r.sample.join(' · ')}${r.items > r.sample.length ? ` and ${String(r.items - r.sample.length)} more` : ''}</span>
    </label>`))}
    ${found?.more ? html`<p class="form-field__hint">${plural(found.more, 'more notebook')} not shown. Search to find one by name; archived ones are searched too.</p>` : html``}
    <label class="exp-choice">
      <input type="radio" name="from" value="paste" data-exp-from data-title="" data-label="a list you pasted"${on(pasting)}>
      <span class="exp-choice__title">A list I paste</span>
      <span class="exp-choice__says">${candidates.length ? 'When none of your notebooks has the things to rank.' : 'None of your notebooks has two or more options yet.'}</span>
    </label>`;
}

/**
 * What will be copied from the chosen notebook, to check and change: the
 * set sua proposes (all of a short list; a trimmed "golden set" of a long
 * one) as a list of every option with the proposed ones ticked, and, when
 * the notebook has picks, the offer to score results against them.
 * `posted` are the items ticked last time (a page that came back).
 */
export function renderSetPanel(notebookId: string, g: GoldenSet, posted?: { items?: ReadonlySet<string>; key?: boolean }): SafeHtml {
  const ticked = (id: string, inSet: boolean) => (posted?.items ? posted.items.has(id) : inSet);
  const picks = g.items.filter((i) => i.why === 'pick' && i.inSet).length;
  const spread = g.items.filter((i) => i.why === 'spread' && i.inSet).length;
  const low = g.items.filter((i) => i.why === 'ruled-out' && i.inSet).length;
  const running = g.items.filter((i) => i.why !== 'ruled-out').length;
  const parts = [
    ...(picks ? [`${g.key?.by === 'sua' ? 'sua\'s' : 'your'} ${plural(picks, 'pick')}`] : []),
    ...(spread ? [`${String(spread)} of the rest, spread from best to worst${g.across ? ` by ${g.across}` : ''}`] : []),
    ...(low ? [`${String(low)} you ruled out (a good result keeps ${low === 1 ? 'it' : 'them'} low)`] : []),
  ];
  const says = g.trimmed
    ? `sua suggests a golden set of ${String(g.size)} in place of all ${String(running)}: ${parts.length > 1 ? `${parts.slice(0, -1).join('; ')}; and ${parts[parts.length - 1]}` : parts.join('')}. Fewer items make quicker, clearer runs.`
    : `All ${String(running)} of its options${low ? `, and ${String(low)} you ruled out (a good result keeps ${low === 1 ? 'it' : 'them'} low)` : ''}.`;
  const tag = (i: GoldenSet['items'][number]) => (i.why === 'pick' ? html` <span class="badge badge--ok">${g.key?.by === 'sua' ? 'sua\'s pick' : 'your pick'}</span>` : i.why === 'ruled-out' ? html` <span class="badge badge--muted">ruled out</span>${i.reason ? html` <span class="exp-set__reason">${i.reason}</span>` : html``}` : html``);
  const keyOn = posted?.key ?? !!g.key;
  return html`<div class="exp-set" data-exp-set data-total="${String(g.of)}">
    <p class="exp-set__says">${says}</p>
    <details class="exp-set__list"${g.trimmed ? unsafeHtml(' open') : unsafeHtml('')}>
      <summary>See and change what's in it</summary>
      <ul class="exp-set__items">
        ${list(g.items.map((i) => html`<li><label><input type="checkbox" name="items_${notebookId}" value="${i.id}" data-exp-item${ticked(i.id, i.inSet) ? unsafeHtml(' checked') : unsafeHtml('')}> ${i.name}${tag(i)}</label></li>`))}
      </ul>
    </details>
    ${g.key ? html`<label class="exp-set__key"><input type="checkbox" name="key_${notebookId}" value="1" data-exp-key${keyOn ? unsafeHtml(' checked') : unsafeHtml('')}>
      <span>Score each result against ${g.key.by === 'sua' ? 'sua\'s' : 'your'} ${plural(g.key.ids.length, 'pick')}: ${g.key.names.join(', ')}${low ? `; and against keeping what you ruled out low` : ''}.
      <span class="exp-set__keynote">${g.key.by === 'sua' ? 'You haven\'t decided in that notebook, so these are sua\'s picks, not yours.' : 'This tells you which version agrees with what you actually chose, not only which versions differ.'}</span></span></label>` : html``}
  </div>`;
}

/**
 * What would be taken from a run's results: every item sua read out of
 * them, with its facts, to check before it's copied. Read as written; if it
 * isn't the list you meant, choose another run or paste one.
 */
export function renderRunPanel(items: readonly RunItem[]): SafeHtml {
  if (items.length < 2) return html`<div class="exp-set"><p class="exp-set__says">sua couldn't read a list of two or more items out of that run's results. Choose another run, a notebook, or paste the list.</p></div>`;
  return html`<div class="exp-set" data-exp-set>
    <p class="exp-set__says">sua read ${plural(items.length, 'item')} out of that run's results. Check they're the things you want ranked: they are used as they are.</p>
    <details class="exp-set__list" open>
      <summary>See the ${String(items.length)}</summary>
      <ol class="exp-set__items exp-set__items--read">
        ${list(items.map((i) => html`<li><strong>${i.title}</strong>${Object.keys(i.facts).length ? html` <span class="exp-set__reason">${Object.entries(i.facts).slice(0, 6).map(([k, v]) => `${k}: ${v.length > 60 ? `${v.slice(0, 59)}…` : v}`).join(' · ')}</span>` : html` <span class="exp-set__reason">no facts with it</span>`}</li>`))}
      </ol>
    </details>
    ${items.every((i) => !Object.keys(i.facts).length) ? html`<p class="exp-choice__but">These came as a plain list, with no facts for an agent to rank by. Results will turn on the titles alone.</p>` : html``}
  </div>`;
}

/**
 * The page that sets an experiment up, as five steps: the question, the set
 * every run ranks, what changes (one change at a time, each one kind of
 * change), whether results are scored, and a summary to check. It is one
 * form posted once; the steps are shown one at a time by the page's script
 * (EXPERIMENT_PAGE_JS), and without scripts they stack with the same button
 * at the end. `open` is the step to start on.
 */
export function renderExperimentNew(args: {
  notebooks: readonly SetCandidate[];
  /** What will be copied from the chosen notebook (renderSetPanel), when one is chosen. */
  setPanel?: SafeHtml;
  /** The agents that could be tested: `takesItems` says whether an experiment can hand it the set as it is. */
  agents: ReadonlyArray<{ id: string; name: string; description?: string; takesItems?: boolean; costPerRun?: number; runs?: number; current?: number; versions?: ReadonlyArray<{ v: number; at: string; note?: string }> }>;
  /** Runs whose results could be the set. */
  runs?: readonly RunSetCandidate[];
  /** Notebooks that fit but aren't listed until searched for. */
  moreNotebooks?: number;
  providers: readonly string[];
  defaultAgent: string;
  values?: ExperimentNewValues;
  /** The step to open on (1 to 5). */
  open?: number;
  flash?: Flash;
}): string {
  const v = args.values ?? {};
  const b = (k: string) => { const x = v.body?.[k]; return typeof x === 'string' ? x : ''; };
  const fresh = !v.body || !Object.keys(v.body).length;
  const agent = v.agent || args.defaultAgent;
  const on = (yes: boolean, attr: string) => (yes ? unsafeHtml(` ${attr}`) : unsafeHtml(''));
  const pasting = v.from === 'paste' || (!v.from && !!v.paste);

  const version = (c: number, n: number, kind: string, shown: boolean) => {
    const k = `c${String(c)}_v${String(n)}`;
    const letter = String.fromCharCode(64 + n);
    return html`<div class="exp-ver" data-exp-ver${on(!shown, 'hidden')}>
      <span class="exp-ver__letter" aria-hidden="true">${letter}</span>
      <input class="form-field__input exp-ver__name" name="${k}_name" value="${b(`${k}_name`)}" maxlength="60" placeholder="Name of version ${letter}" aria-label="Name of version ${letter}">
      <div class="exp-ver__value">
        <textarea class="form-field__textarea" name="${k}_text" rows="3" data-exp-for="instructions preferences" aria-label="What version ${letter} says" placeholder="${EXPERIMENT_CHANGE_KINDS.find((x) => x.id === kind)?.placeholder ?? ''}">${b(`${k}_text`)}</textarea>
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
    const any = [1, 2, 3, 4].some(used);
    // A change that came filled in keeps its kind (instructions when it named none); an empty one waits to be asked.
    const kind = EXPERIMENT_CHANGE_KINDS.find((x) => x.id === b(`${k}_kind`))?.id ?? (any ? 'instructions' : '');
    return html`<div class="exp-change" data-exp-change data-kind="${kind}">
      <fieldset class="exp-choices" data-exp-kinds>
        <legend class="exp-step__ask">${c === 1 ? 'What do you want to change?' : 'What else do you want to change?'}</legend>
        ${list(EXPERIMENT_CHANGE_KINDS.map((x) => html`<label class="exp-choice">
          <input type="radio" name="${k}_kind" value="${x.id}" data-exp-kind data-call="${x.call}" data-placeholder="${x.placeholder}"${on(kind === x.id, 'checked')}>
          <span class="exp-choice__title">${x.title}</span>
          <span class="exp-choice__says">${x.says}</span>
        </label>`))}
      </fieldset>
      <div class="exp-change__body" data-exp-change-body>
        <label class="exp-field"><span class="exp-field__label">What to call it</span>
          <input class="form-field__input exp-change__name" name="${k}_name" value="${b(`${k}_name`)}" maxlength="40" placeholder="Build"></label>
        <p class="exp-field__label">Its versions. A is what the others are compared with.</p>
        <p class="form-field__hint" data-exp-for="version" data-exp-versions-hint></p>
        <div class="exp-vers">${list([1, 2, 3, 4].map((n) => version(c, n, kind, n <= 2 || used(n))))}</div>
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
        <textarea class="form-field__textarea" name="${k}_rubric" rows="3" placeholder="The top three match what the person asked for; nothing they ruled out is in the top five.">${b(`${k}_rubric`)}</textarea></label>
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
  const counting = !!b('top_items');
  const judging = !!(b('j1_rubric') || b('j2_rubric'));
  const open = Math.min(6, Math.max(1, args.open ?? 1));

  const body = html`
    ${pageHeader({
      crumbs: [{ label: 'Home', href: '/' }, { label: 'Experiments', href: '/experiments' }, { label: 'New' }],
      title: 'New experiment',
      description: 'Five short steps. Nothing is made until the last one, and nothing runs until you press Run after that.',
    })}
    <form method="POST" action="/experiments" class="exp-new" data-exp-new data-exp-open="${String(open)}" data-max-runs="${String(EXPERIMENT_MAX_RUNS)}">
      <ol class="exp-steps" data-exp-progress aria-label="Steps">
        ${list(EXPERIMENT_NEW_STEPS.map((s, i) => html`<li><button type="button" class="exp-steps__step" data-exp-go="${String(i + 1)}"><span class="exp-steps__n">${String(i + 1)}</span> ${s}</button></li>`))}
      </ol>

      <section class="exp-step" data-exp-step="1" aria-labelledby="exp-s1">
        <h2 class="exp-step__ask" id="exp-s1"><label for="exp-question">What do you want to find out?</label></h2>
        <textarea class="form-field__textarea exp-q__box" id="exp-question" name="question" rows="3" maxlength="1000" placeholder="Does the way the agent was built change its picks more than what the person asks for?">${v.question ?? ''}</textarea>
        <p class="form-field__hint">In your own words. An experiment runs one agent over the same set of things several ways and counts how far its answer moves.</p>
        <p class="exp-step__err" data-exp-err role="alert" hidden></p>
      </section>

      <section class="exp-step" data-exp-step="2" aria-labelledby="exp-s2">
        <fieldset class="exp-choices">
          <legend class="exp-step__ask" id="exp-s2">Which agent are you testing?</legend>
          <p class="form-field__hint">Each run gives it the same set of items and whatever a version changes. It has to answer with every item, best first.</p>
          <input class="form-field__input exp-find" type="search" placeholder="Search your agents" aria-label="Search your agents" data-exp-find>
          <div class="exp-findlist" data-exp-findlist data-first="6">
            ${list(args.agents.map((a) => html`<label class="exp-choice${a.id === args.defaultAgent ? ' exp-choice--suggested' : ''}" data-exp-findable data-text="${`${a.name} ${a.id} ${a.description ?? ''}`.toLowerCase()}">
              <input type="radio" name="agent" value="${a.id}" data-exp-agent data-title="${a.name}" data-versions="${JSON.stringify(a.versions ?? [])}"${a.costPerRun !== undefined ? unsafeHtml(` data-cost="${String(a.costPerRun)}"`) : unsafeHtml('')}${on(agent === a.id, 'checked')}>
              <span class="exp-choice__title">${a.name}${a.id === args.defaultAgent ? html` <span class="badge badge--ok">Suggested</span>` : html``}</span>
              <span class="exp-choice__says">${a.id === args.defaultAgent ? 'Ranks the set the way each version tells it to. Use it to test instructions, preferences or models without an agent of your own.' : a.description ? (a.description.length > 160 ? `${a.description.slice(0, 159)}…` : a.description) : a.id}</span>
              ${a.id === args.defaultAgent ? html`` : html`<span class="exp-choice__says exp-choice__for">${a.runs ? `Run ${plural(a.runs, 'time')}` : 'Not run yet'}${a.versions?.length ? ` · ${plural(a.versions.length, 'version')}${a.current !== undefined ? `, now on ${String(a.current)}` : ''}` : ''}</span>`}
              ${a.id === args.defaultAgent || a.takesItems ? html`` : html`<span class="exp-choice__says exp-choice__but">It has no ITEMS input, so an experiment can't hand it the set. Its runs would rank nothing and be unusable until it takes ITEMS and answers with a &lt;ranking&gt; block.</span>`}
            </label>`))}
          </div>
          <button type="button" class="btn btn--ghost btn--sm" data-exp-find-all hidden>Show all ${String(args.agents.length)}</button>
          <p class="form-field__hint" data-exp-find-none hidden>No agent matches that.</p>
        </fieldset>
        <p class="exp-step__err" data-exp-err role="alert" hidden></p>
      </section>

      <section class="exp-step" data-exp-step="3" aria-labelledby="exp-s3">
        <fieldset class="exp-choices">
          <legend class="exp-step__ask" id="exp-s3">Which set should every run rank?</legend>
          <p class="form-field__hint">It is copied now and never changes, so every run is judged on the same things.</p>
          <input class="form-field__input exp-find" type="search" placeholder="Search your notebooks (archived ones too)" aria-label="Search your notebooks" data-exp-find-sets>
          <div class="exp-sets" data-exp-sets data-for-question="${(v.question ?? '').trim()}">${renderSetChoices(args.notebooks, v.from ?? '', pasting, undefined, { search: '', more: args.moreNotebooks ?? 0 }, args.runs ?? [])}</div>
        </fieldset>
        <div class="exp-paste" data-exp-paste${on(!pasting, 'hidden')}>
          <textarea class="form-field__textarea" name="paste" rows="5" aria-label="The items, one a line" placeholder="Staff Engineer at Acme | Pay: $250,000 | Remote: yes&#10;Senior Engineer at Globex | Pay: $210,000 | Remote: no">${v.paste ?? ''}</textarea>
          <p class="form-field__hint">One item a line. Facts after the title are separated by | and written "Label: value".</p>
        </div>
        <div data-exp-setpanel>${args.setPanel ?? html``}</div>
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
        <p class="form-field__hint" data-exp-nochange hidden>With nothing changed, it only shows how much the result moves by itself when the same thing is run again.</p>
        <p class="exp-step__err" data-exp-err role="alert" hidden></p>
      </section>

      <section class="exp-step" data-exp-step="5" aria-labelledby="exp-s5">
        <fieldset class="exp-choices">
          <legend class="exp-step__ask" id="exp-s5">Do you also want to know which is better?</legend>
          <p class="form-field__hint">Comparing results shows which versions differ. To say which is better you need a standard. Leave both off to skip this.</p>
          <label class="exp-choice">
            <input type="checkbox" data-exp-reveal="count"${on(counting, 'checked')}>
            <span class="exp-choice__title">Count it</span>
            <span class="exp-choice__says">Name items that should be near the top. Counted the same way every time.</span>
          </label>
          <div class="exp-reveal" data-exp-revealed="count"${on(!counting, 'hidden')}>
            <label class="exp-field"><span class="exp-field__label">Items that should be near the top</span>
              <textarea class="form-field__textarea" name="top_items" rows="3" placeholder="Part of an item's title, one a line">${b('top_items')}</textarea></label>
          </div>
          <label class="exp-choice">
            <input type="checkbox" data-exp-reveal="judge"${on(judging, 'checked')}>
            <span class="exp-choice__title">Have a model judge it</span>
            <span class="exp-choice__says">It reads each result against your words and gives 0 to 100% with a reason. It never sees which version made the result. This doubles the runs.</span>
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
        <details class="exp-how">
          <summary>How it runs</summary>
          <label class="exp-field"><span class="exp-field__label">Runs of each combination</span>
            <input class="form-field__input exp-new__short" name="repeats" type="number" min="1" max="${String(EXPERIMENT_MAX_REPEATS)}" value="${v.repeats || '3'}" data-exp-repeats></label>
          <p class="form-field__hint">Running each more than once shows how much the result moves by itself. With one run, nothing can be concluded.</p>
        </details>
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

/** What a level sets, in words. */
function levelSays(l: ExperimentLevel): string[] {
  const out: string[] = [];
  if (l.version !== undefined) out.push(`agent version ${String(l.version)}`);
  if (l.provider || l.model) out.push(`runs on ${[l.provider, l.model].filter(Boolean).join(' ')}`);
  if (l.instructions) out.push(`instructions: “${l.instructions.length > 220 ? `${l.instructions.slice(0, 219)}…` : l.instructions}”`);
  for (const [k, val] of Object.entries(l.inputs ?? {})) out.push(`${k.toLowerCase()}: “${val.length > 220 ? `${val.slice(0, 219)}…` : val}”`);
  return out.length ? out : ['changes nothing (the agent as it is)'];
}

const CELL_BADGE: Record<ExperimentCell['status'], string> = { todo: 'badge--muted', running: 'badge--info', done: 'badge--ok', invalid: 'badge--warn', failed: 'badge--err', stopped: 'badge--muted' };
const CELL_WORD: Record<ExperimentCell['status'], string> = { todo: 'waiting', running: 'running', done: 'ranked', invalid: 'unusable', failed: 'failed', stopped: 'stopped' };

/** What changes as a pass runs: the page reloads when this does. */
export function experimentStateKey(s: ExperimentStanding): string {
  const p = passProgress(s.cells);
  return [s.pass?.id ?? '', s.running ? 'r' : '', p.done, p.invalid, p.failed, p.stopped, p.todo, p.running].join('|');
}

/** Items shown in the per-item table before the fold. */
const ITEMS_SHOWN = 12;

export function renderExperimentPage(args: {
  e: Experiment;
  cases: ExperimentCase[];
  standing: ExperimentStanding;
  /** What a run of its agent has cost lately, when known. */
  costPerRun?: number;
  /** Its agent's name, and whether it is installed. */
  agent?: { name: string; version?: number };
  /** The notebook that shows it, when it has one. */
  notebook?: { id: string; title: string };
  flash?: Flash;
}): string {
  const { e, cases, standing } = args;
  const conditions = experimentConditions(e.factors);
  const runs = experimentRunCount(e, cases.length);
  const p = passProgress(standing.cells);
  const v = standing.verdict;
  const words = v ? verdictWords(v) : undefined;
  const act = (path: string) => `/experiments/${encodeURIComponent(e.id)}/${path}`;
  const post = (path: string, label: string, cls = 'btn', extra: SafeHtml = html``) => html`<form method="POST" action="${act(path)}" class="exp-act">${extra}<button type="submit" class="${cls}">${label}</button></form>`;
  const estimate = args.costPerRun !== undefined ? `, about ${money(args.costPerRun * runs)}` : '';
  const left = p.stopped + (standing.running ? 0 : p.todo);
  const unusable = p.invalid + p.failed;
  const titleOf = new Map(cases.flatMap((c) => c.items.map((i) => [i.id, i.title] as const)));

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
        ${post('run', standing.pass ? 'Run it again' : `Run it (${plural(runs, 'run')}${estimate})`, standing.pass ? 'btn' : 'btn btn--primary')}
        ${inNotebook}`;

  const verdictBlock = !standing.pass
    ? html`<section class="exp-verdict exp-verdict--none"><p class="exp-verdict__headline">Not run yet.</p><p class="exp-verdict__sample">A pass makes ${plural(runs, 'run')}: ${plural(conditions.length, 'condition')} × ${plural(e.repeats, 'repeat')}${cases.length > 1 ? ` × ${plural(cases.length, 'set')}` : ''}${estimate}. Two run at a time.</p></section>`
    : html`<section class="exp-verdict" aria-label="What it found">
        <p class="exp-verdict__label">${standing.running ? 'So far' : 'What it found'}</p>
        <p class="exp-verdict__headline">${words?.headline ?? ''}</p>
        ${words?.lines.length ? html`<ul class="exp-verdict__lines">${list(words.lines.map((l) => html`<li>${l}</li>`))}</ul>` : html``}
        <p class="exp-verdict__sample">${words?.sample ?? ''}${unusable ? ` ${plural(unusable, 'run')} couldn't be used and ${unusable === 1 ? 'is' : 'are'} not counted.` : ''}</p>
      </section>`;

  const figures = v && (v.effects.length || v.noise) ? html`<div class="exp-figures">
      ${list(v.effects.map((f) => html`<div class="exp-figure${f.beyondNoise ? ' exp-figure--on' : ''}">
        <p class="exp-figure__value">${num(f.shift)}</p>
        <p class="exp-figure__label">places moved by changing ${f.name.toLowerCase()}</p>
        <p class="exp-figure__sub">${num(f.overlap)} of the top ${String(v.topK)} stayed${f.beyondNoise === undefined ? '' : f.beyondNoise ? ' · more than a repeat' : ' · no more than a repeat'}</p>
      </div>`))}
      ${v.noise ? html`<div class="exp-figure exp-figure--noise">
        <p class="exp-figure__value">${num(v.noise.shift)}</p>
        <p class="exp-figure__label">places moved between two runs of the same thing</p>
        <p class="exp-figure__sub">${num(v.noise.overlap)} of the top ${String(v.topK)} stayed · at most ${num(v.noise.shiftMax)}</p>
      </div>` : html``}
    </div>` : html``;

  const conditionRows = conditions.map((c, i) => {
    const m = v?.conditions.find((x) => x.id === c.id);
    const cs = standing.cells.filter((x) => x.conditionId === c.id);
    const done = cs.filter((x) => x.status === 'done').length;
    return html`<tr>
      <th scope="row">${c.name}${i === 0 ? html` <span class="badge badge--muted">baseline</span>` : html``}</th>
      <td class="exp-n">${standing.pass ? `${String(done)} of ${String(cs.length)}` : '—'}</td>
      <td class="exp-n">${i === 0 ? '—' : m?.vsBaseline ? `${num(m.vsBaseline.overlap)} of ${String(v!.topK)}` : '…'}</td>
      <td class="exp-n">${i === 0 ? '—' : m?.vsBaseline ? num(m.vsBaseline.shift) : '…'}</td>
      ${list(e.scorers.map((sc) => { const sm = standing.summaries?.find((x) => x.scorerId === sc.id && x.conditionId === c.id); return html`<td class="exp-n">${sm ? html`${pct(sm.mean)}${sm.n > 1 && sm.min !== sm.max ? html` <span class="exp-range">${pct(sm.min)}–${pct(sm.max)}</span>` : html``}` : standing.pass ? '…' : '—'}</td>`; }))}
    </tr>`;
  });

  const itemRows = (v?.items ?? []).map((it) => html`<tr>
      <th scope="row">${titleOf.get(it.id) ?? it.id}</th>
      ${list(conditions.map((c) => html`<td class="exp-n">${it.ranks[c.id] !== undefined ? num(it.ranks[c.id]) : '—'}</td>`))}
      <td class="exp-n exp-n--strong">${num(it.spread)}</td>
    </tr>`);
  const itemTable = (rows: SafeHtml[]) => html`<div class="exp-scroll"><table class="table exp-table">
      <thead><tr><th scope="col">Item</th>${list(conditions.map((c) => html`<th scope="col" class="exp-n">${c.name}</th>`))}<th scope="col" class="exp-n">Moved</th></tr></thead>
      <tbody>${list(rows)}</tbody>
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
    ${standing.running ? html`<p class="exp-working">${working({ text: `Running ${String(p.done + p.invalid + p.failed + 1 > p.total ? p.total : p.done + p.invalid + p.failed + 1)} of ${String(p.total)}. This page updates by itself; you can leave and come back.` })}</p>` : html``}
    ${!args.agent ? html`<p class="flash flash--error">Its agent, ${e.task.agentId}, isn't installed, so it can't run.</p>` : html``}
    ${standing.pass && args.agent?.version !== undefined && standing.pass.taskVersion !== undefined && args.agent.version !== standing.pass.taskVersion && !standing.running
      ? html`<p class="exp-note">${args.agent.name} has changed since this ran (it was version ${String(standing.pass.taskVersion)}, it is now ${String(args.agent.version)}). Run it again to see what that changed.</p>` : html``}
    ${verdictBlock}
    ${figures}

    <section class="exp-section">
      <h2>Each condition against the baseline</h2>
      <p class="exp-section__note">How many of the baseline's top ${String(e.topK)} are still in the top ${String(e.topK)}, and how many places an item moved on average.${e.scorers.length ? ' Then each score, averaged over the condition\'s runs (with the lowest and highest when they differ). The baseline has scores too: a score is about one result, not a comparison.' : ''}</p>
      <div class="exp-scroll"><table class="table exp-table">
        <thead><tr><th scope="col">Condition</th><th scope="col" class="exp-n">Runs</th><th scope="col" class="exp-n">Top ${String(e.topK)} kept</th><th scope="col" class="exp-n">Places moved</th>${list(e.scorers.map((sc) => html`<th scope="col" class="exp-n">${sc.name}</th>`))}</tr></thead>
        <tbody>${list(conditionRows)}</tbody>
      </table></div>
    </section>

    ${v && v.effects.some((f) => f.parts.length > 1) ? html`<section class="exp-section">
      <h2>Each change by itself</h2>
      <p class="exp-section__note">The same change made with everything else held at one setting. When these differ a lot, the thing varied matters under some settings and not others.</p>
      <div class="exp-scroll"><table class="table exp-table">
        <thead><tr><th scope="col">Changing</th><th scope="col">From</th><th scope="col">To</th><th scope="col" class="exp-n">Top ${String(e.topK)} kept</th><th scope="col" class="exp-n">Places moved</th></tr></thead>
        <tbody>${list(v.effects.flatMap((f) => f.parts.map((part) => html`<tr>
          <th scope="row">${f.name}</th>
          <td>${conditions.find((c) => c.id === part.from)?.name ?? part.from}</td>
          <td>${conditions.find((c) => c.id === part.to)?.name ?? part.to}</td>
          <td class="exp-n">${num(part.overlap)} of ${String(v.topK)}</td>
          <td class="exp-n">${num(part.shift)}</td>
        </tr>`)))}</tbody>
      </table></div>
    </section>` : html``}

    ${itemRows.length ? html`<section class="exp-section">
      <h2>Where each item landed</h2>
      <p class="exp-section__note">Its place under each condition (1 is first), averaged over that condition's runs. The items that moved furthest are first.${cases.length > 1 ? ` Showing ${cases[0].name}.` : ''}</p>
      ${itemTable(itemRows.slice(0, ITEMS_SHOWN))}
      ${itemRows.length > ITEMS_SHOWN ? html`<details class="exp-fold"><summary>${plural(itemRows.length - ITEMS_SHOWN, 'more item')}</summary>${itemTable(itemRows.slice(ITEMS_SHOWN))}</details>` : html``}
    </section>` : html``}

    <section class="exp-section">
      <h2>How it is set up</h2>
      <dl class="exp-setup">
        <div><dt>Runs</dt><dd>${args.agent?.name ?? e.task.agentId}, ${plural(e.repeats, 'time')} for each condition</dd></div>
        <div><dt>Holds fixed</dt><dd>${list(cases.map((c) => html`${plural(c.items.length, 'item')}${e.from ? html`, copied from <a href="/notebooks/${encodeURIComponent(e.from.notebookId)}">${e.from.title}</a>` : html``}${e.fromRun ? html`, taken from <a href="/runs/${encodeURIComponent(e.fromRun.runId)}">${e.fromRun.title}</a>` : html``} `))}</dd></div>
        ${list(e.factors.map((f) => html`<div><dt>Varies ${f.name.toLowerCase()}</dt><dd><ul class="exp-levels-said">${list(f.levels.map((l) => html`<li><strong>${l.name}:</strong> ${levelSays(l).join('; ')}</li>`))}</ul></dd></div>`))}
        ${list(e.scorers.map((sc) => html`<div><dt>Scores</dt><dd><strong>${sc.name}:</strong> ${sc.kind === 'top'
          ? `counted: the share of ${plural(sc.items.length, 'named item')} (${sc.items.map((id) => titleOf.get(id) ?? id).join('; ')}) ${sc.avoid ? 'kept out of' : 'in'} the top ${String(sc.k)}`
          : `judged${sc.provider || sc.model ? ` by ${[sc.provider, sc.model].filter(Boolean).join(' ')}` : ''}: “${sc.rubric}”`}</dd></div>`))}
        ${e.factors.length ? html`` : html`<div><dt>Varies</dt><dd>Nothing: it runs the agent as it is, ${plural(e.repeats, 'time')}, which shows how much its answer moves by itself.</dd></div>`}
      </dl>
      <details class="exp-fold"><summary>The ${plural(cases.reduce((s, c) => s + c.items.length, 0), 'item')} held fixed</summary>
        ${list(cases.map((c) => html`<ol class="exp-items">${list(c.items.map((i) => html`<li><strong>${i.title}</strong>${Object.keys(i.facts).length ? html` <span class="exp-items__facts">${Object.entries(i.facts).map(([k, val]) => `${k}: ${val}`).join(' · ')}</span>` : html``}</li>`))}</ol>`))}
      </details>
    </section>

    ${standing.cells.length ? html`<section class="exp-section">
      <details class="exp-fold"><summary>Every run (${plural(standing.cells.length, 'run')}${p.costUsd ? `, ${money(p.costUsd)}` : ''})</summary>
        <div class="exp-scroll"><table class="table exp-table">
          <thead><tr><th scope="col">Condition</th><th scope="col" class="exp-n">Run</th><th scope="col">How it went</th><th scope="col">Its top ${String(e.topK)}</th></tr></thead>
          <tbody>${list(standing.cells.map((c) => html`<tr>
            <th scope="row">${conditions.find((x) => x.id === c.conditionId)?.name ?? c.conditionId}</th>
            <td class="exp-n">${String(c.repeat)}</td>
            <td><span class="badge ${CELL_BADGE[c.status]}">${CELL_WORD[c.status]}</span>${c.runId ? html` <a href="/runs/${encodeURIComponent(c.runId)}">the run</a>` : html``}${c.error ? html` <span class="exp-cell__why">${c.error}</span>` : html``}</td>
            <td>${c.ranking ? c.ranking.slice(0, e.topK).map((id) => titleOf.get(id) ?? id).join(' · ') : ''}${list((standing.scores ?? []).filter((x) => x.cellId === c.id).map((x) => { const sc = e.scorers.find((y) => y.id === x.scorerId); return html`<p class="exp-cell__score"><strong>${sc?.name ?? x.scorerId}:</strong> ${x.value !== undefined ? html`${pct(x.value)}. ${x.reason ?? ''}` : html`<span class="exp-cell__why">no score: ${x.error ?? 'it gave none'}</span>`}${x.runId ? html` <a href="/runs/${encodeURIComponent(x.runId)}">the judge's run</a>` : html``}</p>`; }))}</td>
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
 * the New experiment page becomes five steps shown one at a time: Next
 * checks only the step you're on, the changes are made one at a time, and
 * the last step writes the whole setup out from what the form holds.
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
  setInterval(check, el.getAttribute('data-exp-running') ? 4000 : 20000);
})();
(function () {
  var form = document.querySelector('[data-exp-new]');
  if (!form) return;
  var MAX = Number(form.getAttribute('data-max-runs')) || 60;
  var LAST = 6;
  // The steps, by number.
  var S_AGENT = 2, S_SET = 3, S_CHANGES = 4, S_SCORE = 5;
  function all(sel, root) { return Array.prototype.slice.call((root || form).querySelectorAll(sel)); }
  function one(sel, root) { return (root || form).querySelector(sel); }
  function text(f) { return f ? String(f.value || '').trim() : ''; }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }
  function nextHidden(list) { for (var i = 0; i < list.length; i++) if (list[i].hidden) return list[i]; return null; }

  var steps = all('[data-exp-step]');
  var changes = all('[data-exp-change]');
  var cur = 1;
  /** The change being filled in (its index), or -1 when none is. */
  var editing = -1;

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
    return { kind: kindOf(c), name: text(one('.exp-change__name', c)) || (r ? r.getAttribute('data-call') : ''), kindTitle: r ? text({ value: one('.exp-choice__title', r.parentNode).textContent }) : '', versions: vs, made: vs.length >= 2, touched: vs.length > 0 };
  }
  function made() { return changes.map(info).filter(function (x) { return x.made; }); }
  function judges() { var r = one('[data-exp-reveal="judge"]'); return r && r.checked ? all('[data-exp-judge]').filter(function (j) { return !j.hidden && text(one('textarea', j)); }).length : 0; }
  function repeats() { return Math.max(1, Math.min(5, Number(text(one('[data-exp-repeats]'))) || 3)); }
  function countLine() {
    var sizes = made().map(function (x) { return x.versions.length; });
    var combos = sizes.reduce(function (a, b) { return a * b; }, 1);
    var r = repeats();
    var j = judges();
    var runs = combos * r * (1 + j);
    var line = (sizes.length > 1 ? sizes.join(' × ') + ' = ' : '') + combos + (combos === 1 ? ' combination' : ' combinations') + ' × ' + r + (r === 1 ? ' run' : ' runs')
      + (j ? ', each read by ' + j + (j === 1 ? ' judge' : ' judges') : '') + ' = ' + runs + (runs === 1 ? ' run' : ' runs');
    var opt = one('[data-exp-agent]:checked');
    var cost = opt ? Number(opt.getAttribute('data-cost')) : 0;
    if (cost > 0) { var est = cost * combos * r; line += ', about ' + (est < 0.01 ? 'under $0.01' : '$' + est.toFixed(2)); }
    var warn = '';
    if (runs > MAX) warn = 'That is more than the ' + MAX + ' runs one pass may make. Use fewer versions, runs or judges.';
    else if (r === 1) warn = 'With one run of each, nothing can be concluded. Use 2 or more under How it runs.';
    return { line: line + '.', warn: warn, over: runs > MAX, combos: combos };
  }

  // ----- step 2: the sets, ranked for the question, and what would be copied -----
  var askedFor = null;
  var askedQuestion = null;
  var findTimer = null;
  function getHtml(url) { return fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } }).then(function (r) { return r.ok ? r.text() : null; }); }
  function chosenFrom() { var r = one('[data-exp-from]:checked'); return r ? r.value : ''; }
  function loadPanel(from) {
    var box = one('[data-exp-setpanel]');
    if (!box) return;
    if (!from || from === 'paste') { box.textContent = ''; return; }
    box.setAttribute('data-for', from);
    getHtml('/experiments/sets?panel=1&from=' + encodeURIComponent(from)).then(function (h) {
      // Only if it's still the one chosen.
      if (h !== null && box.getAttribute('data-for') === from && chosenFrom() === from) { box.innerHTML = h; if (cur === LAST) drawSummary(); }
    }).catch(function () {});
  }
  // ----- step 2: the agent, found by typing -----
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
    one('[data-exp-find-none]').hidden = shown > 0;
  }
  /** The chosen agent's versions, offered wherever a version number is asked for. */
  function offerVersions() {
    var a = one('[data-exp-agent]:checked');
    var vs = [];
    try { vs = JSON.parse((a && a.getAttribute('data-versions')) || '[]'); } catch (e) { vs = []; }
    var dl = document.getElementById('exp-versions');
    if (dl) {
      dl.textContent = '';
      vs.forEach(function (v) { var o = document.createElement('option'); o.value = String(v.v); o.label = 'Version ' + v.v + ' · ' + v.at + (v.note ? ' · ' + v.note : ''); dl.appendChild(o); });
    }
    var name = a ? a.getAttribute('data-title') : 'The agent';
    var hint = !vs.length ? name + ' has no earlier versions to compare. To test versions, choose one of your own agents in step 2.'
      : vs.length === 1 ? name + ' has one version (' + vs[0].v + '), so there is nothing to compare it with yet.'
      : name + ' has versions ' + vs[vs.length - 1].v + ' to ' + vs[0].v + '. The newest are ' + vs.slice(0, 4).map(function (v) { return v.v + ' (' + v.at + ')'; }).join(', ') + '.';
    all('[data-exp-versions-hint]').forEach(function (p) { p.textContent = hint; });
  }

  /** What is changed, in a few lines, for sua's reading of the question. */
  function changesSaid() {
    return made().map(function (x) { return x.name + ' (' + x.kindTitle.toLowerCase() + '): ' + x.versions.map(function (v) { return v.name + (v.says ? ' = ' + v.says.slice(0, 200) : ''); }).join(' | '); }).join('\\n');
  }
  /**
   * The question (or what changes) is new since the sets were last ranked:
   * rank them again, keeping what's chosen, and ask sua to read the question.
   * Its reading arrives a little later and is laid over the same list.
   */
  function refreshSets() {
    var q = text(form.elements.question);
    var ch = changesSaid();
    var find = text(one('[data-exp-find-sets]'));
    var ask = q + '\\n' + ch + '\\n' + find;
    var list = one('[data-exp-sets]');
    if (!list || ask === askedFor) return;
    var sameQuestion = askedQuestion === q + '\\n' + ch;
    askedFor = ask;
    askedQuestion = q + '\\n' + ch;
    var url = function () { return '/experiments/sets?question=' + encodeURIComponent(q) + '&changes=' + encodeURIComponent(ch) + '&q=' + encodeURIComponent(find) + '&from=' + encodeURIComponent(chosenFrom()); };
    var tries = 0;
    function draw() {
      getHtml(url()).then(function (h) {
        if (h === null || askedFor !== ask) return;
        list.innerHTML = h;
        var a = one('[data-exp-advice]', list);
        // Still reading: look again shortly, for about a minute.
        if (a && a.getAttribute('data-exp-advice') === 'working' && tries++ < 20) setTimeout(draw, 3000);
      }).catch(function () {});
    }
    // Only a new question is read again; searching just re-lists.
    if (!q || sameQuestion) { draw(); return; }
    var body = 'question=' + encodeURIComponent(q) + '&changes=' + encodeURIComponent(ch);
    fetch('/experiments/sets/advice', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'fetch' }, body: body })
      .then(draw, draw);
  }
  function setItems() { return all('[data-exp-setpanel] [data-exp-item]'); }

  // ----- step 3: one change at a time -----
  function clearChange(c) {
    all('input[type="text"], input[type="number"], input:not([type]), textarea', c).forEach(function (x) { x.value = ''; });
    all('select', c).forEach(function (x) { x.selectedIndex = 0; });
    all('[data-exp-kind]', c).forEach(function (x) { x.checked = false; });
    all('[data-exp-ver]', c).forEach(function (v, i) { v.hidden = i > 1; });
    c.setAttribute('data-kind', '');
  }
  function applyKind(c) {
    var r = one('[data-exp-kind]:checked', c);
    c.setAttribute('data-kind', r ? r.value : '');
    if (!r) return;
    all('textarea', c).forEach(function (x) { x.placeholder = r.getAttribute('data-placeholder') || ''; });
    var name = one('.exp-change__name', c);
    var calls = all('[data-exp-kind]', c).map(function (x) { return x.getAttribute('data-call'); });
    if (name && (!text(name) || calls.indexOf(text(name)) >= 0)) name.value = r.getAttribute('data-call') || '';
  }
  function drawChanges() {
    var list = one('[data-exp-made]');
    list.textContent = '';
    changes.forEach(function (c, i) {
      c.hidden = i !== editing;
      var body = one('[data-exp-change-body]', c);
      if (body) body.hidden = !kindOf(c);
      var add = one('[data-exp-add-version]', c);
      if (add) add.hidden = !nextHidden(all('[data-exp-ver]', c));
      var x = info(c);
      if (!x.made || i === editing) return;
      var li = el('li', 'exp-made__item');
      var words = el('span', 'exp-made__words');
      words.appendChild(el('strong', '', x.name));
      words.appendChild(document.createTextNode(' (' + x.kindTitle.toLowerCase() + '): ' + x.versions.map(function (v) { return v.name; }).join(' | ')));
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

  // ----- step 5: the summary -----
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
    var from = one('[data-exp-from]:checked');
    var lines = text(form.elements.paste).split(/\\n/).filter(function (l) { return l.trim(); }).length;
    var boxes = setItems();
    var kept = boxes.filter(function (x) { return x.checked; }).length;
    var holds = !from ? 'Nothing chosen yet.' : from.value === 'paste' ? lines + (lines === 1 ? ' item' : ' items') + ' you pasted'
      : boxes.length && kept < boxes.length ? kept + (kept === 1 ? ' item' : ' items') + ' from ' + from.getAttribute('data-title') + ' (a golden set; ' + (boxes.length - kept) + ' left out)' : from.getAttribute('data-label');
    var ag = one('[data-exp-agent]:checked');
    row(dl, 'Tests', ag ? ag.getAttribute('data-title') : 'No agent chosen.', S_AGENT);
    row(dl, 'Holds fixed', holds, S_SET);
    var ms = made();
    if (!ms.length) row(dl, 'Changes', 'Nothing. It will only show how much the result moves by itself.', S_CHANGES);
    ms.forEach(function (x) {
      var ul = el('ul', 'exp-check__versions');
      x.versions.forEach(function (v, i) {
        var li = el('li');
        li.appendChild(el('strong', '', v.name + (i === 0 ? ' (compared against)' : '')));
        if (v.says) li.appendChild(document.createTextNode(': ' + (v.says.length > 160 ? v.says.slice(0, 159) + '…' : v.says)));
        ul.appendChild(li);
      });
      var box = el('div');
      box.appendChild(el('span', 'exp-check__kind', x.kindTitle));
      box.appendChild(ul);
      row(dl, 'Changes ' + x.name.toLowerCase(), box, S_CHANGES);
    });
    var count = one('[data-exp-reveal="count"]');
    var tops = count && count.checked ? text(form.elements.top_items).split(/\\n/).filter(function (l) { return l.trim(); }) : [];
    var js = judges();
    var scored = [];
    var key = one('[data-exp-setpanel] [data-exp-key]');
    if (from && from.value !== 'paste' && key && key.checked) scored.push('counts whether the picks in that notebook land near the top');
    if (tops.length) scored.push('counts how many of ' + tops.length + (tops.length === 1 ? ' named item lands' : ' named items land') + ' near the top');
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
    if (n === S_AGENT && !one('[data-exp-agent]:checked')) return 'Choose the agent to test.';
    if (n === S_SET) {
      var from = one('[data-exp-from]:checked');
      if (!from) return 'Choose the set every run ranks.';
      if (from.value === 'paste' && text(form.elements.paste).split(/\\n/).filter(function (l) { return l.trim(); }).length < 2) return 'Paste at least two items, one a line.';
      var boxes = setItems();
      if (from.value !== 'paste' && boxes.length && boxes.filter(function (x) { return x.checked; }).length < 2) return 'Keep at least two items in the set.';
    }
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
    if (cur === S_SET) refreshSets();
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
    if (t.matches('[data-exp-kind]')) { applyKind(t.closest('[data-exp-change]')); drawChanges(); var n = one('.exp-ver__name', t.closest('[data-exp-change]')); if (n) n.focus(); }
    if (t.matches('[data-exp-from]')) { one('[data-exp-paste]').hidden = t.value !== 'paste'; say(S_SET, ''); loadPanel(t.value); }
    if (t.matches('[data-exp-item]')) say(S_SET, '');
    if (t.matches('[data-exp-agent]')) { say(S_AGENT, ''); offerVersions(); }
    if (t.matches('[data-exp-reveal]')) {
      var box = one('[data-exp-revealed="' + t.getAttribute('data-exp-reveal') + '"]');
      box.hidden = !t.checked;
      if (!t.checked) all('textarea, input', box).forEach(function (x) { x.value = ''; });
      else { var f = one('textarea', box); if (f) f.focus(); }
    }
    if (cur === LAST) drawSummary();
  });
  form.addEventListener('input', function (e) {
    var t = e.target;
    if (t.matches && t.matches('[data-exp-find]')) findAgents();
    // Searching the sets asks the server (it reaches archived notebooks and other agents' runs), once typing pauses.
    if (t.matches && t.matches('[data-exp-find-sets]')) { clearTimeout(findTimer); findTimer = setTimeout(refreshSets, 250); }
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
  // Enter in a one-line box goes on, as Next does; it never sends a half-made experiment.
  form.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !e.target.matches || !e.target.matches('input:not([type="checkbox"]):not([type="radio"])')) return;
    // Enter in a search box searches; it doesn't move on.
    if (e.target.matches('[data-exp-find], [data-exp-find-sets]')) { e.preventDefault(); return; }
    if (cur === LAST) return;
    e.preventDefault();
    go(cur + 1);
  });
  form.addEventListener('submit', function (e) {
    for (var k = 1; k < LAST; k++) { var msg = check(k); if (msg) { e.preventDefault(); say(k, msg); show(k, true); return; } }
  });

  form.classList.add('exp-wiz');
  changes.forEach(applyKindKeepName);
  function applyKindKeepName(c) { var r = one('[data-exp-kind]:checked', c); c.setAttribute('data-kind', r ? r.value : ''); }
  var addJudge = one('[data-exp-add-judge]');
  if (addJudge) addJudge.hidden = !nextHidden(all('[data-exp-judge]'));
  offerVersions();
  findAgents();
  show(Number(form.getAttribute('data-exp-open')) || 1, false);
})();
`;
