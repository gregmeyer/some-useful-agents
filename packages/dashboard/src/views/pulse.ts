import type { Agent, AgentSignal, Run } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { formatAge } from './components.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface PulseTile {
  agent: Agent;
  signal: AgentSignal;
  lastRun?: Run;
  /** Extracted value from the run output via signal.field or raw result. */
  value?: unknown;
}

export interface PulsePageInput {
  tiles: PulseTile[];
  /** Stats for the health strip. */
  stats: {
    runsToday: number;
    failedToday: number;
    avgDurationSec: number;
    agentCount: number;
  };
}

// ── Value extraction ─────────────────────────────────────────────────────

/**
 * Extract the display value from a run's output using the signal's field
 * dot-path. Falls back to the raw result text.
 */
export function extractSignalValue(
  run: Run | undefined,
  signal: AgentSignal,
  outputsJson?: string,
): unknown {
  if (!run?.result) return undefined;

  // Try structured output first (outputsJson from the last node).
  if (outputsJson && signal.field) {
    try {
      const obj = JSON.parse(outputsJson);
      const val = dotGet(obj, signal.field);
      if (val !== undefined) return val;
    } catch { /* fall through to raw result */ }
  }

  // Try parsing result as JSON and extracting via field path.
  if (signal.field) {
    try {
      const parsed = JSON.parse(run.result);
      const val = dotGet(parsed, signal.field);
      if (val !== undefined) return val;
    } catch { /* not JSON, use raw */ }
  }

  // Raw result text.
  return run.result;
}

function dotGet(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ── Tile renderers ───────────────────────────────────────────────────────

function renderNumberTile(tile: PulseTile): SafeHtml {
  const val = tile.value !== undefined ? String(tile.value) : '--';
  const icon = tile.signal.icon ?? '';
  return html`
    <div class="pulse-tile pulse-tile--number ${sizeClass(tile.signal.size)}">
      <div class="pulse-tile__header">
        ${icon ? html`<span class="pulse-tile__icon">${icon}</span>` : html``}
        <span class="pulse-tile__title">${tile.signal.title}</span>
      </div>
      <div class="pulse-tile__value">${val}</div>
      ${tileFooter(tile)}
    </div>
  `;
}

function renderTextTile(tile: PulseTile): SafeHtml {
  const val = tile.value !== undefined ? String(tile.value) : 'No data yet';
  const truncated = val.length > 400 ? val.slice(0, 400) + '...' : val;
  const icon = tile.signal.icon ?? '';
  return html`
    <div class="pulse-tile pulse-tile--text ${sizeClass(tile.signal.size)}">
      <div class="pulse-tile__header">
        ${icon ? html`<span class="pulse-tile__icon">${icon}</span>` : html``}
        <span class="pulse-tile__title">${tile.signal.title}</span>
      </div>
      <div class="pulse-tile__text">${truncated}</div>
      ${tileFooter(tile)}
    </div>
  `;
}

function renderTableTile(tile: PulseTile): SafeHtml {
  const icon = tile.signal.icon ?? '';
  let rows: Record<string, unknown>[] = [];
  if (Array.isArray(tile.value)) {
    rows = tile.value.slice(0, 10) as Record<string, unknown>[];
  } else if (typeof tile.value === 'string') {
    try {
      const parsed = JSON.parse(tile.value);
      if (Array.isArray(parsed)) rows = parsed.slice(0, 10) as Record<string, unknown>[];
    } catch { /* not JSON */ }
  }

  const cols = rows.length > 0 ? Object.keys(rows[0]) : [];
  const tableHtml = rows.length === 0
    ? html`<p class="dim" style="font-size: var(--font-size-xs);">No data</p>`
    : unsafeHtml(`
      <table class="pulse-table">
        <thead><tr>${cols.map((c) => `<th>${escHtml(c)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) =>
          `<tr>${cols.map((c) => `<td>${escHtml(String(r[c] ?? ''))}</td>`).join('')}</tr>`
        ).join('')}</tbody>
      </table>
    `);

  return html`
    <div class="pulse-tile pulse-tile--table ${sizeClass(tile.signal.size)}">
      <div class="pulse-tile__header">
        ${icon ? html`<span class="pulse-tile__icon">${icon}</span>` : html``}
        <span class="pulse-tile__title">${tile.signal.title}</span>
      </div>
      ${tableHtml}
      ${tileFooter(tile)}
    </div>
  `;
}

function renderJsonTile(tile: PulseTile): SafeHtml {
  const icon = tile.signal.icon ?? '';
  let formatted = '';
  if (tile.value !== undefined) {
    try {
      const obj = typeof tile.value === 'string' ? JSON.parse(tile.value) : tile.value;
      formatted = JSON.stringify(obj, null, 2);
    } catch {
      formatted = String(tile.value);
    }
  }
  const truncated = formatted.length > 600 ? formatted.slice(0, 600) + '\n...' : formatted;
  return html`
    <div class="pulse-tile pulse-tile--json ${sizeClass(tile.signal.size)}">
      <div class="pulse-tile__header">
        ${icon ? html`<span class="pulse-tile__icon">${icon}</span>` : html``}
        <span class="pulse-tile__title">${tile.signal.title}</span>
      </div>
      <pre class="pulse-tile__code">${truncated || 'No data'}</pre>
      ${tileFooter(tile)}
    </div>
  `;
}

function renderChartTile(tile: PulseTile): SafeHtml {
  // v1: chart is rendered as a number with a placeholder note.
  // SVG sparklines come in Phase 5.
  return renderNumberTile(tile);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function sizeClass(size?: string): string {
  if (size === '2x1') return 'pulse-tile--2x1';
  if (size === '1x2') return 'pulse-tile--1x2';
  if (size === '2x2') return 'pulse-tile--2x2';
  return '';
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

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderTile(tile: PulseTile): SafeHtml {
  switch (tile.signal.format) {
    case 'number': return renderNumberTile(tile);
    case 'text': return renderTextTile(tile);
    case 'table': return renderTableTile(tile);
    case 'json': return renderJsonTile(tile);
    case 'chart': return renderChartTile(tile);
    default: return renderTextTile(tile);
  }
}

// ── Page ─────────────────────────────────────────────────────────────────

export function renderPulsePage(input: PulsePageInput): string {
  const { tiles, stats } = input;
  const failRate = stats.runsToday > 0 ? Math.round((stats.failedToday / stats.runsToday) * 100) : 0;

  const body = html`
    <div style="display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-6);">
      <h1 style="margin: 0;">Pulse</h1>
      <span style="font-size: var(--font-size-sm); color: var(--color-text-muted);">
        ${String(tiles.length)} signal${tiles.length !== 1 ? 's' : ''} active
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
    ${tiles.length === 0
      ? html`
        <div class="pulse-empty">
          <h2>No signals yet</h2>
          <p>Add a <code>signal:</code> field to any agent's YAML to show its output here.</p>
          <pre class="pulse-empty__example">signal:
  title: API Latency
  icon: "\u26A1"
  format: number
  field: latency_ms</pre>
          <p><a href="/agents">Browse agents &rarr;</a></p>
        </div>
      `
      : html`
        <div class="pulse-grid">
          ${tiles.map((t) => renderTile(t)) as unknown as SafeHtml[]}
        </div>
      `
    }
  `;

  return render(layout({ title: 'Pulse', activeNav: 'pulse' }, body));
}
