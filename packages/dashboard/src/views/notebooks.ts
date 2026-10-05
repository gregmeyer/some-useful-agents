/**
 * Notebooks (goal surfaces G1; mockup screen 22): the list, and one notebook,
 * a header that reads as its cover (what it's for, parameters, a pipeline
 * diagram, a progress ring over its criteria), its surface (options, notes
 * and decisions, evidence), and the forms to add to it, edit it, and close it
 * with a decision.
 */
import { notebookProgress, type CompiledSurface, type Notebook, type NotebookEntry } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { cronToHuman, formatAge } from './components.js';

const NOTEBOOK_ICON = unsafeHtml('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/><path d="M9 8h6"/></svg>');

const STATUS_LABEL: Record<Notebook['status'], string> = { active: 'active', decided: 'decided', stopped: 'stopped' };

/** A progress ring over the criteria: met of total. */
export function progressRing(met: number, total: number, size = 78): SafeHtml {
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  const frac = total === 0 ? 0 : met / total;
  const half = size / 2;
  return unsafeHtml(`<svg class="nb-ring" role="img" aria-label="${String(met)} of ${String(total)} criteria met" width="${String(size)}" height="${String(size)}" viewBox="0 0 ${String(size)} ${String(size)}">
    <defs><linearGradient id="nb-ring-grad" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="var(--color-primary)"/><stop offset="1" stop-color="var(--color-ok)"/></linearGradient></defs>
    <circle cx="${String(half)}" cy="${String(half)}" r="${r.toFixed(1)}" fill="none" stroke="var(--color-border)" stroke-width="8"/>
    <circle cx="${String(half)}" cy="${String(half)}" r="${r.toFixed(1)}" fill="none" stroke="url(#nb-ring-grad)" stroke-width="8" stroke-linecap="round"
      stroke-dasharray="${(c * frac).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${String(half)} ${String(half)})"/>
    <text x="${String(half)}" y="${String(half + 5)}" text-anchor="middle" class="nb-ring__label">${total ? `${String(met)}/${String(total)}` : '—'}</text>
  </svg>`);
}

export interface PipelineStage { agentId: string; status: 'ok' | 'failed' | 'never' | 'running'; note: string }

/** The pipeline as connected nodes, each with its last run. */
function pipelineDiagram(stages: PipelineStage[]): SafeHtml {
  if (stages.length === 0) return html``;
  const w = 640;
  const pad = 70;
  const step = stages.length > 1 ? (w - pad * 2) / (stages.length - 1) : 0;
  const xs = stages.map((_, i) => (stages.length > 1 ? pad + step * i : w / 2));
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;'));
  const glyph = { ok: '✓', failed: '!', never: '○', running: '◌' } as const;
  const nodes = stages.map((s, i) => `
    <g class="nb-pipe__node nb-pipe__node--${s.status}">
      <circle cx="${xs[i].toFixed(0)}" cy="28" r="15"/>
      <text x="${xs[i].toFixed(0)}" y="33" text-anchor="middle" class="nb-pipe__glyph">${glyph[s.status]}</text>
      <text x="${xs[i].toFixed(0)}" y="58" text-anchor="middle" class="nb-pipe__name">${esc(s.agentId.slice(0, 22))}</text>
      <text x="${xs[i].toFixed(0)}" y="71" text-anchor="middle" class="nb-pipe__note">${esc(s.note)}</text>
    </g>`).join('');
  const line = stages.length > 1 ? `<path d="M${xs[0].toFixed(0)} 28 H ${xs[xs.length - 1].toFixed(0)}" class="nb-pipe__line"/><path d="M${xs[0].toFixed(0)} 28 H ${xs[xs.length - 1].toFixed(0)}" class="nb-pipe__flow"/>` : '';
  const label = `Pipeline: ${stages.map((s) => `${s.agentId} (${s.note})`).join(', ')}`;
  return unsafeHtml(`<svg class="nb-pipe" role="img" aria-label="${esc(label)}" width="100%" height="76" viewBox="0 0 ${String(w)} 76" preserveAspectRatio="xMidYMid meet">${line}${nodes}</svg>`);
}

function hero(nb: Notebook, stages: PipelineStage[], running?: { step: number; of: number }): SafeHtml {
  const { met, total } = notebookProgress(nb);
  const id = encodeURIComponent(nb.id);
  const human = nb.cadence ? cronToHuman(nb.cadence) : '';
  const cadence = human ? `runs ${human.charAt(0).toLowerCase()}${human.slice(1)}` : 'runs when you ask';
  return html`
    <section class="nb-hero" aria-labelledby="nb-title">
      <div class="nb-hero__main">
        <div class="nb-hero__titlerow">
          <span class="nb-hero__icon">${NOTEBOOK_ICON}</span>
          <h1 class="nb-hero__title" id="nb-title">${nb.title}</h1>
          <span class="nb-status nb-status--${nb.status}">${STATUS_LABEL[nb.status]}</span>
        </div>
        ${nb.statement ? html`<p class="nb-hero__statement">${nb.statement}</p>` : html`<p class="nb-hero__statement nb-hero__statement--empty">Say what this notebook is for under Edit.</p>`}
        <div class="nb-hero__chips">
          ${nb.params.map((p) => html`<span class="nb-chip">${p}</span>`) as unknown as SafeHtml[]}
          <span class="nb-hero__meta">started ${formatAge(nb.createdAt)} · ${cadence}</span>
        </div>
        ${pipelineDiagram(stages)}
        ${nb.pipeline.length ? html`
          <div class="nb-run">
            ${running
              ? html`<span class="nb-run__now" data-notebook-running role="status">Running step ${String(running.step)} of ${String(running.of)}… this page updates as it goes.</span>`
              : nb.status === 'active'
                ? html`<form method="POST" action="/notebooks/${encodeURIComponent(nb.id)}/run" class="nb-run__form"><button type="submit" class="btn btn--sm">Run the pipeline now</button></form>`
                : html``}
            ${nb.lastRunAt && !running ? html`<span class="nb-run__last">Last run ${formatAge(nb.lastRunAt)}: ${nb.lastRunNote ?? ''}</span>` : html``}
          </div>` : html``}
        ${nb.status === 'decided' && nb.decision ? html`<div class="nb-decided"><strong>Decided ${formatAge(nb.decidedAt ?? nb.updatedAt)}:</strong> ${nb.decision}</div>` : html``}
      </div>
      <aside class="nb-hero__side" aria-label="Done when">
        <div class="nb-progress">
          ${progressRing(met, total)}
          <div class="nb-progress__list">
            <span class="nb-progress__label">Done when</span>
            ${total === 0 ? html`<span class="nb-progress__empty">No criteria yet. Add them under Edit.</span>` : html``}
            ${nb.criteria.map((c, i) => html`
              <form method="POST" action="/notebooks/${id}/criteria/${String(i)}" class="nb-crit">
                <input type="hidden" name="met" value="${c.met ? '0' : '1'}">
                <button type="submit" class="nb-crit__btn ${c.met ? 'is-met' : ''}" aria-pressed="${c.met ? 'true' : 'false'}" title="${c.met ? 'Mark not met' : 'Mark met'}">${c.met ? '✓' : '○'}</button>
                <span class="nb-crit__text ${c.met ? 'is-met' : ''}">${c.text}</span>
              </form>`) as unknown as SafeHtml[]}
          </div>
        </div>
        ${nb.status === 'active' ? html`
          <details class="nb-decide">
            <summary class="btn btn--primary btn--sm">Decide…</summary>
            <form method="POST" action="/notebooks/${id}/decide" class="nb-decide__form">
              <label for="nb-decision" class="nb-progress__label">What did you decide, and why?</label>
              <textarea id="nb-decision" name="decision" rows="4" required class="form-field" placeholder="Buy the 2019 RAV4 XLE: clean history, under budget. The CR-V had an accident."></textarea>
              <button type="submit" class="btn btn--primary btn--sm">Record the decision and close</button>
            </form>
          </details>` : html`
          <form method="POST" action="/notebooks/${id}/status" class="nb-reopen"><input type="hidden" name="status" value="active"><button type="submit" class="btn btn--sm">Reopen</button></form>`}
      </aside>
    </section>`;
}

const KIND_LABEL: Record<NotebookEntry['kind'], string> = { note: 'note', option: 'option', evidence: 'evidence', decision: 'decision' };

function entryCard(nb: Notebook, e: NotebookEntry): SafeHtml {
  return html`
    <li class="nb-entry nb-entry--${e.kind}" id="entry-${e.id}">
      <div class="nb-entry__head">
        <span class="nb-entry__kind">${KIND_LABEL[e.kind]}</span>
        <strong class="nb-entry__title">${e.title}</strong>
        <form method="POST" action="/notebooks/${encodeURIComponent(nb.id)}/entries/${e.id}/remove" class="nb-entry__remove">
          <button type="submit" class="btn btn--xs btn--ghost" aria-label="Remove “${e.title}”" title="Remove">×</button>
        </form>
      </div>
      ${e.body ? html`<p class="nb-entry__body">${e.body}</p>` : html``}
      <span class="nb-entry__by">${e.by === 'you' ? 'you' : e.by.replace(/^agent:/, '')} · ${formatAge(e.createdAt)}${e.runId ? html` · <a href="/runs/${encodeURIComponent(e.runId)}" class="mono">run ${e.runId.slice(0, 8)}</a>` : html``}</span>
    </li>`;
}

function surfaceColumn(nb: Notebook, compiled: CompiledSurface, entries: NotebookEntry[]): SafeHtml {
  const byId = new Map(entries.map((e) => [`nbentry:${e.id}`, e]));
  const regions = compiled.regions.filter((r) => r.entries.length > 0);
  if (regions.length === 0) {
    return html`
      <section class="nb-start" aria-labelledby="nb-start-title">
        <h2 class="nb-start__title" id="nb-start-title">Tell sua what you're looking for</h2>
        <p class="nb-start__sub">Talk it through the way you would with a friend: who it's for, budget, must-haves, what you've already seen or ruled out. sua files it here as you go (notes, options, limits, what "done" means) and can set up agents to keep looking.</p>
        ${talkForm(nb, entries, true)}
      </section>`;
  }
  return html`${regions.map((r) => html`
    <section class="nb-region" data-surface-region="${r.id}">
      <h2 class="nb-region__title">${r.title} <span class="nb-region__count">${String(r.entries.length)}</span></h2>
      <ul class="nb-region__list">${r.entries.map((ce) => { const e = byId.get(ce.item.id); return e ? entryCard(nb, e) : html``; }) as unknown as SafeHtml[]}</ul>
    </section>`) as unknown as SafeHtml[]}`;
}

/**
 * The next useful thing to tell sua, from where the notebook is: what it's
 * for, then limits, then candidates, then the first unmet criterion, then a
 * pipeline, then deciding. Drives the talk box's hint and ghost text.
 */
export function nextStep(nb: Notebook, entries: readonly NotebookEntry[]): { hint: string; placeholder: string } {
  const options = entries.filter((e) => e.kind === 'option');
  const notes = entries.filter((e) => e.kind === 'note');
  const goal = (nb.statement || nb.title).replace(/[.!?]+$/, '');
  const short = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
  if (nb.status === 'decided') {
    return { hint: 'Decided. Anything learned since is still worth keeping.', placeholder: `e.g. how the decision is working out, or anything that would change it` };
  }
  if (!nb.statement && notes.length === 0) {
    return { hint: "Start with what it's for and what matters most.", placeholder: `e.g. what "${short(nb.title)}" is for, who it's for, and what matters most` };
  }
  if (nb.params.length === 0) {
    return { hint: 'Next: the limits sua should hold to.', placeholder: `e.g. budget, size, must-haves and deal-breakers for "${short(goal)}"` };
  }
  if (options.length === 0) {
    return { hint: "Next: candidates. Anything you've already seen?", placeholder: 'e.g. paste a link, or describe one you saw (what, price, where) and what you thought of it' };
  }
  const open = nb.criteria.find((c) => !c.met);
  if (open && nb.pipeline.length > 0) {
    return { hint: `Next: “${short(open.text, 60)}”.`, placeholder: `e.g. what you know about “${short(open.text)}” for the ${short(options[0].title, 40)}` };
  }
  if (nb.pipeline.length === 0) {
    return { hint: `${String(options.length)} option${options.length === 1 ? '' : 's'} so far. sua can keep looking for you.`, placeholder: 'e.g. "keep looking every morning", or tell sua about another one you saw' };
  }
  if (open) {
    return { hint: `Next: “${short(open.text, 60)}”.`, placeholder: `e.g. what you know about “${short(open.text)}”` };
  }
  return { hint: 'Every criterion is met. Ready to decide?', placeholder: `e.g. "go with the ${short(options[0].title, 40)}, because…"` };
}

/** The one box: tell sua, and it files it (opens the notebook's conversation beside the page). */
function talkForm(nb: Notebook, entries: readonly NotebookEntry[], big = false): SafeHtml {
  const step = nextStep(nb, entries);
  return html`
    <form method="POST" action="/notebooks/${encodeURIComponent(nb.id)}/ask" class="nb-talk__form ${big ? 'nb-talk__form--big' : ''}" data-ask-fix>
      <label class="nb-talk__next" for="nb-talk-${big ? 'big' : 'side'}">${step.hint}</label>
      <textarea id="nb-talk-${big ? 'big' : 'side'}" name="text" required rows="${big ? '4' : '3'}" class="form-field"
        placeholder="${step.placeholder}"></textarea>
      <button type="submit" class="btn btn--primary btn--sm">Tell sua</button>
    </form>`;
}

function sideForms(nb: Notebook, entries: readonly NotebookEntry[]): SafeHtml {
  const hasEntries = entries.length > 0;
  const id = encodeURIComponent(nb.id);
  return html`
    ${hasEntries || nb.conversationId ? html`
      <section class="nb-side__card nb-talk" aria-labelledby="nb-talk-title">
        <h2 class="nb-side__title" id="nb-talk-title">Talk to sua about this notebook</h2>
        ${talkForm(nb, entries)}
        ${nb.conversationId ? html`<button type="button" class="btn btn--sm btn--ghost nb-talk__continue" data-nb-continue="${nb.conversationId}">Continue the conversation</button>` : html``}
      </section>` : html``}
    <details class="nb-side__card nb-addself">
      <summary class="nb-side__title">Add an entry yourself</summary>
      <form method="POST" action="/notebooks/${id}/entries" class="nb-form">
        <div class="nb-kinds" role="radiogroup" aria-label="What it is">
          ${(['note', 'option', 'evidence', 'decision'] as const).map((k, i) => html`
            <label class="nb-kind"><input type="radio" name="kind" value="${k}"${i === 0 ? unsafeHtml(' checked') : unsafeHtml('')}><span>${KIND_LABEL[k]}</span></label>`) as unknown as SafeHtml[]}
        </div>
        <input type="text" name="title" required class="form-field" placeholder="One line: 2019 RAV4 XLE, 54k mi, $24,900" autocomplete="off">
        <textarea name="body" rows="3" class="form-field" placeholder="Details (optional)"></textarea>
        <button type="submit" class="btn btn--sm">Add</button>
      </form>
    </details>
    <details class="nb-side__card nb-edit">
      <summary class="nb-side__title">Edit this notebook</summary>
      <form method="POST" action="/notebooks/${id}/edit" class="nb-form">
        <label class="nb-label">Title<input type="text" name="title" value="${nb.title}" required class="form-field"></label>
        <label class="nb-label">What it's for<textarea name="statement" rows="2" class="form-field">${nb.statement}</textarea></label>
        <label class="nb-label">Parameters, one per line<textarea name="params" rows="3" class="form-field">${nb.params.join('\n')}</textarea></label>
        <label class="nb-label">Done when, one per line<textarea name="criteria" rows="3" class="form-field">${nb.criteria.map((c) => c.text).join('\n')}</textarea></label>
        <label class="nb-label">Pipeline: agent ids, one per line<textarea name="pipeline" rows="3" class="form-field mono">${nb.pipeline.join('\n')}</textarea></label>
        <label class="nb-label">Runs (five-field schedule, or empty for when you ask)<input type="text" name="cadence" value="${nb.cadence}" class="form-field mono" placeholder="0 7 * * *"></label>
        <button type="submit" class="btn btn--sm">Save</button>
      </form>
      ${nb.status === 'active' ? html`<form method="POST" action="/notebooks/${id}/status" class="nb-form"><input type="hidden" name="status" value="stopped"><button type="submit" class="btn btn--sm btn--ghost">Stop this notebook</button></form>` : html``}
    </details>`;
}

export function renderNotebookPage(args: { nb: Notebook; entries: NotebookEntry[]; compiled: CompiledSurface; stages: PipelineStage[]; running?: { step: number; of: number }; flash?: { kind: 'error' | 'info' | 'ok'; message: string } }): string {
  return render(layout({ title: args.nb.title, activeNav: 'inbox', flash: args.flash, wide: true }, html`
    <p class="nb-crumbs"><a href="/">Home</a> › <a href="/notebooks">Notebooks</a></p>
    ${hero(args.nb, args.stages, args.running)}
    ${args.running ? unsafeHtml('<script>setTimeout(function () { if (!document.querySelector("textarea:focus, input:focus")) location.reload(); }, 6000);</script>') : html``}
    <div class="nb-body">
      <div class="nb-body__main" data-nb-main="${args.nb.id}" data-nb-count="${String(args.entries.length)}">${surfaceColumn(args.nb, args.compiled, args.entries)}</div>
      <aside class="nb-body__side">${sideForms(args.nb, args.entries)}</aside>
    </div>
  `));
}

/** The notebook's sections alone (GET /notebooks/:id/main), for live updates. */
export function renderNotebookMain(nb: Notebook, compiled: CompiledSurface, entries: NotebookEntry[]): string {
  return render(surfaceColumn(nb, compiled, entries));
}

export function renderNotebooksList(args: { notebooks: Array<{ nb: Notebook; entries: number }>; openNew?: boolean; flash?: { kind: 'error' | 'info' | 'ok'; message: string } }): string {
  return render(layout({ title: 'Notebooks', activeNav: 'inbox', flash: args.flash, wide: true }, html`
    <p class="nb-crumbs"><a href="/">Home</a> › Notebooks</p>
    <div class="nb-list__head">
      <div>
        <h1 class="nb-list__title">Notebooks</h1>
        <p class="nb-list__sub">A goal you keep over time: what it's for, when it's done, what you've found, and what you decided.</p>
      </div>
    </div>
    <div class="nb-list">
      <details class="nb-card nb-card--new" id="new"${args.notebooks.length === 0 || args.openNew ? unsafeHtml(' open') : unsafeHtml('')}>
        <summary class="nb-card__new">+ New notebook</summary>
        <form method="POST" action="/notebooks" class="nb-form">
          <label class="nb-label">Title<input type="text" name="title" required class="form-field" placeholder="Buy a used car"></label>
          <label class="nb-label">What it's for<textarea name="statement" rows="2" class="form-field" placeholder="Find a reliable used SUV for family trips, and decide by Oct 15."></textarea></label>
          <label class="nb-label">Parameters, one per line<textarea name="params" rows="3" class="form-field" placeholder="SUV, AWD&#10;under $26,000&#10;under 60k miles"></textarea></label>
          <label class="nb-label">Done when, one per line<textarea name="criteria" rows="3" class="form-field" placeholder="At least one car that fits&#10;Clean history on the top choice&#10;A decision recorded"></textarea></label>
          <button type="submit" class="btn btn--primary btn--sm">Start the notebook</button>
        </form>
      </details>
      ${args.notebooks.map(({ nb, entries }) => {
        const { met, total } = notebookProgress(nb);
        return html`
          <a class="nb-card" href="/notebooks/${encodeURIComponent(nb.id)}">
            ${progressRing(met, total, 56)}
            <span class="nb-card__text">
              <span class="nb-card__title">${nb.title} <span class="nb-status nb-status--${nb.status}">${STATUS_LABEL[nb.status]}</span></span>
              <span class="nb-card__statement">${nb.decision ?? nb.statement}</span>
              <span class="nb-card__meta">${String(entries)} entr${entries === 1 ? 'y' : 'ies'} · updated ${formatAge(nb.updatedAt)}</span>
            </span>
          </a>`;
      }) as unknown as SafeHtml[]}
    </div>
  `));
}

/** The Notebooks line on Home (under the goal): no nav item until they've proven themselves. */
export function renderHomeNotebooksLine(active: number, total: number): SafeHtml {
  return html`<p class="home-notebooks">${NOTEBOOK_ICON}<a href="/notebooks">${total === 0 ? 'Notebooks' : `${String(active)} active notebook${active === 1 ? '' : 's'}`}</a><span aria-hidden="true">·</span><a href="/notebooks?new=1">New notebook</a><span class="home-notebooks__hint">a goal you keep over time</span></p>`;
}
