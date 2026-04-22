/**
 * System widget builders for the home page. Each builder computes data from
 * the stores and returns an OutputWidgetSchema + JSON output string. The
 * existing renderOutputWidget() handles all rendering.
 */

import type { Agent, Run, OutputWidgetSchema, SchedulerStatus, SchedulerHeartbeat } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from './html.js';
import { renderOutputWidget } from './output-widgets.js';
import { statusBadge, formatAge, formatDuration, cronToHuman } from './components.js';

export interface HomeWidgetData {
  agents: Agent[];
  recentRuns: Run[];
  todayRuns: Run[];
  inFlightRuns: Run[];
  scheduledAgents: Agent[];
  /** Current page of the activity feed (1-based). Defaults to 1. */
  activityPage?: number;
  /** Items per page for the activity feed. Defaults to 10. */
  activityPageSize?: number;
  /** Total run count (for computing "has next page"). */
  totalRunCount?: number;
  /** Scheduler status from heartbeat file. */
  schedulerStatus?: SchedulerStatus;
  /** Scheduler heartbeat data (next fire times, etc.). */
  schedulerHeartbeat?: SchedulerHeartbeat | null;
  /** Last scheduled fire time per agent (from run store). */
  lastScheduledFires?: Record<string, string>;
}

interface SystemWidget {
  id: string;
  title: string;
  icon: string;
  html: SafeHtml;
}

// ── Widget builders ─────────────────────────────────────────────────────

function buildRunsToday(data: HomeWidgetData): SystemWidget {
  const { todayRuns } = data;
  const completed = todayRuns.filter((r) => r.status === 'completed').length;
  const failed = todayRuns.filter((r) => r.status === 'failed').length;

  const schema: OutputWidgetSchema = {
    type: 'dashboard',
    fields: [
      { name: 'total', label: 'Runs today', type: 'metric' },
      { name: 'completed', label: 'Completed', type: 'stat' },
      { name: 'failed', label: 'Failed', type: 'stat' },
    ],
  };
  const output = JSON.stringify({ total: String(todayRuns.length), completed: String(completed), failed: String(failed) });
  const widgetHtml = renderOutputWidget(schema, output, '_home-runs-today');

  return {
    id: '_home-runs-today',
    title: 'Runs Today',
    icon: '\u{1F4CA}',
    html: widgetHtml ?? html`<p class="dim">No data</p>`,
  };
}

function buildFailureRate(data: HomeWidgetData): SystemWidget {
  const { todayRuns } = data;
  const failed = todayRuns.filter((r) => r.status === 'failed').length;
  const rate = todayRuns.length > 0 ? Math.round((failed / todayRuns.length) * 100) : 0;
  const label = todayRuns.length === 0 ? 'No runs today' : `${String(failed)} of ${String(todayRuns.length)} failed`;

  const schema: OutputWidgetSchema = {
    type: 'dashboard',
    fields: [
      { name: 'rate', label: 'Failure rate', type: 'metric' },
      { name: 'detail', label: 'Detail', type: 'text' },
    ],
  };
  const output = JSON.stringify({ rate: `${String(rate)}%`, detail: label });
  const widgetHtml = renderOutputWidget(schema, output, '_home-failure-rate');

  return {
    id: '_home-failure-rate',
    title: 'Failure Rate',
    icon: '\u26A0\uFE0F',
    html: widgetHtml ?? html`<p class="dim">No data</p>`,
  };
}

function buildInFlight(data: HomeWidgetData): SystemWidget {
  const { inFlightRuns } = data;

  if (inFlightRuns.length === 0) {
    const schema: OutputWidgetSchema = {
      type: 'dashboard',
      fields: [
        { name: 'count', label: 'In flight', type: 'metric' },
        { name: 'status', label: 'Status', type: 'text' },
      ],
    };
    const output = JSON.stringify({ count: '0', status: 'Nothing running' });
    const widgetHtml = renderOutputWidget(schema, output, '_home-in-flight');
    return {
      id: '_home-in-flight',
      title: 'In Flight',
      icon: '\u{1F680}',
      html: widgetHtml ?? html`<p class="dim">No data</p>`,
    };
  }

  const fields: OutputWidgetSchema['fields'] = [
    { name: 'count', label: 'In flight', type: 'metric' },
  ];
  const outputObj: Record<string, string> = { count: String(inFlightRuns.length) };

  // Add each running agent as a text field (up to 5).
  for (const r of inFlightRuns.slice(0, 5)) {
    const key = `run_${r.id.slice(0, 8)}`;
    fields.push({ name: key, label: r.agentName, type: 'text' });
    outputObj[key] = formatAge(r.startedAt).toString();
  }
  if (inFlightRuns.length > 5) {
    fields.push({ name: 'more', label: 'More', type: 'text' });
    outputObj.more = `+${String(inFlightRuns.length - 5)} more`;
  }

  const schema: OutputWidgetSchema = { type: 'key-value', fields };
  const output = JSON.stringify(outputObj);
  const widgetHtml = renderOutputWidget(schema, output, '_home-in-flight');

  return {
    id: '_home-in-flight',
    title: 'In Flight',
    icon: '\u{1F680}',
    html: widgetHtml ?? html`<p class="dim">No data</p>`,
  };
}

function buildAgents(data: HomeWidgetData): SystemWidget {
  const { agents, scheduledAgents } = data;
  const active = agents.filter((a) => a.status === 'active').length;

  const schema: OutputWidgetSchema = {
    type: 'dashboard',
    fields: [
      { name: 'total', label: 'Total agents', type: 'metric' },
      { name: 'active', label: 'Active', type: 'stat' },
      { name: 'scheduled', label: 'Scheduled', type: 'stat' },
    ],
  };
  const output = JSON.stringify({
    total: String(agents.length),
    active: String(active),
    scheduled: String(scheduledAgents.length),
  });
  const widgetHtml = renderOutputWidget(schema, output, '_home-agents');

  return {
    id: '_home-agents',
    title: 'Agents',
    icon: '\u{1F916}',
    html: widgetHtml ?? html`<p class="dim">No data</p>`,
  };
}

function buildRecentActivity(data: HomeWidgetData): SystemWidget {
  const { recentRuns } = data;
  const page = data.activityPage ?? 1;
  const pageSize = data.activityPageSize ?? 10;
  const totalCount = data.totalRunCount ?? recentRuns.length;

  if (recentRuns.length === 0 && page === 1) {
    return {
      id: '_home-recent-activity',
      title: 'Recent Activity',
      icon: '\u{1F4DD}',
      html: html`<p style="color: var(--color-text-muted); font-size: var(--font-size-sm);">No runs yet. <a href="/agents">Run an agent</a> to get started.</p>`,
    };
  }

  // Render activity cards for the current page.
  const cards = recentRuns.map((r) => {
    const isError = r.status === 'failed';
    const errorPreview = isError && r.error ? truncate(r.error, 100) : '';
    const outputPreview = !isError ? truncate(r.result, 120) : '';

    return html`
      <a href="/runs/${r.id}" style="text-decoration: none; color: inherit; display: block;">
        <div style="display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) 0; border-bottom: 1px solid var(--color-border);">
          <span class="mono" style="font-size: var(--font-size-xs); font-weight: var(--weight-semibold);">${r.agentName}</span>
          ${statusBadge(r.status)}
          <span style="font-size: 10px; color: var(--color-text-subtle); margin-left: auto; white-space: nowrap;">
            ${formatAge(r.startedAt)} \u00b7 ${formatDuration(r.startedAt, r.completedAt)}
          </span>
        </div>
        ${outputPreview ? html`<div style="font-family: var(--font-mono); font-size: 10px; color: var(--color-text-muted); line-height: 1.3; padding: 2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${outputPreview}</div>` : html``}
        ${errorPreview ? html`<div style="font-size: 10px; color: var(--color-err); line-height: 1.3; padding: 2px 0;">${errorPreview}</div>` : html``}
      </a>
    `;
  });

  // Pagination controls.
  const hasPrev = page > 1;
  const hasNext = page * pageSize < totalCount;
  const startItem = (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, totalCount);

  return {
    id: '_home-recent-activity',
    title: 'Recent Activity',
    icon: '\u{1F4DD}',
    html: html`
      <div style="display: flex; flex-direction: column;">
        ${cards as unknown as SafeHtml[]}
        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: var(--space-3); padding-top: var(--space-2); border-top: 1px solid var(--color-border);">
          <span style="font-size: var(--font-size-xs); color: var(--color-text-muted);">
            ${String(startItem)}\u2013${String(endItem)} of ${String(totalCount)}
          </span>
          <div style="display: flex; gap: var(--space-2); align-items: center;">
            ${hasPrev
              ? html`<a href="/?page=${String(page - 1)}${pageSize !== 10 ? `&pageSize=${String(pageSize)}` : ''}" class="btn btn--ghost btn--sm" style="padding: 2px 8px; font-size: var(--font-size-xs);">\u2190 Newer</a>`
              : html`<span class="btn btn--ghost btn--sm" style="padding: 2px 8px; font-size: var(--font-size-xs); opacity: 0.3; pointer-events: none;">\u2190 Newer</span>`
            }
            ${hasNext
              ? html`<a href="/?page=${String(page + 1)}${pageSize !== 10 ? `&pageSize=${String(pageSize)}` : ''}" class="btn btn--ghost btn--sm" style="padding: 2px 8px; font-size: var(--font-size-xs);">Older \u2192</a>`
              : html`<span class="btn btn--ghost btn--sm" style="padding: 2px 8px; font-size: var(--font-size-xs); opacity: 0.3; pointer-events: none;">Older \u2192</span>`
            }
          </div>
        </div>
        <p style="margin-top: var(--space-2); font-size: var(--font-size-xs);">
          <a href="/runs">View all runs &rarr;</a>
        </p>
      </div>
    `,
  };
}

function buildScheduled(data: HomeWidgetData): SystemWidget {
  const { scheduledAgents } = data;
  const status = data.schedulerStatus ?? 'stopped';
  const heartbeat = data.schedulerHeartbeat;
  const lastFires = data.lastScheduledFires ?? {};

  if (scheduledAgents.length === 0) {
    return {
      id: '_home-scheduled',
      title: 'Scheduled',
      icon: '\u{1F552}',
      html: html`<p style="color: var(--color-text-muted); font-size: var(--font-size-sm);">No agents have a cron schedule. Add <code>schedule:</code> to an agent YAML to automate runs.</p>`,
    };
  }

  // Status indicator.
  const statusDot = status === 'running'
    ? '\u{1F7E2}' // green circle
    : status === 'stale'
    ? '\u{1F7E1}' // yellow circle
    : '\u{1F534}'; // red circle
  const statusLabel = status === 'running'
    ? 'Scheduler running'
    : status === 'stale'
    ? 'Scheduler stale'
    : 'Scheduler stopped';

  // Build rows for each scheduled agent.
  const rows = scheduledAgents.map((a) => {
    const schedule = cronToHuman(a.schedule ?? '');
    const lastFire = lastFires[a.id];
    const lastStr = lastFire ? formatAge(lastFire) : 'never';
    const nextFire = heartbeat?.nextFires?.[a.id];
    const nextStr = nextFire ? formatRelativeTime(nextFire, true) : '';

    return html`
      <div style="display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) 0; border-bottom: 1px solid var(--color-border);">
        <a href="/agents/${a.id}" class="mono" style="font-size: var(--font-size-xs); font-weight: var(--weight-semibold); flex: 1;">${a.id}</a>
        <span style="font-size: 10px; color: var(--color-text-muted);" title="${a.schedule ?? ''}">${schedule}</span>
      </div>
      <div style="display: flex; gap: var(--space-3); font-size: 10px; color: var(--color-text-subtle); padding: 2px 0 4px;">
        <span>last: ${lastStr}</span>
        ${nextStr ? html`<span>next: ${nextStr}</span>` : html``}
      </div>
    `;
  });

  return {
    id: '_home-scheduled',
    title: 'Scheduled',
    icon: '\u{1F552}',
    html: html`
      <div>
        <div style="display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-3); padding-bottom: var(--space-2); border-bottom: 1px solid var(--color-border);">
          <span>${statusDot}</span>
          <span style="font-size: var(--font-size-xs); font-weight: var(--weight-semibold);">${statusLabel}</span>
        </div>
        ${rows as unknown as SafeHtml[]}
      </div>
    `,
  };
}

function buildQuickActions(): SystemWidget {
  return {
    id: '_home-quick-actions',
    title: 'Quick Actions',
    icon: '\u26A1',
    html: html`
      <div style="display: flex; flex-direction: column; gap: var(--space-2);">
        <a href="/agents/new" class="btn btn--sm" style="justify-content: center;">+ New agent</a>
        <a href="/agents" class="btn btn--sm btn--ghost" style="justify-content: center;">Browse agents</a>
        <a href="/help/tutorial" class="btn btn--sm btn--ghost" style="justify-content: center;">Tutorial</a>
      </div>
    `,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function formatRelativeTime(isoDate: string, future = false): string {
  const diff = future
    ? new Date(isoDate).getTime() - Date.now()
    : Date.now() - new Date(isoDate).getTime();
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

function truncate(text: string | undefined, max: number): string {
  if (!text) return '';
  const clean = text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1) + '\u2026';
}


// ── Exports ─────────────────────────────────────────────────────────────

export function buildHomeWidgets(data: HomeWidgetData): SystemWidget[] {
  return [
    buildRunsToday(data),
    buildFailureRate(data),
    buildInFlight(data),
    buildAgents(data),
    buildScheduled(data),
    buildRecentActivity(data),
    buildQuickActions(),
  ];
}

/**
 * Render a system widget as a pulse-tile with header and resize handle.
 * Matches the Pulse tile chrome so the shared layout JS can manage it.
 */
export function renderHomeWidget(widget: SystemWidget): SafeHtml {
  return unsafeHtml(
    `<div class="pulse-tile" data-agent-id="${escHtml(widget.id)}">` +
    `<div class="pulse-tile__header">` +
    `<span class="pulse-tile__icon">${widget.icon}</span>` +
    `<span class="pulse-tile__title">${escHtml(widget.title)}</span>` +
    `</div>` +
    `<div class="pulse-tile__body" style="padding: var(--space-3);">` +
    widget.html.toString() +
    `</div>` +
    `<div class="pulse-tile__resize-handle" data-agent-id="${escHtml(widget.id)}"></div>` +
    `</div>`
  );
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
