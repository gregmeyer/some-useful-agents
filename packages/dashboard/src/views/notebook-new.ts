/**
 * New notebook (canvas artboard 28): say it in a sentence, sua drafts the
 * notebook, you check it (every part editable), then start it. The draft
 * arrives as a fragment (renderDraftReview) that notebook-new.js.ts puts in
 * place; the review is an ordinary form posting to POST /notebooks.
 */
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import type { NotebookDraft } from '../lib/notebook-draft.js';

const CADENCES: Array<[string, string]> = [['', 'when I ask'], ['0 7 * * *', 'every morning'], ['0 7 * * 1,4', 'twice a week'], ['0 7 * * 1', 'every Monday']];

export function renderNotebookNew(opts: { text?: string; flash?: { kind: 'error' | 'info' | 'ok'; message: string } } = {}): string {
  return render(layout({ title: 'New notebook', activeNav: 'inbox', flash: opts.flash }, html`
    <div class="nbd" data-nbd>
      <p class="nb-crumbs"><a href="/">Home</a> › <a href="/notebooks">Notebooks</a> › New</p>
      <h1 class="nbd__title">Start a notebook</h1>
      <form class="nbd-ask" data-nbd-ask method="POST" action="/notebooks/draft">
        <label class="nbd-ask__label" for="nbd-text">Describe it like you'd tell a friend</label>
        <div class="nbd-ask__row">
          <textarea id="nbd-text" name="text" rows="3" required class="form-field nbd-ask__text" data-nbd-text
            placeholder="A reliable used SUV or wagon for my daughter's first car, AWD, $3–8k, under 175k miles, around Bellingham to Seattle. Decide by the 15th.">${opts.text ?? ''}</textarea>
          <button type="submit" class="btn btn--primary nbd-ask__go" data-nbd-go>Draft it</button>
        </div>
        <p class="nbd-ask__examples">For example: “a remote staff engineer job paying $180k+” · “a quiet 2-bed rental in Fremont under $2,600” · “noise-cancelling headphones under $300”</p>
      </form>
      <div class="nbd-result" data-nbd-result aria-live="polite"></div>
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
      ${values.map((v) => html`<span class="nbd-chip"><input name="${name}" value="${v}" aria-label="${label}" size="${String(Math.max(4, Math.min(40, v.length + 1)))}" data-nbd-grow><button type="button" class="nbd-chip__x" data-nbd-remove aria-label="Remove ${v}">×</button></span>`) as unknown as SafeHtml[]}
      <button type="button" class="nbd-chip nbd-chip--add" data-nbd-add="${name}" data-nbd-add-label="${label}">+ add</button>
    </div>`;
}

/** A list of editable lines (done-when, checks), each removable, plus "+ add". */
function rows(name: string, values: readonly string[], label: string): SafeHtml {
  return html`<div class="nbd-list" data-nbd-chips="${name}">
      ${values.map((c) => html`<span class="nbd-row"><span class="nbd-row__box" aria-hidden="true">☐</span><input name="${name}" value="${c}" aria-label="${label}"><button type="button" class="nbd-chip__x" data-nbd-remove aria-label="Remove ${c}">×</button></span>`) as unknown as SafeHtml[]}
      <button type="button" class="nbd-chip nbd-chip--add" data-nbd-add="${name}" data-nbd-add-label="${label}" data-nbd-add-row>+ add</button>
    </div>`;
}

/** The draft to check: every part editable, then Start (POST /notebooks). */
export function renderDraftReview(id: string, draft: NotebookDraft, agents: ReadonlyArray<{ id: string; description: string }>): SafeHtml {
  const cadence = CADENCES.some(([c]) => c === draft.cadence) ? CADENCES : [...CADENCES, [draft.cadence, draft.cadence] as [string, string]];
  return html`
    <form method="POST" action="/notebooks" class="nbd-draft" data-nbd-draft="${id}">
      <div class="nbd-draft__head">
        <span class="nbd-draft__who" aria-hidden="true">sua</span>
        <span>Here's a draft from what you said. Change anything, then start it.${draft.why ? html` <span class="nbd-draft__why">${draft.why}</span>` : html``}</span>
      </div>
      <div class="nbd-draft__body">
        <div class="nbd-draft__main">
          <label class="nbd-field"><span class="nbd-field__label">Title</span>
            <input name="title" value="${draft.title}" required class="nbd-draft__titleinput"></label>
          <label class="nbd-field"><span class="nbd-field__label">What it's for</span>
            <textarea name="statement" rows="2" class="form-field">${draft.statement}</textarea></label>
          <div class="nbd-field"><span class="nbd-field__label">Limits</span>${chips('params', draft.params, 'Limit')}</div>
          <div class="nbd-field"><span class="nbd-field__label">Done when</span>${rows('criteria', draft.criteria, 'Done when')}</div>
        </div>
        <div class="nbd-draft__side">
          <div class="nbd-field"><span class="nbd-field__label">For each option sua notes</span>
            <div class="nbd-chips">
              ${draft.fields.map((f) => html`<span class="nbd-chip nbd-chip--fact"><input type="hidden" name="field" value="${JSON.stringify(f)}">${f.label}<button type="button" class="nbd-chip__x" data-nbd-remove aria-label="Don't note ${f.label}">×</button></span>`) as unknown as SafeHtml[]}
            </div>
          </div>
          <div class="nbd-field"><span class="nbd-field__label">Before deciding, check</span>${rows('checks', draft.checks, 'Check')}</div>
          <label class="nbd-field"><span class="nbd-field__label">Stages</span>
            <input name="stages" value="${draft.stages.join(' → ')}" class="form-field" aria-describedby="nbd-stages-hint"><span class="nbd-field__hint" id="nbd-stages-hint">separated by →</span></label>
          <div class="nbd-field"><span class="nbd-field__label">Searches</span>
            ${draft.pipeline.length
              ? html`<div class="nbd-agents">${agents.filter((a) => draft.pipeline.includes(a.id)).map((a) => html`
                  <label class="nbd-agent" title="${a.description}"><input type="checkbox" name="pipeline" value="${a.id}" checked><span>${a.id}</span></label>`) as unknown as SafeHtml[]}</div>`
              : html`<p class="nbd-field__hint">None of your agents search for this yet. Once it's started, ask sua to build one.</p>`}
            <label class="nbd-cadence">Search
              <select name="cadence">${cadence.map(([v, l]) => html`<option value="${v}"${v === draft.cadence ? unsafeHtml(' selected') : unsafeHtml('')}>${l}</option>`) as unknown as SafeHtml[]}</select>
            </label>
          </div>
        </div>
      </div>
      <div class="nbd-draft__foot">
        <button type="submit" class="btn btn--primary">Looks right, start it</button>
        <span class="nbd-change">
          <label class="sr-only" for="nbd-change">Ask sua to change the draft</label>
          <input id="nbd-change" type="text" placeholder="Ask sua to change… e.g. add Subaru Outback, drop the deadline" data-nbd-change-text autocomplete="off">
          <button type="button" class="btn btn--sm" data-nbd-change>Change it</button>
        </span>
      </div>
    </form>`;
}
