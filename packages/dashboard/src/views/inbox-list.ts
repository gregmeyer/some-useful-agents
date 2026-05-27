import type { InboxMessage, InboxPriority } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { formatAge } from './components.js';

export interface InboxListOptions {
  rows: InboxMessage[];
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
}

const PRIORITY_LABEL: Record<InboxPriority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const PRIORITY_HINT: Record<InboxPriority, string> = {
  high: 'Failed runs and other action-needed-now items',
  medium: 'Authorisations and pending decisions',
  low: 'Housekeeping reminders',
};

const SOURCE_LABEL: Record<string, string> = {
  'run-failure': 'Run failure',
  'permission-request': 'Permission',
  'cadence': 'Cadence',
  'manual': 'Manual',
};

/**
 * Render the inbox list page. Rows are grouped by priority into three
 * sections (High / Medium / Low) so the operator's eye lands on the
 * urgent items first. Within each section, rows are newest-first.
 * Mirrors the list-table pattern from runs-list.ts but groups
 * vertically instead of using a single sortable table.
 */
export function renderInboxList(opts: InboxListOptions): string {
  const { rows, flash } = opts;

  const groups: Record<InboxPriority, InboxMessage[]> = {
    high: rows.filter((r) => r.priority === 'high'),
    medium: rows.filter((r) => r.priority === 'medium'),
    low: rows.filter((r) => r.priority === 'low'),
  };

  const sections = (Object.keys(groups) as InboxPriority[]).map((priority) => {
    const items = groups[priority];
    if (items.length === 0) return html``;
    const tbody = items.map((m) => html`
      <tr>
        <td>${m.agentId ? html`<a href="/agents/${m.agentId}">${m.agentId}</a>` : html`<span class="dim">—</span>`}</td>
        <td><a href="/inbox/${m.id}">${m.title}</a></td>
        <td class="dim">${SOURCE_LABEL[m.source] ?? m.source}</td>
        <td class="dim">${formatAge(new Date(m.createdAt).toISOString())}</td>
        <td><span class="badge badge--muted">${m.status}</span></td>
      </tr>
    `);
    return html`
      <section style="margin-bottom: var(--space-5);">
        <h2 style="margin: 0 0 var(--space-1); font-size: var(--font-size-lg);">
          ${PRIORITY_LABEL[priority]}
          <span class="dim" style="font-weight: var(--weight-regular); font-size: var(--font-size-sm); margin-left: var(--space-2);">
            ${String(items.length)} ${items.length === 1 ? 'item' : 'items'}
          </span>
        </h2>
        <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-2);">${PRIORITY_HINT[priority]}</p>
        <table class="table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Title</th>
              <th>Source</th>
              <th>Age</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${tbody as unknown as SafeHtml[]}</tbody>
        </table>
      </section>
    `;
  });

  const empty = rows.length === 0
    ? html`
      <div class="settings-empty mt-0">
        <h3 class="mt-0">Inbox zero</h3>
        <p class="dim">
          No items need your attention. Producers (failed-run hooks, CSP-block escalation,
          cadence reminders) ship in upcoming PRs — until then this page shows demo data
          with <code>SUA_INBOX_DEMO=1</code>.
        </p>
      </div>`
    : html``;

  const body = html`
    ${pageHeader({
      title: 'Inbox',
      description: 'Things that need your attention, ordered by priority.',
    })}
    ${empty}
    ${sections as unknown as SafeHtml[]}
  `;

  return render(layout({ title: 'Inbox', activeNav: 'inbox', flash }, body));
}
