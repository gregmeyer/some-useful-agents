/**
 * Mission Control home (`/`) — the unified dashboard front door:
 *  - an inbox lead-in: what needs you now + what sua closed on its own
 *  - a primary "Ask sua" CTA that opens a fresh inbox thread
 *  - the live Pulse board (system + agent signal tiles, fully editable)
 *  - a collapsed "Recent activity" run feed
 *
 * The inbox leads the home body (C2): a "needs you" strip pulls attention to
 * threads awaiting a reply, and a "loop ticker" shows threads sua resolved
 * autonomously — the trust-building counterpart (the system closing loops,
 * not just asking). Both stay live via the global inbox SSE stream. The
 * top-bar toast (layout.ts + inbox-badge.js) remains as the always-visible
 * cross-page cue; this surfaces the actual threads.
 */

import { html, render, type SafeHtml } from './html.js';
import type { InboxMessage } from '@some-useful-agents/core';
import { layout } from './layout.js';
import { renderPulseBoard } from './pulse.js';
import type { PulsePageInput } from './pulse-types.js';
import { buildRecentActivity, renderHomeWidget, type HomeWidgetData } from './home-widgets.js';
import { buildFromGoalButton, buildFromGoalModal } from './build-from-goal-modal.js';
import { renderInboxModalShell } from './inbox-modal.js';
import { formatAge } from './components.js';

export interface HomePageInput {
  /** Live Pulse board data (from buildPulseBoardData). */
  board: PulsePageInput;
  /** Recent-activity feed data (reused HomeWidgetData subset). */
  activity: HomeWidgetData;
  agentCount: number;
  availableDashboards?: Array<{ id: string; name: string }>;
  flash?: { kind: 'ok' | 'error' | 'info'; message: string };
  /** Threads awaiting an operator reply (listNeedsYou). Drives the amber strip. */
  needsYou?: InboxMessage[];
  /** Threads sua resolved autonomously (listRecentlyResolved). Drives the teal ticker. */
  recentlyResolved?: InboxMessage[];
}

/**
 * The inbox lead-in strips (needs-you + loop ticker), wrapped in a single
 * container the live-refresh client swaps on an `inbox:changed` event. Shared
 * by the home page and the `GET /inbox/home-strips` fragment endpoint so the
 * two never drift. Renders nothing (an empty container) when both lists are
 * empty — the container must persist so the client has a swap target.
 */
export function renderHomeInboxStrips(
  needsYou: InboxMessage[] = [],
  recentlyResolved: InboxMessage[] = [],
): SafeHtml {
  const needsYouBlock = needsYou.length > 0
    ? html`
      <section class="home-needs" aria-label="Needs you">
        <div class="home-needs__head">
          <span class="home-needs__dot" aria-hidden="true"></span>
          <span class="home-needs__title">Needs you</span>
          <span class="home-needs__count">${String(needsYou.length)}</span>
          <a class="home-needs__all" href="/inbox">Open inbox →</a>
        </div>
        <div class="home-needs__items">
          ${needsYou.map((m) => html`
            <a class="home-needs__item" href="/inbox/${m.id}" data-inbox-rail-id="${m.id}">
              <span class="home-needs__item-title">${m.title}</span>
              <span class="home-needs__item-age">${formatAge(new Date(m.lastActivityAt ?? m.createdAt).toISOString())}</span>
            </a>
          `) as unknown as SafeHtml[]}
        </div>
      </section>
    `
    : html``;

  const loopBlock = recentlyResolved.length > 0
    ? html`
      <section class="home-loop" aria-label="Recently closed by sua">
        <div class="home-loop__head">
          <span class="home-loop__title">sua closed these</span>
        </div>
        <div class="home-loop__items">
          ${recentlyResolved.map((m) => html`
            <a class="home-loop__item" href="/inbox/${m.id}" data-inbox-rail-id="${m.id}">
              <span class="home-loop__check" aria-hidden="true">✓</span>
              <span class="home-loop__item-title">${m.title}</span>
              <span class="home-loop__item-age">${formatAge(new Date(m.resolvedAt ?? m.createdAt).toISOString())}</span>
            </a>
          `) as unknown as SafeHtml[]}
        </div>
      </section>
    `
    : html``;

  return html`<div class="home-inbox" data-home-inbox>${needsYouBlock}${loopBlock}</div>`;
}

export function renderHomePage(input: HomePageInput): string {
  const liveHeading = html`<h2 class="section-label" style="margin: 0;">Live Pulse</h2>`;

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
      <span class="dim" style="font-size: var(--font-size-sm);">
        ${String(input.agentCount)} agent${input.agentCount !== 1 ? 's' : ''} registered
      </span>
      ${input.agentCount === 0 ? html`` : html`
        <form method="POST" action="/inbox/new" style="margin: 0 0 0 auto;">
          <button type="submit" class="btn btn--primary btn--sm" title="Start a new inbox thread — ask sua to run, build, fix, or look something up">Ask sua →</button>
        </form>
      `}
    </div>

    ${input.agentCount === 0 ? html`` : renderHomeInboxStrips(input.needsYou, input.recentlyResolved)}

    ${board}

    <details class="home-activity" style="margin-top: var(--space-6);">
      <summary class="home-activity__summary">Recent activity</summary>
      <div class="home-activity__body" style="margin-top: var(--space-3);">
        ${renderHomeWidget(activityWidget)}
      </div>
    </details>

    ${input.agentCount === 0 ? buildFromGoalModal({ availableDashboards: input.availableDashboards }) : html``}

    ${input.agentCount === 0 ? html`` : renderInboxModalShell()}
  `;

  return render(layout({ title: 'Home', activeNav: 'home', flash: input.flash }, body));
}
