/**
 * Mission Control home (`/`) — the unified front door, ordered by attention:
 *  1. "Needs you"   — the inbox's awaiting-user threads (count + preview + CTA)
 *  2. "Live Pulse"  — the real Pulse board (system + agent signal tiles),
 *                     reused read-only via renderPulseBoard({ editable: false })
 *  3. "Recent activity" — the run feed, collapsed by default
 *
 * This replaces the old system-stat-only home (a strict subset of Pulse) so the
 * two surfaces no longer duplicate, and surfaces the inbox — the most powerful
 * surface — at the top of the front door.
 */

import type { InboxMessage } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { renderPulseBoard } from './pulse.js';
import type { PulsePageInput } from './pulse-types.js';
import { buildRecentActivity, renderHomeWidget, type HomeWidgetData } from './home-widgets.js';
import { buildFromGoalButton, buildFromGoalModal } from './build-from-goal-modal.js';
import { formatAge } from './components.js';

export interface HomePageInput {
  /** Live Pulse board data (from buildPulseBoardData). */
  board: PulsePageInput;
  /** Inbox "Needs you": count + a small preview of awaiting-user threads. */
  needsYou: { count: number; top: InboxMessage[] };
  /** Recent-activity feed data (reused HomeWidgetData subset). */
  activity: HomeWidgetData;
  agentCount: number;
  availableDashboards?: Array<{ id: string; name: string }>;
  flash?: { kind: 'ok' | 'error' | 'info'; message: string };
}

const PRIORITY_DOT: Record<string, string> = {
  high: 'inbox-modal__priority--high',
  medium: 'inbox-modal__priority--medium',
  low: 'inbox-modal__priority--low',
};

function needsYouCard(m: InboxMessage): SafeHtml {
  return html`
    <a class="home-needs__card" href="/inbox/${m.id}">
      <span class="inbox-modal__priority ${PRIORITY_DOT[m.priority] ?? ''}" aria-hidden="true"></span>
      <span class="home-needs__title">${m.title}</span>
      <span class="home-needs__meta">
        ${m.agentId ? html`<span class="mono">${m.agentId}</span> · ` : html``}${formatAge(new Date(m.createdAt).toISOString())}
      </span>
    </a>
  `;
}

function needsYouStrip(needsYou: HomePageInput['needsYou']): SafeHtml {
  if (needsYou.count === 0) {
    return html`
      <section class="home-needs home-needs--clear">
        <span class="home-needs__clear">✓ Inbox clear — nothing needs your reply.</span>
        <a class="home-needs__open" href="/inbox">Open inbox →</a>
      </section>
    `;
  }
  return html`
    <section class="home-needs">
      <div class="home-needs__head">
        <h2 class="home-needs__heading">Needs you <span class="badge badge--warn">${String(needsYou.count)}</span></h2>
        <a class="home-needs__open" href="/inbox">Open inbox →</a>
      </div>
      <div class="home-needs__cards">
        ${needsYou.top.map(needsYouCard) as unknown as SafeHtml[]}
      </div>
    </section>
  `;
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
      <div style="margin-left: auto; display: flex; gap: var(--space-2);">
        ${buildFromGoalButton({ variant: 'primary' })}
        <a class="btn btn--ghost btn--sm" href="/packs">Browse packs</a>
      </div>
    </div>

    ${needsYouStrip(input.needsYou)}

    ${board}

    <details class="home-activity" style="margin-top: var(--space-6);">
      <summary class="home-activity__summary">Recent activity</summary>
      <div class="home-activity__body" style="margin-top: var(--space-3);">
        ${renderHomeWidget(activityWidget)}
      </div>
    </details>

    ${buildFromGoalModal({ availableDashboards: input.availableDashboards })}
  `;

  return render(layout({ title: 'Home', activeNav: 'home', flash: input.flash }, body));
}
