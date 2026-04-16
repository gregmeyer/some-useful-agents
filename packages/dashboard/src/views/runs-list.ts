import type { Run, RunStatus } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { statusBadge, formatDuration, formatAge } from './components.js';

export interface RunsListOptions {
  rows: Run[];
  total: number;
  limit: number;
  offset: number;
  filter: {
    agent?: string;
    statuses: string[];
    triggeredBy?: string;
    q?: string;
  };
  distinct: {
    agents: string[];
    statuses: string[];
    triggeredBy: string[];
  };
  /** Banner shown above the filter bar (redirected errors from mutation routes). */
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
}

const ALL_STATUSES: RunStatus[] = ['pending', 'running', 'completed', 'failed', 'cancelled'];

export function renderRunsList(opts: RunsListOptions): string {
  const { rows, total, limit, offset, filter, distinct, flash } = opts;

  const showingStart = total === 0 ? 0 : offset + 1;
  const showingEnd = Math.min(offset + rows.length, total);

  const prevOffset = Math.max(0, offset - limit);
  const nextOffset = offset + limit;

  const runRows = rows.map((r) => html`
    <tr>
      <td><a href="/runs/${r.id}" class="mono">${r.id.slice(0, 8)}</a></td>
      <td><a href="/agents/${r.agentName}">${r.agentName}</a></td>
      <td>${statusBadge(r.status)}</td>
      <td class="dim">${formatAge(r.startedAt)}</td>
      <td class="dim">${formatDuration(r.startedAt, r.completedAt)}</td>
      <td class="dim">${r.triggeredBy}</td>
    </tr>
  `);

  const agentOptions = distinct.agents.map((a) => html`
    <option value="${a}" ${filter.agent === a ? 'selected' : ''}>${a}</option>
  `);

  const triggeredByOptions = distinct.triggeredBy.map((t) => html`
    <option value="${t}" ${filter.triggeredBy === t ? 'selected' : ''}>${t}</option>
  `);

  // Status checkboxes — more ergonomic than a multi-select for 5 values.
  const statusChecks = ALL_STATUSES.map((s) => html`
    <label class="filters__status-check mono">
      <input type="checkbox" name="status" value="${s}" ${filter.statuses.includes(s) ? 'checked' : ''}>
      ${s}
    </label>
  `);

  const filterBar = html`
    <form class="filters" method="GET" action="/runs">
      <label>
        Agent
        <select name="agent">
          <option value="">any</option>
          ${agentOptions as unknown as SafeHtml[]}
        </select>
      </label>
      <label>
        Triggered by
        <select name="triggeredBy">
          <option value="">any</option>
          ${triggeredByOptions as unknown as SafeHtml[]}
        </select>
      </label>
      <label>
        Search
        <input type="text" name="q" value="${filter.q ?? ''}" placeholder="id prefix or agent name">
      </label>
      <label class="filters__status">
        Status
        <div class="filters__status-row">${statusChecks as unknown as SafeHtml[]}</div>
      </label>
      <button type="submit" class="btn btn--primary">Apply</button>
      <a class="btn btn--ghost btn--sm filters__reset" href="/runs">Reset</a>
    </form>
  `;

  const hasAnyFilter = filter.agent !== undefined
    || filter.triggeredBy !== undefined
    || (filter.q !== undefined && filter.q.length > 0)
    || filter.statuses.length > 0;

  const table = rows.length === 0
    ? hasAnyFilter
      ? html`
        <div class="settings-empty" style="margin-top: 0;">
          <h3 style="margin-top: 0;">No runs match</h3>
          <p class="dim">No runs match the current filters. <a href="/runs">Reset filters</a> to see everything.</p>
        </div>`
      : html`
        <div class="settings-empty" style="margin-top: 0;">
          <h3 style="margin-top: 0;">No runs yet</h3>
          <p class="dim">Trigger your first run from the <a href="/agents">Agents</a> page or <code>sua workflow run &lt;id&gt;</code>.</p>
        </div>`
    : html`
      <table class="table">
        <thead>
          <tr>
            <th>ID</th><th>Agent</th><th>Status</th>
            <th>Started</th><th>Duration</th><th>Triggered</th>
          </tr>
        </thead>
        <tbody>${runRows as unknown as SafeHtml[]}</tbody>
      </table>
    `;

  const pager = total > 0 ? html`
    <div class="pager">
      <div>Showing ${String(showingStart)}–${String(showingEnd)} of ${String(total)}</div>
      <div>
        ${offset > 0 ? html`<a href="${buildUrl(filter, limit, prevOffset)}">← Prev</a>` : html`<span class="dim">← Prev</span>`}
        ${' '}
        ${nextOffset < total ? html`<a href="${buildUrl(filter, limit, nextOffset)}">Next →</a>` : html`<span class="dim">Next →</span>`}
      </div>
    </div>
  ` : html``;

  const body = html`
    ${pageHeader({ title: 'Runs' })}
    ${filterBar}
    ${table}
    ${pager}
  `;

  return render(layout({ title: 'Runs', activeNav: 'runs', flash }, body));
}

function buildUrl(filter: RunsListOptions['filter'], limit: number, offset: number): string {
  const params = new URLSearchParams();
  if (filter.agent) params.set('agent', filter.agent);
  if (filter.triggeredBy) params.set('triggeredBy', filter.triggeredBy);
  if (filter.q) params.set('q', filter.q);
  for (const s of filter.statuses) params.append('status', s);
  if (limit !== 50) params.set('limit', String(limit));
  if (offset !== 0) params.set('offset', String(offset));
  const qs = params.toString();
  return qs ? `/runs?${qs}` : '/runs';
}
