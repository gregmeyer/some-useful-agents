/**
 * New notebook → Import a notebook file (docs/notebooks.md "Send a copy to
 * another machine"): choose a .suanb file another sua saved, see what
 * importing it will do here, then Import.
 */
import type { NotebookImportPlan } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** What importing will do, and the Import button. */
export function renderImportPlan(plan: NotebookImportPlan, key: string): SafeHtml {
  const install = plan.agents.filter((a) => a.action === 'install').map((a) => a.id);
  const same = plan.agents.filter((a) => a.action === 'same').map((a) => a.id);
  const differs = plan.agents.filter((a) => a.action === 'yours-differs');
  const missing = plan.agents.filter((a) => a.action === 'missing-example').map((a) => a.id);
  const toolsIn = plan.tools.filter((t) => t.action === 'install').map((t) => t.id);
  const toolsDiffer = plan.tools.filter((t) => t.action === 'yours-differs').map((t) => t.id);
  const ids = (list: readonly string[]) => list.map((id, i) => html`${i ? ', ' : ''}<span class="mono">${id}</span>`);
  const when = (() => { try { return new Date(plan.from.exportedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); } catch { return plan.from.exportedAt; } })();
  return html`<section class="nb-import__plan card" aria-labelledby="nb-import-plan">
    <h2 id="nb-import-plan" class="nb-import__title">${plan.title}</h2>
    <p class="dim">From ${plan.from.machine}, saved ${when}. ${plural(plan.counts.options, 'option')}, ${plural(plan.counts.notes, 'note')}, ${plural(plan.counts.pictures, 'picture')}.</p>
    <ul class="nb-import__list">
      ${plan.renamed ? html`<li>A notebook with its id is already here, so the copy is <span class="mono">${plan.notebookId}</span>. Its links point to the copy.</li>` : html`<li>It comes in as <span class="mono">${plan.notebookId}</span>.</li>`}
      ${install.length ? html`<li>Adds ${install.length === 1 ? 'the agent' : 'the agents'} ${ids(install)}, which ${install.length === 1 ? 'it runs and isn’t' : 'it runs and aren’t'} here yet.</li>` : html``}
      ${toolsIn.length ? html`<li>Adds ${toolsIn.length === 1 ? 'the tool' : 'the tools'} ${ids(toolsIn)}.</li>` : html``}
      ${same.length ? html`<li>Uses ${ids(same)}, already here as in the copy.</li>` : html``}
      ${differs.length ? html`<li class="nb-import__warn">Keeps your own ${ids(differs.map((a) => a.id))} here, which ${differs.length === 1 ? 'differs' : 'differ'} from the copy's. The notebook runs yours.</li>` : html``}
      ${toolsDiffer.length ? html`<li class="nb-import__warn">Keeps your own ${toolsDiffer.length === 1 ? 'tool' : 'tools'} ${ids(toolsDiffer)}, which ${toolsDiffer.length === 1 ? 'differs' : 'differ'} from the copy's.</li>` : html``}
      ${missing.length ? html`<li class="nb-import__warn">It uses ${ids(missing)}, which ${missing.length === 1 ? 'isn’t' : 'aren’t'} installed here. Install ${missing.length === 1 ? 'it' : 'them'} from the examples before it runs.</li>` : html``}
      ${plan.missingSecrets.length ? html`<li class="nb-import__warn">Its agents need ${plan.missingSecrets.length === 1 ? 'a secret' : 'secrets'} this machine doesn't have: ${ids(plan.missingSecrets)}. Add ${plan.missingSecrets.length === 1 ? 'it' : 'them'} in <a href="/settings/secrets">Settings → Secrets</a>.</li>` : html``}
      ${plan.scheduleWas ? html`<li>Its schedule is off here, so two machines don't both fill it. Turn it on from the notebook if this machine should.</li>` : html``}
    </ul>
    ${plan.problems.length
      ? html`<div class="flash flash--error"><strong>It can't be imported:</strong> ${plan.problems.join(' ')}</div>`
      : html`<form method="POST" action="/notebooks/import/${key}" class="nb-import__go"><button type="submit" class="btn btn--primary">Import</button> <a href="/notebooks/import" class="btn btn--ghost">Choose another file</a></form>`}
  </section>`;
}

export function renderNotebookImport(opts: { flash?: { kind: 'error' | 'ok' | 'info'; message: string } } = {}): string {
  return render(layout({ title: 'Import a notebook', activeNav: 'notebooks', flash: opts.flash }, html`
    <div class="nb-import">
      <p class="nb-crumbs"><a href="/">Home</a> › <a href="/notebooks">Answers</a> › Import</p>
      <h1 class="nbd__title">Import a notebook</h1>
      <p class="dim">A notebook file (<span class="mono">.suanb</span>) is a copy of a notebook from another sua: Download / share → Notebook file on that machine. It brings its options, facts, pictures, write-up and steps, and the agents and tools of yours it runs. Once imported it's its own notebook here.</p>
      <label class="form-field">
        <span class="form-field__label">The notebook file</span>
        <input type="file" accept=".suanb,application/gzip" class="form-field__input" data-nb-import-file>
      </label>
      <div data-nb-import-status class="nb-import__status" aria-live="polite"></div>
      <div data-nb-import-plan></div>
    </div>
    ${unsafeHtml(IMPORT_JS)}
  `));
}

const IMPORT_JS = `<script>
(function () {
  var input = document.querySelector('[data-nb-import-file]');
  var status = document.querySelector('[data-nb-import-status]');
  var out = document.querySelector('[data-nb-import-plan]');
  if (!input) return;
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  input.addEventListener('change', function () {
    var f = input.files && input.files[0];
    out.innerHTML = '';
    if (!f) { status.innerHTML = ''; return; }
    status.innerHTML = window.suaWorking ? window.suaWorking({ text: 'Reading ' + f.name + '\\u2026' }) : 'Reading\\u2026';
    fetch('/notebooks/import/check', { method: 'POST', headers: { 'Content-Type': 'application/gzip' }, body: f })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        status.innerHTML = '';
        if (!d.ok) { out.innerHTML = '<div class="flash flash--error">' + esc(d.error) + '</div>'; return; }
        out.innerHTML = d.html;
      })
      .catch(function () { status.innerHTML = ''; out.innerHTML = '<div class="flash flash--error">Lost touch with the dashboard.</div>'; });
  });
})();
</script>`;
