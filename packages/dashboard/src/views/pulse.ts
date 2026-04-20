import type { Agent, AgentSignal, Run, SignalTemplate } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { formatAge } from './components.js';
import { normalizeSignal, extractMappedValues } from './pulse-templates.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface PulseTile {
  agent: Agent;
  signal: AgentSignal;
  lastRun?: Run;
  /** Resolved slot values from extractMappedValues. */
  slots: Record<string, unknown>;
}

export interface PulsePageInput {
  tiles: PulseTile[];
  /** Hidden tiles (for the show/hide panel). */
  hiddenTiles: PulseTile[];
  stats: {
    runsToday: number;
    failedToday: number;
    avgDurationSec: number;
    agentCount: number;
  };
}

// ── Template renderers ───────────────────────────────────────────────────

function renderMetric(tile: PulseTile): SafeHtml {
  const val = tile.slots.value !== undefined ? String(tile.slots.value) : '--';
  const unit = tile.slots.unit ? String(tile.slots.unit) : '';
  const label = tile.slots.label ? String(tile.slots.label) : '';
  const prev = tile.slots.previous !== undefined ? Number(tile.slots.previous) : undefined;
  const curr = tile.slots.value !== undefined ? Number(tile.slots.value) : undefined;

  let trend = '';
  if (prev !== undefined && curr !== undefined && !isNaN(prev) && !isNaN(curr)) {
    if (curr > prev) trend = '\u2191';       // ↑
    else if (curr < prev) trend = '\u2193';  // ↓
    else trend = '\u2192';                   // →
  }
  const trendClass = trend === '\u2191' ? 'pulse-tile__trend--up'
    : trend === '\u2193' ? 'pulse-tile__trend--down'
    : 'pulse-tile__trend--flat';

  return html`
    <div class="pulse-tile pulse-tile--metric ${sizeClass(tile.signal.size)}">
      ${tileHeader(tile)}
      <div class="pulse-tile__value">
        ${val}${unit ? html`<span class="pulse-tile__unit">${unit}</span>` : html``}${trend ? html`<span class="pulse-tile__trend ${trendClass}">${trend}</span>` : html``}
      </div>
      ${label ? html`<div class="pulse-tile__label">${label}</div>` : html``}
      ${tileFooter(tile)}
    </div>
  `;
}

function renderTextHeadline(tile: PulseTile): SafeHtml {
  const headline = tile.slots.headline ? String(tile.slots.headline) : '';
  const body = tile.slots.body ? String(tile.slots.body) : 'No data yet';
  const truncBody = body.length > 500 ? body.slice(0, 500) + '...' : body;
  return html`
    <div class="pulse-tile pulse-tile--text-headline ${sizeClass(tile.signal.size)}">
      ${tileHeader(tile)}
      ${headline ? html`<div class="pulse-tile__headline">${headline}</div>` : html``}
      <div class="pulse-tile__body">${truncBody}</div>
      ${tileFooter(tile)}
    </div>
  `;
}

function renderTable(tile: PulseTile): SafeHtml {
  let rows: Record<string, unknown>[] = [];
  const rawRows = tile.slots.rows;
  if (Array.isArray(rawRows)) {
    rows = rawRows.slice(0, 10) as Record<string, unknown>[];
  } else if (typeof rawRows === 'string') {
    try {
      const parsed = JSON.parse(rawRows);
      if (Array.isArray(parsed)) rows = parsed.slice(0, 10) as Record<string, unknown>[];
    } catch { /* not JSON */ }
  }

  let cols: string[] = [];
  if (tile.slots.columns && Array.isArray(tile.slots.columns)) {
    cols = tile.slots.columns.map(String);
  } else if (rows.length > 0) {
    cols = Object.keys(rows[0]);
  }

  const tableHtml = rows.length === 0
    ? html`<p class="dim" style="font-size: var(--font-size-xs);">No data</p>`
    : unsafeHtml(`
      <table class="pulse-table">
        <thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) =>
          `<tr>${cols.map((c) => `<td>${esc(String(r[c] ?? ''))}</td>`).join('')}</tr>`
        ).join('')}</tbody>
      </table>
    `);

  return html`
    <div class="pulse-tile pulse-tile--table ${sizeClass(tile.signal.size)}">
      ${tileHeader(tile)}
      ${tableHtml}
      ${tileFooter(tile)}
    </div>
  `;
}

function renderStatus(tile: PulseTile): SafeHtml {
  const status = tile.slots.status ? String(tile.slots.status).toLowerCase() : 'unknown';
  const label = tile.slots.label ? String(tile.slots.label) : status;
  const message = tile.slots.message ? String(tile.slots.message) : '';
  const dotClass = status === 'healthy' || status === 'ok' || status === 'up'
    ? 'pulse-tile__status-dot--healthy'
    : status === 'degraded' || status === 'warn' || status === 'warning'
    ? 'pulse-tile__status-dot--degraded'
    : 'pulse-tile__status-dot--down';

  return html`
    <div class="pulse-tile pulse-tile--status ${sizeClass(tile.signal.size)}">
      ${tileHeader(tile)}
      <div style="display: flex; align-items: center; gap: var(--space-2); flex: 1;">
        <span class="pulse-tile__status-dot ${dotClass}"></span>
        <span class="pulse-tile__status-label">${label}</span>
      </div>
      ${message ? html`<div class="pulse-tile__status-message">${message}</div>` : html``}
      ${tileFooter(tile)}
    </div>
  `;
}

function renderTimeSeries(tile: PulseTile): SafeHtml {
  const values = Array.isArray(tile.slots.values) ? tile.slots.values.map(Number).filter((n) => !isNaN(n)) : [];
  const current = tile.slots.current !== undefined ? String(tile.slots.current) : (values.length > 0 ? String(values[values.length - 1]) : '--');
  const label = tile.slots.label ? String(tile.slots.label) : '';

  let sparkline = html`<div class="dim" style="font-size: var(--font-size-xs);">No data points</div>`;
  if (values.length >= 2) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const h = 40;
    const w = 200;
    const points = values.map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    sparkline = unsafeHtml(`<div class="pulse-tile__sparkline"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${points}"/></svg></div>`);
  }

  return html`
    <div class="pulse-tile pulse-tile--time-series ${sizeClass(tile.signal.size)}">
      ${tileHeader(tile)}
      <div class="pulse-tile__value" style="font-size: var(--font-size-xl);">${current}</div>
      ${sparkline}
      ${label ? html`<div class="pulse-tile__label">${label}</div>` : html``}
      ${tileFooter(tile)}
    </div>
  `;
}

function renderImage(tile: PulseTile): SafeHtml {
  const url = tile.slots.imageUrl ? String(tile.slots.imageUrl) : '';
  const alt = tile.slots.alt ? String(tile.slots.alt) : tile.signal.title;
  return html`
    <div class="pulse-tile pulse-tile--image ${sizeClass(tile.signal.size)}">
      ${tileHeader(tile)}
      ${url
        ? unsafeHtml(`<img class="pulse-tile__image" src="${esc(url)}" alt="${esc(alt)}" loading="lazy">`)
        : html`<div class="dim" style="font-size: var(--font-size-xs);">No image URL</div>`}
      ${tileFooter(tile)}
    </div>
  `;
}

function renderTextImage(tile: PulseTile): SafeHtml {
  const text = tile.slots.text ? String(tile.slots.text) : '';
  const url = tile.slots.imageUrl ? String(tile.slots.imageUrl) : '';
  const truncText = text.length > 300 ? text.slice(0, 300) + '...' : text;
  return html`
    <div class="pulse-tile pulse-tile--text-image ${sizeClass(tile.signal.size)}">
      ${tileHeader(tile)}
      <div style="display: flex; gap: var(--space-3); flex: 1;">
        <div class="pulse-tile__body" style="flex: 1;">${truncText || 'No text'}</div>
        ${url
          ? unsafeHtml(`<img class="pulse-tile__image" src="${esc(url)}" alt="" style="max-width:120px;max-height:120px;" loading="lazy">`)
          : html``}
      </div>
      ${tileFooter(tile)}
    </div>
  `;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function sizeClass(size?: string): string {
  if (size === '2x1') return 'pulse-tile--2x1';
  if (size === '1x2') return 'pulse-tile--1x2';
  if (size === '2x2') return 'pulse-tile--2x2';
  return '';
}

function tileHeader(tile: PulseTile): SafeHtml {
  const icon = tile.signal.icon ?? '';
  return html`
    <div class="pulse-tile__header">
      <div style="display: flex; align-items: center; gap: var(--space-2); flex: 1;">
        ${icon ? html`<span class="pulse-tile__icon">${icon}</span>` : html``}
        <span class="pulse-tile__title">${tile.signal.title}</span>
      </div>
      <form method="POST" action="/agents/${tile.agent.id}/signal/toggle" style="margin: 0;">
        <button type="submit" class="pulse-tile__toggle" title="Hide from Pulse">\u00D7</button>
      </form>
    </div>
  `;
}

function tileFooter(tile: PulseTile): SafeHtml {
  const agentLink = `/agents/${tile.agent.id}`;
  const runLink = tile.lastRun ? `/runs/${tile.lastRun.id}` : '';
  const age = tile.lastRun ? formatAge(tile.lastRun.completedAt ?? tile.lastRun.startedAt) : 'never';
  return html`
    <div class="pulse-tile__footer">
      <a href="${agentLink}" class="pulse-tile__agent">${tile.agent.id}</a>
      ${runLink
        ? html`<a href="${runLink}" class="pulse-tile__age">${age}</a>`
        : html`<span class="pulse-tile__age">${age}</span>`}
    </div>
  `;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderTile(tile: PulseTile): SafeHtml {
  const { template } = normalizeSignal(tile.signal);
  switch (template as SignalTemplate) {
    case 'metric': return renderMetric(tile);
    case 'text-headline': return renderTextHeadline(tile);
    case 'table': return renderTable(tile);
    case 'status': return renderStatus(tile);
    case 'time-series': return renderTimeSeries(tile);
    case 'image': return renderImage(tile);
    case 'text-image': return renderTextImage(tile);
    default: return renderTextHeadline(tile);
  }
}

// ── Page ─────────────────────────────────────────────────────────────────

export function renderPulsePage(input: PulsePageInput): string {
  const { tiles, hiddenTiles, stats } = input;
  const failRate = stats.runsToday > 0 ? Math.round((stats.failedToday / stats.runsToday) * 100) : 0;
  const visibleCount = tiles.length;
  const hiddenCount = hiddenTiles.length;

  const body = html`
    <div style="display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-6);">
      <h1 style="margin: 0;">Pulse</h1>
      <span style="font-size: var(--font-size-sm); color: var(--color-text-muted);">
        ${String(visibleCount)} signal${visibleCount !== 1 ? 's' : ''} active${hiddenCount > 0 ? html`, ${String(hiddenCount)} hidden` : html``}
      </span>
    </div>

    <!-- Health strip -->
    <div class="pulse-health">
      <div class="pulse-health__stat">
        <span class="pulse-health__value">${String(stats.runsToday)}</span>
        <span class="pulse-health__label">runs today</span>
      </div>
      <div class="pulse-health__stat">
        <span class="pulse-health__value ${failRate > 20 ? 'pulse-health__value--warn' : ''}">${String(failRate)}%</span>
        <span class="pulse-health__label">failure rate</span>
      </div>
      <div class="pulse-health__stat">
        <span class="pulse-health__value">${stats.avgDurationSec > 0 ? String(stats.avgDurationSec) + 's' : '--'}</span>
        <span class="pulse-health__label">avg duration</span>
      </div>
      <div class="pulse-health__stat">
        <span class="pulse-health__value">${String(stats.agentCount)}</span>
        <span class="pulse-health__label">agents</span>
      </div>
    </div>

    <!-- Signal tiles -->
    ${visibleCount === 0 && hiddenCount === 0
      ? html`
        <div class="pulse-empty">
          <h2>No signals yet</h2>
          <p>Add a <code>signal:</code> field to any agent's YAML to show its output here.</p>
          <pre class="pulse-empty__example">signal:
  title: API Latency
  template: metric
  mapping:
    value: latency_ms
    unit: "%"</pre>
          <p><a href="/agents">Browse agents &rarr;</a></p>
        </div>
      `
      : html`
        <div class="pulse-grid">
          ${tiles.map((t) => renderTile(t)) as unknown as SafeHtml[]}
        </div>
      `
    }

    <!-- Hidden tiles section -->
    ${hiddenCount > 0 ? html`
      <details class="pulse-hidden-section" style="margin-top: var(--space-6);">
        <summary style="cursor: pointer; font-family: var(--font-mono); font-size: var(--font-size-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-text-muted);">
          ${String(hiddenCount)} hidden signal${hiddenCount !== 1 ? 's' : ''}
        </summary>
        <div style="display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-3);">
          ${hiddenTiles.map((t) => html`
            <form method="POST" action="/agents/${t.agent.id}/signal/toggle" style="margin: 0; display: inline;">
              <button type="submit" class="btn btn--ghost btn--sm" style="font-family: var(--font-mono);">
                ${t.signal.icon ?? ''} ${t.signal.title} (${t.agent.id})
              </button>
            </form>
          `) as unknown as SafeHtml[]}
        </div>
      </details>
    ` : html``}
  `;

  return render(layout({ title: 'Pulse', activeNav: 'pulse' }, body));
}
