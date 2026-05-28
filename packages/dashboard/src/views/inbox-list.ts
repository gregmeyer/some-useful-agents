import type { InboxMessage, InboxPriority, InboxSource } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { formatAge } from './components.js';
import { renderInboxModalShell } from './inbox-modal.js';

export type InboxSortKey = 'priority' | 'source' | 'agent' | 'title' | 'age' | 'status';
export type InboxSortDir = 'asc' | 'desc';

export interface InboxListOptions {
  rows: InboxMessage[];
  sort: InboxSortKey;
  dir: InboxSortDir;
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
  /** Current filter state, used to repopulate the search bar. */
  filter?: { q: string; starred: boolean; tag: string };
  /** All tags currently in use across the inbox, for the tag dropdown. */
  allTags?: string[];
}

export const INBOX_DEFAULT_SORT: { sort: InboxSortKey; dir: InboxSortDir } = {
  sort: 'priority',
  dir: 'asc',
};

const PRIORITY_BADGE: Record<InboxPriority, string> = {
  high: 'badge--warn',
  medium: 'badge--info',
  low: 'badge--muted',
};

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
 * Client-side sort. Keeps the store API focused on its canonical
 * priority+age order and lets the UI own presentation.
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
          || (b.createdAt - a.createdAt);
      case 'age':
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

function sortUrl(col: InboxSortKey, current: { sort: InboxSortKey; dir: InboxSortDir }): string {
  const sameCol = col === current.sort;
  const dir: InboxSortDir = sameCol
    ? (current.dir === 'asc' ? 'desc' : 'asc')
    : (col === 'age' || col === 'status') ? 'desc' : 'asc';
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
 * Single sortable grid. Each `<tr>` carries `data-inbox-row-id` so
 * inbox-modal.js intercepts clicks and opens the message in a modal
 * — no page navigation. The `<a>` inside still navigates as a
 * fallback for right-click "open in new tab" + no-JS users.
 */
export function renderInboxList(opts: InboxListOptions): string {
  const { rows, sort, dir, flash } = opts;
  const filter = opts.filter ?? { q: '', starred: false, tag: '' };
  const allTags = opts.allTags ?? [];
  const sorted = sortMessages(rows, sort, dir);
  const current = { sort, dir };
  const hasActiveFilter = !!filter.q || filter.starred || !!filter.tag;

  const header = (col: InboxSortKey, label: string): SafeHtml => html`
    <th><a href="${sortUrl(col, current)}" class="inbox-sort-header">${label}${sortIndicator(col, current)}</a></th>
  `;

  const tagOptions = allTags.map((t) => html`
    <option value="${t}" ${filter.tag === t ? 'selected' : ''}>${t}</option>
  `);

  // Search + filter bar above the table. The form GETs back to /inbox
  // so filters live in the URL and can be bookmarked / shared. A
  // simple Clear button strips every param.
  const filterBar = html`
    <form class="inbox-filter" method="GET" action="/inbox">
      <input type="text" name="q" value="${filter.q}" placeholder="Search title, body, agent, or conversation…"
        class="form-field inbox-filter__q">
      <label class="inbox-filter__starred">
        <input type="checkbox" name="starred" value="1" ${filter.starred ? 'checked' : ''}>
        ★ Starred only
      </label>
      <select name="tag" class="form-field inbox-filter__tag">
        <option value="">All tags</option>
        ${tagOptions as unknown as SafeHtml[]}
      </select>
      <button type="submit" class="btn btn--sm btn--primary">Apply</button>
      ${hasActiveFilter ? html`<a class="btn btn--sm btn--ghost" href="/inbox">Clear</a>` : html``}
    </form>
  `;

  const tagChips = (tags: string[]): SafeHtml => tags.length === 0
    ? html``
    : html`<span class="inbox-tag-chips">${tags.map((t) => html`<a href="/inbox?tag=${encodeURIComponent(t)}" class="inbox-tag-chip" data-inbox-row-stop>${t}</a>`) as unknown as SafeHtml[]}</span>`;

  const tbody = sorted.map((m) => html`
    <tr data-inbox-row-id="${m.id}" class="inbox-row">
      <td>
        <form method="POST" action="/inbox/${m.id}/star" data-inbox-row-stop data-inbox-star-form style="margin:0;">
          <input type="hidden" name="starred" value="${m.starred ? '0' : '1'}">
          <button type="submit" class="inbox-star ${m.starred ? 'inbox-star--on' : ''}" aria-label="${m.starred ? 'Unstar' : 'Star'}">★</button>
        </form>
      </td>
      <td><span class="badge ${PRIORITY_BADGE[m.priority]}">${m.priority}</span></td>
      <td><span class="badge ${SOURCE_BADGE[m.source]}">${SOURCE_LABEL[m.source]}</span></td>
      <td>${m.agentId ? html`<a href="/agents/${m.agentId}" data-inbox-row-stop>${m.agentId}</a>` : html`<span class="dim">—</span>`}</td>
      <td>
        <a href="/inbox/${m.id}" data-inbox-row-link>${m.title}</a>
        ${tagChips(m.tags)}
      </td>
      <td class="dim">${formatAge(new Date(m.createdAt).toISOString())}</td>
      <td><span class="badge badge--muted">${m.status}</span></td>
    </tr>
  `);

  const emptyState = hasActiveFilter
    ? html`
      <div class="settings-empty mt-0">
        <h3 class="mt-0">No matches</h3>
        <p class="dim">No inbox items match the current filter. <a href="/inbox">Clear filters</a> to see everything.</p>
      </div>`
    : html`
      <div class="settings-empty mt-0">
        <h3 class="mt-0">Inbox zero</h3>
        <p class="dim">
          No items need your attention. Producers (failed-run hooks, CSP-block escalation,
          cadence reminders) ship in upcoming PRs — until then this page shows demo data
          with <code>SUA_INBOX_DEMO=1</code>.
        </p>
      </div>`;

  const table = rows.length === 0
    ? emptyState
    : html`
      <table class="table inbox-table">
        <thead>
          <tr>
            <th aria-label="Star"></th>
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
      description: 'Things that need your attention. Click a row to open. Click a column header to sort.',
    })}
    ${filterBar}
    ${table}
    ${renderInboxModalShell()}
  `;

  return render(layout({ title: 'Inbox', activeNav: 'inbox', flash }, body));
}
