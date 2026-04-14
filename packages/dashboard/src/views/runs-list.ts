import type { Run, RunStatus } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
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
}

const ALL_STATUSES: RunStatus[] = ['pending', 'running', 'completed', 'failed', 'cancelled'];

export function renderRunsList(opts: RunsListOptions): string {
  const { rows, total, limit, offset, filter, distinct } = opts;

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
    <label class="mono" style="flex-direction: row; gap: 0.25rem; align-items: center;">
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
      <label style="gap: 0.35rem;">
        Status
        <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">${statusChecks as unknown as SafeHtml[]}</div>
      </label>
      <button type="submit">Apply</button>
      <a class="reset" href="/runs">Reset</a>
    </form>
  `;

  const table = rows.length === 0
    ? html`<p class="dim">No runs match the current filters.</p>`
    : html`
      <table>
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

  const body = html`<h1>Runs</h1>${filterBar}${table}${pager}`;

  return render(layout({ title: 'Runs', activeNav: 'runs' }, body));
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
