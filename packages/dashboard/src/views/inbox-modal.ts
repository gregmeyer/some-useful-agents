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
          <button type="button" class="inbox-modal__panelbar-btn" data-panel-wide aria-label="Widen" title="Widen"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"></path></svg></button>
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
      <span class="sua-panel-pill__avatar" aria-hidden="true">s</span>
      <span data-panel-pill-text>Conversation</span>
      <span class="sua-panel-pill__dot" aria-hidden="true"></span>
    </button>
  `;
}
