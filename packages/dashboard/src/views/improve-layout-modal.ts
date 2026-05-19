/**
 * Shared markup for the "Improve layout" wizard modal.
 *
 * Used on Pulse AND on each named dashboard page. The two surfaces
 * differ in: which endpoints to hit, which localStorage key to read/
 * write, and what "Apply" means (Pulse flips pulseVisible; dashboards
 * rewrite section.agentIds).
 *
 * The differences are passed via `ImproveLayoutConfig`, serialised to
 * data-* attributes on the modal element. The shared JS in
 * `improve-layout.js.ts` reads them at open time.
 *
 * Wizard JS binds to:
 *   - #improve-layout-btn — opens the modal
 *   - #improve-layout-modal — backdrop (carries the data-* config)
 *   - #improve-layout-content — replaceable inner panel for stage swaps
 *   - #improve-layout-pills — pill row populated on open
 *   - #improve-layout-focus — free-form textarea
 *   - #improve-layout-submit — submit button
 */

import { html, unsafeHtml, type SafeHtml } from './html.js';

/**
 * Surface-specific configuration the modal JS needs at open time.
 * Serialised onto data-attributes of the modal backdrop element.
 */
export interface ImproveLayoutConfig {
  /** Endpoint base, e.g. "/pulse/layout-plan" or "/dashboards/<id>/layout-plan". */
  endpointBase: string;
  /** localStorage key, e.g. "sua-pulse-layout" or "sua-dashboard-layout-<id>". */
  storageKey: string;
  /**
   * Verb shown to the user in the "Will N agents" details on the proposed
   * plan ("hide" for Pulse, "remove" for named dashboards). The matching
   * past-tense / restoration UX copy is wired up in the JS based on this.
   */
  curateVerb: 'hide' | 'remove';
}

/** Default config — Pulse. Keeps the existing caller signature working. */
const PULSE_CONFIG: ImproveLayoutConfig = {
  endpointBase: '/pulse/layout-plan',
  storageKey: 'sua-pulse-layout',
  curateVerb: 'hide',
};

export function improveLayoutButton(): SafeHtml {
  return html`<button type="button" class="btn btn--ghost btn--sm" id="improve-layout-btn">✨ Improve layout</button>`;
}

export function improveLayoutModal(config: ImproveLayoutConfig = PULSE_CONFIG): SafeHtml {
  // Data attributes are HTML-escaped by the html`` tag.
  const attrs = unsafeHtml(
    ` data-endpoint-base="${escapeAttr(config.endpointBase)}"`
    + ` data-storage-key="${escapeAttr(config.storageKey)}"`
    + ` data-curate-verb="${escapeAttr(config.curateVerb)}"`,
  );
  const verbNoun = config.curateVerb === 'remove' ? 'remove from this dashboard' : 'hide from Pulse';
  return html`
    <div id="improve-layout-modal" class="modal-backdrop"${attrs}>
      <div class="modal" style="max-width: 640px; max-height: 85vh; overflow-y: auto;">
        <div id="improve-layout-content">
          <h3 style="margin: 0 0 var(--space-3);">Improve layout</h3>
          <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3);">
            Pick a suggestion or describe your own focus. The planner ranks your agents, groups them into containers, and asks clarifying questions before anything is applied. Agents not chosen will ${unsafeHtml(verbNoun)}.
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

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
