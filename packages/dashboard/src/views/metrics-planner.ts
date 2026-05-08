import type { PlannerTelemetryStats, PlannerTelemetryRow } from '@some-useful-agents/core';
import { html, render } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';

function formatPercent(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function formatMs(n: number | null): string {
  if (n == null) return '—';
  if (n < 1000) return `${n}ms`;
  return `${(n / 1000).toFixed(1)}s`;
}

function formatStatus(s: string): string {
  if (s === 'ok') return 'ok';
  if (s === 'no-json') return 'no-json';
  if (s === 'schema-invalid') return 'schema-invalid';
  return s;
}

export function renderPlannerMetrics(args: {
  stats: PlannerTelemetryStats;
  recent: PlannerTelemetryRow[];
}): string {
  const { stats, recent } = args;
  const histogramRows = Object.entries(stats.extractStatusHistogram)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => html`
      <tr>
        <td><code>${formatStatus(status)}</code></td>
        <td style="text-align: right; font-variant-numeric: tabular-nums;">${String(count)}</td>
        <td style="text-align: right; font-variant-numeric: tabular-nums;" class="dim">${stats.totalAttempted > 0 ? formatPercent(count / stats.totalAttempted) : '—'}</td>
      </tr>
    `);

  const recentRows = recent.map((r) => html`
    <tr>
      <td><a href="/runs/${r.runId}" class="mono">${r.runId.slice(0, 8)}</a></td>
      <td><code>${formatStatus(r.planExtractStatus)}</code></td>
      <td style="text-align: right; font-variant-numeric: tabular-nums;">${String(r.planAttempts)}</td>
      <td style="text-align: right; font-variant-numeric: tabular-nums;">${String(r.planAutofixCount)}</td>
      <td style="text-align: right; font-variant-numeric: tabular-nums;">${formatMs(r.timeToPlanMs)}</td>
      <td style="text-align: right; font-variant-numeric: tabular-nums;">${r.committedAt ? formatMs(r.timeToCommitMs) : html`<span class="dim">—</span>`}</td>
      <td class="dim" style="font-size: var(--font-size-xs);">${r.intent ?? ''}</td>
      <td class="dim" style="font-size: var(--font-size-xs); max-width: 32ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${r.goal ?? ''}</td>
    </tr>
  `);

  const body = html`
    ${pageHeader({
      title: 'Planner metrics',
      description: `Build-planner telemetry from the last ${String(stats.windowDays)} days. ` +
        `Tracks how often plans extract cleanly on the first attempt, how much autoFixYaml ` +
        `has to rescue, and how plans-attempted maps to plans-committed.`,
    })}

    <section class="card" style="margin-bottom: var(--space-6);">
      <p class="card__title">Headline metrics</p>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--space-4); margin-top: var(--space-3);">
        <div>
          <div class="dim" style="font-size: var(--font-size-xs);">Plans attempted</div>
          <div style="font-size: var(--font-size-xl); font-variant-numeric: tabular-nums;">${String(stats.totalAttempted)}</div>
        </div>
        <div>
          <div class="dim" style="font-size: var(--font-size-xs);">Plans committed</div>
          <div style="font-size: var(--font-size-xl); font-variant-numeric: tabular-nums;">${String(stats.totalCommitted)}</div>
          <div class="dim" style="font-size: var(--font-size-xs);">${formatPercent(stats.commitRate)} commit rate</div>
        </div>
        <div>
          <div class="dim" style="font-size: var(--font-size-xs);">First-attempt clean</div>
          <div style="font-size: var(--font-size-xl); font-variant-numeric: tabular-nums;">${formatPercent(stats.firstAttemptCleanRate)}</div>
          <div class="dim" style="font-size: var(--font-size-xs);">extract=ok &amp; attempts=1</div>
        </div>
        <div>
          <div class="dim" style="font-size: var(--font-size-xs);">Avg attempts</div>
          <div style="font-size: var(--font-size-xl); font-variant-numeric: tabular-nums;">${stats.averageAttempts.toFixed(2)}</div>
        </div>
        <div>
          <div class="dim" style="font-size: var(--font-size-xs);">Avg autoFix rescues</div>
          <div style="font-size: var(--font-size-xl); font-variant-numeric: tabular-nums;">${stats.averageAutofixCount.toFixed(2)}</div>
          <div class="dim" style="font-size: var(--font-size-xs);">per plan</div>
        </div>
        <div>
          <div class="dim" style="font-size: var(--font-size-xs);">Plan latency</div>
          <div style="font-size: var(--font-size-xl); font-variant-numeric: tabular-nums;">${formatMs(stats.p50PlanMs)}</div>
          <div class="dim" style="font-size: var(--font-size-xs);">p50 / p95 ${formatMs(stats.p95PlanMs)}</div>
        </div>
      </div>
    </section>

    <section class="card" style="margin-bottom: var(--space-6);">
      <p class="card__title">Extract status histogram</p>
      ${histogramRows.length === 0
        ? html`<p class="dim" style="margin: var(--space-3) 0 0;">No completed plan-extracts in this window.</p>`
        : html`
          <table class="table" style="margin-top: var(--space-3);">
            <thead><tr><th>Status</th><th style="text-align: right;">Count</th><th style="text-align: right;">Share</th></tr></thead>
            <tbody>${histogramRows}</tbody>
          </table>
        `}
    </section>

    <section class="card">
      <p class="card__title">Recent runs</p>
      ${recent.length === 0
        ? html`<p class="dim" style="margin: var(--space-3) 0 0;">No planner runs recorded yet.</p>`
        : html`
          <table class="table" style="margin-top: var(--space-3); font-size: var(--font-size-sm);">
            <thead>
              <tr>
                <th>Run</th>
                <th>Extract</th>
                <th style="text-align: right;">Attempts</th>
                <th style="text-align: right;">AutoFix</th>
                <th style="text-align: right;">Plan ms</th>
                <th style="text-align: right;">Commit ms</th>
                <th>Intent</th>
                <th>Goal</th>
              </tr>
            </thead>
            <tbody>${recentRows}</tbody>
          </table>
        `}
    </section>
  `;

  return render(layout({ title: 'Planner metrics' }, body));
}
