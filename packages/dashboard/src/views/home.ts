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
import { cleanSnippet, PREVIEW_ROLE_LABEL, type InboxRowPreviewPayload } from './inbox-list.js';
import { formatNatureMeta, type HomeFeedData, type CadenceItem } from '../lib/home-feed.js';

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

/** Zero-pad a small count for the ledger feel (02, 11). */
function padCount(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** One-line preview cell: latest reply snippet, or a pending-actions hint, or
 *  an empty cell (a bare title reads cleaner than a "No replies yet" apology). */
function renderRowPreview(preview: InboxRowPreviewPayload): SafeHtml {
  if (preview.latestResponse) {
    const role = PREVIEW_ROLE_LABEL[preview.latestResponse.role] ?? preview.latestResponse.role;
    return html`<span class="feed-row__preview"><span class="feed-row__preview-role">${role}</span> ${cleanSnippet(preview.latestResponse.body, 90)}</span>`;
  }
  if (preview.proposedActions) {
    const n = preview.proposedActions.count;
    return html`<span class="feed-row__preview feed-row__preview--pending">▸ ${String(n)} proposed action${n === 1 ? '' : 's'}</span>`;
  }
  return html`<span class="feed-row__preview"></span>`;
}

/**
 * One cadence row on the aligned grid: state-dot · title · preview · meta · age.
 * `variant` drives the accent + which columns show — needs-you gets the amber
 * edge + pulsing dot and no meta (the edge already says "act"); active rows
 * show the quiet `sched·llm` meta.
 */
function renderCadenceItem(item: CadenceItem, variant: 'needs' | 'active'): SafeHtml {
  const m = item.message;
  const meta = variant === 'active' ? formatNatureMeta(item.nature) : '';
  return html`
    <a class="feed-row feed-row--${variant}" href="/inbox/${m.id}" data-inbox-rail-id="${m.id}">
      <span class="feed-row__dot feed-row__dot--${variant}" aria-hidden="true"></span>
      <span class="feed-row__title">${m.title}</span>
      ${renderRowPreview(item.preview)}
      <span class="feed-row__meta">${meta}</span>
      <span class="feed-row__age">${formatAge(new Date(m.lastActivityAt ?? m.createdAt).toISOString())}</span>
    </a>
  `;
}

/** A cadence group: a mono-caps hairline label over a set of rows. No card. */
function renderCadenceGroup(label: string, items: CadenceItem[], variant: 'needs' | 'active', modifier = ''): SafeHtml {
  if (items.length === 0) return html``;
  return html`
    <section class="feed-group ${modifier}" aria-label="${label}">
      <div class="feed-group__label section-label">${label} <span class="feed-group__count">${padCount(items.length)}</span></div>
      ${items.map((it) => renderCadenceItem(it, variant)) as unknown as SafeHtml[]}
    </section>
  `;
}

/**
 * The cadence-organized inbox feed: one dense, borderless list where mono-caps
 * labels are the only dividers and every row's meta/age align into a right-hand
 * ledger. Wrapped in a single `[data-home-inbox]` container the live-refresh
 * client swaps on `inbox:changed`. Shared by the home page and the
 * `GET /inbox/home-strips` fragment. Renders an empty-but-present container so
 * the client always has a swap target.
 */
export function renderHomeInboxFeed(feed: HomeFeedData = EMPTY_FEED): SafeHtml {
  const { needsYou, today, week, earlier, closed } = feed;
  const total = needsYou.length + today.length + week.length + earlier.length;

  const earlierBlock = earlier.length > 0
    ? html`
      <details class="feed-group feed-group--earlier">
        <summary class="feed-group__label section-label">Earlier <span class="feed-group__count">${padCount(earlier.length)}</span></summary>
        ${earlier.map((it) => renderCadenceItem(it, 'active')) as unknown as SafeHtml[]}
      </details>
    `
    : html``;

  const closedBlock = closed.length > 0
    ? html`
      <section class="feed-group feed-group--closed" aria-label="Closed by sua">
        <div class="feed-group__label section-label">sua closed these</div>
        ${closed.map((m) => html`
          <a class="feed-row feed-row--closed" href="/inbox/${m.id}" data-inbox-rail-id="${m.id}">
            <span class="feed-row__dot feed-row__dot--closed" aria-hidden="true">✓</span>
            <span class="feed-row__title">${m.title}</span>
            <span class="feed-row__preview"></span>
            <span class="feed-row__meta"></span>
            <span class="feed-row__age">${formatAge(new Date(m.resolvedAt ?? m.createdAt).toISOString())}</span>
          </a>
        `) as unknown as SafeHtml[]}
      </section>
    `
    : html``;

  const emptyState = total === 0 && closed.length === 0
    ? html`<div class="feed-empty dim">All clear — nothing needs you. Ask sua anything above to start.</div>`
    : html``;

  return html`
    <div class="home-inbox" data-home-inbox>
      ${renderCadenceGroup('Needs you', needsYou, 'needs', 'feed-group--needs')}
      ${renderCadenceGroup('Today', today, 'active')}
      ${renderCadenceGroup('This week', week, 'active')}
      ${earlierBlock}
      ${closedBlock}
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
    <form class="home-ask" method="POST" action="/inbox/new" data-home-ask>
      <span class="home-ask__prompt" aria-hidden="true">sua&nbsp;›</span>
      <textarea class="home-ask__input" name="body" rows="1"
        placeholder="Ask sua to run, build, fix, or look something up…"
        data-home-ask-input aria-label="Ask sua"></textarea>
      <button type="submit" class="btn btn--primary btn--sm home-ask__send" data-home-ask-send>Send ↵</button>
    </form>

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
