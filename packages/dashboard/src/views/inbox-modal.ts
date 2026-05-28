import { html, type SafeHtml } from './html.js';

/**
 * The modal shell lives once on /inbox and stays empty until JS opens
 * it. inbox-modal.js.ts fetches `/inbox/:id/fragment` into the inner
 * container, intercepts the Reply / Dismiss form submits, and polls
 * for triage-agent updates while the conversation is alive.
 *
 * The `<a href="/inbox/:id">` row link still works as a fallback
 * (right-click "open in new tab", users with JS disabled) — JS
 * progressively enhances the click to an in-page modal.
 */
export function renderInboxModalShell(): SafeHtml {
  return html`
    <div class="modal-backdrop" id="inbox-modal" role="dialog" aria-modal="true" aria-labelledby="inbox-modal-title" hidden>
      <div class="modal" style="max-width: 44rem; max-height: 88vh; overflow-y: auto;">
        <div id="inbox-modal-content">
          <p class="dim" style="margin: 0; padding: var(--space-4) 0; text-align: center;">Loading…</p>
        </div>
        <div class="modal__actions" style="justify-content: flex-end; margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--color-border);">
          <button type="button" class="btn btn--ghost" data-inbox-modal-close>Close</button>
        </div>
      </div>
    </div>
  `;
}
