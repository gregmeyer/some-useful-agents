/**
 * New notebook (canvas artboard 28): say it in a sentence, sua drafts the
 * notebook, you check it (every part editable), then start it. The draft
 * arrives as a fragment (renderDraftReview) that notebook-new.js.ts puts in
 * place; the review is an ordinary form posting to POST /notebooks.
 */
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { formatAge } from './components.js';
import type { NotebookField, NotebookStep, NotebookTemplate } from '@some-useful-agents/core';
import type { NotebookDraft, DraftState } from '../lib/notebook-draft.js';
import { suaStepAgentName } from '../lib/notebook-step-agents.js';

const CADENCES: Array<[string, string]> = [['', 'when I ask'], ['0 7 * * *', 'every morning'], ['0 7 * * 1,4', 'twice a week'], ['0 7 * * 1', 'every Monday']];

/** Up to three suggestions from your conversations; clicking one fills the box. */
export function renderSuggestionPills(items: ReadonlyArray<{ label: string; text: string; from?: string }>, refreshing: boolean): SafeHtml {
  if (items.length === 0) {
    return refreshing ? html`<p class="nbd-pills__wait" role="status">sua is looking through your conversations for ideas…</p>` : html``;
  }
  return html`<span class="nbd-pills__label">From your conversations</span>
    ${items.map((s) => html`<button type="button" class="nbd-pill" data-nbd-pill="${s.text}" title="${s.from ? `From “${s.from}”: ${s.text}` : s.text}">${s.label}</button>`) as unknown as SafeHtml[]}`;
}

/**
 * Drafts you haven't started yet, to pick up again: what you said, where
 * sua got to, Continue and Discard. On the notebooks list and the new page.
 */
export function renderDraftsStrip(drafts: ReadonlyArray<{ id: string } & DraftState>, back: 'list' | 'new'): SafeHtml {
  if (!drafts.length) return html``;
  const where = (d: DraftState) => d.status === 'working' ? 'sua is drafting it' : d.status === 'ready' ? 'ready to check' : "sua couldn't draft it";
  return html`
    <section class="nbd-drafts" aria-labelledby="nbd-drafts-title">
      <h2 class="nbd-drafts__title" id="nbd-drafts-title">${drafts.length === 1 ? 'A draft you haven’t started' : 'Drafts you haven’t started'}</h2>
      <ul class="nbd-drafts__list">
        ${drafts.map((d) => html`
          <li class="nbd-drafts__item">
            <a class="nbd-drafts__name" href="/notebooks/new?draft=${encodeURIComponent(d.id)}">${d.status === 'ready' || (d.status === 'working' && d.draft) ? d.draft!.title : d.text}</a>
            <span class="nbd-drafts__meta">${where(d)} · ${formatAge(new Date(d.at).toISOString())}</span>
            <a class="btn btn--sm" href="/notebooks/new?draft=${encodeURIComponent(d.id)}">Continue →</a>
            <form method="POST" action="/notebooks/draft/${encodeURIComponent(d.id)}/discard" class="nbd-drafts__discard">
              <input type="hidden" name="back" value="${back}">
              <button type="submit" class="btn btn--sm btn--ghost">Discard</button>
            </form>
          </li>`) as unknown as SafeHtml[]}
      </ul>
    </section>`;
}

type TemplateRow = Pick<NotebookTemplate, 'id' | 'name' | 'description' | 'uses'>;

/** Remove a template, after asking once. */
function deleteTemplateControl(t: TemplateRow): SafeHtml {
  return html`<details class="nbd-tpl__del">
    <summary class="btn btn--sm btn--ghost" aria-label="Delete the template ${t.name}" title="Delete this template">×</summary>
    <form method="POST" action="/notebooks/templates/${encodeURIComponent(t.id)}/delete">
      <span>Delete it? Notebooks made from it stay.</span>
      <button type="submit" class="btn btn--sm">Delete</button>
    </form>
  </details>`;
}

/**
 * Your templates: each starts a conversation with sua, which asks what's
 * different this time, then creates the notebook. Archive one to stop it
 * being offered; archived ones fold away below, to restore or delete.
 */
function renderTemplateList(templates: readonly TemplateRow[], archived: readonly TemplateRow[] = []): SafeHtml {
  if (!templates.length && !archived.length) return html``;
  const archiveForm = (t: TemplateRow, restore: boolean) => html`<form method="POST" action="/notebooks/templates/${encodeURIComponent(t.id)}/archive" class="nbd-tpl__arch">
    <input type="hidden" name="archived" value="${restore ? '0' : '1'}">
    <button type="submit" class="btn btn--sm${restore ? '' : ' btn--ghost'}" title="${restore ? 'Offer it again on New notebook and to sua' : "Keep it, but don't offer it on New notebook or to sua"}">${restore ? 'Restore' : 'Archive'}</button>
  </form>`;
  return html`<section class="nbd-tpl" aria-labelledby="nbd-tpl-h">
    ${templates.length ? html`<h2 class="nbd-tpl__h" id="nbd-tpl-h">Or start from one of your templates</h2>
    <ul class="nbd-tpl__list">
      ${templates.map((t) => html`<li class="nbd-tpl__item">
        <span class="nbd-tpl__name">${t.name}</span>
        <span class="nbd-tpl__what">${t.description}${t.uses ? ` · used ${String(t.uses)}×` : ''}</span>
        <form method="POST" action="/inbox/new" class="nbd-tpl__go">
          <input type="hidden" name="body" value="${`Start a new notebook from my “${t.name}” template.`}">
          <button type="submit" class="btn btn--sm btn--primary" title="sua asks what's different this time, then creates it">Start with sua →</button>
        </form>
        ${archiveForm(t, false)}
        ${deleteTemplateControl(t)}
      </li>`) as unknown as SafeHtml[]}
    </ul>` : html`<h2 class="nbd-tpl__h" id="nbd-tpl-h">Your templates</h2>`}
    ${archived.length ? html`<details class="nbd-tpl__archived">
      <summary>Archived templates <span class="nbd-tpl__n">${String(archived.length)}</span></summary>
      <ul class="nbd-tpl__list">
        ${archived.map((t) => html`<li class="nbd-tpl__item is-archived">
          <span class="nbd-tpl__name">${t.name}</span>
          <span class="nbd-tpl__what">${t.description}</span>
          ${archiveForm(t, true)}
          ${deleteTemplateControl(t)}
        </li>`) as unknown as SafeHtml[]}
      </ul>
    </details>` : html``}
  </section>`;
}

export function renderNotebookNew(opts: {
  text?: string; suggestions?: ReadonlyArray<{ label: string; text: string; from?: string }>; refreshing?: boolean; flash?: { kind: 'error' | 'info' | 'ok'; message: string };
  /** Back to a draft you left: it shows as it was (still drafting, ready with your changes, or failed). */
  draft?: { id: string; state: DraftState; agents: ReadonlyArray<{ id: string; description: string }> };
  /** Other drafts not started yet. */
  others?: ReadonlyArray<{ id: string } & DraftState>;
  /** Your templates: start one by asking sua. */
  templates?: ReadonlyArray<Pick<NotebookTemplate, 'id' | 'name' | 'description' | 'uses'>>;
  /** Archived templates: restore or delete. */
  archivedTemplates?: ReadonlyArray<Pick<NotebookTemplate, 'id' | 'name' | 'description' | 'uses'>>;
} = {}): string {
  const d = opts.draft;
  const result = !d ? html``
    : d.state.status === 'ready' ? renderDraftReview(d.id, d.state.draft, d.agents, d.state.error)
    : d.state.status === 'failed' ? html`<p class="flash flash--error">${d.state.error}</p>`
    : html`<p class="nbd-working" role="status"><span class="nbd-working__dot" aria-hidden="true"></span>sua is drafting your notebook… this takes a few seconds.</p>`;
  return render(layout({ title: 'New notebook', activeNav: 'inbox', flash: opts.flash }, html`
    <div class="nbd" data-nbd${d ? html` data-nbd-id="${d.id}"` : html``}${d?.state.status === 'working' ? unsafeHtml(' data-nbd-resume') : unsafeHtml('')}>
      <p class="nb-crumbs"><a href="/">Home</a> › <a href="/notebooks">Notebooks</a> › New</p>
      <h1 class="nbd__title">Start a notebook</h1>
      ${renderDraftsStrip(opts.others ?? [], 'new')}
      <form class="nbd-ask" data-nbd-ask method="POST" action="/notebooks/draft">
        <label class="nbd-ask__label" for="nbd-text">Describe it like you'd tell a friend</label>
        <div class="nbd-ask__row">
          <textarea id="nbd-text" name="text" rows="3" required class="form-field nbd-ask__text" data-nbd-text
            placeholder="A reliable used hatchback for my commute, automatic, under $12k and 90k miles, within 50 miles of home. Decide by the end of the month.">${opts.text ?? ''}</textarea>
          <button type="submit" class="btn btn--primary nbd-ask__go" data-nbd-go>${d ? 'Draft again' : 'Draft it'}</button>
        </div>
        <div class="nbd-pills" data-nbd-pills${opts.refreshing ? unsafeHtml(' data-nbd-pills-refreshing') : unsafeHtml('')} aria-live="polite">${renderSuggestionPills(opts.suggestions ?? [], !!opts.refreshing)}</div>
        <p class="nbd-ask__examples">For example: “a remote staff engineer job paying $180k+” · “a quiet 2-bed rental in Fremont under $2,600” · “noise-cancelling headphones under $300”</p>
      </form>
      ${renderTemplateList(opts.templates ?? [], opts.archivedTemplates ?? [])}
      <div class="nbd-result" data-nbd-result aria-live="polite">${result}</div>
      <form method="POST" action="/notebooks" class="nbd-skip" data-nbd-skip>
        <input type="hidden" name="statement" value="" data-nbd-skip-text>
        <button type="submit" class="nbd-skip__btn">Skip the draft: start it and talk it through with sua →</button>
      </form>
    </div>
  `));
}

/** A row of editable chips: each an input you can change or remove, plus "+ add". */
function chips(name: string, values: readonly string[], label: string): SafeHtml {
  return html`<div class="nbd-chips" data-nbd-chips="${name}">
      ${values.map((v) => html`<span class="nbd-chip"><input name="${name}" value="${v}" aria-label="${label}" size="${String(Math.max(4, Math.min(60, v.length + 1)))}" data-nbd-grow><button type="button" class="nbd-chip__x" data-nbd-remove aria-label="Remove ${v}">×</button></span>`) as unknown as SafeHtml[]}
      <button type="button" class="nbd-chip nbd-chip--add" data-nbd-add="${name}" data-nbd-add-label="${label}">+ add</button>
    </div>`;
}

/** A list of editable lines (done-when, checks), each removable, plus "+ add". A met one (editing a notebook) shows ticked. */
function rows(name: string, values: readonly string[], label: string, met: readonly boolean[] = []): SafeHtml {
  return html`<div class="nbd-list" data-nbd-chips="${name}">
      ${values.map((c, i) => html`<span class="nbd-row"><span class="nbd-row__box${met[i] ? ' is-met' : ''}" aria-hidden="true">${met[i] ? '☑' : '☐'}</span><textarea name="${name}" rows="1" aria-label="${label}${met[i] ? ' (met)' : ''}" data-nbd-autosize>${c}</textarea><button type="button" class="nbd-chip__x" data-nbd-remove aria-label="Remove ${c}">×</button></span>`) as unknown as SafeHtml[]}
      <button type="button" class="nbd-chip nbd-chip--add" data-nbd-add="${name}" data-nbd-add-label="${label}" data-nbd-add-row>+ add</button>
    </div>`;
}

const STEP_KIND_WORD: Record<NotebookStep['kind'], string> = { find: 'find', source: 'source', check: 'check', narrow: 'narrow', decide: 'decide' };

/**
 * The work in steps: each with its title (editable), what kind of step it
 * is, and which of your agents does it (check and find steps can use sua's checker and finder;
 * narrow and decide are yours). Removable; sua takes them one at a time.
 * Editing a notebook, each step keeps its id (so it keeps how far it got),
 * a done one says so, and the one running can't be removed.
 */
function stepRows(steps: readonly NotebookStep[], agents: ReadonlyArray<{ id: string; description: string }>, editing = false): SafeHtml {
  return html`<div class="nbd-field"><span class="nbd-field__label">Steps</span>
    <ol class="nbd-steps">
      ${steps.map((st) => html`<li class="nbd-row nbd-step">
        ${editing ? html`<input type="hidden" name="step_id" value="${st.id}">` : html``}
        <input type="hidden" name="step_kind" value="${st.kind}">
        <input type="hidden" name="step_target" value="${st.target !== undefined ? String(st.target) : ''}">
        <span class="nbd-step__kind">${STEP_KIND_WORD[st.kind]}</span>
        <input name="step_title" value="${st.title}" aria-label="Step" class="nbd-step__title">
        ${st.kind === 'decide' || st.kind === 'narrow'
          ? html`<input type="hidden" name="step_agent" value=""><span class="nbd-step__by">you</span>`
          : html`<select name="step_agent" aria-label="Agent for ${st.title}" class="nbd-step__agent">
              <option value="">${suaStepAgentName(st.kind) ?? 'needs an agent'}</option>
              ${agents.map((a) => html`<option value="${a.id}"${a.id === st.agentId ? unsafeHtml(' selected') : unsafeHtml('')}>${a.id}</option>`) as unknown as SafeHtml[]}
            </select>`}
        ${editing && st.status === 'done' ? html`<span class="nbd-step__state">done</span>` : editing && st.status === 'running' ? html`<span class="nbd-step__state is-running">running</span>` : html``}
        ${editing && st.status === 'running' ? html`` : html`<button type="button" class="nbd-chip__x" data-nbd-remove aria-label="Remove ${st.title}">×</button>`}
      </li>`) as unknown as SafeHtml[]}
    </ol>
    <span class="nbd-field__hint">${editing ? 'Steps you keep keep how far they got.' : 'sua takes them one at a time and checks in after each.'}</span>
  </div>`;
}

/** What the setup editor shows: a draft's, or a notebook's own. */
export interface SetupValues {
  title: string; statement: string; params: readonly string[]; criteria: readonly string[];
  /** Which done-whens are met (editing a notebook). */
  met?: readonly boolean[];
  steps?: readonly NotebookStep[]; fields: readonly NotebookField[]; checks: readonly string[]; stages: readonly string[];
  pipeline: readonly string[]; cadence: string;
}

/**
 * Every part of a notebook's setup, editable: title, what it's for, limits,
 * done-whens and steps; then what's noted for each option, the checks, the
 * stages, the searches and when they run. The new notebook's draft review
 * and the Edit page both use it; it posts the same form either way.
 * `offered`: the searches to list (a draft lists the ones sua suggested; editing lists every one).
 */
export function notebookSetupEditor(v: SetupValues, agents: ReadonlyArray<{ id: string; description: string; feeds?: readonly string[] }>, opts: { editing?: boolean; offered?: readonly string[] } = {}): SafeHtml {
  const editing = !!opts.editing;
  const offered = opts.offered ?? v.pipeline;
  const cadence = CADENCES.some(([c]) => c === v.cadence) ? CADENCES : [...CADENCES, [v.cadence, v.cadence] as [string, string]];
  const listed = agents.filter((a) => offered.includes(a.id));
  // A search the notebook has whose agent is gone: shown, so saving doesn't drop it silently.
  const gone = editing ? v.pipeline.filter((p) => !agents.some((a) => a.id === p)) : [];
  // Editing, every agent is offered: the notebook's own and the ones that fill notebooks first, the rest folded away.
  const first = editing ? listed.filter((a) => v.pipeline.includes(a.id) || a.feeds?.length) : listed;
  const rest = editing ? listed.filter((a) => !first.includes(a)) : [];
  const agentBox = (a: { id: string; description: string }) => html`
                  <label class="nbd-agent" title="${a.description}"><input type="checkbox" name="pipeline" value="${a.id}"${v.pipeline.includes(a.id) ? unsafeHtml(' checked') : unsafeHtml('')}><span>${a.id}</span></label>`;
  return html`<div class="nbd-draft__body" data-nbd-editor>
        <div class="nbd-draft__main">
          <label class="nbd-field"><span class="nbd-field__label">Title</span>
            <input name="title" value="${v.title}" required class="nbd-draft__titleinput"></label>
          <label class="nbd-field"><span class="nbd-field__label">What it's for</span>
            <textarea name="statement" rows="2" class="form-field" data-nbd-autosize>${v.statement}</textarea></label>
          <div class="nbd-field"><span class="nbd-field__label">Limits</span>${chips('params', v.params, 'Limit')}</div>
          <div class="nbd-field"><span class="nbd-field__label">Done when</span>${rows('criteria', v.criteria, 'Done when', v.met)}</div>
          ${v.steps?.length ? stepRows(v.steps, agents, editing) : html``}
        </div>
        <div class="nbd-draft__side">
          <div class="nbd-field"><span class="nbd-field__label">For each option sua notes</span>
            <div class="nbd-chips">
              ${v.fields.map((f) => html`<span class="nbd-chip nbd-chip--fact"><input type="hidden" name="field" value="${JSON.stringify(f)}">${f.label}<button type="button" class="nbd-chip__x" data-nbd-remove aria-label="Don't note ${f.label}">×</button></span>`) as unknown as SafeHtml[]}
            </div>
            ${editing ? html`<span class="nbd-field__hint">Removing one hides it; what options already have is kept. To note something new, ask sua.</span>` : html``}
          </div>
          <div class="nbd-field"><span class="nbd-field__label">Before deciding, check</span>${rows('checks', v.checks, 'Check')}</div>
          <div class="nbd-field"><span class="nbd-field__label">Stages, in order</span>${chips('stages', v.stages, 'Stage')}</div>
          <div class="nbd-field"><span class="nbd-field__label">Searches</span>
            ${listed.length || gone.length
              ? html`<div class="nbd-agents">${first.map(agentBox)}${gone.map((id) => html`
                  <label class="nbd-agent is-gone" title="This agent isn't installed any more. Untick it to drop it."><input type="checkbox" name="pipeline" value="${id}" checked><span>${id}</span> <span class="nbd-agent__note">not installed</span></label>`) as unknown as SafeHtml[]}</div>
                ${rest.length ? html`<details class="nbd-moreagents"><summary>${first.length ? 'Other agents' : 'Your agents'} (${String(rest.length)})</summary><div class="nbd-agents">${rest.map(agentBox)}</div></details>` : html``}`
              : editing
                ? html`<p class="nbd-field__hint">You have no search agents yet. Ask sua to build one.</p>`
                : v.steps?.length
                  ? html`<p class="nbd-field__hint">The steps do the searching. Once they're done, a search here can keep the notebook fresh.</p>`
                  : html`<p class="nbd-field__hint">None of your agents search for this yet. Once it's started, ask sua to build one.</p>`}
            <label class="nbd-cadence">Search
              <select name="cadence">${cadence.map(([val, l]) => html`<option value="${val}"${val === v.cadence ? unsafeHtml(' selected') : unsafeHtml('')}>${l}</option>`) as unknown as SafeHtml[]}</select>
            </label>
          </div>
        </div>
      </div>`;
}

/** The draft to check: every part editable, then Start (POST /notebooks). */
export function renderDraftReview(id: string, draft: NotebookDraft, agents: ReadonlyArray<{ id: string; description: string }>, error?: string): SafeHtml {
  return html`
    ${error ? html`<p class="flash flash--error">${error}</p>` : html``}
    <form method="POST" action="/notebooks" class="nbd-draft" data-nbd-draft="${id}">
      <input type="hidden" name="draft" value="${id}">
      <div class="nbd-draft__head">
        <span class="nbd-draft__who" aria-hidden="true">sua</span>
        <span>Here's a draft from what you said. Change anything, then start it.${draft.why ? html` <span class="nbd-draft__why">${draft.why}</span>` : html``}</span>
      </div>
      ${notebookSetupEditor(draft, agents, { offered: draft.suggested ?? draft.pipeline })}
      <div class="nbd-draft__foot">
        <button type="submit" class="btn btn--primary">Looks right, start it</button>
        <span class="nbd-saved" data-nbd-saved aria-live="polite">Draft kept: come back to it any time.</span>
        <span class="nbd-change">
          <label class="sr-only" for="nbd-change">Ask sua to change the draft</label>
          <input id="nbd-change" type="text" placeholder="Ask sua to change… e.g. add Subaru Outback, drop the deadline" data-nbd-change-text autocomplete="off">
          <button type="button" class="btn btn--sm" data-nbd-change>Change it</button>
        </span>
      </div>
    </form>`;
}
