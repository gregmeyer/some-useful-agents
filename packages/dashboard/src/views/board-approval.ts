import { html, type SafeHtml } from './html.js';

/** Approve / Decline for a board build's drafted agents (docs/boards.md § Build a board). */
export function boardApprovalButtons(buildId: string, _returnTo?: string): SafeHtml {
  const base = `/boards/builds/${encodeURIComponent(buildId)}`;
  return html`<div class="board-approval">
    <form method="POST" action="${base}/approve" style="display: inline; margin: 0;">
      <button type="submit" class="btn btn--primary btn--sm">Approve and add to the board</button>
    </form>
    <form method="POST" action="${base}/decline" style="display: inline; margin: 0;" data-confirm-modal="Delete the drafted agents? Nothing has run yet." data-confirm-label="Decline" data-confirm-title="Decline the new agents?">
      <button type="submit" class="btn btn--ghost btn--sm">Decline</button>
    </form>
  </div>`;
}
