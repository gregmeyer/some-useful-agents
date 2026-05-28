import type { InboxMessage, InboxResponse } from '@some-useful-agents/core';
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
   * this message. The fragment renders a `[data-triage-pending="1"]`
   * marker that inbox-modal.js polls on so the conversation refreshes
   * as soon as the agent's response lands.
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

const ROLE_LABEL: Record<string, string> = {
  user: 'You',
  triage: 'Triage agent',
  system: 'System',
};

const ROLE_DOT_COLOR: Record<string, string> = {
  user: 'var(--color-primary, #2dd4bf)',
  triage: 'var(--color-info, #60a5fa)',
  system: 'var(--color-text-muted, #8b93a7)',
};

/**
 * Render the message detail as a SELF-CONTAINED FRAGMENT (no <html>,
 * <body>, layout chrome). Used by inbox-modal.js — fetched from
 * `/inbox/:id/fragment` and injected into the modal's content
 * container. The full-page `renderInboxDetail` below wraps this in
 * the standard dashboard layout for direct-link access + accessibility.
 */
export function renderInboxDetailFragment(opts: InboxDetailOptions): SafeHtml {
  const { message, responses, flash, triagePending } = opts;
  const badgeClass = PRIORITY_BADGE[message.priority] ?? 'badge--muted';
  const isTerminal = message.status === 'dismissed' || message.status === 'resolved';

  const flashBlock = flash ? html`
    <div class="flash flash--${flash.kind}" style="margin: 0 0 var(--space-2);">${flash.message}</div>
  ` : html``;

  const headerMeta = html`
    <div style="display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; font-size: var(--font-size-sm); color: var(--color-text-muted); margin-top: var(--space-1);">
      <span class="badge ${badgeClass}">${message.priority}</span>
      <span>${SOURCE_LABEL[message.source] ?? message.source}</span>
      <span>${formatAge(new Date(message.createdAt).toISOString())}</span>
      <span class="badge badge--muted">${message.status}</span>
      ${message.agentId ? html`<a href="/agents/${message.agentId}">${message.agentId}</a>` : html``}
      ${message.runId ? html`<a href="/runs/${message.runId}" class="mono">run ${message.runId.slice(0, 8)}</a>` : html``}
    </div>
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

  // Conversation timeline + reply form. The triage agent posts here
  // too — its entries get the badge--info dot color.
  const timeline = responses.map((r) => html`
    <div style="border-top: 1px solid var(--color-border); padding: var(--space-2) 0;">
      <div style="font-size: var(--font-size-xs); color: var(--color-text-muted); margin-bottom: var(--space-1); display: flex; align-items: center; gap: var(--space-1);">
        <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${ROLE_DOT_COLOR[r.role] ?? ROLE_DOT_COLOR.system};"></span>
        ${ROLE_LABEL[r.role] ?? r.role} · ${formatAge(new Date(r.createdAt).toISOString())}
      </div>
      <div style="white-space: pre-wrap;">${r.body}</div>
    </div>
  `);

  const conversationBlock = html`
    <section style="margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--color-border);">
      <h4 style="margin: 0 0 var(--space-1); font-size: var(--font-size-sm); text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-muted);">Conversation</h4>
      ${responses.length === 0 && !triagePending
        ? html`<p class="dim" style="font-size: var(--font-size-sm); margin: 0 0 var(--space-2);">No replies yet. Post a note below — the triage agent will join automatically.</p>`
        : html`${timeline as unknown as SafeHtml[]}`}
      ${triagePending ? html`
        <div data-triage-pending="1" style="border-top: 1px solid var(--color-border); padding: var(--space-2) 0; font-size: var(--font-size-sm); color: var(--color-text-muted); display: flex; align-items: center; gap: var(--space-2);">
          <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${ROLE_DOT_COLOR.triage}; animation: pulse 1.2s ease-in-out infinite;"></span>
          Triage agent is thinking…
        </div>
      ` : html``}
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
        <form method="POST" action="/inbox/${message.id}/triage" data-inbox-modal-form style="margin: 0;">
          <button type="submit" class="btn btn--sm btn--ghost" ${triagePending ? 'disabled' : ''}>
            ${triagePending ? 'Triaging…' : 'Ask triage'}
          </button>
        </form>
        <form method="POST" action="/inbox/${message.id}/dismiss" data-inbox-modal-form data-inbox-modal-dismiss-on-success="1" style="margin: 0;">
          <button type="submit" class="btn btn--sm btn--ghost">Dismiss</button>
        </form>
        <span class="dim" style="font-size: var(--font-size-xs); margin-left: auto;">
          Dismiss closes this thread; Triage asks the LLM for a recommendation.
        </span>
      </div>
    `;

  return html`
    <header style="margin: 0;">
      <h3 id="inbox-modal-title" style="margin: 0;">${message.title}</h3>
      ${headerMeta}
    </header>
    ${flashBlock}
    ${bodyBlock}
    ${contextBlock}
    ${conversationBlock}
    ${actionsBlock}
  `;
}

/**
 * Full-page render — used for direct `/inbox/:id` GETs (right-click
 * "open in new tab", accessibility, search-engine friendly). Wraps
 * the same fragment in the standard layout chrome.
 */
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
 * Inline reply form. Hidden when the message is in a terminal state.
 * Disabled while a triage run is pending so the user can't queue a
 * second turn while the first is still thinking — the agent posts
 * back via `/triage`, the modal polls, the form re-enables.
 */
function replyForm(message: InboxMessage, triagePending: boolean): SafeHtml {
  if (message.status === 'dismissed' || message.status === 'resolved') return html``;
  return html`
    <form method="POST" action="/inbox/${message.id}/respond" data-inbox-modal-form
      style="margin: var(--space-2) 0 0; padding-top: var(--space-2); border-top: 1px solid var(--color-border); display: flex; flex-direction: column; gap: var(--space-2);">
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
