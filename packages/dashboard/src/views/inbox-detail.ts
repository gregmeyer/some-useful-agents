import type { InboxMessage, InboxResponse, InboxResponseRole } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { formatAge } from './components.js';

export interface InboxDetailOptions {
  message: InboxMessage;
  responses: InboxResponse[];
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
  /**
   * When true, the triage agent has a run in `pending` or `running` for
   * this message (or one was just kicked off and the run-store hasn't
   * caught up yet). The fragment renders a `[data-triage-pending="1"]`
   * thinking indicator that inbox-modal.js polls on.
   */
  triagePending?: boolean;
}

const PRIORITY_BADGE: Record<string, string> = {
  high: 'badge--warn',
  medium: 'badge--info',
  low: 'badge--muted',
};

const SOURCE_LABEL: Record<string, string> = {
  'run-failure': 'Run failure',
  'permission-request': 'Permission',
  'cadence': 'Cadence',
  'manual': 'Manual',
};

const ROLE_LABEL: Record<InboxResponseRole, string> = {
  user: 'You',
  triage: 'Triage agent',
  system: 'System',
};

/** Two-character avatar text per role (mirrors Slack-style avatars). */
const ROLE_AVATAR: Record<InboxResponseRole, string> = {
  user: 'You',
  triage: 'Tri',
  system: 'Sys',
};

/**
 * Self-contained fragment of the message detail — no <html>, <body>,
 * or layout chrome. Fetched by `inbox-modal.js` via
 * `/inbox/:id/fragment` and injected into the modal's content
 * container. The full-page `renderInboxDetail` wraps this in the
 * standard dashboard layout for direct-link access + accessibility.
 */
export function renderInboxDetailFragment(opts: InboxDetailOptions): SafeHtml {
  const { message, responses, flash, triagePending } = opts;
  const badgeClass = PRIORITY_BADGE[message.priority] ?? 'badge--muted';
  const isTerminal = message.status === 'dismissed' || message.status === 'resolved';

  const flashBlock = flash ? html`
    <div class="flash flash--${flash.kind}" style="margin: 0 0 var(--space-2);">${flash.message}</div>
  ` : html``;

  // Header meta row + a star control on the right. The star form is
  // intercepted by inbox-modal.js (via data-inbox-modal-form) so
  // clicking it toggles in place without a page reload.
  const headerMeta = html`
    <div style="display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; font-size: var(--font-size-sm); color: var(--color-text-muted); margin-top: var(--space-1);">
      <span class="badge ${badgeClass}">${message.priority}</span>
      <span>${SOURCE_LABEL[message.source] ?? message.source}</span>
      <span>${formatAge(new Date(message.createdAt).toISOString())}</span>
      <span class="badge badge--muted">${message.status}</span>
      ${message.agentId ? html`<a href="/agents/${message.agentId}">${message.agentId}</a>` : html``}
      ${message.runId ? html`<a href="/runs/${message.runId}" class="mono">run ${message.runId.slice(0, 8)}</a>` : html``}
      <form method="POST" action="/inbox/${message.id}/star" data-inbox-modal-form style="margin: 0 0 0 auto;">
        <input type="hidden" name="starred" value="${message.starred ? '0' : '1'}">
        <button type="submit" class="inbox-star ${message.starred ? 'inbox-star--on' : ''}" aria-label="${message.starred ? 'Unstar' : 'Star'}">★</button>
      </form>
    </div>
  `;

  // Tag editor: comma-separated input. Existing tags are pre-filled.
  // Form submit replaces the entire tag set; clearing the input
  // removes all tags. Validation happens in the store (invalid
  // entries are silently dropped).
  const tagsBlock = html`
    <form method="POST" action="/inbox/${message.id}/tags" data-inbox-modal-form
      style="margin-top: var(--space-2); display: flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-xs);">
      <label style="color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: var(--weight-semibold);">Tags</label>
      <input type="text" name="tags" value="${message.tags.join(', ')}"
        placeholder="auth, network, …" class="form-field"
        style="flex: 1; padding: var(--space-1) var(--space-2); font-size: var(--font-size-xs);">
      <button type="submit" class="btn btn--xs btn--ghost">Save tags</button>
    </form>
  `;

  const bodyBlock = html`
    <section style="margin-top: var(--space-3);">
      <h4 style="margin: 0 0 var(--space-1); font-size: var(--font-size-sm); text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-muted);">Details</h4>
      <div style="white-space: pre-wrap;">${message.body}</div>
    </section>
  `;

  const contextBlock = message.contextJson ? html`
    <details style="margin-top: var(--space-3);">
      <summary style="cursor: pointer; font-size: var(--font-size-xs); color: var(--color-text-muted); font-weight: var(--weight-semibold); text-transform: uppercase; letter-spacing: 0.06em;">Context payload</summary>
      <pre class="mono" style="font-size: var(--font-size-xs); margin: var(--space-2) 0 0; overflow-x: auto; max-height: 12rem;">${pretty(message.contextJson)}</pre>
    </details>
  ` : html``;

  const timeline = responses.map((r) => renderConversationEntry(r));

  const conversationBlock = html`
    <section style="margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--color-border);">
      <h4 style="margin: 0 0 var(--space-2); font-size: var(--font-size-sm); text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-muted);">Conversation</h4>
      ${responses.length === 0 && !triagePending
        ? html`<p class="dim" style="font-size: var(--font-size-sm); margin: 0 0 var(--space-2);">No replies yet. Post a note below — the triage agent will join automatically.</p>`
        : html`${timeline as unknown as SafeHtml[]}`}
      ${triagePending ? renderThinkingIndicator() : html``}
      ${replyForm(message, triagePending ?? false)}
    </section>
  `;

  const actionsBlock = isTerminal
    ? html`
      <p class="dim" style="margin: var(--space-3) 0 0; font-size: var(--font-size-sm);">
        This message is ${message.status}.${message.resolvedAt ? html` Closed ${formatAge(new Date(message.resolvedAt).toISOString())}.` : html``}
      </p>`
    : html`
      <div style="margin-top: var(--space-3); display: flex; gap: var(--space-2); align-items: center;">
        <form method="POST" action="/inbox/${message.id}/triage" data-inbox-modal-form data-inbox-modal-keeps-triage="1" style="margin: 0;">
          <button type="submit" class="btn btn--sm btn--ghost" ${triagePending ? 'disabled' : ''}>
            ${triagePending ? 'Triaging…' : 'Ask triage'}
          </button>
        </form>
        <form method="POST" action="/inbox/${message.id}/dismiss" data-inbox-modal-form data-inbox-modal-dismiss-on-success="1" style="margin: 0;">
          <button type="submit" class="btn btn--sm btn--ghost">Dismiss</button>
        </form>
        <span class="dim" style="font-size: var(--font-size-xs); margin-left: auto;">
          Dismiss closes this thread; Triage re-runs the LLM for a fresh recommendation.
        </span>
      </div>
    `;

  // Sticky top region: title + meta + tags + details + context all stay
  // pinned while the conversation thread scrolls below. The modal's
  // outer container handles vertical overflow; this sub-section uses
  // position:sticky relative to that scroll context.
  return html`
    <div class="inbox-detail">
      <div class="inbox-detail__header">
        <header style="margin: 0;">
          <h3 id="inbox-modal-title" style="margin: 0;">${message.title}</h3>
          ${headerMeta}
          ${tagsBlock}
        </header>
        ${flashBlock}
        ${bodyBlock}
        ${contextBlock}
      </div>
      <div class="inbox-detail__thread">
        ${conversationBlock}
        ${actionsBlock}
      </div>
    </div>
  `;
}

/** Full-page render — used for direct `/inbox/:id` GETs (fallback). */
export function renderInboxDetail(opts: InboxDetailOptions): string {
  const { message, flash } = opts;
  const pageBody = html`
    ${pageHeader({
      title: message.title,
      back: { href: '/inbox', label: 'Inbox' },
    })}
    <section class="card" style="margin-top: var(--space-3);">
      ${renderInboxDetailFragment(opts)}
    </section>
  `;
  return render(layout({
    title: `${message.title} · Inbox`,
    activeNav: 'inbox',
    flash,
  }, pageBody));
}

function pretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/**
 * Slack-style conversation entry: avatar + name + time + body. The
 * `data-msg-id` attribute lets the modal JS detect new entries
 * between refreshes and animate them in once.
 */
function renderConversationEntry(r: InboxResponse): SafeHtml {
  const role = (ROLE_LABEL[r.role] ?? r.role);
  const avatar = ROLE_AVATAR[r.role] ?? r.role.slice(0, 1).toUpperCase();
  return html`
    <div class="inbox-msg" data-msg-id="${r.id}">
      <div class="inbox-msg__avatar inbox-msg__avatar--${r.role}">${avatar}</div>
      <div class="inbox-msg__body">
        <div class="inbox-msg__meta">
          <span class="inbox-msg__meta-name">${role}</span>
          <span>${formatAge(new Date(r.createdAt).toISOString())}</span>
        </div>
        <div class="inbox-msg__text">${r.body}</div>
      </div>
    </div>
  `;
}

/** Pulsing-dots "Triage agent is thinking…" indicator. */
function renderThinkingIndicator(): SafeHtml {
  return html`
    <div class="inbox-thinking" data-triage-pending="1">
      <div class="inbox-thinking__avatar">Tri</div>
      <div>
        Triage agent is thinking
        <span class="inbox-thinking__dots"><span></span><span></span><span></span></span>
      </div>
    </div>
  `;
}

/**
 * Reply form. Disabled while triage is pending so the user can't
 * queue a second turn before the first response lands. Carries
 * `data-inbox-modal-keeps-triage` so the JS bumps the polling
 * deadline on submit (covers the race where the dag-executor
 * hasn't inserted its run row yet).
 */
function replyForm(message: InboxMessage, triagePending: boolean): SafeHtml {
  if (message.status === 'dismissed' || message.status === 'resolved') return html``;
  return html`
    <form method="POST" action="/inbox/${message.id}/respond" data-inbox-modal-form data-inbox-modal-keeps-triage="1"
      style="margin: var(--space-3) 0 0; padding-top: var(--space-2); border-top: 1px solid var(--color-border); display: flex; flex-direction: column; gap: var(--space-2);">
      <label style="font-size: var(--font-size-xs); color: var(--color-text-muted);">
        Reply
      </label>
      <textarea name="body" rows="3" required maxlength="8192"
        ${triagePending ? 'disabled' : ''}
        placeholder="Describe what you tried, ask a follow-up, or note a decision. The triage agent will respond."
        class="form-field"
        style="padding: var(--space-2); font-size: var(--font-size-sm); resize: vertical;"></textarea>
      <div style="display: flex; justify-content: flex-end;">
        <button type="submit" class="btn btn--sm btn--primary" ${triagePending ? 'disabled' : ''}>
          ${triagePending ? 'Waiting on triage…' : 'Post reply'}
        </button>
      </div>
    </form>
  `;
}
