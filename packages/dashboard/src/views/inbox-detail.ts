import type { InboxMessage, InboxResponse } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { formatAge } from './components.js';

export interface InboxDetailOptions {
  message: InboxMessage;
  responses: InboxResponse[];
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
}

const PRIORITY_BADGE: Record<string, string> = {
  high: 'badge--warn',
  medium: 'badge--info',
  low: 'badge--muted',
};

const ROLE_LABEL: Record<string, string> = {
  user: 'You',
  triage: 'Triage agent',
  system: 'System',
};

/**
 * Render the inbox-message detail page. Sections:
 *   - header — priority + source + age + status
 *   - body   — short markdown summary the producer wrote
 *   - context — collapsible <details> of the structured producer payload
 *   - recommendation — triage agent's suggestion (PR 4+)
 *   - responses timeline — conversation thread (PR 4+)
 *
 * Mirrors the run-detail shell pattern but trims to a single-column
 * layout — no DAG / widget panes.
 */
export function renderInboxDetail(opts: InboxDetailOptions): string {
  const { message, responses, flash } = opts;

  const ageIso = new Date(message.createdAt).toISOString();
  const badgeClass = PRIORITY_BADGE[message.priority] ?? 'badge--muted';

  const headerMeta = html`
    <div style="display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; font-size: var(--font-size-sm); color: var(--color-text-muted); margin-top: var(--space-1);">
      <span class="badge ${badgeClass}">${message.priority}</span>
      <span>${message.source}</span>
      <span>${formatAge(ageIso)}</span>
      <span><span class="badge badge--muted">${message.status}</span></span>
      ${message.agentId ? html`<a href="/agents/${message.agentId}">${message.agentId}</a>` : html``}
      ${message.runId ? html`<a href="/runs/${message.runId}" class="mono">run ${message.runId.slice(0, 8)}</a>` : html``}
    </div>
  `;

  const bodyBlock = html`
    <section class="card" style="margin-top: var(--space-4);">
      <h3 style="margin: 0 0 var(--space-2);">Details</h3>
      <div style="white-space: pre-wrap;">${message.body}</div>
    </section>
  `;

  const contextBlock = message.contextJson ? html`
    <section class="card" style="margin-top: var(--space-3);">
      <details>
        <summary style="cursor: pointer; font-weight: var(--weight-semibold);">Context payload</summary>
        <pre class="mono" style="font-size: var(--font-size-xs); margin: var(--space-2) 0 0; overflow-x: auto;">${pretty(message.contextJson)}</pre>
      </details>
    </section>
  ` : html``;

  const recommendationBlock = message.recommendation ? html`
    <section class="card" style="margin-top: var(--space-3);">
      <h3 style="margin: 0 0 var(--space-2);">Recommendation</h3>
      <div style="white-space: pre-wrap;">${message.recommendation}</div>
      ${message.triageRunId ? html`
        <p class="dim" style="font-size: var(--font-size-xs); margin: var(--space-2) 0 0;">
          From triage run <a href="/runs/${message.triageRunId}" class="mono">${message.triageRunId.slice(0, 8)}</a>
        </p>
      ` : html``}
    </section>
  ` : html``;

  // Conversation timeline: each entry is a small block with role +
  // age + body. Empty state hints that the triage agent (next PR)
  // will fill this in automatically.
  const responsesBlock = html`
    <section class="card" style="margin-top: var(--space-3);">
      <h3 style="margin: 0 0 var(--space-2);">Conversation</h3>
      ${responses.length > 0
        ? html`${responses.map((r) => html`
            <div style="border-top: 1px solid var(--color-border); padding: var(--space-2) 0;">
              <div style="font-size: var(--font-size-xs); color: var(--color-text-muted); margin-bottom: var(--space-1);">
                ${ROLE_LABEL[r.role] ?? r.role} · ${formatAge(new Date(r.createdAt).toISOString())}
              </div>
              <div style="white-space: pre-wrap;">${r.body}</div>
            </div>
          `) as unknown as SafeHtml[]}`
        : html`<p class="dim" style="font-size: var(--font-size-sm); margin: 0 0 var(--space-2);">No replies yet. Add a note below; the triage agent will join the thread in an upcoming PR.</p>`}
      ${replyForm(message)}
    </section>
  `;

  // Action bar — surfaces the catch-all "Dismiss" verb for any
  // message. Source-specific actions (allow-host, retry-run, etc.)
  // ship as a follow-up PR; for now Dismiss is the universal action
  // the user asked for in the first dogfood pass.
  const actionsBlock = message.status === 'dismissed' || message.status === 'resolved'
    ? html`
      <section class="card" style="margin-top: var(--space-3);">
        <p class="dim" style="margin: 0; font-size: var(--font-size-sm);">
          This message is ${message.status}. ${message.resolvedAt ? html`Closed ${formatAge(new Date(message.resolvedAt).toISOString())}.` : html``}
        </p>
      </section>`
    : html`
      <section class="card" style="margin-top: var(--space-3); display: flex; gap: var(--space-2); align-items: center;">
        <form method="POST" action="/inbox/${message.id}/dismiss" style="margin: 0;">
          <button type="submit" class="btn btn--sm btn--ghost">Dismiss</button>
        </form>
        <span class="dim" style="font-size: var(--font-size-xs);">Hide this message from the queue. Reopen with the status filter on /inbox.</span>
      </section>
    `;

  const pageBody = html`
    ${pageHeader({
      title: message.title,
      back: { href: '/inbox', label: 'Inbox' },
    })}
    ${headerMeta}
    ${bodyBlock}
    ${contextBlock}
    ${recommendationBlock}
    ${actionsBlock}
    ${responsesBlock}
  `;

  return render(layout({
    title: `${message.title} · Inbox`,
    activeNav: 'inbox',
    flash,
  }, pageBody));
}

/**
 * Pretty-print a JSON string for the collapsible context panel. If the
 * payload isn't valid JSON we display it verbatim — context_json is
 * producer-controlled and we'd rather show garbage than crash.
 */
function pretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/**
 * Inline reply form rendered inside the Conversation card. POSTs to
 * /inbox/:id/respond which appends a `user`-role entry to the thread.
 * Hidden when the message is in a terminal state — once you've
 * dismissed/resolved, the conversation is closed.
 */
function replyForm(message: InboxMessage): SafeHtml {
  if (message.status === 'dismissed' || message.status === 'resolved') return html``;
  return html`
    <form method="POST" action="/inbox/${message.id}/respond"
      style="margin: var(--space-2) 0 0; padding-top: var(--space-2); border-top: 1px solid var(--color-border); display: flex; flex-direction: column; gap: var(--space-2);">
      <label style="font-size: var(--font-size-xs); color: var(--color-text-muted);">
        Reply
      </label>
      <textarea name="body" rows="3" required maxlength="8192"
        placeholder="Describe what you tried, ask a follow-up, or note a decision."
        class="form-field"
        style="padding: var(--space-2); font-size: var(--font-size-sm); resize: vertical;"></textarea>
      <div style="display: flex; justify-content: flex-end;">
        <button type="submit" class="btn btn--sm btn--primary">Post reply</button>
      </div>
    </form>
  `;
}
