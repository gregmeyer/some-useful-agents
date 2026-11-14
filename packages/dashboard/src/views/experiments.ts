/**
 * Experiments (ADR-0078): the list, the page that sets one up, and an
 * experiment's own page: what it found in a sentence, the numbers behind
 * it, each condition against the baseline, where each item landed, and
 * every run. All of it is drawn from the stored cells; nothing on these
 * pages is written by a model.
 */
import {
  experimentConditions, experimentRunCount, passProgress, verdictWords,
  EXPERIMENT_MAX_LEVELS, EXPERIMENT_MAX_REPEATS, EXPERIMENT_MAX_RUNS,
  type Experiment, type ExperimentCase, type ExperimentCell, type ExperimentLevel, type ExperimentPass, type ExperimentVerdict,
} from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { working } from './working.js';

type Flash = { kind: 'error' | 'info' | 'ok'; message: string };
const list = (xs: SafeHtml[]) => xs as unknown as SafeHtml[];
const num = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '');
const money = (n: number) => (n < 0.01 ? 'under $0.01' : `$${n.toFixed(2)}`);
const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;

/** How an experiment stands, for its list row and its page. */
export interface ExperimentStanding {
  /** A pass is running in this process. */
  running: boolean;
  pass?: ExperimentPass;
  cells: ExperimentCell[];
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

/** The page that sets an experiment up. Two factors are offered, each with up to four levels. */
export function renderExperimentNew(args: {
  notebooks: ReadonlyArray<{ id: string; title: string; options: number }>;
  agents: ReadonlyArray<{ id: string; name: string }>;
  providers: readonly string[];
  defaultAgent: string;
  values?: ExperimentNewValues;
  flash?: Flash;
}): string {
  const v = args.values ?? {};
  const b = (k: string) => { const x = v.body?.[k]; return typeof x === 'string' ? x : ''; };
  const agent = v.agent || args.defaultAgent;
  const level = (f: number, l: number) => {
    const k = `f${String(f)}_l${String(l)}`;
    const optional = l > 2;
    return html`<fieldset class="exp-level">
      <legend>Level ${String(l)}${optional ? ' (optional)' : ''}</legend>
      <label class="form-field__label" for="${k}_name">Name</label>
      <input class="form-field__input" id="${k}_name" name="${k}_name" value="${b(`${k}_name`)}" maxlength="60" placeholder="${f === 1 ? (l === 1 ? 'As built' : 'Pay first') : (l === 1 ? 'Wants remote' : 'Wants seniority')}">
      <label class="form-field__label" for="${k}_instructions">Instructions to the agent</label>
      <textarea class="form-field__textarea" id="${k}_instructions" name="${k}_instructions" rows="3" placeholder="How this level tells the agent to decide what fits. Leave empty if this level doesn't change it.">${b(`${k}_instructions`)}</textarea>
      <label class="form-field__label" for="${k}_preferences">The person's preferences</label>
      <textarea class="form-field__textarea" id="${k}_preferences" name="${k}_preferences" rows="3" placeholder="What the person wants, in their words. Leave empty if this level doesn't change it.">${b(`${k}_preferences`)}</textarea>
      <details class="exp-level__more">
        <summary>Model or agent version</summary>
        <label class="form-field__label" for="${k}_provider">Provider</label>
        <select class="form-field__input" id="${k}_provider" name="${k}_provider">
          <option value="">the agent's own</option>
          ${list(args.providers.map((p) => html`<option value="${p}"${b(`${k}_provider`) === p ? unsafeHtml(' selected') : unsafeHtml('')}>${p}</option>`))}
        </select>
        <label class="form-field__label" for="${k}_model">Model</label>
        <input class="form-field__input" id="${k}_model" name="${k}_model" value="${b(`${k}_model`)}" maxlength="80" placeholder="the provider's default">
        <label class="form-field__label" for="${k}_version">Agent version</label>
        <input class="form-field__input" id="${k}_version" name="${k}_version" type="number" min="1" value="${b(`${k}_version`)}" placeholder="its current one">
      </details>
    </fieldset>`;
  };
  const factor = (f: number, name: string, hint: string) => html`<section class="exp-factor" aria-labelledby="f${String(f)}_h">
    <h3 id="f${String(f)}_h">Thing to vary ${String(f)}${f > 1 ? ' (optional)' : ''}</h3>
    <p class="form-field__hint">${hint}</p>
    <label class="form-field__label" for="f${String(f)}_name">What is varied</label>
    <input class="form-field__input" id="f${String(f)}_name" name="f${String(f)}_name" value="${b(`f${String(f)}_name`) || (v.body ? '' : name)}" maxlength="40">
    <div class="exp-levels">${list(Array.from({ length: EXPERIMENT_MAX_LEVELS }, (_, i) => level(f, i + 1)))}</div>
  </section>`;
  const body = html`
    ${pageHeader({
      crumbs: [{ label: 'Home', href: '/' }, { label: 'Experiments', href: '/experiments' }, { label: 'New' }],
      title: 'New experiment',
      description: 'Name what you want to find out, pick the set to hold fixed, and say what to vary. Nothing runs until you press Run on the next page.',
    })}
    <form method="POST" action="/experiments" class="exp-new">
      <section class="card">
        <label class="form-field__label" for="exp-name">Name</label>
        <input class="form-field__input" id="exp-name" name="name" required maxlength="120" value="${v.name ?? ''}" placeholder="What changes job recommendations">
        <label class="form-field__label" for="exp-question">What do you want to find out?</label>
        <textarea class="form-field__textarea" id="exp-question" name="question" rows="2" maxlength="1000" placeholder="Does the way the agent was built change its picks more than what the person asks for?">${v.question ?? ''}</textarea>
      </section>

      <section class="card">
        <h2 class="card__title">The set to hold fixed</h2>
        <p class="form-field__hint">Every run ranks these same items. They are copied now and never change, even if the notebook does.</p>
        <label class="form-field__label" for="exp-from">Copy the options of a notebook</label>
        <select class="form-field__input" id="exp-from" name="from">
          <option value="">none: I'll paste a list below</option>
          ${list(args.notebooks.map((n) => html`<option value="${n.id}"${v.from === n.id ? unsafeHtml(' selected') : unsafeHtml('')}>${n.title} (${plural(n.options, 'option')})</option>`))}
        </select>
        <label class="form-field__label" for="exp-paste">Or paste a list, one item a line</label>
        <textarea class="form-field__textarea" id="exp-paste" name="paste" rows="5" placeholder="Staff Engineer at Acme | Pay: $250,000 | Remote: yes&#10;Senior Engineer at Globex | Pay: $210,000 | Remote: no">${v.paste ?? ''}</textarea>
        <p class="form-field__hint">Facts after the title are separated by | and written "Label: value". Used only when no notebook is chosen.</p>
      </section>

      <section class="card">
        <h2 class="card__title">What runs</h2>
        <label class="form-field__label" for="exp-agent">The agent</label>
        <select class="form-field__input" id="exp-agent" name="agent">
          ${list(args.agents.map((a) => html`<option value="${a.id}"${agent === a.id ? unsafeHtml(' selected') : unsafeHtml('')}>${a.name}${a.id === args.defaultAgent ? ' (ranks a list as instructed)' : ''}</option>`))}
        </select>
        <p class="form-field__hint">It is given the items (ITEMS) and whatever each level sets (INSTRUCTIONS, PREFERENCES), and must answer with every item's id, best first, in a &lt;ranking&gt; block.</p>
        <label class="form-field__label" for="exp-repeats">Runs of each condition</label>
        <input class="form-field__input exp-new__short" id="exp-repeats" name="repeats" type="number" min="1" max="${String(EXPERIMENT_MAX_REPEATS)}" value="${v.repeats ?? '3'}">
        <p class="form-field__hint">Running each condition more than once shows how much the result moves by itself. With one run, nothing can be concluded. A pass makes ${String(EXPERIMENT_MAX_RUNS)} runs at most.</p>
      </section>

      <section class="card">
        <h2 class="card__title">What to vary</h2>
        <p class="form-field__hint">Each thing you vary needs two or more levels. Every combination is run, so two things with two levels each is four conditions. In each level, fill only what that level changes.</p>
        ${factor(1, 'Build', 'For example the build: two sets of instructions, two models, or two versions of the agent.')}
        ${factor(2, 'Preferences', 'For example what the person asks for: two preference profiles.')}
      </section>

      <div class="exp-new__acts">
        <button type="submit" class="btn btn--primary">Set it up</button>
        <a class="btn btn--ghost" href="/experiments">Cancel</a>
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

  const actions = e.archivedAt
    ? post('archive', 'Restore', 'btn', html`<input type="hidden" name="restore" value="1">`)
    : standing.running
      ? post('stop', 'Stop', 'btn btn--warn')
      : html`
        ${standing.pass && left ? post('resume', `Go on (${plural(left, 'run')} left)`, 'btn btn--primary') : html``}
        ${standing.pass && !left && unusable ? post('resume', `Try the ${String(unusable)} unusable again`, 'btn', html`<input type="hidden" name="retry" value="1">`) : html``}
        ${post('run', standing.pass ? 'Run it again' : `Run it (${plural(runs, 'run')}${estimate})`, standing.pass && left ? 'btn' : standing.pass ? 'btn' : 'btn btn--primary')}`;

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
      <p class="exp-section__note">How many of the baseline's top ${String(e.topK)} are still in the top ${String(e.topK)}, and how many places an item moved on average.</p>
      <div class="exp-scroll"><table class="table exp-table">
        <thead><tr><th scope="col">Condition</th><th scope="col" class="exp-n">Runs</th><th scope="col" class="exp-n">Top ${String(e.topK)} kept</th><th scope="col" class="exp-n">Places moved</th></tr></thead>
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
            <td>${c.ranking ? c.ranking.slice(0, e.topK).map((id) => titleOf.get(id) ?? id).join(' · ') : ''}</td>
          </tr>`))}</tbody>
        </table></div>
      </details>
    </section>` : html``}
    </div>

    ${e.archivedAt || standing.running ? html`` : html`<p class="exp-foot">${post('archive', 'Archive this experiment', 'btn btn--ghost btn--sm')}</p>`}`;
  return render(layout({ title: e.name, activeNav: 'experiments', wide: true, ...(args.flash ? { flash: args.flash } : {}) }, body));
}

/** In the browser: an experiment's page reloads when its pass moves on. */
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
`;
