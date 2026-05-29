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

/**
 * Human label + badge variant for each inbox-status enum. Mirrors
 * the table in inbox-list.ts — kept here as a duplicate to avoid an
 * import cycle, but updated together when the operator-facing
 * vocabulary changes. `Your turn` is the load-bearing label: it's
 * the only status that demands action.
 */
const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  triaged: 'Triaged',
  awaiting_user: 'Your turn',
  verifying: 'Verifying',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
};
const STATUS_BADGE: Record<string, string> = {
  open: 'badge--muted',
  triaged: 'badge--muted',
  awaiting_user: 'badge--warn',
  verifying: 'badge--info',
  resolved: 'badge--ok',
  dismissed: 'badge--muted',
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

  // Tight meta row: priority dot + status + agent link + run link + age.
  // Priority becomes a colored dot rather than a full badge to lower
  // its visual weight; the status badge stays because it's the
  // operator's primary "what state is this in" signal. Source is now
  // implicit via the priority + agent + runId combination (it's
  // surfaced on the list view).
  const headerMeta = html`
    <div class="inbox-modal__meta">
      <span class="inbox-modal__priority inbox-modal__priority--${message.priority}" title="${message.priority} priority"></span>
      <span class="badge ${STATUS_BADGE[message.status] ?? 'badge--muted'}">${STATUS_LABEL[message.status] ?? message.status}</span>
      ${message.agentId ? html`<a href="/agents/${message.agentId}" class="inbox-modal__link">${message.agentId}</a>` : html``}
      ${message.runId ? html`<span class="inbox-modal__sep">·</span><a href="/runs/${message.runId}" class="inbox-modal__link mono">run ${message.runId.slice(0, 8)}</a>` : html``}
      <span class="inbox-modal__age">${formatAge(new Date(message.createdAt).toISOString())}</span>
    </div>
  `;

  // Star control sits in the title row, top-right (mirrors the
  // modal-shell ✕ close button alignment).
  const starControl = html`
    <form method="POST" action="/inbox/${message.id}/star" data-inbox-modal-form class="inbox-modal__star-form">
      <input type="hidden" name="starred" value="${message.starred ? '0' : '1'}">
      <button type="submit" class="inbox-star ${message.starred ? 'inbox-star--on' : ''}" aria-label="${message.starred ? 'Unstar' : 'Star'}">★</button>
    </form>
  `;

  // Tags as pills with inline ×. The form submits the full tag set on
  // every change (existing route contract — `tags` is a CSV); JS
  // handles add/remove deltas client-side and then submits.
  const tagPills = message.tags.map((t) => html`
    <span class="inbox-pill" data-inbox-tag="${t}">
      ${t}<button type="button" class="inbox-pill__remove" data-inbox-tag-remove="${t}" aria-label="Remove tag ${t}">×</button>
    </span>
  `);
  const tagsBlock = html`
    <form method="POST" action="/inbox/${message.id}/tags" data-inbox-modal-form
      data-inbox-tags-form data-inbox-modal-quiet="1" class="inbox-modal__tags">
      <input type="hidden" name="tags" value="${message.tags.join(', ')}" data-inbox-tags-input>
      ${tagPills as unknown as SafeHtml[]}
      <input type="text" class="inbox-modal__tag-add" placeholder="Add tag…" aria-label="Add tag"
        data-inbox-tag-add maxlength="32">
    </form>
  `;

  // Body lands without a heading — it IS the content, no label needed.
  // Manual conversations seed body with '(empty)' so the store's
  // NOT NULL constraint is satisfied; suppress that visually so the
  // modal opens clean until the operator's first reply lands.
  const trimmedBody = message.body.trim();
  const hasBody = trimmedBody.length > 0 && trimmedBody !== '(empty)';
  const bodyBlock = hasBody ? html`
    <div class="inbox-modal__body">${message.body}</div>
  ` : html``;

  const contextBlock = message.contextJson ? html`
    <details class="inbox-modal__context">
      <summary>Context payload</summary>
      <pre class="mono">${pretty(message.contextJson)}</pre>
    </details>
  ` : html``;

  const timeline = responses.map((r) => html`
    <li class="inbox-timeline__entry">${renderConversationEntry(r, currentTargetYaml)}</li>
  `);

  // Conversation rendered as a vertical timeline. Each `<li>` carries
  // the avatar dot that overlaps the rail line drawn by
  // .inbox-timeline. No "Conversation" heading — the timeline shape
  // is self-evident.
  const timelineBlock = html`
    <section class="inbox-modal__timeline-section">
      ${responses.length === 0 && !triagePending
        ? html`<p class="dim" style="font-size: var(--font-size-sm); margin: 0 0 var(--space-2);">No replies yet. Use the composer below — the triage agent will join automatically.</p>`
        : html`<ul class="inbox-timeline">${timeline as unknown as SafeHtml[]}</ul>`}
      ${triagePending ? renderThinkingIndicator() : html``}
    </section>
  `;

  // Single consolidated footer: composer textarea on top, then a single
  // right-aligned row with Ask triage and Dismiss as ghost secondaries
  // sitting beside the Post reply primary on the right.
  const composer = isTerminal
    ? html`
      <div class="inbox-composer inbox-composer--terminal">
        <p class="dim" style="margin: 0; font-size: var(--font-size-sm);">
          This message is ${message.status}.${message.resolvedAt ? html` Closed ${formatAge(new Date(message.resolvedAt).toISOString())}.` : html``}
        </p>
      </div>
    `
    : html`
      <div class="inbox-composer">
        ${replyComposerOnly(message, triagePending ?? false)}
        <div class="inbox-composer__footer">
          <form method="POST" action="/inbox/${message.id}/triage" data-inbox-modal-form data-inbox-modal-keeps-triage="1" style="margin: 0;">
            <button type="submit" class="btn btn--sm btn--ghost" ${triagePending ? 'disabled' : ''}>
              ${triagePending ? 'Triaging…' : 'Ask triage'}
            </button>
          </form>
          <form method="POST" action="/inbox/${message.id}/dismiss" data-inbox-modal-form data-inbox-modal-dismiss-on-success="1" style="margin: 0;">
            <button type="submit" class="btn btn--sm btn--ghost">Dismiss</button>
          </form>
          <button type="submit" form="inbox-reply-form" class="btn btn--sm btn--primary"
            ${triagePending ? 'disabled' : ''}>
            ${triagePending ? 'Waiting…' : 'Post reply'}
          </button>
        </div>
      </div>
    `;

  // Title row: title (left) + star (right). Close × lives in the modal
  // shell's corner (see inbox-modal.ts). The old "Close" link at the
  // bottom-right is gone.
  return html`
    <div class="inbox-detail">
      <div class="inbox-detail__header">
        <header class="inbox-modal__title-row">
          <h3 id="inbox-modal-title" class="inbox-modal__title">${message.title}</h3>
          ${starControl}
        </header>
        ${headerMeta}
        ${tagsBlock}
        ${flashBlock}
        ${bodyBlock}
        ${contextBlock}
      </div>
      <div class="inbox-detail__thread">
        ${timelineBlock}
      </div>
      ${composer}
    </div>
  `;
}

/**
 * Composer textarea only — the submit button moves into the
 * footer row alongside Ask triage / Dismiss. The `<form id>` lets
 * the footer's primary button reach it via `form="inbox-reply-form"`.
 */
function replyComposerOnly(message: InboxMessage, triagePending: boolean): SafeHtml {
  if (message.status === 'dismissed' || message.status === 'resolved') return html``;
  return html`
    <form id="inbox-reply-form" method="POST" action="/inbox/${message.id}/respond"
      data-inbox-modal-form data-inbox-modal-keeps-triage="1" class="inbox-composer__form">
      <textarea name="body" rows="3" required maxlength="8192"
        ${triagePending ? 'disabled' : ''}
        placeholder="Describe what you tried, ask a follow-up, or note a decision. The triage agent will respond."
        class="form-field inbox-composer__textarea"></textarea>
    </form>
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
          <button type="button" class="inbox-msg__copy" data-inbox-copy
            aria-label="Copy ${role} message"
            title="Copy this message">
            <span data-inbox-copy-label>Copy</span>
          </button>
        </div>
        <div class="inbox-msg__text" data-inbox-copy-source>${r.body}</div>
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
      // Action-running picks up the same witty-label rotation as the
      // triage indicator — different phase, different label set
      // ("Dispatching…", "Crunching…"). data-action-running is the
      // hook the modal-poll watchdog uses to keep the modal alive
      // while the sub-agent runs.
      return html`
        <div class="inbox-action__running inbox-thinking" data-action-running="1" data-thinking-phase="action-running">
          <span class="inbox-thinking__label" data-thinking-label>Running</span>
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
  // data-thinking-phase lets the modal JS pick the right label set
  // when it rotates copy underneath the dots. The default seed text
  // is a sensible label so users with JS disabled (or before the
  // rotation loop fires) still see something coherent.
  return html`
    <div class="inbox-thinking" data-triage-pending="1" data-thinking-phase="triage">
      <div class="inbox-thinking__avatar">Tri</div>
      <div>
        <span class="inbox-thinking__label" data-thinking-label>Triage agent is thinking</span>
        <span class="inbox-thinking__dots"><span></span><span></span><span></span></span>
      </div>
    </div>
  `;
}

