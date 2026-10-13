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
  /** sua's redesign, when one was asked for (lib/view-designer.ts); a ready one carries both previews. */
  proposal?: {
    status: 'working' | 'ready' | 'failed';
    request: string;
    at: string;
    why?: string;
    error?: string;
    text?: string;
    preview?: SafeHtml;
    currentPreview?: SafeHtml;
  };
  /** Opened from a tile's Redesign: put the cursor in the request field. */
  redesignFocus?: boolean;
}

/** Ask sua for a redesign: an optional request and a button. */
function redesignForm(id: string, label: string, request = '', focus = false): SafeHtml {
  return html`<form method="POST" action="/agents/${id}/view/redesign" class="view-redesign__ask">
    <input type="text" name="request" class="form-field" value="${request}" maxlength="500" placeholder="What should change? (optional) e.g. lead with the price, show a trend" aria-label="What should change"${focus ? unsafeHtml(' autofocus') : unsafeHtml('')}>
    <button type="submit" class="btn btn--sm">${label}</button>
  </form>`;
}

function redesignSection(args: RenderViewEditorArgs, id: string, nextVersion: string): SafeHtml {
  const p = args.proposal;
  if (!p) {
    return html`<section class="view-redesign" id="redesign" aria-label="Redesign">
      <div class="view-redesign__head"><span class="section-label">Redesign with sua</span>
        <span class="dim view-editor__note">sua proposes a better view from this one, its real data and your brand. Nothing changes until you use it.</span></div>
      ${redesignForm(id, 'Redesign', '', args.redesignFocus)}
    </section>`;
  }
  if (p.status === 'working') {
    return html`<section class="view-redesign" id="redesign" aria-label="Redesign" data-view-proposal-working="${args.agent.id}">
      <p class="view-redesign__working" role="status" aria-live="polite"><span class="view-redesign__dot" aria-hidden="true"></span>
        sua is redesigning this view${p.request ? html`: <q>${p.request}</q>` : html``}. This page updates when it's ready.</p>
    </section>`;
  }
  if (p.status === 'failed') {
    return html`<section class="view-redesign" id="redesign" aria-label="Redesign">
      <p class="view-redesign__failed">sua's redesign didn't work out: ${(p.error ?? 'no reason given').replace(/([^.!?])$/, '$1.')}</p>
      ${redesignForm(id, 'Try again', p.request)}
    </section>`;
  }
  return html`<section class="view-redesign view-redesign--ready" id="redesign" aria-label="sua's proposal">
    <div class="view-redesign__head"><span class="section-label">sua's proposal</span>
      <span class="dim view-editor__note">${p.request ? html`You asked: <q>${p.request}</q> · ` : html``}${formatAge(p.at)}</span></div>
    ${p.why ? html`<p class="view-redesign__why">${p.why}</p>` : html``}
    <div class="view-redesign__compare">
      <div class="view-redesign__side"><span class="section-label">Now</span><div class="view-editor__surface">${p.currentPreview ?? html``}</div></div>
      <div class="view-redesign__side"><span class="section-label">Proposed</span><div class="view-editor__surface">${p.preview ?? html``}</div></div>
    </div>
    <div class="view-editor__actions">
      <form method="POST" action="/agents/${id}/view/proposal/use" class="view-editor__remove">
        <input type="hidden" name="baseVersion" value="${String(args.agent.version)}">
        <button type="submit" class="btn btn--primary btn--sm">Use this (save as v${nextVersion})</button>
      </form>
      <button type="button" class="btn btn--ghost btn--sm" data-view-proposal-edit>Edit it first</button>
      <script type="application/json" data-view-proposal-text>${unsafeHtml(JSON.stringify(p.text ?? '').replace(/</g, '\\u003c'))}</script>
      <form method="POST" action="/agents/${id}/view/proposal/discard" class="view-editor__remove">
        <button type="submit" class="btn btn--ghost btn--sm">Discard</button>
      </form>
    </div>
    <details class="view-redesign__again"><summary class="dim">Ask for something different</summary>${redesignForm(id, 'Try again', p.request)}</details>
  </section>`;
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
    ${redesignSection(args, id, nextVersion)}
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
