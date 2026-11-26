import { html, type SafeHtml } from './html.js';

/**
 * The inbox's thread view, on every page (layout.ts). It shows as:
 *   - the conversation panel beside a page (`data-panel` docked | wide | min
 *     on the backdrop): Ask sua, the top-bar button and Cmd-K open it, and it
 *     follows you between pages; the list and a thread take turns in it.
 *   - Home (`/`, `/inbox`, `/inbox/:id`, `data-panel="page"`): moved into the
 *     page, with the list and the thread side by side.
 * inbox-modal.js.ts drives both; the panel bar and the pill only show beside a page.
 */
export function renderInboxModalShell(): SafeHtml {
  return html`
    <div class="modal-backdrop" id="inbox-modal" role="dialog" aria-modal="true" aria-labelledby="inbox-modal-title" hidden>
      <div class="modal inbox-modal">
        ${/* Conversation panel controls (shown only when the modal is docked as the panel). */ ''}
        <div class="inbox-modal__panelbar">
          <button type="button" class="inbox-modal__panelbar-back" data-panel-back>← Inbox</button>
          <span class="inbox-modal__panelbar-title" data-panel-title>Inbox</span>
          <button type="button" class="inbox-modal__panelbar-btn inbox-modal__panelbar-btn--new" data-panel-new aria-label="New conversation" title="New conversation">+</button>
          ${/* The rest of the panel's controls, one click away (the inbox cleanup): widen, minimize, refresh, the full inbox. */ ''}
          <details class="inbox-modal__panelbar-more" data-panelbar-more>
            <summary class="inbox-modal__panelbar-btn" aria-label="More" title="More">⋯</summary>
            <div class="inbox-modal__panelbar-menu" role="menu">
              <button type="button" class="inbox-modal__panelbar-item" role="menuitem" data-panel-wide>Widen</button>
              <button type="button" class="inbox-modal__panelbar-item" role="menuitem" data-panel-min>Minimize</button>
              <button type="button" class="inbox-modal__panelbar-item" role="menuitem" data-panel-refresh>Refresh</button>
              <a class="inbox-modal__panelbar-item" role="menuitem" href="/inbox">Open full inbox</a>
            </div>
          </details>
        </div>
        <button type="button" class="inbox-modal__close" data-inbox-modal-close aria-label="Close">×</button>
        <div class="inbox-modal__panes">
          ${/* The inbox list; beside the thread on Home, in place of it in the panel. */ ''}
          <div class="inbox-modal__list" id="inbox-modal-list"></div>
          <div id="inbox-modal-content">
            <p class="dim" style="margin: 0; padding: var(--space-4) 0; text-align: center;">Loading…</p>
          </div>
        </div>
      </div>
    </div>
    <button type="button" class="sua-panel-pill" data-panel-restore hidden>
      <span class="sua-panel-pill__avatar" aria-hidden="true">s</span>
      <span data-panel-pill-text>Conversation</span>
      <span class="sua-panel-pill__dot" aria-hidden="true"></span>
    </button>
  `;
}
