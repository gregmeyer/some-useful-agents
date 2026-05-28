import type {
  InboxMessage,
  InboxResponse,
  InboxResponseRole,
  InboxActionMeta,
  InboxActionStatus,
} from '@some-useful-agents/core';
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
  /**
   * Current YAML of the agent referenced by `message.agentId`, used
   * to render the unified diff inside `agent-editor`-targeting action
   * cards. The route exports this once via `core.exportAgent` and
   * passes it in; the view keeps no agentStore dependency. Absent
   * when the message has no target agent or it isn't installed.
   */
  currentTargetYaml?: string;
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
  action: 'Proposed action',
};

/** Two-character avatar text per role (mirrors Slack-style avatars). */
const ROLE_AVATAR: Record<InboxResponseRole, string> = {
  user: 'You',
  triage: 'Tri',
  system: 'Sys',
  action: 'Act',
};

/** Human label for each action-card status. */
const ACTION_STATUS_LABEL: Record<InboxActionStatus, string> = {
  proposed: 'Proposed',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  skipped: 'Skipped',
  refused: 'Refused',
};

/**
 * Self-contained fragment of the message detail — no <html>, <body>,
 * or layout chrome. Fetched by `inbox-modal.js` via
 * `/inbox/:id/fragment` and injected into the modal's content
 * container. The full-page `renderInboxDetail` wraps this in the
 * standard dashboard layout for direct-link access + accessibility.
 */
export function renderInboxDetailFragment(opts: InboxDetailOptions): SafeHtml {
  const { message, responses, flash, triagePending, currentTargetYaml } = opts;
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

  const timeline = responses.map((r) => html`
    <li class="inbox-timeline__entry">${renderConversationEntry(r, currentTargetYaml)}</li>
  `);

  // Conversation rendered as a vertical timeline. Each `<li>` carries
  // the avatar dot that overlaps the rail line drawn by .inbox-timeline.
  const timelineBlock = html`
    <section style="margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--color-border);">
      <h4 style="margin: 0 0 var(--space-2); font-size: var(--font-size-sm); text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-muted);">Conversation</h4>
      ${responses.length === 0 && !triagePending
        ? html`<p class="dim" style="font-size: var(--font-size-sm); margin: 0 0 var(--space-2);">No replies yet. Use the composer below — the triage agent will join automatically.</p>`
        : html`<ul class="inbox-timeline">${timeline as unknown as SafeHtml[]}</ul>`}
      ${triagePending ? renderThinkingIndicator() : html``}
    </section>
  `;

  const actionsRow = isTerminal
    ? html`
      <p class="dim" style="margin: var(--space-3) 0 0; font-size: var(--font-size-sm);">
        This message is ${message.status}.${message.resolvedAt ? html` Closed ${formatAge(new Date(message.resolvedAt).toISOString())}.` : html``}
      </p>`
    : html`
      <div class="inbox-composer__row">
        <form method="POST" action="/inbox/${message.id}/triage" data-inbox-modal-form data-inbox-modal-keeps-triage="1" style="margin: 0;">
          <button type="submit" class="btn btn--sm btn--ghost" ${triagePending ? 'disabled' : ''}>
            ${triagePending ? 'Triaging…' : 'Ask triage'}
          </button>
        </form>
        <form method="POST" action="/inbox/${message.id}/dismiss" data-inbox-modal-form data-inbox-modal-dismiss-on-success="1" style="margin: 0;">
          <button type="submit" class="btn btn--sm btn--ghost">Dismiss</button>
        </form>
      </div>
    `;

  // Pinned composer sits below the scrolling timeline. Sticky-bottom
  // keeps it on screen even when the operator scrolls back through
  // long threads — no hunting for the reply box.
  const composer = isTerminal ? html`` : html`
    <div class="inbox-composer">
      ${replyForm(message, triagePending ?? false)}
      ${actionsRow}
    </div>
  `;
  const terminalNote = isTerminal ? actionsRow : html``;

  // Sticky top region: title + meta + tags + details + context all stay
  // pinned while the conversation thread scrolls below.
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
        ${timelineBlock}
        ${terminalNote}
      </div>
      ${composer}
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
 * between refreshes and animate them in once. `action`-role rows
 * branch to a card renderer that surfaces Run / Skip controls + the
 * sub-agent's status.
 */
function renderConversationEntry(r: InboxResponse, currentTargetYaml?: string): SafeHtml {
  if (r.role === 'action') return renderActionEntry(r, currentTargetYaml);
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

/**
 * Inline parse of an action-role response's `meta_json`. Mirrors the
 * route's `parseActionMeta` (deliberately duplicated to keep the
 * view's import surface from leaking into route helpers).
 */
function parseActionMeta(r: InboxResponse): InboxActionMeta | null {
  if (r.role !== 'action' || !r.metaJson) return null;
  try {
    const parsed = JSON.parse(r.metaJson) as Partial<InboxActionMeta>;
    if (parsed && parsed.kind === 'action'
      && typeof parsed.agentId === 'string'
      && typeof parsed.status === 'string') {
      return parsed as InboxActionMeta;
    }
  } catch { /* swallow */ }
  return null;
}

/** Render an action-role row as a card whose body depends on status. */
function renderActionEntry(r: InboxResponse, currentTargetYaml?: string): SafeHtml {
  const meta = parseActionMeta(r);
  if (!meta) {
    // Malformed action row — fall back to plain rendering so the
    // operator at least sees the body text.
    return html`
      <div class="inbox-msg" data-msg-id="${r.id}">
        <div class="inbox-msg__avatar inbox-msg__avatar--action">Act</div>
        <div class="inbox-msg__body">
          <div class="inbox-msg__meta"><span class="inbox-msg__meta-name">Action (malformed)</span></div>
          <div class="inbox-msg__text">${r.body}</div>
        </div>
      </div>
    `;
  }

  const statusLabel = ACTION_STATUS_LABEL[meta.status] ?? meta.status;
  const inputsRendered = renderActionInputs(meta.inputs);
  const messageId = '__inbox_message_id__'; // hijacked from form action below

  // Drives modal-poll keep-alive while the action is running.
  const runningAttr = meta.status === 'running' ? 'data-action-running="1"' : '';

  const controlsBlock = meta.status === 'proposed'
    ? html`
      <div class="inbox-action__controls">
        <form method="POST" action="/inbox/${r.messageId}/actions/${r.id}/run"
          data-inbox-modal-form data-inbox-modal-keeps-triage="1" style="margin:0;">
          <button type="submit" class="btn btn--xs btn--primary">Run</button>
        </form>
        <form method="POST" action="/inbox/${r.messageId}/actions/${r.id}/skip"
          data-inbox-modal-form style="margin:0;">
          <button type="submit" class="btn btn--xs btn--ghost">Skip</button>
        </form>
      </div>
    `
    : html``;
  void messageId;

  const detailBlock = renderActionStatusBody(meta);

  return html`
    <div class="inbox-msg inbox-msg--action inbox-action inbox-action--${meta.status}" data-msg-id="${r.id}" ${runningAttr as unknown as SafeHtml}>
      <div class="inbox-msg__avatar inbox-msg__avatar--action">Act</div>
      <div class="inbox-msg__body">
        <div class="inbox-msg__meta">
          <span class="inbox-msg__meta-name">Triage proposed</span>
          <span class="inbox-action__status">${statusLabel}</span>
          <span>${formatAge(new Date(r.createdAt).toISOString())}</span>
        </div>
        <div class="inbox-action__card">
          <div class="inbox-action__headline">
            Run agent <span class="mono">${meta.agentId}</span>
            ${meta.runId ? html` · <a href="/runs/${meta.runId}" class="mono">run ${meta.runId.slice(0, 8)}</a>` : html``}
          </div>
          ${meta.rationale ? html`<div class="inbox-action__rationale">${meta.rationale}</div>` : html``}
          ${meta.agentId === 'agent-editor' && meta.inputs.NEW_YAML
            ? renderYamlDiff(currentTargetYaml ?? '', meta.inputs.NEW_YAML)
            : inputsRendered}
          ${detailBlock}
          ${controlsBlock}
        </div>
      </div>
    </div>
  `;
}

function renderActionInputs(inputs: Record<string, string>): SafeHtml {
  const keys = Object.keys(inputs);
  if (keys.length === 0) return html``;
  const rows = keys.map((k) => html`
    <li><span class="inbox-action__input-key mono">${k}</span> <span class="inbox-action__input-val mono">${inputs[k]}</span></li>
  `);
  return html`
    <ul class="inbox-action__inputs">${rows as unknown as SafeHtml[]}</ul>
  `;
}

function renderActionStatusBody(meta: InboxActionMeta): SafeHtml {
  switch (meta.status) {
    case 'proposed':
      return html``;
    case 'running':
      return html`
        <div class="inbox-action__running">
          Running
          <span class="inbox-thinking__dots"><span></span><span></span><span></span></span>
        </div>
      `;
    case 'completed': {
      const dur = formatDuration(meta);
      const preview = meta.resultSummary?.trim();
      return html`
        <div class="inbox-action__result inbox-action__result--ok">
          Completed${dur ? ` in ${dur}` : ''}.
          ${preview ? html`<pre class="inbox-action__preview mono">${preview}</pre>` : html``}
        </div>
      `;
    }
    case 'failed':
      return html`
        <div class="inbox-action__result inbox-action__result--err">
          Failed${formatDuration(meta) ? ` after ${formatDuration(meta)}` : ''}.
          ${meta.refusalReason ? html`<div class="inbox-action__reason">${meta.refusalReason}</div>` : html``}
        </div>
      `;
    case 'skipped':
      return html`<div class="inbox-action__result inbox-action__result--muted">Skipped by operator.</div>`;
    case 'refused':
      return html`
        <div class="inbox-action__result inbox-action__result--err">
          Refused. ${meta.refusalReason ? html`<span>${meta.refusalReason}</span>` : html``}
        </div>
      `;
    default:
      return html``;
  }
}

/**
 * Render a unified-diff view of `oldYaml` vs `newYaml`. Used by
 * agent-editor action cards so the operator sees exactly what's
 * about to change before clicking Run. Hand-rolled LCS-based line
 * diff — agent YAMLs are small (~100 lines) so O(m*n) memory is
 * trivial. Lines that match render dim; removed lines red, added
 * lines green.
 */
function renderYamlDiff(oldYaml: string, newYaml: string): SafeHtml {
  const a = oldYaml.split('\n');
  const b = newYaml.split('\n');
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: SafeHtml[] = [];
  let plus = 0, minus = 0;
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { rows.push(diffLine(' ', a[i])); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push(diffLine('-', a[i])); i++; minus++; }
    else { rows.push(diffLine('+', b[j])); j++; plus++; }
  }
  while (i < m) { rows.push(diffLine('-', a[i++])); minus++; }
  while (j < n) { rows.push(diffLine('+', b[j++])); plus++; }

  return html`
    <div class="inbox-action__diff">
      <div class="inbox-action__diff-header">
        Proposed YAML change — <span class="inbox-action__diff-add">+${plus}</span> /
        <span class="inbox-action__diff-del">-${minus}</span>
      </div>
      <pre class="inbox-action__diff-body mono">${rows as unknown as SafeHtml[]}</pre>
    </div>
  `;
}

function diffLine(kind: ' ' | '+' | '-', text: string): SafeHtml {
  const cls = kind === '+' ? 'inbox-action__diff-line--add'
    : kind === '-' ? 'inbox-action__diff-line--del'
    : 'inbox-action__diff-line--ctx';
  return html`<span class="inbox-action__diff-line ${cls}">${kind} ${text}
</span>`;
}

function formatDuration(meta: InboxActionMeta): string {
  if (typeof meta.startedAt !== 'number' || typeof meta.endedAt !== 'number') return '';
  const ms = meta.endedAt - meta.startedAt;
  if (ms < 0) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
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
