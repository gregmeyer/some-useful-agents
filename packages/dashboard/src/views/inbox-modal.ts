import { html, type SafeHtml } from './html.js';

/**
 * The modal shell lives once on /inbox and stays empty until the
 * inbox-modal.js bundle opens it. Click a row → fetch the fragment
 * → inject into `#inbox-modal-content` → reveal.
 *
 * The full-page `/inbox/:id` route still works as a fallback for
 * right-click "open in new tab" and no-JS users.
 */
export function renderInboxModalShell(): SafeHtml {
  return html`
    <div class="modal-backdrop" id="inbox-modal" role="dialog" aria-modal="true" aria-labelledby="inbox-modal-title" hidden>
      <div class="modal" style="max-width: 44rem; max-height: 88vh; display: flex; flex-direction: column;">
        <div id="inbox-modal-content" style="flex: 1; overflow-y: auto; min-height: 0;">
          <p class="dim" style="margin: 0; padding: var(--space-4) 0; text-align: center;">Loading…</p>
        </div>
        <div class="modal__actions" style="justify-content: flex-end; margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--color-border); flex-shrink: 0;">
          <button type="button" class="btn btn--ghost" data-inbox-modal-close>Close</button>
        </div>
      </div>
    </div>
  `;
}
