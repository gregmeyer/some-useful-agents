/**
 * Mission Control home (`/`) — the inbox-as-front-door surface:
 *  - the inbox leads: a cadence-organized feed of threads (Needs you / Today /
 *    This week / Earlier) + a "sua closed these" ticker
 *  - each row carries a task-2×2 nature tag (scheduled/ad-hoc ·
 *    deterministic/non-deterministic) so you calibrate "act vs read" at a glance
 *  - the radiators (Pulse board, Recent activity) are demoted to collapsed
 *    secondary zones below the feed
 *
 * The whole point is lower cognitive load: the conversation/inbox is the entry
 * point, cadence is the organizer, and rich UI (action cards, widgets, YAML
 * diffs) surfaces inside a thread only when you step in. The feed stays live via
 * the global inbox SSE stream; the top-bar toast remains the cross-page cue.
 */

import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { renderPulseBoard } from './pulse.js';
import type { PulsePageInput } from './pulse-types.js';
import { buildRecentActivity, renderHomeWidget, type HomeWidgetData } from './home-widgets.js';
import { buildFromGoalButton, buildFromGoalModal } from './build-from-goal-modal.js';
import { renderInboxModalShell } from './inbox-modal.js';
import { formatAge } from './components.js';
import type { HomeFeedData, CadenceItem } from '../lib/home-feed.js';

export interface HomePageInput {
  /** Live Pulse board data (from buildPulseBoardData). */
  board: PulsePageInput;
  /** Recent-activity feed data (reused HomeWidgetData subset). */
  activity: HomeWidgetData;
  agentCount: number;
  availableDashboards?: Array<{ id: string; name: string }>;
  flash?: { kind: 'ok' | 'error' | 'info'; message: string };
  /** Cadence-organized inbox feed (buildHomeFeedData). Drives the front door. */
  feed?: HomeFeedData;
}

const EMPTY_FEED: HomeFeedData = { needsYou: [], today: [], week: [], earlier: [], closed: [] };

/**
 * The two task-2×2 nature chips for a cadence row: scheduled/ad-hoc and
 * deterministic/non-deterministic. Tiny, tooltipped, so the operator reads the
 * quadrant at a glance without a legend.
 */
function renderNatureChips(item: CadenceItem): SafeHtml {
  const { scheduled, deterministic } = item.nature;
  const sched = scheduled
    ? html`<span class="home-nature home-nature--sched" title="Scheduled — runs on a clock">⏰</span>`
    : html`<span class="home-nature home-nature--adhoc" title="Ad-hoc — event-driven or on-demand">⚡</span>`;
  const det = deterministic
    ? html`<span class="home-nature home-nature--det" title="Deterministic — predictable pipeline output">⚙</span>`
    : html`<span class="home-nature home-nature--nondet" title="Non-deterministic — an LLM/agent decides; worth a look">🧠</span>`;
  return html`<span class="home-nature-set" aria-hidden="true">${sched}${det}</span>`;
}

/** One cadence row: title + nature chips + age, opens the thread in the modal. */
function renderCadenceItem(item: CadenceItem): SafeHtml {
  const m = item.message;
  return html`
    <a class="home-feed__item" href="/inbox/${m.id}" data-inbox-rail-id="${m.id}">
      <span class="home-feed__item-title">${m.title}</span>
      ${renderNatureChips(item)}
      <span class="home-feed__item-age">${formatAge(new Date(m.lastActivityAt ?? m.createdAt).toISOString())}</span>
    </a>
  `;
}

/** A cadence section (Today / This week), hidden entirely when empty. */
function renderCadenceSection(label: string, items: CadenceItem[]): SafeHtml {
  if (items.length === 0) return html``;
  return html`
    <section class="home-feed__section" aria-label="${label}">
      <div class="home-feed__section-head">${label} <span class="home-feed__section-count">${String(items.length)}</span></div>
      <div class="home-feed__items">
        ${items.map(renderCadenceItem) as unknown as SafeHtml[]}
      </div>
    </section>
  `;
}

/**
 * The cadence-organized inbox feed, wrapped in a single container the
 * live-refresh client swaps on an `inbox:changed` event. Shared by the home
 * page and the `GET /inbox/home-strips` fragment so the two never drift.
 * Renders an empty-but-present container when there's nothing, so the client
 * always has a swap target (and the operator sees a calm "all clear").
 */
export function renderHomeInboxFeed(feed: HomeFeedData = EMPTY_FEED): SafeHtml {
  const { needsYou, today, week, earlier, closed } = feed;
  const total = needsYou.length + today.length + week.length + earlier.length;

  const needsYouBlock = needsYou.length > 0
    ? html`
      <section class="home-needs" aria-label="Needs you">
        <div class="home-needs__head">
          <span class="home-needs__dot" aria-hidden="true"></span>
          <span class="home-needs__title">Needs you</span>
          <span class="home-needs__count">${String(needsYou.length)}</span>
          <a class="home-needs__all" href="/inbox">All threads →</a>
        </div>
        <div class="home-feed__items">
          ${needsYou.map(renderCadenceItem) as unknown as SafeHtml[]}
        </div>
      </section>
    `
    : html``;

  const earlierBlock = earlier.length > 0
    ? html`
      <details class="home-feed__earlier">
        <summary class="home-feed__earlier-summary">Earlier <span class="home-feed__section-count">${String(earlier.length)}</span></summary>
        <div class="home-feed__items" style="margin-top: var(--space-2);">
          ${earlier.map(renderCadenceItem) as unknown as SafeHtml[]}
        </div>
      </details>
    `
    : html``;

  const loopBlock = closed.length > 0
    ? html`
      <section class="home-loop" aria-label="Recently closed by sua">
        <div class="home-loop__head">
          <span class="home-loop__title">sua closed these</span>
        </div>
        <div class="home-loop__items">
          ${closed.map((m) => html`
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

  // Calm "all clear" when the active queue is empty but sua has been working.
  const emptyState = total === 0 && closed.length === 0
    ? html`<div class="home-feed__empty dim">Nothing needs you. Ask sua anything above to start.</div>`
    : html``;

  return html`
    <div class="home-inbox" data-home-inbox>
      ${needsYouBlock}
      ${renderCadenceSection('Today', today)}
      ${renderCadenceSection('This week', week)}
      ${earlierBlock}
      ${loopBlock}
      ${emptyState}
    </div>
  `;
}

export function renderHomePage(input: HomePageInput): string {
  // Zero-agents empty state is unchanged: onboarding beats an empty inbox.
  if (input.agentCount === 0) {
    const body = html`
      <div style="display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-6);">
        <h1 style="margin: 0;">Home</h1>
        <span class="dim" style="font-size: var(--font-size-sm);">0 agents registered</span>
      </div>
      <div class="settings-empty" style="margin-top: var(--space-4);">
        <h3 style="margin-top: 0;">No agents yet</h3>
        <p class="dim">An agent is a named task sua can run — a shell command, an LLM prompt, or a chain of both. Describe what you want and let sua build it, or follow the guided tour.</p>
        <p style="display: flex; gap: var(--space-3); justify-content: center; margin: 0;">
          ${buildFromGoalButton({ variant: 'primary' })}
          <a class="btn" href="/help/tutorial">Open tutorial</a>
        </p>
      </div>
      ${buildFromGoalModal({ availableDashboards: input.availableDashboards })}
    `;
    return render(layout({ title: 'Home', activeNav: 'home', flash: input.flash }, body));
  }

  const activityWidget = buildRecentActivity(input.activity);
  const pulseHeading = html`<h2 class="section-label" style="margin: 0;">Signals</h2>`;

  const body = html`
    <div style="display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-4);">
      <h1 style="margin: 0;">Home</h1>
      <span class="dim" style="font-size: var(--font-size-sm);">
        ${String(input.agentCount)} agent${input.agentCount !== 1 ? 's' : ''} registered
      </span>
      <form method="POST" action="/inbox/new" style="margin: 0 0 0 auto;">
        <button type="submit" class="btn btn--primary btn--sm" title="Start a new inbox thread — ask sua to run, build, fix, or look something up">Ask sua →</button>
      </form>
    </div>

    ${renderHomeInboxFeed(input.feed)}

    <details class="home-secondary" style="margin-top: var(--space-6);">
      <summary class="home-activity__summary">Signals</summary>
      <div style="margin-top: var(--space-3);">
        ${renderPulseBoard(input.board, { heading: pulseHeading })}
      </div>
    </details>

    <details class="home-activity" style="margin-top: var(--space-4);">
      <summary class="home-activity__summary">Recent activity</summary>
      <div class="home-activity__body" style="margin-top: var(--space-3);">
        ${renderHomeWidget(activityWidget)}
      </div>
    </details>

    ${renderInboxModalShell()}
  `;

  return render(layout({ title: 'Home', activeNav: 'home', flash: input.flash }, body));
}
