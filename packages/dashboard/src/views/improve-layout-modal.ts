/**
 * Shared markup for the "Improve layout" wizard modal on Pulse.
 *
 * Wizard JS is in improve-layout.js.ts and is wired in via layout.ts.
 * Binds to:
 *   - #improve-layout-btn — opens the modal
 *   - #improve-layout-modal — backdrop
 *   - #improve-layout-content — replaceable inner panel for stage swaps
 *   - #improve-layout-pills — pill row populated on open
 *   - #improve-layout-focus — free-form textarea
 *   - #improve-layout-submit — submit button
 *
 * Pulse page renders `improveLayoutButton()` next to the edit toggle
 * and `improveLayoutModal()` once at the bottom of the body.
 */

import { html, type SafeHtml } from './html.js';

export function improveLayoutButton(): SafeHtml {
  return html`<button type="button" class="btn btn--ghost btn--sm" id="improve-layout-btn">✨ Improve layout</button>`;
}

export function improveLayoutModal(): SafeHtml {
  return html`
    <div id="improve-layout-modal" class="modal-backdrop">
      <div class="modal" style="max-width: 640px; max-height: 85vh; overflow-y: auto;">
        <div id="improve-layout-content">
          <h3 style="margin: 0 0 var(--space-3);">Improve layout</h3>
          <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3);">
            Pick a suggestion or describe your own focus. The planner ranks your agents, groups them into containers, and asks clarifying questions before anything is applied.
          </p>

          <div style="margin-bottom: var(--space-3);">
            <div style="font-size: var(--font-size-xs); color: var(--color-text-muted); margin-bottom: var(--space-2); font-weight: var(--weight-semibold); text-transform: uppercase; letter-spacing: 0.06em;">Suggestions</div>
            <div id="improve-layout-pills" style="display: flex; flex-wrap: wrap; gap: var(--space-2);">
              <span class="dim" style="font-size: var(--font-size-xs);" id="improve-layout-pills-loading">Loading suggestions...</span>
            </div>
          </div>

          <label style="display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-4);">
            <strong style="font-size: var(--font-size-sm);">Focus <span class="dim" style="font-weight: var(--weight-regular);">(optional)</span></strong>
            <textarea id="improve-layout-focus" rows="3" placeholder="e.g. group by topic, surface my failing agents, pin the daily-run ones"
              style="padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-sm); resize: vertical;"></textarea>
          </label>

          <div style="display: flex; gap: var(--space-2); justify-content: flex-end;">
            <button type="button" class="btn btn--ghost btn--sm" data-close-improve-layout="1">Cancel</button>
            <button type="button" class="btn btn--primary btn--sm" id="improve-layout-submit">Plan layout</button>
          </div>
        </div>
      </div>
    </div>
  `;
}
