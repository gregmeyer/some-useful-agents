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
          <span class="inbox-modal__panelbar-title">Inbox</span>
          <a class="inbox-modal__panelbar-btn" href="/inbox" data-panel-inbox aria-label="Open in the inbox" title="Open in the inbox">↗</a>
          <button type="button" class="inbox-modal__panelbar-btn" data-panel-wide aria-label="Widen" title="Widen">⤢</button>
          <button type="button" class="inbox-modal__panelbar-btn" data-panel-min aria-label="Minimize" title="Minimize">–</button>
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
      <span class="sua-panel-pill__dot" aria-hidden="true"></span>
      <span data-panel-pill-text>Conversation</span>
    </button>
  `;
}
