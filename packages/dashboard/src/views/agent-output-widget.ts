import type { Agent } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { renderOutputWidgetEditor } from './agent-detail-helpers.js';

/**
 * Output Widget editor on its own page (rather than inline on the
 * agent Config tab). The editor renders unchanged — the page just
 * adds a tab strip that filters which sections are visible. CSS
 * targets the editor's existing element IDs so no editor changes
 * are required beyond adding `id="ow-preview-card"` to the preview
 * pane.
 *
 * Tabs:
 *   Type        — widget-type cards + helper paragraph
 *   Fields      — field table OR ai-template block (the editor's JS
 *                 picks which based on selected type)
 *   Interactive — run-in-place toggle + run inputs + label fields
 *   Preview     — the live preview pane (`#ow-preview-card`)
 *
 * Save / Remove buttons live in the editor's action bar, which is
 * always visible (no `data-section` attribute → not hidden by tab CSS).
 */
export type OutputWidgetTab = 'type' | 'fields' | 'interactive' | 'preview';

export interface RenderOutputWidgetPageArgs {
  agent: Agent;
  /** Active sub-tab; falls back to 'type'. Driven by `?tab=...` query param. */
  activeTab?: OutputWidgetTab;
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
}

const TABS: Array<{ id: OutputWidgetTab; label: string }> = [
  { id: 'type', label: 'Type' },
  { id: 'fields', label: 'Fields' },
  { id: 'interactive', label: 'Interactive' },
  { id: 'preview', label: 'Preview' },
];

export function renderOutputWidgetPage(args: RenderOutputWidgetPageArgs): string {
  const { agent, flash } = args;
  const active: OutputWidgetTab = args.activeTab ?? 'type';

  const tabStrip = html`
    <nav class="ow-tab-strip" role="tablist" aria-label="Output Widget editor">
      ${TABS.map((t) => html`
        <a href="?tab=${t.id}" class="${t.id === active ? 'is-active' : ''}" role="tab" aria-selected="${t.id === active ? 'true' : 'false'}" data-tab="${t.id}">${t.label}</a>
      `) as unknown as SafeHtml[]}
    </nav>
  `;

  const body = html`
    ${pageHeader({
      title: 'Output Widget',
      meta: [html`<span class="dim mono">${agent.id}</span>`],
      cta: html`<a class="btn btn--ghost btn--sm" href="/agents/${agent.id}/config">Done</a>`,
      back: { href: `/agents/${agent.id}/config`, label: 'Back to Config' },
    })}

    <div class="ow-page" data-active-tab="${active}">
      ${tabStrip}
      <div class="ow-page__body">
        ${renderOutputWidgetEditor(agent)}
      </div>
    </div>

    ${unsafeHtml(`<script>
    (function () {
      // Client-side tab switch: clicking a tab updates data-active-tab
      // and the URL hash without a full reload, so the editor's form
      // state survives. Falls back to the href on no-JS.
      var page = document.querySelector('.ow-page');
      if (!page) return;
      var tabs = page.querySelectorAll('.ow-tab-strip a[data-tab]');
      function activate(id) {
        page.setAttribute('data-active-tab', id);
        for (var i = 0; i < tabs.length; i++) {
          var t = tabs[i];
          var on = t.getAttribute('data-tab') === id;
          t.classList.toggle('is-active', on);
          t.setAttribute('aria-selected', on ? 'true' : 'false');
        }
        try { history.replaceState(null, '', '?tab=' + encodeURIComponent(id)); } catch (e) { /* ignore */ }
      }
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].addEventListener('click', function (e) {
          e.preventDefault();
          activate(this.getAttribute('data-tab'));
        });
      }
    })();
    </script>`)}
  `;

  return render(layout({ title: `Output Widget · ${agent.id}`, activeNav: 'agents', flash }, body));
}
