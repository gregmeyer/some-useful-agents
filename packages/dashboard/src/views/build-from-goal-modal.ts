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

import { html, unsafeHtml, type SafeHtml } from './html.js';

export interface BuildFromGoalModalOptions {
  /** User-owned dashboards offered as "Add to existing dashboard" targets. Pack-owned dashboards are intentionally excluded. */
  availableDashboards?: Array<{ id: string; name: string }>;
  /** If set, the existing-dashboard radio is pre-selected and this id is pre-chosen in the dropdown. */
  defaultDashboardId?: string;
}

export function buildFromGoalButton(opts: { variant?: 'primary' | 'ghost' } = {}): SafeHtml {
  const cls = opts.variant === 'primary' ? 'btn btn--primary btn--sm' : 'btn btn--sm';
  return html`<button type="button" class="${cls}" id="build-from-goal-btn">Build from goal</button>`;
}

export function buildFromGoalModal(opts: BuildFromGoalModalOptions = {}): SafeHtml {
  const dashboards = opts.availableDashboards ?? [];
  const defaultId = opts.defaultDashboardId ?? '';
  const preselect = defaultId && dashboards.some((d) => d.id === defaultId) ? 'existing' : 'agents';
  const optionsJson = JSON.stringify(dashboards).replace(/</g, '\\u003c');
  return html`
    <div id="build-modal" class="modal-backdrop">
      <div class="modal" style="max-width: 600px; max-height: 85vh; overflow-y: auto;">
        <div id="build-modal-content">
          <h3 style="margin: 0 0 var(--space-3);">Build from goal</h3>
          <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3);">
            Describe an agent <em>or</em> a dashboard. Claude surveys what's already installed, drafts any missing agents, and assembles the dashboard. Review the plan before anything is created.
          </p>

          <fieldset style="border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3); margin-bottom: var(--space-3);">
            <legend style="font-size: var(--font-size-xs); color: var(--color-text-muted); padding: 0 var(--space-1);">Land where?</legend>
            <label style="display: flex; gap: var(--space-2); align-items: center; font-size: var(--font-size-sm); padding: var(--space-1) 0;">
              <input type="radio" name="build-target" value="agents" ${preselect === 'agents' ? 'checked' : ''}>
              <span>Just create the agent(s)</span>
            </label>
            <label style="display: flex; gap: var(--space-2); align-items: center; font-size: var(--font-size-sm); padding: var(--space-1) 0;">
              <input type="radio" name="build-target" value="new-dashboard">
              <span>Create agent(s) + a new dashboard</span>
            </label>
            <label style="display: flex; gap: var(--space-2); align-items: center; font-size: var(--font-size-sm); padding: var(--space-1) 0;">
              <input type="radio" name="build-target" value="existing" ${preselect === 'existing' ? 'checked' : ''} ${dashboards.length === 0 ? 'disabled' : ''}>
              <span>Add to existing dashboard</span>
              ${dashboards.length === 0
                ? html`<span class="dim" style="font-size: var(--font-size-xs);">(none yet)</span>`
                : html``}
            </label>
            <div id="build-target-dashboard-row" style="display: ${preselect === 'existing' ? 'block' : 'none'}; padding: var(--space-1) 0 var(--space-1) var(--space-6);">
              <select id="build-target-dashboard" class="input" style="width: 100%; font-size: var(--font-size-sm);">
                ${dashboards.map((d) => html`<option value="${d.id}" ${d.id === defaultId ? 'selected' : ''}>${d.name}</option>`) as unknown as SafeHtml[]}
              </select>
            </div>
          </fieldset>

          <label style="display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-3);">
            <strong style="font-size: var(--font-size-sm);">Goal</strong>
            <textarea id="build-goal" rows="3" placeholder="e.g. a daily morning dashboard with HN top stories, today's weather, and my notes folder"
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
      ${unsafeHtml(`<script type="application/json" id="build-target-dashboards">${optionsJson}</script>`)}
    </div>
  `;
}
