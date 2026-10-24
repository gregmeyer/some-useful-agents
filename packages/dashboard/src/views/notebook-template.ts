/**
 * Save as a template (a notebook's Edit → More): the notebook's setup to
 * keep, with its texts to edit first and what changes each time (the
 * subject: "Who you're meeting"). Where the subject was named, the texts
 * say {subject}; starting a notebook from the template fills it in.
 */
import { subjectOut, templateSubjectGuess, TEMPLATE_SUBJECT, type Notebook } from '@some-useful-agents/core';
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

export function renderTemplateSave(args: { nb: Notebook; flash?: { kind: 'error' | 'info' | 'ok'; message: string } }): string {
  const { nb } = args;
  const id = encodeURIComponent(nb.id);
  const example = templateSubjectGuess(nb);
  const sub = (t: string) => subjectOut(t, example);
  const lines = (list: readonly string[]) => list.map(sub).join('\n');
  const area = (name: string, label: string, hint: string, value: string, rows: number) => html`<label class="nb-label nbt__field">${label}
      <textarea name="${name}" rows="${String(rows)}" class="form-field" data-nbt-text>${value}</textarea>
      <span class="nbt__hint">${hint}</span>
    </label>`;
  return render(layout({ title: `Save ${nb.title} as a template`, activeNav: 'notebooks', flash: args.flash }, html`
    <div class="nbe nbt" data-nbt>
      <p class="nb-crumbs"><a href="/">Home</a> › <a href="/notebooks">Notebooks</a> › <a href="/notebooks/${id}">${nb.title}</a> › <a href="/notebooks/${id}/edit">Edit</a> › Save as a template</p>
      <h1 class="nbe__title">Save as a template</h1>
      <p class="nbt__lede">A template keeps this notebook's setup to start new ones like it. Its options, notes and history stay here. Make the words fit any time you'd use it: where it names the thing that changes, it says <code>{subject}</code>, and you fill that in when you start one.</p>
      <form method="POST" action="/notebooks/${id}/template" class="nb-form nbt-form">
        <input type="hidden" name="review" value="1">
        <label class="nb-label nbt__field">Template name
          <input type="text" name="name" value="${templateNameFrom(nb.title, example)}" required maxlength="60" class="form-field">
        </label>
        <fieldset class="nbt__subject">
          <legend>What changes each time</legend>
          <label class="nb-label">What to ask when you start one
            <input type="text" name="subject_label" value="${example ? 'Who or what it’s about' : ''}" maxlength="80" class="form-field" placeholder="Who you’re meeting (a person or company)">
          </label>
          <label class="nb-label">In this notebook it was
            <input type="text" name="subject_example" value="${example}" maxlength="80" class="form-field" placeholder="Dana Reyes" data-nbt-example>
          </label>
          <span class="nbt__hint">Wherever the texts below name it, it becomes <code>{subject}</code>. Leave both empty for a template that's the same every time.</span>
        </fieldset>
        ${area('statement', 'What it’s for', 'One or two sentences.', sub(nb.statement), 2)}
        ${area('params', 'Limits', 'One per line. Drop any that only fit this time.', lines(nb.params), Math.max(3, nb.params.length + 1))}
        ${area('criteria', 'Done when', 'One per line.', lines(nb.criteria.map((c) => c.text)), Math.max(2, nb.criteria.length + 1))}
        ${area('checks', 'Checks on each option', 'One per line.', lines(nb.checks), Math.max(2, nb.checks.length + 1))}
        ${nb.steps?.length ? html`<fieldset class="nbt__steps">
          <legend>Steps</legend>
          ${nb.steps.map((s, i) => html`<label class="nb-label nbt__step"><span class="nbt__step-n">${String(i + 1)}</span>
            <input type="text" name="step_${s.id}" value="${sub(s.title)}" maxlength="60" class="form-field" data-nbt-text aria-label="Step ${String(i + 1)}">
            <span class="nbt__step-kind">${s.kind}</span>
          </label>`) as unknown as SafeHtml[]}
          <span class="nbt__hint">Each starts fresh: to do, with the same agent.</span>
        </fieldset>` : html``}
        ${nb.fields.length ? html`<fieldset class="nbt__steps nbt__fields">
          <legend>Facts each option notes</legend>
          ${nb.fields.map((f) => html`<label class="nb-label nbt__step"><input type="text" name="field_${f.key}" value="${sub(f.label)}" maxlength="40" class="form-field" data-nbt-text aria-label="Fact: ${f.label}"><span class="nbt__step-kind">${f.type}</span></label>`) as unknown as SafeHtml[]}
          <span class="nbt__hint">Rename one to fit any time ("What suggests it matters to them").</span>
        </fieldset>` : html``}
        <dl class="nbt__kept">
          ${nb.stages.length ? html`<div><dt>Stages</dt><dd>${nb.stages.join(' → ')}</dd></div>` : html``}
          ${nb.cadence ? html`<div><dt>Schedule</dt><dd>${nb.cadence}</dd></div>` : html``}
        </dl>
        <div class="nbd-draft__foot">
          <button type="submit" class="btn btn--primary">Save template</button>
          <a class="btn btn--ghost" href="/notebooks/${id}/edit">Cancel</a>
        </div>
      </form>
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
