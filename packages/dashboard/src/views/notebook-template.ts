/**
 * Make a template from a notebook (its Edit → More): a preview of the
 * template (saved, or sua's first guess) beside a conversation with sua,
 * which drafts it on a card you approve (notebook-template); the notebook's
 * page below, as notebooks from it will look; and the words to edit by hand,
 * folded away. What changes each time (the subject: "Who you're meeting")
 * reads {subject} in its texts and is filled in when one is started.
 */
import { subjectOut, templateSubjectGuess, TEMPLATE_SUBJECT, type Notebook, type NotebookTemplateSetup } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';

/** The template's name from the notebook's title: without its subject ("Prepare for meeting"). */
export function templateNameFrom(title: string, example: string): string {
  const out = subjectOut(title, example)
    .replace(/\s+(?:with|for|about|on|at|of|to)\s+\{subject\}(?:'s)?/gi, '')
    .split(TEMPLATE_SUBJECT).join('')
    .replace(/\s+/g, ' ').trim();
  return (out || title).slice(0, 60);
}

/** The template as the page shows it: saved from this notebook, or sua's first guess. */
export interface TemplatePreview {
  name: string;
  setup: NotebookTemplateSetup;
  saved: boolean;
  uses?: number;
  updatedAt?: string;
}

/** A template text with its `{subject}` shown as what it asks ("Who you're meeting"). */
function withSubject(text: string, label?: string): SafeHtml {
  const parts = text.split(TEMPLATE_SUBJECT);
  return html`${parts.map((p, i) => html`${p}${i < parts.length - 1 ? html`<mark class="nbt-subj" title="Filled in each time">${label ?? 'subject'}</mark>` : html``}`) as unknown as SafeHtml[]}`;
}

/**
 * What a notebook from the template starts with: its name, what it asks
 * each time, what it's for, limits, done-whens, checks, steps and facts.
 * Redrawn as sua saves new versions (GET /notebooks/:id/template/preview).
 */
export function renderTemplatePreview(p: TemplatePreview): SafeHtml {
  const t = p.setup;
  const label = t.subject?.label;
  const list = (items: readonly string[]) => html`<ul class="nbt-pv__list">${items.map((x) => html`<li>${withSubject(x, label)}</li>`) as unknown as SafeHtml[]}</ul>`;
  return html`<div class="nbt-pv" data-nbt-preview-body>
      <p class="nbt-pv__status ${p.saved ? 'is-saved' : ''}">${p.saved
        ? html`Saved as a template${p.uses ? ` · used ${String(p.uses)}×` : ''}. Start one on <a href="/notebooks/new">New notebook</a>.`
        : html`Not saved yet: this is sua's first guess. Tell sua what to change, then save it from its card.`}</p>
      <h2 class="nbt-pv__name">${p.name}</h2>
      ${t.subject ? html`<p class="nbt-pv__asks"><span class="nbt-pv__k">Asks each time</span> <mark class="nbt-subj">${t.subject.label}</mark> <span class="nbt-pv__was">this time: ${t.subject.example}</span></p>` : html`<p class="nbt-pv__asks"><span class="nbt-pv__k">The same every time</span></p>`}
      <p class="nbt-pv__for">${withSubject(t.statement, label)}</p>
      <div class="nbt-pv__grid">
        ${t.params.length ? html`<section><h3 class="nbt-pv__h">Limits</h3>${list(t.params)}</section>` : html``}
        ${t.criteria.length ? html`<section><h3 class="nbt-pv__h">Done when</h3>${list(t.criteria)}</section>` : html``}
        ${t.checks.length ? html`<section><h3 class="nbt-pv__h">Checks on each</h3>${list(t.checks)}</section>` : html``}
        ${t.steps.length ? html`<section><h3 class="nbt-pv__h">Steps</h3><ol class="nbt-pv__list nbt-pv__steps">${t.steps.map((x) => html`<li>${withSubject(x.title, label)} <span class="nbt-pv__kind">${x.kind}</span></li>`) as unknown as SafeHtml[]}</ol></section>` : html``}
        ${t.fields.length ? html`<section><h3 class="nbt-pv__h">Facts each notes</h3><p class="nbt-pv__facts">${t.fields.map((f, i) => html`${i ? ' · ' : ''}${withSubject(f.label, label)}`) as unknown as SafeHtml[]}</p></section>` : html``}
      </div>
    </div>`;
}

export function renderTemplateSave(args: {
  nb: Notebook;
  preview: TemplatePreview;
  /** The notebook's page, drawn with what it has (what a notebook from the template will look like once it fills). */
  page?: SafeHtml;
  /** sua is replying in the notebook's conversation. */
  working?: boolean;
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
}): string {
  const { nb, preview } = args;
  const id = encodeURIComponent(nb.id);
  const example = preview.setup.subject?.example ?? templateSubjectGuess(nb);
  const sub = (t: string) => subjectOut(t, example);
  // The words yourself: the template's own when it's saved, else the notebook's with the guess swapped.
  const hand = {
    name: preview.name, label: preview.setup.subject?.label ?? '', example,
    statement: preview.setup.statement, params: preview.setup.params, criteria: preview.setup.criteria, checks: preview.setup.checks,
    steps: Object.fromEntries(preview.setup.steps.map((x) => [x.id, x.title])) as Record<string, string>,
    fields: Object.fromEntries(preview.setup.fields.map((f) => [f.key, f.label])) as Record<string, string>,
  };
  const area = (name: string, label: string, hint: string, value: string, rows: number) => html`<label class="nb-label nbt__field">${label}
      <textarea name="${name}" rows="${String(rows)}" class="form-field" data-nbt-text>${value}</textarea>
      <span class="nbt__hint">${hint}</span>
    </label>`;
  const starters = [
    preview.setup.subject ? `Make it work for anyone I'd use it for: ask "${preview.setup.subject.label}" each time.` : 'Make it work for any time I use it.',
    'Drop the limits that only fit this time, and make the wording fit anyone.',
    `Call it "${preview.name}".`,
  ];
  return render(layout({ title: `Template from ${nb.title}`, activeNav: 'notebooks', flash: args.flash }, html`
    <div class="nbt nbt--talk" data-nbt>
      <p class="nb-crumbs"><a href="/">Home</a> › <a href="/notebooks">Notebooks</a> › <a href="/notebooks/${id}">${nb.title}</a> › Make a template</p>
      <h1 class="nbe__title">Make a template from this notebook</h1>
      <p class="nbt__lede">Tell sua how notebooks like this should start next time. It drafts the template, you approve it on its card, and the preview here updates. The template keeps the setup and the page, never this notebook's findings.</p>
      <div class="nbt-grid">
        <section class="nbt-preview" aria-labelledby="nbt-pv-h" data-nbt-preview="/notebooks/${id}/template/preview">
          <h2 class="nbt-sec" id="nbt-pv-h">The template</h2>
          ${renderTemplatePreview(preview)}
        </section>
        <aside class="nbt-talk nb-side__card nb-talk" aria-labelledby="nbt-talk-h" data-ask-scope>
          <h2 class="nb-side__title" id="nbt-talk-h">Talk to sua about the template</h2>
          ${args.working ? html`<p class="nbt-talk__working" role="status">sua is working on it…</p>` : html``}
          <form method="POST" action="/notebooks/${id}/ask" class="nb-talk__form" data-ask-fix>
            <input type="hidden" name="template" value="1">
            <textarea name="text" required rows="4" class="form-field" data-enter-sends data-home-ask-input placeholder="e.g. make it work for anyone I'm meeting, a person or a company"></textarea>
            <div class="nb-talk__send">
              <span class="nb-talk__keys"><kbd>Enter</kbd> to send</span>
              <button type="submit" class="btn btn--primary btn--sm">Tell sua</button>
            </div>
          </form>
          <div class="nbt-talk__starters">
            ${starters.map((x) => html`<button type="button" class="ask-pill" data-ask-fill="${x}">${x}</button>`) as unknown as SafeHtml[]}
          </div>
          ${nb.conversationId ? html`<a class="nbt-talk__open" href="/inbox/${encodeURIComponent(nb.conversationId)}" data-nb-continue="${nb.conversationId}">Open the conversation</a>` : html``}
        </aside>
      </div>
      ${args.page ? html`<section class="nbt-page" aria-labelledby="nbt-page-h">
        <h2 class="nbt-sec" id="nbt-page-h">Its page <span class="nbt-sec__note">shown with this notebook's findings; a new one starts empty and fills the same way. Ask sua on the notebook to change it.</span></h2>
        ${args.page}
      </section>` : html``}
      <details class="nbt-hand">
        <summary>Edit the words yourself</summary>
      <form method="POST" action="/notebooks/${id}/template" class="nb-form nbt-form">
        <input type="hidden" name="review" value="1">
        <label class="nb-label nbt__field">Template name
          <input type="text" name="name" value="${hand.name}" required maxlength="60" class="form-field">
        </label>
        <fieldset class="nbt__subject">
          <legend>What changes each time</legend>
          <label class="nb-label">What to ask when you start one
            <input type="text" name="subject_label" value="${hand.label}" maxlength="80" class="form-field" placeholder="Who you’re meeting (a person or company)">
          </label>
          <label class="nb-label">In this notebook it was
            <input type="text" name="subject_example" value="${hand.example}" maxlength="80" class="form-field" placeholder="Dana Reyes" data-nbt-example>
          </label>
          <span class="nbt__hint">Wherever the texts below name it, it becomes <code>{subject}</code>. Leave both empty for a template that's the same every time.</span>
        </fieldset>
        ${area('statement', 'What it’s for', 'One or two sentences.', hand.statement, 2)}
        ${area('params', 'Limits', 'One per line. Drop any that only fit this time.', hand.params.join('\n'), Math.max(3, hand.params.length + 1))}
        ${area('criteria', 'Done when', 'One per line.', hand.criteria.join('\n'), Math.max(2, hand.criteria.length + 1))}
        ${area('checks', 'Checks on each option', 'One per line.', hand.checks.join('\n'), Math.max(2, hand.checks.length + 1))}
        ${nb.steps?.length ? html`<fieldset class="nbt__steps">
          <legend>Steps</legend>
          ${nb.steps.map((s, i) => html`<label class="nb-label nbt__step"><span class="nbt__step-n">${String(i + 1)}</span>
            <input type="text" name="step_${s.id}" value="${hand.steps[s.id] ?? sub(s.title)}" maxlength="60" class="form-field" data-nbt-text aria-label="Step ${String(i + 1)}">
            <span class="nbt__step-kind">${s.kind}</span>
          </label>`) as unknown as SafeHtml[]}
          <span class="nbt__hint">Each starts fresh: to do, with the same agent.</span>
        </fieldset>` : html``}
        ${nb.fields.length ? html`<fieldset class="nbt__steps nbt__fields">
          <legend>Facts each option notes</legend>
          ${nb.fields.map((f) => html`<label class="nb-label nbt__step"><input type="text" name="field_${f.key}" value="${hand.fields[f.key] ?? sub(f.label)}" maxlength="40" class="form-field" data-nbt-text aria-label="Fact: ${f.label}"><span class="nbt__step-kind">${f.type}</span></label>`) as unknown as SafeHtml[]}
          <span class="nbt__hint">Rename one to fit any time ("What suggests it matters to them").</span>
        </fieldset>` : html``}
        <dl class="nbt__kept">
          ${nb.stages.length ? html`<div><dt>Stages</dt><dd>${nb.stages.join(' → ')}</dd></div>` : html``}
          ${nb.cadence ? html`<div><dt>Schedule</dt><dd>${nb.cadence}</dd></div>` : html``}
        </dl>
        <div class="nbd-draft__foot">
          <button type="submit" class="btn btn--primary">Save template</button>
        </div>
      </form>
      </details>
    </div>
  `));
}

/** The review form as edits for NotebookStore.saveTemplate. */
export function templateEditsFrom(body: Record<string, unknown>, nb: Notebook): import('@some-useful-agents/core').NotebookTemplateEdits {
  const str = (k: string) => (typeof body[k] === 'string' ? body[k] as string : '');
  const lines = (k: string) => str(k).split('\n').map((l) => l.trim()).filter(Boolean);
  const stepTitles: Record<string, string> = {};
  for (const s of nb.steps ?? []) { const t = str(`step_${s.id}`).trim(); if (t) stepTitles[s.id] = t; }
  const fieldLabels: Record<string, string> = {};
  for (const f of nb.fields) { const l = str(`field_${f.key}`).trim(); if (l) fieldLabels[f.key] = l; }
  const label = str('subject_label').trim();
  const example = str('subject_example').trim();
  return {
    statement: str('statement'),
    params: lines('params'), criteria: lines('criteria'), checks: lines('checks'),
    stepTitles, fieldLabels,
    ...(label && example ? { subject: { label, example } } : {}),
  };
}

/**
 * The review page: change "In this notebook it was" and the texts that
 * name it say {subject} there too. On New notebook, a template's subject
 * box joins the message that starts it.
 */
export const NOTEBOOK_TEMPLATE_JS = `
  // New notebook: a template's "Who you're meeting" box goes into the message to sua.
  document.addEventListener('submit', function (ev) {
    var form = ev.target;
    if (!form || !form.matches || !form.matches('[data-nbt-start]')) return;
    var box = form.querySelector('[data-nbt-subject]');
    var body = form.querySelector('input[name="body"]');
    var v = box ? box.value.replace(/\\s+/g, ' ').trim() : '';
    if (v && body) body.value = form.getAttribute('data-nbt-start') + v + '.';
  }, true);
  // The template page: its preview redraws as sua saves new versions.
  (function () {
    var box = document.querySelector('[data-nbt-preview]');
    if (!box) return;
    var url = box.getAttribute('data-nbt-preview');
    var busy = false;
    setInterval(function () {
      if (busy || document.hidden) return;
      busy = true;
      fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } })
        .then(function (r) { return r.ok ? r.text() : ''; })
        .then(function (html) {
          var cur = box.querySelector('[data-nbt-preview-body]');
          if (!html || !cur || cur.outerHTML === html.trim()) return;
          var t = document.createElement('template');
          t.innerHTML = html.trim();
          var next = t.content.firstElementChild;
          if (next) { cur.replaceWith(next); next.classList.add('is-new'); }
        })
        .catch(function () {})
        .then(function () { busy = false; });
    }, 4000);
  })();
  (function () {
    var root = document.querySelector('[data-nbt]');
    if (!root) return;
    var ex = root.querySelector('[data-nbt-example]');
    if (!ex) return;
    function esc(s) { return s.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'); }
    var timer;
    ex.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var v = ex.value.replace(/\\s+/g, ' ').trim();
        if (v.length < 3) return;
        var re = new RegExp('(^|[^\\\\p{L}\\\\p{N}])' + esc(v).replace(/ /g, '\\\\s+') + '(?![\\\\p{L}\\\\p{N}])', 'giu');
        root.querySelectorAll('[data-nbt-text]').forEach(function (el) {
          var next = el.value.replace(re, '$1{subject}');
          if (next !== el.value) el.value = next;
        });
      }, 400);
    });
  })();
`;
