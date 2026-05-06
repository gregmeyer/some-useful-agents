/**
 * Shared markup for the "Build from goal" wizard modal.
 *
 * The wizard JS is in build-from-goal.js.ts and is wired in via
 * layout.ts (so it's globally available). It binds to:
 *   - #build-from-goal-btn — opens the modal
 *   - #build-modal         — the modal backdrop
 *   - #build-modal-content — replaceable inner panel for stage swaps
 *
 * Pages that want the wizard render `buildFromGoalButton()` somewhere
 * in their CTA strip and `buildFromGoalModal()` once at the bottom of
 * the page body. Both the home page and the agents list page use this.
 */

import { html, type SafeHtml } from './html.js';

export function buildFromGoalButton(opts: { variant?: 'primary' | 'ghost' } = {}): SafeHtml {
  const cls = opts.variant === 'primary' ? 'btn btn--primary btn--sm' : 'btn btn--sm';
  return html`<button type="button" class="${cls}" id="build-from-goal-btn">Build from goal</button>`;
}

export function buildFromGoalModal(): SafeHtml {
  return html`
    <div id="build-modal" class="modal-backdrop">
      <div class="modal" style="max-width: 600px; max-height: 85vh; overflow-y: auto;">
        <div id="build-modal-content">
          <h3 style="margin: 0 0 var(--space-3);">Build from goal</h3>
          <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3);">
            Describe what you want your agent to do. Claude will design a complete agent with the right nodes, tools, and wiring.
          </p>
          <label style="display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-3);">
            <strong style="font-size: var(--font-size-sm);">Goal</strong>
            <textarea id="build-goal" rows="3" placeholder="e.g. Scrape job listings from ashbyhq, extract key details, and save to a local JSON file"
              style="padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-sm); resize: vertical;"></textarea>
          </label>
          <label style="display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-4);">
            <strong style="font-size: var(--font-size-sm);">Constraints <span class="dim" style="font-weight: var(--weight-regular);">(optional)</span></strong>
            <input id="build-focus" type="text" placeholder="e.g. use shell nodes only, schedule daily at 9am"
              style="padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-sm);">
          </label>
          <div style="display: flex; gap: var(--space-2); justify-content: flex-end;">
            <button type="button" class="btn btn--ghost btn--sm" data-close-build="1">Cancel</button>
            <button type="button" class="btn btn--primary btn--sm" id="build-submit-btn">Build agent</button>
          </div>
        </div>
      </div>
    </div>
  `;
}
