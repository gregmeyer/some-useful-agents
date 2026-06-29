/**
 * Mission Control home (`/`) — the unified dashboard front door:
 *  - a primary "Ask sua" CTA that opens a fresh inbox thread
 *  - the live Pulse board (system + agent signal tiles, fully editable)
 *  - a collapsed "Recent activity" run feed
 *
 * The "needs you" inbox signal lives globally in the top-bar toast (see
 * layout.ts + inbox-badge.js), not in a vertical strip here — so the home
 * leads straight into the board.
 */

import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { renderPulseBoard } from './pulse.js';
import type { PulsePageInput } from './pulse-types.js';
import { buildRecentActivity, renderHomeWidget, type HomeWidgetData } from './home-widgets.js';
import { buildFromGoalButton, buildFromGoalModal } from './build-from-goal-modal.js';

export interface HomePageInput {
  /** Live Pulse board data (from buildPulseBoardData). */
  board: PulsePageInput;
  /** Recent-activity feed data (reused HomeWidgetData subset). */
  activity: HomeWidgetData;
  agentCount: number;
  availableDashboards?: Array<{ id: string; name: string }>;
  flash?: { kind: 'ok' | 'error' | 'info'; message: string };
}

export function renderHomePage(input: HomePageInput): string {
  const liveHeading = html`<h2 style="margin: 0;">Live Pulse</h2>`;

  const board = input.agentCount === 0
    ? html`
      <div class="settings-empty" style="margin-top: var(--space-4);">
        <h3 style="margin-top: 0;">No agents yet</h3>
        <p class="dim">An agent is a named task sua can run — a shell command, an LLM prompt, or a chain of both. Describe what you want and let sua build it, or follow the guided tour.</p>
        <p style="display: flex; gap: var(--space-3); justify-content: center; margin: 0;">
          ${buildFromGoalButton({ variant: 'primary' })}
          <a class="btn" href="/help/tutorial">Open tutorial</a>
        </p>
      </div>
    `
    : renderPulseBoard(input.board, { heading: liveHeading });

  const activityWidget = buildRecentActivity(input.activity);

  const body = html`
    <div style="display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-6);">
      <h1 style="margin: 0;">Home</h1>
      <span style="font-size: var(--font-size-sm); color: var(--color-text-muted);">
        ${String(input.agentCount)} agent${input.agentCount !== 1 ? 's' : ''} registered
      </span>
      ${input.agentCount === 0 ? html`` : html`
        <form method="POST" action="/inbox/new" style="margin: 0 0 0 auto;">
          <button type="submit" class="btn btn--primary btn--sm" title="Start a new inbox thread — ask sua to run, build, fix, or look something up">Ask sua →</button>
        </form>
      `}
    </div>

    ${board}

    <details class="home-activity" style="margin-top: var(--space-6);">
      <summary class="home-activity__summary">Recent activity</summary>
      <div class="home-activity__body" style="margin-top: var(--space-3);">
        ${renderHomeWidget(activityWidget)}
      </div>
    </details>

    ${input.agentCount === 0 ? buildFromGoalModal({ availableDashboards: input.availableDashboards }) : html``}
  `;

  return render(layout({ title: 'Home', activeNav: 'home', flash: input.flash }, body));
}
