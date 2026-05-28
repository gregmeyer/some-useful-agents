import type { InboxMessage, InboxPriority, InboxSource } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { formatAge } from './components.js';

export type InboxSortKey = 'priority' | 'source' | 'agent' | 'title' | 'age' | 'status';
export type InboxSortDir = 'asc' | 'desc';

export interface InboxListOptions {
  rows: InboxMessage[];
  sort: InboxSortKey;
  dir: InboxSortDir;
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
}

/**
 * Default sort is priority ASC (high first) with age DESC as the
 * secondary tiebreaker — matches what the queue is *for*: the most
 * urgent recent thing on top.
 */
export const INBOX_DEFAULT_SORT: { sort: InboxSortKey; dir: InboxSortDir } = {
  sort: 'priority',
  dir: 'asc',
};

/**
 * Strong visual marker per priority — the operator's eye should pick
 * out high-pri rows at a glance. Mirrors the warn/info/muted palette
 * used elsewhere (badge--warn for failed runs, badge--info for active
 * status, badge--muted for neutral metadata).
 */
const PRIORITY_BADGE: Record<InboxPriority, string> = {
  high: 'badge--warn',
  medium: 'badge--info',
  low: 'badge--muted',
};

/**
 * Source labels + badge variants. The badge gives "what kind of issue
 * is this" affordance at a glance — the user asked for this in the
 * first dogfood pass.
 */
const SOURCE_LABEL: Record<InboxSource, string> = {
  'run-failure': 'Run failure',
  'permission-request': 'Permission',
  'cadence': 'Cadence',
  'manual': 'Manual',
};
const SOURCE_BADGE: Record<InboxSource, string> = {
  'run-failure': 'badge--warn',
  'permission-request': 'badge--info',
  'cadence': 'badge--muted',
  'manual': 'badge--muted',
};

const PRIORITY_RANK: Record<InboxPriority, number> = { high: 0, medium: 1, low: 2 };

/**
 * Sort messages client-side (JS, not SQL) — keeps the store API
 * focused on the canonical priority+age order and lets the UI layer
 * own presentation. Limit is 200 server-side; in-memory sort cost is
 * negligible.
 */
export function sortMessages(
  rows: InboxMessage[],
  sort: InboxSortKey,
  dir: InboxSortDir,
): InboxMessage[] {
  const sign = dir === 'asc' ? 1 : -1;
  const copy = rows.slice();
  copy.sort((a, b) => {
    switch (sort) {
      case 'priority':
        return sign * (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
          || (b.createdAt - a.createdAt); // newer first as tiebreaker
      case 'age':
        // age DESC (= "newest first") is what users mean by "by age".
        // Treat `asc` as oldest-first and `desc` as newest-first.
        return dir === 'asc' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt;
      case 'source':
        return sign * a.source.localeCompare(b.source) || (b.createdAt - a.createdAt);
      case 'agent':
        return sign * (a.agentId ?? '').localeCompare(b.agentId ?? '') || (b.createdAt - a.createdAt);
      case 'title':
        return sign * a.title.localeCompare(b.title);
      case 'status':
        return sign * a.status.localeCompare(b.status) || (b.createdAt - a.createdAt);
      default:
        return 0;
    }
  });
  return copy;
}

/**
 * Build the URL for a column header. Click the active column → flip
 * direction; click a different column → switch to it with that
 * column's natural default direction (priority asc, age desc, etc.).
 */
function sortUrl(col: InboxSortKey, current: { sort: InboxSortKey; dir: InboxSortDir }): string {
  const sameCol = col === current.sort;
  let dir: InboxSortDir;
  if (sameCol) {
    dir = current.dir === 'asc' ? 'desc' : 'asc';
  } else {
    // Per-column natural defaults: age + status are most useful
    // descending (newest first / triaged-on-top), the rest ascending.
    dir = (col === 'age' || col === 'status') ? 'desc' : 'asc';
  }
  const params = new URLSearchParams();
  if (col !== INBOX_DEFAULT_SORT.sort) params.set('sort', col);
  if (dir !== INBOX_DEFAULT_SORT.dir || col !== INBOX_DEFAULT_SORT.sort) params.set('dir', dir);
  const qs = params.toString();
  return qs ? `/inbox?${qs}` : '/inbox';
}

function sortIndicator(col: InboxSortKey, current: { sort: InboxSortKey; dir: InboxSortDir }): string {
  if (col !== current.sort) return '';
  return current.dir === 'asc' ? ' ↑' : ' ↓';
}

/**
 * Render the inbox list page as a single sortable grid. Each column
 * header is a link that toggles the sort direction (clicking the
 * active column) or switches to that column (default direction per
 * column). The "affordance for what kind of issue" comes from the
 * priority + source badges — the eye lands on warn-styled rows first.
 */
export function renderInboxList(opts: InboxListOptions): string {
  const { rows, sort, dir, flash } = opts;
  const sorted = sortMessages(rows, sort, dir);
  const current = { sort, dir };

  const header = (col: InboxSortKey, label: string): SafeHtml => html`
    <th><a href="${sortUrl(col, current)}" class="inbox-sort-header">${label}${sortIndicator(col, current)}</a></th>
  `;

  const tbody = sorted.map((m) => html`
    <tr>
      <td><span class="badge ${PRIORITY_BADGE[m.priority]}">${m.priority}</span></td>
      <td><span class="badge ${SOURCE_BADGE[m.source]}">${SOURCE_LABEL[m.source]}</span></td>
      <td>${m.agentId ? html`<a href="/agents/${m.agentId}">${m.agentId}</a>` : html`<span class="dim">—</span>`}</td>
      <td><a href="/inbox/${m.id}">${m.title}</a></td>
      <td class="dim">${formatAge(new Date(m.createdAt).toISOString())}</td>
      <td><span class="badge badge--muted">${m.status}</span></td>
    </tr>
  `);

  const table = rows.length === 0
    ? html`
      <div class="settings-empty mt-0">
        <h3 class="mt-0">Inbox zero</h3>
        <p class="dim">
          No items need your attention. Producers (failed-run hooks, CSP-block escalation,
          cadence reminders) ship in upcoming PRs — until then this page shows demo data
          with <code>SUA_INBOX_DEMO=1</code>.
        </p>
      </div>`
    : html`
      <table class="table">
        <thead>
          <tr>
            ${header('priority', 'Priority')}
            ${header('source', 'Source')}
            ${header('agent', 'Agent')}
            ${header('title', 'Title')}
            ${header('age', 'Age')}
            ${header('status', 'Status')}
          </tr>
        </thead>
        <tbody>${tbody as unknown as SafeHtml[]}</tbody>
      </table>
    `;

  const body = html`
    ${pageHeader({
      title: 'Inbox',
      description: 'Things that need your attention. Click a column header to sort.',
    })}
    ${table}
  `;

  return render(layout({ title: 'Inbox', activeNav: 'inbox', flash }, body));
}
