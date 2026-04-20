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
  const val = tile.slots.value !== undefined ? stringify(tile.slots.value) : '--';
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
  const headline = tile.slots.headline ? stringify(tile.slots.headline) : '';
  const rawBody = tile.slots.body ?? 'No data yet';

  // Detect JSON content and pretty-print it in a code block.
  const bodyStr = stringify(rawBody);
  const isJson = looksLikeJson(bodyStr);
  let bodyHtml: SafeHtml;
  if (isJson) {
    const pretty = prettyJson(bodyStr);
    const truncated = pretty.length > 800 ? pretty.slice(0, 800) + '\n...' : pretty;
    bodyHtml = html`<pre class="pulse-tile__code">${truncated}</pre>`;
  } else {
    const truncBody = bodyStr.length > 800 ? bodyStr.slice(0, 800) + '...' : bodyStr;
    bodyHtml = unsafeHtml(`<div class="pulse-tile__body pulse-tile__body--md">${renderMarkdown(truncBody)}</div>`);
  }

  return html`
    <div class="pulse-tile pulse-tile--text-headline ${sizeClass(tile.signal.size)}">
      ${tileHeader(tile)}
      ${headline ? html`<div class="pulse-tile__headline">${headline}</div>` : html``}
      ${bodyHtml}
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

function renderMedia(tile: PulseTile): SafeHtml {
  const rawUrl = tile.slots.url ? String(tile.slots.url).trim() : '';
  const title = tile.slots.title ? String(tile.slots.title) : '';
  const caption = tile.slots.caption ? String(tile.slots.caption) : '';
  const mediaType = tile.slots.mediaType ? String(tile.slots.mediaType).toLowerCase() : '';

  // Extract YouTube video ID from various URL formats.
  const ytMatch = rawUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  const isYoutube = !!ytMatch;
  const isVideo = !isYoutube && (mediaType === 'video' || /\.(mp4|webm|ogg)(\?|$)/i.test(rawUrl));
  const isImage = !isYoutube && !isVideo && /\.(png|jpe?g|gif|webp|svg|bmp)(\?|$)/i.test(rawUrl);

  let mediaEl: SafeHtml;
  if (!rawUrl) {
    mediaEl = html`<div class="dim" style="font-size: var(--font-size-xs); padding: var(--space-4); text-align: center;">No media URL</div>`;
  } else if (isYoutube) {
    const videoId = ytMatch![1];
    const thumbUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1`;
    // Thumbnail with play button. Click swaps to iframe embed in-place.
    // External link opens YouTube in a new tab.
    mediaEl = unsafeHtml(
      `<div class="pulse-media-yt" data-embed="${esc(embedUrl)}" style="position:relative;border-radius:var(--radius-sm);overflow:hidden;cursor:pointer;">` +
      `<img src="${esc(thumbUrl)}" alt="${esc(title || 'YouTube video')}" loading="lazy" style="width:100%;display:block;aspect-ratio:16/9;object-fit:cover;">` +
      `<span style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:48px;height:48px;background:rgba(0,0,0,0.7);border-radius:50%;display:flex;align-items:center;justify-content:center;">` +
      `<span style="width:0;height:0;border-style:solid;border-width:8px 0 8px 16px;border-color:transparent transparent transparent #fff;margin-left:3px;"></span>` +
      `</span></div>` +
      `<a href="${esc(watchUrl)}" target="_blank" rel="noopener" style="display:block;font-size:var(--font-size-xs);color:var(--color-text-muted);margin-top:var(--space-1);text-align:right;">Open on YouTube \u2197</a>`
    );
  } else if (isVideo) {
    mediaEl = unsafeHtml(`<video class="pulse-tile__media" src="${esc(rawUrl)}" controls preload="metadata" style="width:100%;border-radius:var(--radius-sm);"></video>`);
  } else if (isImage) {
    mediaEl = unsafeHtml(`<img class="pulse-tile__media" src="${esc(rawUrl)}" alt="${esc(title)}" loading="lazy" style="width:100%;border-radius:var(--radius-sm);object-fit:cover;max-height:240px;">`);
  } else {
    // Unknown media type — render as a clickable link.
    mediaEl = unsafeHtml(`<a href="${esc(rawUrl)}" target="_blank" rel="noopener" style="color:var(--color-primary);font-family:var(--font-mono);font-size:var(--font-size-xs);word-break:break-all;">${esc(rawUrl)}</a>`);
  }

  return html`
    <div class="pulse-tile pulse-tile--media ${sizeClass(tile.signal.size)}">
      ${tileHeader(tile)}
      ${title ? html`<div class="pulse-tile__headline" style="font-size: var(--font-size-sm);">${title}</div>` : html``}
      ${mediaEl}
      ${caption ? html`<div class="dim" style="font-size: var(--font-size-xs);">${caption}</div>` : html``}
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
      <button type="button" class="pulse-tile__collapse" data-tile-id="${tile.agent.id}" title="Collapse/expand">\u25BC</button>
      <div style="display: flex; align-items: center; gap: var(--space-2); flex: 1; cursor: pointer;" data-tile-id="${tile.agent.id}" data-collapse-trigger>
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

/** Convert any value to a display string. Handles objects that would show as [object Object]. */
function stringify(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  try { return JSON.stringify(val, null, 2); } catch { return String(val); }
}

/**
 * Lightweight markdown to HTML. Handles the common patterns agents produce:
 * headers, bold, italic, links, tables, lists, inline code, line breaks.
 * No library dependency. Input must be pre-escaped or trusted.
 */
function renderMarkdown(text: string): string {
  let h = esc(text);

  // Code blocks (``` ... ```)
  h = h.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="pulse-tile__code">$2</pre>');

  // Inline code
  h = h.replace(/`([^`]+)`/g, '<code style="background:var(--color-surface-raised);padding:0 var(--space-1);border-radius:3px;font-size:var(--font-size-xs);">$1</code>');

  // Headers (## and ###)
  h = h.replace(/^### (.+)$/gm, '<strong style="font-size:var(--font-size-sm);display:block;margin-top:var(--space-2);">$1</strong>');
  h = h.replace(/^## (.+)$/gm, '<strong style="font-size:var(--font-size-md);display:block;margin-top:var(--space-2);">$1</strong>');

  // Bold and italic
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links [text](url)
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:var(--color-primary);" target="_blank" rel="noopener">$1</a>');

  // Markdown tables
  const tableRe = /^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)+)/gm;
  h = h.replace(tableRe, (_, headerRow: string, _sep: string, bodyRows: string) => {
    const headers = headerRow.split('|').filter(Boolean).map((c: string) => c.trim());
    const rows = bodyRows.trim().split('\n').map((r: string) =>
      r.split('|').filter(Boolean).map((c: string) => c.trim())
    );
    return '<table class="pulse-table" style="margin:var(--space-2) 0;">' +
      '<thead><tr>' + headers.map((h: string) => `<th>${h}</th>`).join('') + '</tr></thead>' +
      '<tbody>' + rows.map((r: string[]) => '<tr>' + r.map((c: string) => `<td>${c}</td>`).join('') + '</tr>').join('') + '</tbody>' +
      '</table>';
  });

  // Unordered lists
  h = h.replace(/^- (.+)$/gm, '<li style="margin-left:var(--space-4);list-style:disc;">$1</li>');

  // Double newline → paragraph break, single newline → <br>
  h = h.replace(/\n{2,}/g, '<br><br>');
  h = h.replace(/\n/g, '<br>');

  return h;
}

/** Check if a string looks like JSON (starts with { or [). */
function looksLikeJson(s: string): boolean {
  const trimmed = s.trimStart();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  try { JSON.parse(trimmed); return true; } catch { return false; }
}

/** Pretty-print a JSON string with 2-space indent. */
function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s.trim()), null, 2);
  } catch {
    return s;
  }
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
    case 'media': return renderMedia(tile);
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
