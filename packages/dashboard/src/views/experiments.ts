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

/** What one thing you change can be: the control each of its versions shows. */
export const EXPERIMENT_CHANGE_KINDS = [
  { id: 'instructions', label: 'the instructions it is given', placeholder: 'How this version tells the agent to decide what fits. Leave empty for the agent as it is.' },
  { id: 'preferences', label: 'what the person asks for', placeholder: 'What the person wants, in their words.' },
  { id: 'model', label: 'the model it runs on', placeholder: '' },
  { id: 'version', label: 'the version of the agent', placeholder: '' },
] as const;
export type ExperimentChangeKind = (typeof EXPERIMENT_CHANGE_KINDS)[number]['id'];
const CHANGE_DEFAULTS: Array<{ name: string; kind: ExperimentChangeKind; versions: string[] }> = [
  { name: 'Build', kind: 'instructions', versions: ['As built', 'Pay first'] },
  { name: 'Preferences', kind: 'preferences', versions: ['Wants remote', 'Wants an office'] },
  { name: '', kind: 'model', versions: ['', ''] },
];

/**
 * The page that sets an experiment up: the question, the set, what runs,
 * and up to three things to change. Each thing changed is one kind of
 * change (instructions, preferences, model, agent version), so each of its
 * versions is a name and one box. A line at the foot counts what it comes
 * to as you type. Works without scripts for two changes of two versions;
 * the buttons that add more need them.
 */
export function renderExperimentNew(args: {
  notebooks: ReadonlyArray<{ id: string; title: string; options: number }>;
  agents: ReadonlyArray<{ id: string; name: string; costPerRun?: number }>;
  providers: readonly string[];
  defaultAgent: string;
  values?: ExperimentNewValues;
  flash?: Flash;
}): string {
  const v = args.values ?? {};
  const b = (k: string) => { const x = v.body?.[k]; return typeof x === 'string' ? x : ''; };
  const agent = v.agent || args.defaultAgent;
  const sel = (on: boolean) => (on ? unsafeHtml(' selected') : unsafeHtml(''));
  const hide = (on: boolean) => (on ? unsafeHtml(' hidden') : unsafeHtml(''));

  const version = (c: number, n: number, kind: string, shown: boolean) => {
    const k = `c${String(c)}_v${String(n)}`;
    const letter = String.fromCharCode(64 + n);
    const hint = CHANGE_DEFAULTS[c - 1]?.versions[n - 1] ?? '';
    return html`<div class="exp-ver" data-exp-ver${hide(!shown)}>
      <span class="exp-ver__letter" aria-hidden="true">${letter}</span>
      <input class="form-field__input exp-ver__name" name="${k}_name" value="${b(`${k}_name`)}" maxlength="60" placeholder="${hint || `Version ${letter}`}" aria-label="Name of version ${letter}">
      <div class="exp-ver__value">
        <textarea class="form-field__textarea" name="${k}_text" rows="2" data-exp-for="instructions preferences" aria-label="What version ${letter} says" placeholder="${EXPERIMENT_CHANGE_KINDS.find((x) => x.id === kind)?.placeholder ?? ''}">${b(`${k}_text`)}</textarea>
        <span class="exp-ver__model" data-exp-for="model">
          <select class="form-field__input" name="${k}_provider" aria-label="Provider for version ${letter}">
            <option value="">the agent's own provider</option>
            ${list(args.providers.map((p) => html`<option value="${p}"${sel(b(`${k}_provider`) === p)}>${p}</option>`))}
          </select>
          <input class="form-field__input" name="${k}_model" value="${b(`${k}_model`)}" maxlength="80" placeholder="model (the provider's default if empty)" aria-label="Model for version ${letter}">
        </span>
        <input class="form-field__input exp-ver__num" name="${k}_version" type="number" min="1" value="${b(`${k}_version`)}" data-exp-for="version" placeholder="its current one" aria-label="Agent version for version ${letter}">
      </div>
    </div>`;
  };
  const change = (c: number) => {
    const d = CHANGE_DEFAULTS[c - 1];
    const k = `c${String(c)}`;
    const kind = (EXPERIMENT_CHANGE_KINDS.find((x) => x.id === b(`${k}_kind`))?.id ?? d.kind) as string;
    const name = b(`${k}_name`) || d.name;
    const used = (n: number) => !!(b(`${k}_v${String(n)}_name`) || b(`${k}_v${String(n)}_text`) || b(`${k}_v${String(n)}_model`) || b(`${k}_v${String(n)}_provider`) || b(`${k}_v${String(n)}_version`));
    // Shown: the first two always; one you filled in; a third change only once it's asked for or has something in it.
    const shownChange = c < 3 || !!name || [1, 2, 3, 4].some(used);
    return html`<section class="exp-change" data-exp-change data-kind="${kind}"${hide(!shownChange)} aria-label="Change ${String(c)}">
      <div class="exp-change__head">
        <span class="exp-change__n">Change ${String(c)}</span>
        <input class="form-field__input exp-change__name" name="${k}_name" value="${name}" maxlength="40" placeholder="what you call it" aria-label="What change ${String(c)} is called">
        <label class="exp-change__by">by changing
          <select class="form-field__input" name="${k}_kind" data-exp-kind>
            ${list(EXPERIMENT_CHANGE_KINDS.map((x) => html`<option value="${x.id}" data-placeholder="${x.placeholder}"${sel(kind === x.id)}>${x.label}</option>`))}
          </select>
        </label>
        ${c > 1 ? html`<button type="button" class="btn btn--ghost btn--sm exp-change__remove" data-exp-remove-change>Remove</button>` : html``}
      </div>
      <div class="exp-vers">${list([1, 2, 3, 4].map((n) => version(c, n, kind, n <= 2 || used(n))))}</div>
      <button type="button" class="btn btn--ghost btn--sm" data-exp-add-version>+ another version</button>
    </section>`;
  };
  const judge = (n: number) => {
    const k = `j${String(n)}`;
    const shown = n === 1 || !!b(`${k}_rubric`);
    return html`<div class="exp-judge" data-exp-judge${hide(!shown)}>
      <div class="exp-ver">
        <span class="exp-ver__letter" aria-hidden="true">${String(n)}</span>
        <input class="form-field__input exp-ver__name" name="${k}_name" value="${b(`${k}_name`)}" maxlength="60" placeholder="Respects the preferences" aria-label="Name of judge ${String(n)}">
        <div class="exp-ver__value">
          <textarea class="form-field__textarea" name="${k}_rubric" rows="2" aria-label="What a good result looks like, for judge ${String(n)}" placeholder="What a good result looks like: the top three match what the person asked for.">${b(`${k}_rubric`)}</textarea>
          <span class="exp-ver__model exp-ver__model--on">
            <select class="form-field__input" name="${k}_provider" aria-label="Provider for judge ${String(n)}">
              <option value="">judged by the default model</option>
              ${list(args.providers.map((p) => html`<option value="${p}"${sel(b(`${k}_provider`) === p)}>${p}</option>`))}
            </select>
            <input class="form-field__input" name="${k}_model" value="${b(`${k}_model`)}" maxlength="80" placeholder="model (optional)" aria-label="Model for judge ${String(n)}">
          </span>
        </div>
      </div>
    </div>`;
  };
  const scoring = !!(b('top_items') || b('j1_rubric') || b('j2_rubric'));
  const pasting = v.from === 'paste' || (!v.from && (!!v.paste || !args.notebooks.length));

  const body = html`
    ${pageHeader({
      crumbs: [{ label: 'Home', href: '/' }, { label: 'Experiments', href: '/experiments' }, { label: 'New' }],
      title: 'New experiment',
      description: 'Say what you want to find out, pick the set to hold fixed, and name what to change. Nothing runs until you press Run on the next page.',
    })}
    <form method="POST" action="/experiments" class="exp-new" data-exp-new data-max-runs="${String(EXPERIMENT_MAX_RUNS)}">
      <div class="exp-q">
        <label class="exp-q__label" for="exp-question">What do you want to find out?</label>
        <textarea class="form-field__textarea exp-q__box" id="exp-question" name="question" rows="2" maxlength="1000" placeholder="Does the way the agent was built change its picks more than what the person asks for?">${v.question ?? ''}</textarea>
        <input class="form-field__input exp-q__name" name="name" maxlength="120" value="${v.name ?? ''}" placeholder="A short name (sua uses your question if you leave this empty)" aria-label="A short name for the experiment">
      </div>

      <div class="exp-rows">
        <div class="exp-row2">
          <label class="exp-row2__label" for="exp-from">Hold fixed</label>
          <div class="exp-row2__field">
            <select class="form-field__input" id="exp-from" name="from" data-exp-from>
              <option value=""${sel(!v.from && !pasting)}>Choose a notebook to copy its options…</option>
              ${list(args.notebooks.map((n) => html`<option value="${n.id}"${sel(v.from === n.id)}>${n.title} (${plural(n.options, 'option')})</option>`))}
              <option value="paste"${sel(pasting)}>a list I paste</option>
            </select>
            <div class="exp-paste" data-exp-paste${hide(!pasting)}>
              <textarea class="form-field__textarea" name="paste" rows="4" aria-label="The items, one a line" placeholder="Staff Engineer at Acme | Pay: $250,000 | Remote: yes&#10;Senior Engineer at Globex | Pay: $210,000 | Remote: no">${v.paste ?? ''}</textarea>
              <p class="form-field__hint">One item a line. Facts after the title are separated by | and written "Label: value".</p>
            </div>
            <p class="form-field__hint">Every run ranks these same items. They are copied now and never change.</p>
          </div>
        </div>
        <div class="exp-row2">
          <label class="exp-row2__label" for="exp-agent">Run</label>
          <div class="exp-row2__field exp-row2__field--inline">
            <select class="form-field__input" id="exp-agent" name="agent" data-exp-agent>
              ${list(args.agents.map((a) => html`<option value="${a.id}"${a.costPerRun !== undefined ? unsafeHtml(` data-cost="${String(a.costPerRun)}"`) : unsafeHtml('')}${sel(agent === a.id)}>${a.name}${a.id === args.defaultAgent ? ' (ranks a list as told)' : ''}</option>`))}
            </select>
            <input class="form-field__input exp-new__short" id="exp-repeats" name="repeats" type="number" min="1" max="${String(EXPERIMENT_MAX_REPEATS)}" value="${v.repeats || '3'}" data-exp-repeats aria-label="Runs of each condition">
            <span class="exp-row2__after">times each</span>
          </div>
        </div>
      </div>

      <div class="exp-changes">
        ${list([1, 2, 3].map(change))}
        <button type="button" class="btn btn--ghost btn--sm" data-exp-add-change>+ change something else</button>
        <p class="form-field__hint">Every combination is run: two changes with two versions each is four conditions. The first version of each is the baseline the others are compared with. A change with only one version filled in is left out.</p>
      </div>

      <details class="exp-score"${scoring ? unsafeHtml(' open') : unsafeHtml('')}>
        <summary>Score each result <span class="exp-score__opt">optional</span></summary>
        <p class="form-field__hint">Without a score you learn which conditions differ, not which is better.</p>
        <div class="exp-row2">
          <label class="exp-row2__label" for="exp-top">Should be near the top</label>
          <div class="exp-row2__field">
            <textarea class="form-field__textarea" id="exp-top" name="top_items" rows="2" placeholder="Part of an item's title, one a line">${b('top_items')}</textarea>
            <p class="form-field__hint">Counted: the share of these that land in the top places.</p>
          </div>
        </div>
        <div class="exp-row2">
          <span class="exp-row2__label">A judge</span>
          <div class="exp-row2__field">
            ${list([1, 2].map(judge))}
            <button type="button" class="btn btn--ghost btn--sm" data-exp-add-judge>+ another judge</button>
            <p class="form-field__hint">A model reads each result against your words and gives 0 to 100% with a reason. It never sees which version made the result. Each judge reads every result, so it doubles the runs.</p>
          </div>
        </div>
      </details>

      <label class="exp-also"><input type="checkbox" name="notebook" value="1"${b('notebook') === '1' ? unsafeHtml(' checked') : unsafeHtml('')}> Also make a notebook that shows its results, to talk them over with sua</label>

      <div class="exp-sum">
        <p class="exp-sum__count" data-exp-sum aria-live="polite">Every combination of your changes, ${v.repeats || '3'} times each.</p>
        <div class="exp-new__acts">
          <a class="btn btn--ghost" href="/experiments">Cancel</a>
          <button type="submit" class="btn btn--primary">Set it up</button>
        </div>
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
        <div><dt>Holds fixed</dt><dd>${list(cases.map((c) => html`${plural(c.items.length, 'item')}${e.from ? html`, copied from <a href="/notebooks/${encodeURIComponent(e.from.notebookId)}">${e.from.title}</a>` : html``} `))}</dd></div>
        ${list(e.factors.map((f) => html`<div><dt>Varies ${f.name.toLowerCase()}</dt><dd><ul class="exp-levels-said">${list(f.levels.map((l) => html`<li><strong>${l.name}:</strong> ${levelSays(l).join('; ')}</li>`))}</ul></dd></div>`))}
        ${list(e.scorers.map((sc) => html`<div><dt>Scores</dt><dd><strong>${sc.name}:</strong> ${sc.kind === 'top'
          ? `counted: the share of ${plural(sc.items.length, 'named item')} (${sc.items.map((id) => titleOf.get(id) ?? id).join('; ')}) in the top ${String(sc.k)}`
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
 * the New experiment page shows the right box for each kind of change, adds
 * versions, changes and a judge, and counts what the setup comes to.
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
  function all(sel, root) { return Array.prototype.slice.call((root || form).querySelectorAll(sel)); }
  function filled(ver) {
    return all('input, textarea, select', ver).some(function (f) { return f.offsetParent !== null && String(f.value || '').trim() !== ''; });
  }
  function nextHidden(list) { for (var i = 0; i < list.length; i++) if (list[i].hidden) return list[i]; return null; }
  function tidy() {
    all('[data-exp-change]').forEach(function (c) {
      var add = c.querySelector('[data-exp-add-version]');
      if (add) add.hidden = !nextHidden(all('[data-exp-ver]', c));
    });
    var addChange = form.querySelector('[data-exp-add-change]');
    if (addChange) addChange.hidden = !nextHidden(all('[data-exp-change]'));
    var addJudge = form.querySelector('[data-exp-add-judge]');
    if (addJudge) addJudge.hidden = !nextHidden(all('[data-exp-judge]'));
  }
  function count() {
    var sizes = [];
    all('[data-exp-change]').forEach(function (c) {
      if (c.hidden) return;
      var n = all('[data-exp-ver]', c).filter(function (v) { return !v.hidden && filled(v); }).length;
      if (n >= 2) sizes.push(n);
    });
    var conditions = sizes.reduce(function (a, b) { return a * b; }, 1);
    var repeats = Math.max(1, Math.min(5, Number((form.querySelector('[data-exp-repeats]') || {}).value) || 3));
    var judges = all('[data-exp-judge]').filter(function (j) { return !j.hidden && String((j.querySelector('textarea') || {}).value || '').trim(); }).length;
    var runs = conditions * repeats * (1 + judges);
    var out = form.querySelector('[data-exp-sum]');
    if (!out) return;
    var parts = sizes.length > 1 ? sizes.join(' \u00d7 ') + ' = ' : '';
    var text = parts + conditions + (conditions === 1 ? ' condition' : ' conditions') + ' \u00d7 ' + repeats + (repeats === 1 ? ' run' : ' runs')
      + (judges ? ', each read by ' + judges + (judges === 1 ? ' judge' : ' judges') : '') + ' = ' + runs + (runs === 1 ? ' run' : ' runs');
    var agent = form.querySelector('[data-exp-agent]');
    var opt = agent && agent.options[agent.selectedIndex];
    var cost = opt ? Number(opt.getAttribute('data-cost')) : 0;
    if (cost > 0) { var est = cost * conditions * repeats; text += ', about ' + (est < 0.01 ? 'under $0.01' : '$' + est.toFixed(2)); }
    var note = '';
    if (!sizes.length) note = ' Nothing is changed yet, so this only shows how much the result moves by itself.';
    else if (repeats === 1) note = ' With one run of each, nothing can be concluded: use 2 or more.';
    if (runs > MAX) note = ' That is more than the ' + MAX + ' a pass may make: use fewer versions, runs or judges.';
    out.textContent = text + '.' + note;
    out.classList.toggle('exp-sum__count--over', runs > MAX);
  }
  form.addEventListener('change', function (e) {
    var t = e.target;
    if (t.matches && t.matches('[data-exp-kind]')) {
      var c = t.closest('[data-exp-change]');
      c.setAttribute('data-kind', t.value);
      var ph = t.options[t.selectedIndex].getAttribute('data-placeholder') || '';
      all('textarea', c).forEach(function (x) { x.placeholder = ph; });
    }
    if (t.matches && t.matches('[data-exp-from]')) {
      var p = form.querySelector('[data-exp-paste]');
      if (p) p.hidden = t.value !== 'paste';
    }
    count();
  });
  form.addEventListener('input', count);
  form.addEventListener('click', function (e) {
    var t = e.target;
    if (!t.closest) return;
    var b;
    if ((b = t.closest('[data-exp-add-version]'))) {
      var v = nextHidden(all('[data-exp-ver]', b.closest('[data-exp-change]')));
      if (v) { v.hidden = false; var f = v.querySelector('input'); if (f) f.focus(); }
    } else if ((b = t.closest('[data-exp-add-change]'))) {
      var c = nextHidden(all('[data-exp-change]'));
      if (c) { c.hidden = false; var n = c.querySelector('input'); if (n) n.focus(); }
    } else if ((b = t.closest('[data-exp-remove-change]'))) {
      var gone = b.closest('[data-exp-change]');
      all('input, textarea', gone).forEach(function (x) { x.value = ''; });
      all('select', gone).forEach(function (x) { if (!x.matches('[data-exp-kind]')) x.selectedIndex = 0; });
      gone.hidden = true;
    } else if ((b = t.closest('[data-exp-add-judge]'))) {
      var j = nextHidden(all('[data-exp-judge]'));
      if (j) { j.hidden = false; var jn = j.querySelector('input'); if (jn) jn.focus(); }
    } else return;
    tidy();
    count();
  });
  tidy();
  count();
})();
`;
