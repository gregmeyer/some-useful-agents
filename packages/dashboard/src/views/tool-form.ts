/**
 * New tool / Edit tool: write a tool of your own (a command or a prompt),
 * try it once on sample inputs without saving it, then keep it. The form
 * saves the same YAML `sua tool add` does (docs/tools.md "Tools you add").
 */
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { TOOL_FIELD_TYPES, type ToolFormValues, type ToolFormInput, type ToolFormOutput } from '../lib/tool-form.js';
import type { ToolIdea } from '../lib/tool-ideas.js';

export interface ToolFormPage {
  /** 'new' saves a new tool; 'edit' replaces the tool `values.id`. */
  mode: 'new' | 'edit';
  values: ToolFormValues;
  /** Show the whole tool as YAML instead of the fields. */
  view: 'fields' | 'yaml';
  yaml?: string;
  errors?: string[];
  /** Shown before saving; "Save anyway" keeps the tool despite them. */
  warnings?: string[];
  sample?: string;
  /** New tool only: which way in is showing. Default 'describe'. */
  tab?: 'describe' | 'write';
  /** The form was filled by sua's drafter from this description. */
  drafted?: { said: string; why?: string };
  /** Describe it: ideas from your agents, as cards. */
  ideas?: ToolIdea[];
  /** Describe it: the box starts with this (Make a tool from this step). */
  prefill?: string;
  /** Describe it → Or start from… an agent: the agents to pick from. */
  agents?: Array<{ id: string; name: string }>;
}

const typeOptions = (selected: string): SafeHtml[] =>
  TOOL_FIELD_TYPES.map((t) => html`<option value="${t}"${t === selected ? ' selected' : ''}>${t}</option>`);

function inputRow(i: ToolFormInput): SafeHtml {
  return html`<tr class="tool-form__row">
    <td><input class="form-field__input mono" name="in_name" value="${i.name}" placeholder="url" aria-label="Input name" pattern="[A-Za-z_][A-Za-z0-9_]*"></td>
    <td><select class="form-field__input" name="in_type" aria-label="Type">${typeOptions(i.type)}</select></td>
    <td><select class="form-field__input" name="in_required" aria-label="Required"><option value="yes"${i.required ? ' selected' : ''}>required</option><option value="no"${i.required ? '' : ' selected'}>optional</option></select></td>
    <td><input class="form-field__input mono" name="in_default" value="${i.default}" placeholder="—" aria-label="Default"></td>
    <td><input class="form-field__input" name="in_description" value="${i.description}" placeholder="What it is" aria-label="Description"></td>
    <td><button type="button" class="btn btn--sm btn--ghost" data-remove-row aria-label="Remove this input">×</button></td>
  </tr>`;
}

function outputRow(o: ToolFormOutput): SafeHtml {
  return html`<tr class="tool-form__row">
    <td><input class="form-field__input mono" name="out_name" value="${o.name}" placeholder="count" aria-label="Output name"></td>
    <td><select class="form-field__input" name="out_type" aria-label="Type">${typeOptions(o.type)}</select></td>
    <td colspan="3"><input class="form-field__input" name="out_description" value="${o.description}" placeholder="What it is" aria-label="Description"></td>
    <td><button type="button" class="btn btn--sm btn--ghost" data-remove-row aria-label="Remove this output">×</button></td>
  </tr>`;
}

function sampleFor(v: ToolFormValues): string {
  return v.inputs.filter((i) => i.name).map((i) => `${i.name}: ${i.default || ''}`).join('\n');
}

/** Idea cards; Use this puts the idea's sentence in the Describe it box. */
export function ideaCards(ideas: readonly ToolIdea[], label = 'Ideas from your agents'): SafeHtml {
  if (!ideas.length) {
    return html`<p class="dim tool-ideas__none">No ideas from your agents yet: none of them repeats a fetch or a command another one has. Describe one below, or open a step of an agent and choose <strong>Make a tool from this step</strong>.</p>`;
  }
  return html`<ul class="tool-ideas" aria-label="${label}">
    ${ideas.map((i) => html`<li class="tool-ideas__card">
      <p class="tool-ideas__label">${i.label}</p>
      <p class="tool-ideas__from dim">${i.from}</p>
      <button type="button" class="btn btn--sm" data-use-idea>Use this</button>
      <textarea hidden data-idea-text>${i.text}</textarea>
    </li>`)}
  </ul>`;
}

function startFrom(agents: ReadonlyArray<{ id: string; name: string }>): SafeHtml {
  return html`
    <details class="tool-start" data-tool-start>
      <summary class="tool-start__summary">Or start from…</summary>
      <div class="tool-start__body">
        <div class="tool-start__lenses" role="radiogroup" aria-label="Start from">
          <label class="radio-option"><input type="radio" name="lens" value="agent" checked> An agent</label>
          <label class="radio-option"><input type="radio" name="lens" value="input"> An input</label>
          <label class="radio-option"><input type="radio" name="lens" value="outcome"> An outcome</label>
        </div>
        <div data-lens-panel="agent">
          <label class="form-field">
            <span class="form-field__label">Which agent?</span>
            <select class="form-field__input" name="agent">
              ${agents.map((a) => html`<option value="${a.id}">${a.name}</option>`)}
            </select>
            <span class="form-field__hint">sua reads its steps and suggests tools that would make it simpler, or that other agents could use too.</span>
          </label>
        </div>
        <div data-lens-panel="input" hidden>
          <label class="form-field">
            <span class="form-field__label">What do you have?</span>
            <textarea class="form-field__textarea" name="input" rows="5" maxlength="4000" placeholder="Paste a sample (a CSV's first rows, some JSON, a page's text), a URL, or say what it is: a bank statement CSV, a meeting transcript"></textarea>
            <span class="form-field__hint">sua suggests tools that take it in and give back what's useful in it.</span>
          </label>
        </div>
        <div data-lens-panel="outcome" hidden>
          <label class="form-field">
            <span class="form-field__label">What do you want to end up with?</span>
            <textarea class="form-field__textarea" name="outcome" rows="2" maxlength="1000" placeholder="A weekly summary of what changed in my repos"></textarea>
            <span class="form-field__hint">sua suggests the tools that would produce it.</span>
          </label>
        </div>
        <div class="tool-form__actions"><button type="button" class="btn btn--sm" data-suggest>Suggest tools</button></div>
        <div data-suggest-result class="tool-start__result"></div>
      </div>
    </details>
  `;
}

function describePanel(ideas: readonly ToolIdea[], prefill: string | undefined, agents: ReadonlyArray<{ id: string; name: string }>): SafeHtml {
  return html`
    <section class="tool-form__describe" data-tool-describe>
      ${prefill ? html`` : html`<h2 class="tool-ideas__title">Ideas from your agents</h2>
      <p class="form-field__hint">Things your agents keep doing in their own way, that one tool could do for all of them.</p>
      ${ideaCards(ideas)}
      ${startFrom(agents)}`}
      <label class="form-field">
        <span class="form-field__label">Describe the tool you want</span>
        <textarea class="form-field__textarea tool-form__describe-box" name="description" rows="${prefill ? '10' : '3'}" maxlength="2000"
          placeholder="Look up a word on dictionaryapi.dev and give back its first definition">${prefill ?? ''}</textarea>
        <span class="form-field__hint">sua drafts it and opens it in the form, filled in, for you to read and try. Nothing runs until you press Try it.</span>
      </label>
      <div class="tool-form__actions">
        <button type="button" class="btn btn--primary" data-draft>Draft it</button>
      </div>
      <div data-draft-status class="tool-form__draft-status"></div>
    </section>
    ${unsafeHtml(DESCRIBE_JS)}
  `;
}

function newToolTabs(active: 'describe' | 'write'): SafeHtml {
  const tab = (t: 'describe' | 'write', label: string) => html`<a href="/tools/new?tab=${t}" class="tool-form__tab${t === active ? ' is-active' : ''}"${t === active ? unsafeHtml(' aria-current="page"') : unsafeHtml('')}>${label}</a>`;
  return html`<nav class="tool-form__tabs" aria-label="How to make it">${tab('describe', 'Describe it')}${tab('write', 'Write it')}</nav>`;
}

export function renderToolForm(p: ToolFormPage): string {
  const v = p.values;
  const tab = p.mode === 'new' ? (p.tab ?? 'describe') : 'write';
  const action = p.mode === 'new' ? '/tools/new' : `/tools/${encodeURIComponent(v.id)}/edit`;
  const isCommand = v.kind === 'command';

  const fields = html`
    <div class="tool-form__grid">
      <label class="form-field">
        <span class="form-field__label">Id</span>
        ${p.mode === 'edit'
          ? html`<input class="form-field__input mono" name="id" value="${v.id}" readonly>`
          : html`<input class="form-field__input mono" name="id" value="${v.id}" placeholder="word-count" required pattern="[a-z0-9][a-z0-9-]*">`}
        <span class="form-field__hint">${p.mode === 'edit' ? 'A step uses it as tool: ' + v.id + '.' : 'Lowercase letters, digits and -. A step uses it as tool: <id>.'}</span>
      </label>
      <label class="form-field">
        <span class="form-field__label">Name</span>
        <input class="form-field__input" name="name" value="${v.name}" placeholder="Word count">
      </label>
    </div>
    <label class="form-field">
      <span class="form-field__label">What it does</span>
      <input class="form-field__input" name="description" value="${v.description}" placeholder="Counts the words in some text">
      <span class="form-field__hint">A model reads this to decide when to call it.</span>
    </label>

    <fieldset class="fieldset">
      <legend class="fieldset__legend">It runs</legend>
      <div class="tool-form__kinds">
        <label class="radio-option"><input type="radio" name="kind" value="command"${isCommand ? ' checked' : ''}> A command</label>
        <label class="radio-option"><input type="radio" name="kind" value="prompt"${isCommand ? '' : ' checked'}> A prompt</label>
      </div>
      <label class="form-field">
        <span class="form-field__label" data-kind-label>${isCommand ? 'Command' : 'Prompt'}</span>
        <textarea class="form-field__textarea tool-form__body" name="body" rows="8" spellcheck="false" placeholder="${isCommand ? 'printf \'%s\' "$text" | wc -w' : 'Summarise {{inputs.text}} in three bullets.'}">${v.body}</textarea>
        <span class="form-field__hint" data-kind-hint>${isCommand
          ? unsafeHtml('Inputs arrive as environment variables: write <code>"$text"</code>, in quotes. Print one line of JSON at the end to give the step output fields.')
          : unsafeHtml('Write <code>{{inputs.text}}</code> where an input goes. A prompt tool runs as a step; a model can\'t call one yet.')}</span>
      </label>
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset__legend">Inputs</legend>
      <table class="tool-form__table">
        <thead><tr><th>Name</th><th>Type</th><th></th><th>Default</th><th>Description</th><th></th></tr></thead>
        <tbody data-rows="inputs">${v.inputs.map(inputRow)}</tbody>
      </table>
      <template data-row-template="inputs">${inputRow({ name: '', type: 'string', required: false, default: '', description: '' })}</template>
      <button type="button" class="btn btn--sm" data-add-row="inputs">+ Input</button>
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset__legend">Output fields</legend>
      <p class="form-field__hint">Optional. Name the keys of the JSON line it prints, so later steps can use <code>{{upstream.&lt;step&gt;.&lt;field&gt;}}</code>.</p>
      <table class="tool-form__table">
        <tbody data-rows="outputs">${v.outputs.map(outputRow)}</tbody>
      </table>
      <template data-row-template="outputs">${outputRow({ name: '', type: 'string', description: '' })}</template>
      <button type="button" class="btn btn--sm" data-add-row="outputs">+ Output field</button>
    </fieldset>
  `;

  const yamlView = html`
    <label class="form-field">
      <span class="form-field__label">The tool as YAML</span>
      <textarea class="form-field__textarea tool-form__yaml" name="yaml" rows="22" spellcheck="false">${p.yaml ?? ''}</textarea>
      <span class="form-field__hint">The same file <code>sua tool add</code> takes.</span>
    </label>
  `;

  const errors = p.errors?.length
    ? html`<div class="flash flash--error" role="alert"><strong>It can't be saved yet:</strong><ul class="tool-form__list">${p.errors.map((e) => html`<li>${e}</li>`)}</ul></div>`
    : html``;
  const warnings = p.warnings?.length
    ? html`<div class="flash flash--info" role="status"><strong>Worth a second look before you keep it:</strong><ul class="tool-form__list">${p.warnings.map((w) => html`<li>${w}</li>`)}</ul></div>`
    : html``;

  const body = html`
    ${pageHeader({
      title: p.mode === 'new' ? 'New tool' : `Edit ${v.id}`,
      description: 'A tool of your own: a command or a prompt with named inputs. Steps use it with tool:, and a model can call a command tool from a step\'s tools list. Try it before you keep it.',
      crumbs: p.mode === 'new'
        ? [{ label: 'Home', href: '/' }, { label: 'Tools', href: '/tools' }, { label: 'New tool' }]
        : [{ label: 'Home', href: '/' }, { label: 'Tools', href: '/tools' }, { label: v.id, href: `/tools/${encodeURIComponent(v.id)}` }, { label: 'Edit' }],
    })}

    ${p.mode === 'new' ? newToolTabs(tab) : html``}
    ${tab === 'describe' ? describePanel(p.ideas ?? [], p.prefill, p.agents ?? []) : html`
    ${p.drafted ? html`<div class="flash flash--info tool-form__drafted" role="status">
      <strong>sua drafted this</strong> from “${p.drafted.said}”.${p.drafted.why ? html` ${p.drafted.why}` : html``}
      Read the ${v.kind === 'command' ? 'command' : 'prompt'} before you try it.
    </div>` : html``}
    <form method="POST" action="${action}" class="tool-form" data-tool-form>
      <input type="hidden" name="view" value="${p.view}">
      ${p.view === 'yaml' ? html`<input type="hidden" name="kind" value="${v.kind}">` : html``}
      ${p.mode === 'new' ? html`<input type="hidden" name="tab" value="write">` : html``}
      <div class="tool-form__switch">
        ${p.view === 'fields'
          ? html`<button type="submit" name="action" value="to_yaml" class="btn btn--sm btn--ghost" formnovalidate>Edit as YAML</button>`
          : html`<button type="submit" name="action" value="to_fields" class="btn btn--sm btn--ghost" formnovalidate>Edit as fields</button>`}
      </div>
      ${errors}
      ${warnings}
      ${p.view === 'fields' ? fields : yamlView}

      <section class="tool-form__try card" aria-labelledby="try-heading">
        <h2 id="try-heading" class="tool-form__try-title">Try it</h2>
        <p class="form-field__hint">Runs it once with these inputs. Nothing is saved.</p>
        <textarea class="form-field__textarea" name="sample" rows="3" spellcheck="false" aria-label="Sample inputs" placeholder="text: the quick brown fox">${p.sample ?? sampleFor(v)}</textarea>
        <div class="tool-form__try-actions">
          <button type="button" class="btn btn--sm" data-try>Try it</button>
          <span data-try-status></span>
        </div>
        <div data-try-result class="tool-form__try-result" hidden></div>
      </section>

      <div class="tool-form__actions">
        ${p.warnings?.length
          ? html`<button type="submit" name="action" value="save_anyway" class="btn btn--primary">Save anyway</button>`
          : html`<button type="submit" name="action" value="save" class="btn btn--primary">${p.mode === 'new' ? 'Save tool' : 'Save changes'}</button>`}
        <a href="${p.mode === 'new' ? '/tools' : `/tools/${encodeURIComponent(v.id)}`}" class="btn btn--ghost">Cancel</a>
      </div>
    </form>
    ${unsafeHtml(TOOL_FORM_JS)}`}
  `;
  return render(layout({ title: p.mode === 'new' ? 'New tool' : `Edit ${v.id}`, activeNav: 'tools' }, body));
}

const TOOL_FORM_JS = `<script>
(function () {
  var form = document.querySelector('[data-tool-form]');
  if (!form) return;
  form.addEventListener('click', function (e) {
    var add = e.target.closest('[data-add-row]');
    if (add) {
      var which = add.getAttribute('data-add-row');
      var tpl = form.querySelector('[data-row-template="' + which + '"]');
      form.querySelector('[data-rows="' + which + '"]').appendChild(tpl.content.cloneNode(true));
      return;
    }
    var rm = e.target.closest('[data-remove-row]');
    if (rm) { rm.closest('tr').remove(); return; }
  });
  form.addEventListener('change', function (e) {
    if (e.target.name !== 'kind' || e.target.type !== 'radio') return;
    var cmd = e.target.value === 'command';
    var label = form.querySelector('[data-kind-label]');
    if (label) label.textContent = cmd ? 'Command' : 'Prompt';
    var hint = form.querySelector('[data-kind-hint]');
    if (hint) hint.innerHTML = cmd
      ? 'Inputs arrive as environment variables: write <code>"$text"</code>, in quotes. Print one line of JSON at the end to give the step output fields.'
      : 'Write <code>{{inputs.text}}</code> where an input goes. A prompt tool runs as a step; a model can\\'t call one yet.';
  });

  var tryBtn = form.querySelector('[data-try]');
  var status = form.querySelector('[data-try-status]');
  var out = form.querySelector('[data-try-result]');
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function show(r) {
    var parts = [];
    var ok = r.status === 'completed';
    parts.push('<p class="tool-form__try-verdict ' + (ok ? 'is-ok' : 'is-bad') + '">' + (ok ? '✓ It ran' : '✗ It didn\\'t run cleanly') + (r.durationMs != null ? ' <span class="dim">in ' + (r.durationMs / 1000).toFixed(1) + 's</span>' : '') + (r.exitCode != null ? ' <span class="dim">· exit ' + r.exitCode + '</span>' : '') + '</p>');
    if (r.error) parts.push('<p class="tool-form__try-error">' + esc(r.error) + '</p>');
    if (r.outputs && Object.keys(r.outputs).length) {
      parts.push('<dl class="kv">' + Object.keys(r.outputs).map(function (k) { return '<dt class="mono">' + esc(k) + '</dt><dd class="mono">' + esc(typeof r.outputs[k] === 'string' ? r.outputs[k] : JSON.stringify(r.outputs[k])) + '</dd>'; }).join('') + '</dl>');
    }
    if (r.result) parts.push('<pre class="tool-form__try-out">' + esc(r.result) + '</pre>');
    if (r.url) parts.push('<p class="dim"><a href="' + esc(r.url) + '">The whole run</a></p>');
    out.innerHTML = parts.join('');
    out.hidden = false;
  }
  function poll(runId, tries) {
    fetch('/tools/try/' + encodeURIComponent(runId)).then(function (res) { return res.json(); }).then(function (r) {
      if (!r.ok) { status.textContent = r.error || 'The trial went missing.'; tryBtn.disabled = false; return; }
      if (!r.done && tries < 400) { setTimeout(function () { poll(runId, tries + 1); }, 750); return; }
      status.innerHTML = '';
      tryBtn.disabled = false;
      show(r);
    }).catch(function () { status.textContent = 'Lost touch with the dashboard.'; tryBtn.disabled = false; });
  }
  if (tryBtn) tryBtn.addEventListener('click', function () {
    tryBtn.disabled = true;
    out.hidden = true;
    status.innerHTML = window.suaWorking ? window.suaWorking({ text: 'Running it…' }) : 'Running it…';
    var data = new URLSearchParams(new FormData(form));
    fetch('/tools/try', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: data.toString() })
      .then(function (res) { return res.json(); })
      .then(function (r) {
        if (!r.ok) {
          tryBtn.disabled = false;
          status.innerHTML = '';
          out.innerHTML = '<div class="flash flash--error"><strong>It can\\'t run yet:</strong><ul class="tool-form__list">' + (r.errors || [r.error]).map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div>';
          out.hidden = false;
          return;
        }
        poll(r.runId, 0);
      })
      .catch(function () { tryBtn.disabled = false; status.textContent = 'Lost touch with the dashboard.'; });
  });
})();
</script>`;

const DESCRIBE_JS = `<script>
(function () {
  var root = document.querySelector('[data-tool-describe]');
  if (!root) return;
  var box = root.querySelector('textarea[name=description]');
  var btn = root.querySelector('[data-draft]');
  var status = root.querySelector('[data-draft-status]');
  root.addEventListener('click', function (e) {
    var use = e.target.closest('[data-use-idea]');
    if (!use) return;
    box.value = use.parentNode.querySelector('[data-idea-text]').value;
    box.rows = 6;
    box.focus();
    btn.scrollIntoView({ block: 'nearest' });
  });
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  var start = root.querySelector('[data-tool-start]');
  if (start) {
    var result = start.querySelector('[data-suggest-result]');
    var sBtn = start.querySelector('[data-suggest]');
    var lens = function () { var c = start.querySelector('input[name=lens]:checked'); return c ? c.value : 'agent'; };
    start.addEventListener('change', function (e) {
      if (e.target.name !== 'lens') return;
      var panels = start.querySelectorAll('[data-lens-panel]');
      for (var i = 0; i < panels.length; i++) panels[i].hidden = panels[i].getAttribute('data-lens-panel') !== lens();
      result.innerHTML = '';
    });
    var done = function (html) { sBtn.disabled = false; sBtn.textContent = 'Suggest tools'; result.innerHTML = html; };
    var pollIdeas = function (id, n) {
      fetch('/tools/ideas/' + encodeURIComponent(id)).then(function (r) { return r.json(); }).then(function (d) {
        if (!d.ok) return done('<div class="flash flash--error">' + esc(d.error) + '</div>');
        if (d.status === 'ready') return done(d.html);
        if (d.status === 'failed') return done('<div class="flash flash--error">' + esc(d.error) + '</div>');
        if (n > 200) return done('<div class="flash flash--error">It is taking too long. Try again.</div>');
        setTimeout(function () { pollIdeas(id, n + 1); }, 1500);
      }).catch(function () { done('<div class="flash flash--error">Lost touch with the dashboard.</div>'); });
    };
    sBtn.addEventListener('click', function () {
      var l = lens();
      var body = new URLSearchParams({ lens: l });
      if (l === 'agent') body.set('agent', start.querySelector('select[name=agent]').value);
      else {
        var v = start.querySelector('textarea[name=' + l + ']').value.trim();
        if (!v) { start.querySelector('textarea[name=' + l + ']').focus(); return; }
        body.set('text', v);
      }
      sBtn.disabled = true;
      sBtn.innerHTML = window.suaWorking ? window.suaWorking({ text: 'Thinking\u2026' }) : 'Thinking\u2026';
      result.innerHTML = '';
      fetch('/tools/ideas', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (!d.ok) return done('<div class="flash flash--error">' + esc(d.error) + '</div>'); pollIdeas(d.id, 0); })
        .catch(function () { done('<div class="flash flash--error">Lost touch with the dashboard.</div>'); });
    });
  }
  function fail(msg) {
    btn.disabled = false;
    btn.textContent = 'Draft it';
    status.innerHTML = '<div class="flash flash--error">' + esc(msg) + '</div>';
  }
  function poll(id, n) {
    fetch('/tools/draft/' + encodeURIComponent(id)).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) return fail(d.error || 'The draft went missing.');
      if (d.status === 'ready') { location.href = d.url; return; }
      if (d.status === 'failed') return fail("sua couldn't draft a tool that checks out: " + d.error + ' Try saying more about its inputs and what it gives back, or write it yourself.');
      if (n > 400) return fail('It is taking too long. Try again.');
      var note = status.querySelector('[data-try-note]');
      if (note) note.textContent = d.tries > 1 ? 'Its first draft didn\\u2019t check out, so it\\u2019s trying again (' + d.tries + ' of 3).' : '';
      setTimeout(function () { poll(id, n + 1); }, 1500);
    }).catch(function () { fail('Lost touch with the dashboard.'); });
  }
  btn.addEventListener('click', function () {
    var said = box.value.trim();
    if (!said) { box.focus(); return; }
    btn.disabled = true;
    btn.innerHTML = window.suaWorking ? window.suaWorking({ text: 'Drafting\\u2026' }) : 'Drafting\\u2026';
    status.innerHTML = (window.suaWorking ? window.suaWorking({ size: 'panel', title: 'sua heard you and is drafting your tool', said: said, text: 'It writes the tool, checks it, and opens it here for you to read and try. Usually under a minute.', since: new Date().toISOString() }) : '') + '<p class="dim" data-try-note></p>';
    fetch('/tools/draft', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ description: said }).toString() })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (!d.ok) return fail(d.error || 'sua can\\u2019t draft tools right now.'); poll(d.id, 0); })
      .catch(function () { fail('Lost touch with the dashboard.'); });
  });
})();
</script>`;
