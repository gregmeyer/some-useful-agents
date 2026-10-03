import { html, type SafeHtml } from './html.js';

/**
 * The modal shell lives once on /inbox and stays empty until the
 * inbox-modal.js bundle opens it. Click a row → fetch the fragment
 * → inject into `#inbox-modal-content` → reveal.
 *
 * The full-page `/inbox/:id` route still works as a fallback for
 * right-click "open in new tab" and no-JS users.
 *
 * The same shell is the conversation panel: Ask sua and Cmd-K open it docked
 * to the side (`data-panel` on the backdrop), and it follows you between
 * pages. The panel bar and the minimized pill only show in that mode.
 */
export function renderInboxModalShell(): SafeHtml {
  return html`
    <div class="modal-backdrop" id="inbox-modal" role="dialog" aria-modal="true" aria-labelledby="inbox-modal-title" hidden>
      <div class="modal inbox-modal">
        ${/* Conversation panel controls (shown only when the modal is docked as the panel). */ ''}
        <div class="inbox-modal__panelbar">
          <span class="inbox-modal__panelbar-title">Conversation</span>
          <button type="button" class="btn btn--xs btn--ghost" data-panel-new>New</button>
          <a class="inbox-modal__panelbar-btn" href="/inbox" data-panel-inbox aria-label="Open in the inbox" title="Open in the inbox">↗</a>
          <button type="button" class="inbox-modal__panelbar-btn" data-panel-wide aria-label="Widen" title="Widen">⤢</button>
          <button type="button" class="inbox-modal__panelbar-btn" data-panel-min aria-label="Minimize" title="Minimize">–</button>
        </div>
        <button type="button" class="inbox-modal__close" data-inbox-modal-close aria-label="Close">×</button>
        <div id="inbox-modal-content" style="flex: 1; overflow-y: auto; min-height: 0;">
          <p class="dim" style="margin: 0; padding: var(--space-4) 0; text-align: center;">Loading…</p>
        </div>
      </div>
    </div>
    <button type="button" class="sua-panel-pill" data-panel-restore hidden>
      <span class="sua-panel-pill__dot" aria-hidden="true"></span>
      <span data-panel-pill-text>Conversation</span>
    </button>
  `;
}
