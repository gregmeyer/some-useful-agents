/**
 * /scheduled — list every agent with a cron schedule, regardless of status,
 * with one-click pause / resume per row. Surfaces what the home widget
 * filters out: agents with `schedule: ...` declared but `status: paused`
 * are scheduled-in-intent even if they don't fire today, and the user
 * needs to see them here to decide whether to resume or clear.
 *
 * Clear-schedule (permanent removal) is intentionally NOT a row action —
 * it's a less-reversible decision and lives on the agent detail page
 * (POST /agents/:id/schedule). Run-now likewise lives elsewhere; this
 * page is the management surface, not the operate-it surface.
 */

import type { Agent } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { sectionTabs } from './section-tabs.js';
import { cronToHuman, formatAge, statusBadge } from './components.js';

export interface ScheduledRowInput {
  agent: Agent;
  /** ISO timestamp of the last scheduler-triggered run, if any. */
  lastFireAt?: string;
  /** ISO timestamp of the next scheduled fire, from heartbeat. */
  nextFireAt?: string;
}

export interface ScheduledViewInput {
  rows: ScheduledRowInput[];
  /** Scheduler daemon status — same set as the home widget. */
  schedulerStatus: 'running' | 'idle' | 'stale' | 'stopped';
  /**
   * When set, banner above the table. POSTed from pause/resume handlers
   * via ?flash=... so the user sees confirmation without a JS toast.
   * Treated as info-level — no error path on a successful redirect.
   */
  flash?: string;
}

/** Page-level render. Single call site (routes/scheduled.ts). */
export function renderScheduledPage(input: ScheduledViewInput): string {
  const { rows, schedulerStatus, flash } = input;

  const activeCount = rows.filter((r) => r.agent.status === 'active').length;
  const pausedCount = rows.filter((r) => r.agent.status === 'paused').length;
  const otherCount = rows.length - activeCount - pausedCount;

  const description = rows.length === 0
    ? 'No agents have a cron schedule yet.'
    : `${rows.length} scheduled agent${rows.length === 1 ? '' : 's'} — ` +
      `${activeCount} active` +
      (pausedCount > 0 ? `, ${pausedCount} paused` : '') +
      (otherCount > 0 ? `, ${otherCount} other` : '') +
      `. Scheduler: ${schedulerStatus}.`;

  const body = html`
    ${pageHeader({ title: 'Scheduled', description })}
    ${sectionTabs('scheduled')}
    ${renderEmptyState(rows)}
    ${rows.length > 0 ? renderTable(rows) : html``}
  `;

  return render(layout(
    {
      title: 'Scheduled agents',
      activeNav: 'agents',
      flash: flash ? { kind: 'info', message: flash } : undefined,
    },
    body,
  ));
}

function renderEmptyState(rows: ScheduledRowInput[]): SafeHtml {
  if (rows.length > 0) return html``;
  return html`
    <div class="card" style="padding: var(--space-6); text-align: center;">
      <p style="margin: 0 0 var(--space-2);">No scheduled agents.</p>
      <p class="dim" style="font-size: var(--font-size-xs); margin: 0;">
        Add a <code>schedule:</code> field (cron syntax) to an agent's YAML to
        automate runs. See the
        <a href="/help/cron">cron quick reference</a> if you need a refresher.
      </p>
    </div>
  `;
}

function renderTable(rows: ScheduledRowInput[]): SafeHtml {
  // Sorted by next-fire (earliest first), then alphabetically by id so rows
  // are stable when the heartbeat hasn't yet populated nextFireAt.
  const sorted = [...rows].sort((a, b) => {
    const aNext = a.nextFireAt ? new Date(a.nextFireAt).getTime() : Number.POSITIVE_INFINITY;
    const bNext = b.nextFireAt ? new Date(b.nextFireAt).getTime() : Number.POSITIVE_INFINITY;
    if (aNext !== bNext) return aNext - bNext;
    return a.agent.id.localeCompare(b.agent.id);
  });

  return html`
    <table class="table" style="width: 100%; margin-top: var(--space-4);">
      <thead>
        <tr>
          <th>Agent</th>
          <th>Status</th>
          <th>Schedule</th>
          <th>Last fire</th>
          <th>Next fire</th>
          <th style="text-align: right;">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map(renderRow) as unknown as SafeHtml[]}
      </tbody>
    </table>
  `;
}

function renderRow(row: ScheduledRowInput): SafeHtml {
  const { agent, lastFireAt, nextFireAt } = row;
  const isActive = agent.status === 'active';
  const isPaused = agent.status === 'paused';

  // Next-fire is only meaningful when the agent is active (paused agents
  // have nextFireAt computed by the scheduler-heartbeat as "what it WOULD
  // be" — but rendering that confuses users). For non-active rows, show "—".
  const nextStr = isActive && nextFireAt
    ? formatRelative(nextFireAt, true)
    : html`<span class="dim">—</span>`;
  const lastStr = lastFireAt ? formatAge(lastFireAt) : html`<span class="dim">never</span>`;

  return html`
    <tr>
      <td>
        <a href="/agents/${agent.id}" class="mono" style="font-weight: var(--weight-semibold);">${agent.id}</a>
        ${agent.description ? html`<div class="dim" style="font-size: var(--font-size-xs); max-width: 36ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${agent.description}</div>` : html``}
      </td>
      <td>${statusBadge(agent.status)}</td>
      <td>
        <span title="${agent.schedule ?? ''}">${cronToHuman(agent.schedule ?? '')}</span>
      </td>
      <td>${lastStr}</td>
      <td>${nextStr}</td>
      <td style="text-align: right; white-space: nowrap;">
        ${isActive ? renderPauseForm(agent.id) : html``}
        ${isPaused ? renderResumeForm(agent.id) : html``}
        <a href="/agents/${agent.id}/config" class="btn btn--sm btn--ghost" style="margin-left: var(--space-2);">Edit</a>
      </td>
    </tr>
  `;
}

function renderPauseForm(agentId: string): SafeHtml {
  return html`
    <form method="POST" action="/scheduled/${agentId}/pause" style="display: inline;">
      <button type="submit" class="btn btn--sm" title="Pause this agent. Schedule cron stays declared; resume restores firing.">Pause</button>
    </form>
  `;
}

function renderResumeForm(agentId: string): SafeHtml {
  return html`
    <form method="POST" action="/scheduled/${agentId}/resume" style="display: inline;">
      <button type="submit" class="btn btn--sm btn--primary" title="Resume this agent. Scheduler will fire on its declared cron.">Resume</button>
    </form>
  `;
}

/**
 * Future-leaning relative time string. The home widget has a private copy
 * of this — kept separate so they can diverge if the page needs more
 * detail. Returns "now", "5m", "2h", "3d", etc.
 */
function formatRelative(iso: string, future = false): string {
  const diff = future
    ? new Date(iso).getTime() - Date.now()
    : Date.now() - new Date(iso).getTime();
  if (diff < 0) return future ? 'now' : 'just now';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
