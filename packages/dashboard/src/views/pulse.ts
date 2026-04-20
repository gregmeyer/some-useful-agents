import type { Agent, AgentSignal, Run, SignalTemplate } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { formatAge } from './components.js';
import { normalizeSignal } from './pulse-templates.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface PulseTile {
  agent: Agent;
  signal: AgentSignal;
  lastRun?: Run;
  slots: Record<string, unknown>;
}

export interface PulsePageInput {
  /** Virtual system metric tiles (runs today, failure rate, etc.). */
  systemTiles: PulseTile[];
  /** Visible agent tiles. */
  tiles: PulseTile[];
  /** Hidden agent tiles. */
  hiddenTiles: PulseTile[];
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
    if (curr > prev) trend = '\u2191';
    else if (curr < prev) trend = '\u2193';
    else trend = '\u2192';
  }
  const trendClass = trend === '\u2191' ? 'pulse-tile__trend--up'
    : trend === '\u2193' ? 'pulse-tile__trend--down'
    : 'pulse-tile__trend--flat';

  return tileWrap(tile, html`
    <div class="pulse-tile__value">
      ${val}${unit ? html`<span class="pulse-tile__unit">${unit}</span>` : html``}${trend ? html`<span class="pulse-tile__trend ${trendClass}">${trend}</span>` : html``}
    </div>
    ${label ? html`<div class="pulse-tile__label">${label}</div>` : html``}
  `);
}

function renderTextHeadline(tile: PulseTile): SafeHtml {
  const headline = tile.slots.headline ? stringify(tile.slots.headline) : '';
  const rawBody = tile.slots.body ?? 'No data yet';
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

  return tileWrap(tile, html`
    ${headline ? html`<div class="pulse-tile__headline">${headline}</div>` : html``}
    ${bodyHtml}
  `);
}

function renderTable(tile: PulseTile): SafeHtml {
  let rows: Record<string, unknown>[] = [];
  const rawRows = tile.slots.rows;
  if (Array.isArray(rawRows)) rows = rawRows.slice(0, 10) as Record<string, unknown>[];
  else if (typeof rawRows === 'string') {
    try { const p = JSON.parse(rawRows); if (Array.isArray(p)) rows = p.slice(0, 10) as Record<string, unknown>[]; } catch { /* */ }
  }
  let cols: string[] = [];
  if (tile.slots.columns && Array.isArray(tile.slots.columns)) cols = tile.slots.columns.map(String);
  else if (rows.length > 0) cols = Object.keys(rows[0]);

  const tableHtml = rows.length === 0
    ? html`<p class="dim" style="font-size: var(--font-size-xs);">No data</p>`
    : unsafeHtml(`<table class="pulse-table"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(String(r[c] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody></table>`);

  return tileWrap(tile, tableHtml);
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

  return tileWrap(tile, html`
    <div style="display: flex; align-items: center; gap: var(--space-2); flex: 1;">
      <span class="pulse-tile__status-dot ${dotClass}"></span>
      <span class="pulse-tile__status-label">${label}</span>
    </div>
    ${message ? html`<div class="pulse-tile__status-message">${message}</div>` : html``}
  `);
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
    const h = 40, w = 200;
    const points = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`).join(' ');
    sparkline = unsafeHtml(`<div class="pulse-tile__sparkline"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${points}"/></svg></div>`);
  }

  return tileWrap(tile, html`
    <div class="pulse-tile__value" style="font-size: var(--font-size-xl);">${current}</div>
    ${sparkline}
    ${label ? html`<div class="pulse-tile__label">${label}</div>` : html``}
  `);
}

function renderImage(tile: PulseTile): SafeHtml {
  const url = tile.slots.imageUrl ? String(tile.slots.imageUrl) : '';
  const alt = tile.slots.alt ? String(tile.slots.alt) : tile.signal.title;
  return tileWrap(tile, url
    ? unsafeHtml(`<img class="pulse-tile__image" src="${esc(url)}" alt="${esc(alt)}" loading="lazy" style="width:100%;border-radius:var(--radius-sm);object-fit:cover;max-height:240px;">`)
    : html`<div class="dim" style="font-size: var(--font-size-xs);">No image URL</div>`
  );
}

function renderTextImage(tile: PulseTile): SafeHtml {
  const text = tile.slots.text ? String(tile.slots.text) : '';
  const url = tile.slots.imageUrl ? String(tile.slots.imageUrl) : '';
  const truncText = text.length > 300 ? text.slice(0, 300) + '...' : text;
  return tileWrap(tile, html`
    <div style="display: flex; gap: var(--space-3); flex: 1;">
      <div class="pulse-tile__body" style="flex: 1;">${truncText || 'No text'}</div>
      ${url ? unsafeHtml(`<img class="pulse-tile__image" src="${esc(url)}" alt="" style="max-width:120px;max-height:120px;" loading="lazy">`) : html``}
    </div>
  `);
}

function renderMedia(tile: PulseTile): SafeHtml {
  const rawUrl = tile.slots.url ? String(tile.slots.url).trim() : '';
  const title = tile.slots.title ? String(tile.slots.title) : '';
  const caption = tile.slots.caption ? String(tile.slots.caption) : '';
  const mediaType = tile.slots.mediaType ? String(tile.slots.mediaType).toLowerCase() : '';

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
    mediaEl = unsafeHtml(
      `<div class="pulse-media-yt" data-embed="${esc(embedUrl)}" style="position:relative;border-radius:var(--radius-sm);overflow:hidden;cursor:pointer;">` +
      `<img src="${esc(thumbUrl)}" alt="${esc(title || 'YouTube video')}" loading="lazy" style="width:100%;display:block;aspect-ratio:16/9;object-fit:cover;">` +
      `<span style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:48px;height:48px;background:rgba(0,0,0,0.7);border-radius:50%;display:flex;align-items:center;justify-content:center;">` +
      `<span style="width:0;height:0;border-style:solid;border-width:8px 0 8px 16px;border-color:transparent transparent transparent #fff;margin-left:3px;"></span>` +
      `</span></div>` +
      `<a href="${esc(watchUrl)}" target="_blank" rel="noopener" style="display:block;font-size:var(--font-size-xs);color:var(--color-text-muted);margin-top:var(--space-1);text-align:right;">Open on YouTube \u2197</a>`
    );
  } else if (isVideo) {
    mediaEl = unsafeHtml(`<video src="${esc(rawUrl)}" controls preload="metadata" style="width:100%;border-radius:var(--radius-sm);"></video>`);
  } else if (isImage) {
    mediaEl = unsafeHtml(`<img src="${esc(rawUrl)}" alt="${esc(title)}" loading="lazy" style="width:100%;border-radius:var(--radius-sm);object-fit:cover;max-height:240px;">`);
  } else {
    mediaEl = unsafeHtml(`<a href="${esc(rawUrl)}" target="_blank" rel="noopener" style="color:var(--color-primary);font-family:var(--font-mono);font-size:var(--font-size-xs);word-break:break-all;">${esc(rawUrl)}</a>`);
  }

  return tileWrap(tile, html`
    ${title ? html`<div class="pulse-tile__headline" style="font-size: var(--font-size-sm);">${title}</div>` : html``}
    ${mediaEl}
    ${caption ? html`<div class="dim" style="font-size: var(--font-size-xs);">${caption}</div>` : html``}
  `);
}

// ── Tile wrapper ─────────────────────────────────────────────────────────

/** Wraps tile content with the standard tile chrome: header, content, footer.
 *  Each tile gets draggable + data attributes for the layout system. */
function tileWrap(tile: PulseTile, content: SafeHtml): SafeHtml {
  const isSystem = tile.agent.id.startsWith('_system-');
  const sizeAttr = tile.signal.size ?? '1x1';
  const autoPalette = resolveAutoPalette(tile);
  const paletteAttr = autoPalette && autoPalette !== 'default'
    ? ` data-auto-palette="${autoPalette}"`
    : '';
  return unsafeHtml(
    `<div class="pulse-tile ${sizeClass(sizeAttr)}" data-agent-id="${esc(tile.agent.id)}" data-tile-size="${esc(sizeAttr)}"${paletteAttr}>` +
    tileHeader(tile, isSystem).toString() +
    content.toString() +
    (isSystem ? '' : tileFooter(tile).toString()) +
    '</div>'
  );
}

/**
 * Resolve auto-palette for a tile based on:
 * 1. Conditional thresholds (if declared in signal.thresholds)
 * 2. Template-type defaults (metric→teal, status→auto by value)
 * 3. null = no auto-palette (inherit page theme)
 */
function resolveAutoPalette(tile: PulseTile): string | null {
  const { template } = normalizeSignal(tile.signal);

  // 1. Conditional thresholds (metric tiles with numeric value).
  if (tile.signal.thresholds && tile.signal.thresholds.length > 0) {
    const numVal = Number(tile.slots.value);
    if (!isNaN(numVal)) {
      for (const t of tile.signal.thresholds) {
        if (t.above !== undefined && numVal > t.above) return t.palette;
        if (t.below !== undefined && numVal < t.below) return t.palette;
      }
    }
  }

  // 2. Status tiles auto-color by status value.
  if (template === 'status') {
    const status = tile.slots.status ? String(tile.slots.status).toLowerCase() : '';
    if (status === 'healthy' || status === 'ok' || status === 'up') return 'accent-green';
    if (status === 'degraded' || status === 'warn' || status === 'warning') return 'accent-orange';
    if (status === 'down' || status === 'error' || status === 'critical') return 'accent-red';
  }

  // 3. Template-type defaults.
  if (template === 'metric') return 'accent-teal';

  return null;
}

function sizeClass(size: string): string {
  if (size === '2x1') return 'pulse-tile--2x1';
  if (size === '1x2') return 'pulse-tile--1x2';
  if (size === '2x2') return 'pulse-tile--2x2';
  return '';
}

function tileHeader(tile: PulseTile, isSystem: boolean): SafeHtml {
  const icon = tile.signal.icon ?? '';
  return html`
    <div class="pulse-tile__header">
      <button type="button" class="pulse-tile__collapse" data-tile-id="${tile.agent.id}" title="Collapse/expand">\u25BC</button>
      <div style="display: flex; align-items: center; gap: var(--space-2); flex: 1; cursor: pointer;" data-tile-id="${tile.agent.id}" data-collapse-trigger>
        ${icon ? html`<span class="pulse-tile__icon">${icon}</span>` : html``}
        <span class="pulse-tile__title">${tile.signal.title}</span>
      </div>
      <div style="display: flex; gap: var(--space-1); align-items: center;">
        <button type="button" class="pulse-tile__palette-btn" data-tile-id="${tile.agent.id}" title="Change palette">\u25CF</button>
        ${isSystem ? html`` : html`
          <form method="POST" action="/agents/${tile.agent.id}/signal/toggle" style="margin: 0;">
            <button type="submit" class="pulse-tile__toggle" title="Hide from Pulse">\u00D7</button>
          </form>
        `}
      </div>
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

// ── Helpers ──────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stringify(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  try { return JSON.stringify(val, null, 2); } catch { return String(val); }
}

function renderMarkdown(text: string): string {
  let h = esc(text);
  h = h.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="pulse-tile__code">$2</pre>');
  h = h.replace(/`([^`]+)`/g, '<code style="background:var(--color-surface-raised);padding:0 var(--space-1);border-radius:3px;font-size:var(--font-size-xs);">$1</code>');
  h = h.replace(/^### (.+)$/gm, '<strong style="font-size:var(--font-size-sm);display:block;margin-top:var(--space-2);">$1</strong>');
  h = h.replace(/^## (.+)$/gm, '<strong style="font-size:var(--font-size-md);display:block;margin-top:var(--space-2);">$1</strong>');
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:var(--color-primary);" target="_blank" rel="noopener">$1</a>');
  const tableRe = /^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)+)/gm;
  h = h.replace(tableRe, (_, headerRow: string, _sep: string, bodyRows: string) => {
    const headers = headerRow.split('|').filter(Boolean).map((c: string) => c.trim());
    const rows = bodyRows.trim().split('\n').map((r: string) => r.split('|').filter(Boolean).map((c: string) => c.trim()));
    return '<table class="pulse-table" style="margin:var(--space-2) 0;"><thead><tr>' + headers.map((h: string) => `<th>${h}</th>`).join('') + '</tr></thead><tbody>' + rows.map((r: string[]) => '<tr>' + r.map((c: string) => `<td>${c}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
  });
  h = h.replace(/^- (.+)$/gm, '<li style="margin-left:var(--space-4);list-style:disc;">$1</li>');
  h = h.replace(/\n{2,}/g, '<br><br>');
  h = h.replace(/\n/g, '<br>');
  return h;
}

function looksLikeJson(s: string): boolean {
  const t = s.trimStart();
  if (!t.startsWith('{') && !t.startsWith('[')) return false;
  try { JSON.parse(t); return true; } catch { return false; }
}

function prettyJson(s: string): string {
  try { return JSON.stringify(JSON.parse(s.trim()), null, 2); } catch { return s; }
}

// ── Page ─────────────────────────────────────────────────────────────────

export function renderPulsePage(input: PulsePageInput): string {
  const { systemTiles, tiles, hiddenTiles } = input;
  const allTileCount = systemTiles.length + tiles.length;
  const hiddenCount = hiddenTiles.length;

  // Build a JSON blob of all tile IDs so the JS can construct the default layout.
  const allTileIds = [...systemTiles.map((t) => t.agent.id), ...tiles.map((t) => t.agent.id)];
  const systemTileIds = systemTiles.map((t) => t.agent.id);

  const body = html`
    <div style="display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-6);">
      <h1 style="margin: 0;">Pulse</h1>
      <span style="font-size: var(--font-size-sm); color: var(--color-text-muted);">
        ${String(allTileCount)} signal${allTileCount !== 1 ? 's' : ''}${hiddenCount > 0 ? html`, ${String(hiddenCount)} hidden` : html``}
      </span>
      <div style="margin-left: auto; display: flex; gap: var(--space-2);">
        <button type="button" class="btn btn--ghost btn--sm" id="pulse-edit-toggle">\u270E Edit layout</button>
        <button type="button" class="btn btn--ghost btn--sm" id="pulse-add-container" style="display: none;">+ Add group</button>
      </div>
    </div>

    <!-- Container host — JS reads layout from localStorage and arranges tiles -->
    <div id="pulse-containers">
      <!-- Default: all tiles in order. JS will reorganize into containers. -->
      <section class="pulse-container" data-container-id="_default">
        <div class="pulse-grid" data-container-id="_default">
          ${systemTiles.map((t) => renderTile(t)) as unknown as SafeHtml[]}
          ${tiles.map((t) => renderTile(t)) as unknown as SafeHtml[]}
        </div>
      </section>
    </div>

    <!-- Hidden tiles -->
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

    <!-- Layout data for JS -->
    ${unsafeHtml(`<script type="application/json" id="pulse-tile-data">${JSON.stringify({ allTileIds, systemTileIds })}</script>`)}
  `;

  return render(layout({ title: 'Pulse', activeNav: 'pulse' }, body));
}
