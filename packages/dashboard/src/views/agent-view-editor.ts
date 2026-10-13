import { suaComponentDocs, type Agent } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { formatAge } from './components.js';
import { viewToYaml } from '../lib/view-editor.js';

/**
 * The View editor page (/agents/:name/view): the view as YAML on the left,
 * checked and drawn with the last run's data on the right as you type
 * (views/view-editor.js.ts), saved as a new version. docs/a2ui-views.md.
 */
export interface RenderViewEditorArgs {
  agent: Agent;
  /** The text in the editor: the agent's view, or a starter from its outputs. */
  text: string;
  /** The starter view as YAML, for "Start from its outputs". */
  starterText: string;
  preview: SafeHtml;
  errors: string[];
  paths: Array<{ path: string; example: string }>;
  /** When the preview's run finished (none = no completed run yet). */
  sampleAt?: string;
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
}

export function renderViewEditorPage(args: RenderViewEditorArgs): string {
  const { agent } = args;
  const id = encodeURIComponent(agent.id);
  const view = agent.view;
  const status = !view
    ? (agent.outputWidget
      ? 'It shows runs with its output widget now. Saving a view replaces that on the run page, board tiles, the inbox and chat (the widget stays in its YAML, unused).'
      : 'It has no view yet, so runs show as text. This starter is built from what its last run output.')
    : 'from' in view
      ? `Its view is written by its "${view.from}" step on each run. Saving here replaces that with this fixed view.`
      : `This is its view, from v${String(agent.version)}.`;
  const nextVersion = String(agent.version + 1);
  const docs = suaComponentDocs();

  const body = html`
    ${pageHeader({
      title: 'View',
      meta: [html`<span class="dim mono">${agent.id}</span>`],
      description: 'How this agent\'s runs look: on its run page, on board tiles, in the inbox and in chat.',
      cta: html`<a class="btn btn--ghost btn--sm" href="/agents/${id}/config">Done</a>`,
      back: { href: `/agents/${id}/config`, label: 'Back to Settings' },
    })}
    <p class="view-editor__status">${status}</p>
    <div class="view-editor" data-view-editor="${agent.id}">
      <div class="view-editor__left">
      <form method="POST" action="/agents/${id}/view" class="view-editor__edit">
        <label class="section-label" for="view-text">Components (YAML)</label>
        <textarea id="view-text" name="text" class="form-field mono view-editor__text" rows="18" spellcheck="false" wrap="off" data-view-text>${args.text}</textarea>
        <ul class="view-editor__errors" data-view-errors aria-live="polite" ${args.errors.length ? unsafeHtml('') : unsafeHtml('hidden')}>
          ${args.errors.map((e) => html`<li>${e}</li>`) as unknown as SafeHtml[]}
        </ul>
        <input type="hidden" name="baseVersion" value="${String(agent.version)}">
        <div class="view-editor__actions">
          <button type="submit" class="btn btn--primary btn--sm" data-view-save>Save as v${nextVersion}</button>
          <button type="button" class="btn btn--ghost btn--sm" data-view-starter>Start from its outputs</button>
          <script type="application/json" data-view-starter-text>${unsafeHtml(JSON.stringify(args.starterText).replace(/</g, '\\u003c'))}</script>
        </div>
      </form>
      ${view ? html`<form method="POST" action="/agents/${id}/view/remove" class="view-editor__remove"
        data-confirm-modal="Runs go back to ${agent.outputWidget ? 'its output widget' : 'plain text'}. This saves v${nextVersion}; roll back from Versions to undo."
        data-confirm-label="Remove view" data-confirm-title="Remove the view?">
        <input type="hidden" name="baseVersion" value="${String(agent.version)}">
        <button type="submit" class="btn btn--ghost btn--sm">Remove view</button>
      </form>` : html``}
      </div>
      <section class="view-editor__preview" aria-label="Preview">
        <div class="view-editor__preview-head">
          <span class="section-label">Preview</span>
          <span class="dim view-editor__note">${args.sampleAt ? `with its last run (${formatAge(args.sampleAt)})` : 'no run yet'}</span>
        </div>
        <div class="view-editor__surface" data-view-preview>${args.preview}</div>
      </section>
    </div>
    <div class="view-editor__ref">
      <details open>
        <summary class="section-label">What it can bind to</summary>
        <table class="view-editor__paths">
          <thead><tr><th>Path</th><th>From its last run</th></tr></thead>
          <tbody>${args.paths.map((p) => html`<tr><td class="mono">${p.path}</td><td class="dim">${p.example}</td></tr>`) as unknown as SafeHtml[]}</tbody>
        </table>
        <p class="dim view-editor__note">Bind a prop as <code>{ path: /outputs/name }</code>. A <code>Button</code> with <code>action: { event: { name: run-agent } }</code> runs this agent.</p>
      </details>
      <details>
        <summary class="section-label">sua components</summary>
        <dl class="view-editor__docs">
          ${docs.map((d) => html`<dt class="mono">${d.name}</dt><dd>${d.summary}<code class="view-editor__example">${viewToYaml([d.example as never]).trim()}</code></dd>`) as unknown as SafeHtml[]}
        </dl>
        <p class="dim view-editor__note">Plus the A2UI basics: Text, Image, Row, Column, List, Card, Tabs, Divider, Button, TextField, ChoicePicker and more. See <a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/a2ui-views.md">A2UI views</a>.</p>
      </details>
    </div>
  `;
  return render(layout({ title: `View · ${agent.name}`, flash: args.flash, wide: true }, body));
}
