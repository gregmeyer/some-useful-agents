/**
 * Pulse tile template renderers. Each function takes a PulseTile and returns
 * SafeHtml for the tile's inner content (wrapped by tileWrap in pulse.ts).
 */

import type { SignalTemplate } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from './html.js';
import { normalizeSignal } from './pulse-templates.js';
import { esc, stringify, renderMarkdown, looksLikeJson, prettyJson } from './pulse-helpers.js';
import type { PulseTile, TileWrapFn } from './pulse-types.js';
import { renderOutputWidget } from './output-widgets.js';

// ── Renderers ────────────────────────────────────────────────────────────

function renderMetric(tile: PulseTile, wrap: TileWrapFn): SafeHtml {
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

  return wrap(tile, html`
    <div class="pulse-tile__value">
      ${val}${unit ? html`<span class="pulse-tile__unit">${unit}</span>` : html``}${trend ? html`<span class="pulse-tile__trend ${trendClass}">${trend}</span>` : html``}
    </div>
    ${label ? html`<div class="pulse-tile__label">${label}</div>` : html``}
  `);
}

function renderTextHeadline(tile: PulseTile, wrap: TileWrapFn): SafeHtml {
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

  return wrap(tile, html`
    ${headline ? html`<div class="pulse-tile__headline">${headline}</div>` : html``}
    ${bodyHtml}
  `);
}

function renderTable(tile: PulseTile, wrap: TileWrapFn): SafeHtml {
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

  return wrap(tile, tableHtml);
}

function renderStatus(tile: PulseTile, wrap: TileWrapFn): SafeHtml {
  const status = tile.slots.status ? String(tile.slots.status).toLowerCase() : 'unknown';
  const label = tile.slots.label ? String(tile.slots.label) : status;
  const message = tile.slots.message ? String(tile.slots.message) : '';
  const dotClass = status === 'healthy' || status === 'ok' || status === 'up'
    ? 'pulse-tile__status-dot--healthy'
    : status === 'degraded' || status === 'warn' || status === 'warning'
    ? 'pulse-tile__status-dot--degraded'
    : 'pulse-tile__status-dot--down';

  return wrap(tile, html`
    <div style="display: flex; align-items: center; gap: var(--space-2); flex: 1;">
      <span class="pulse-tile__status-dot ${dotClass}"></span>
      <span class="pulse-tile__status-label">${label}</span>
    </div>
    ${message ? html`<div class="pulse-tile__status-message">${message}</div>` : html``}
  `);
}

function renderTimeSeries(tile: PulseTile, wrap: TileWrapFn): SafeHtml {
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

  return wrap(tile, html`
    <div class="pulse-tile__value" style="font-size: var(--font-size-xl);">${current}</div>
    ${sparkline}
    ${label ? html`<div class="pulse-tile__label">${label}</div>` : html``}
  `);
}

function renderImage(tile: PulseTile, wrap: TileWrapFn): SafeHtml {
  const url = tile.slots.imageUrl ? String(tile.slots.imageUrl) : '';
  const alt = tile.slots.alt ? String(tile.slots.alt) : tile.signal.title;
  return wrap(tile, url
    ? unsafeHtml(`<img class="pulse-tile__image" src="${esc(url)}" alt="${esc(alt)}" loading="lazy" style="width:100%;border-radius:var(--radius-sm);object-fit:cover;max-height:240px;">`)
    : html`<div class="dim" style="font-size: var(--font-size-xs);">No image URL</div>`
  );
}

function renderTextImage(tile: PulseTile, wrap: TileWrapFn): SafeHtml {
  const text = tile.slots.text ? String(tile.slots.text) : '';
  const url = tile.slots.imageUrl ? String(tile.slots.imageUrl) : '';
  const truncText = text.length > 300 ? text.slice(0, 300) + '...' : text;
  return wrap(tile, html`
    <div style="display: flex; gap: var(--space-3); flex: 1;">
      <div class="pulse-tile__body" style="flex: 1;">${truncText || 'No text'}</div>
      ${url ? unsafeHtml(`<img class="pulse-tile__image" src="${esc(url)}" alt="" style="max-width:120px;max-height:120px;" loading="lazy">`) : html``}
    </div>
  `);
}

function renderMedia(tile: PulseTile, wrap: TileWrapFn): SafeHtml {
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
    const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`;
    mediaEl = unsafeHtml(
      `<div class="pulse-media-yt" data-embed="${esc(embedUrl)}" data-watch="${esc(watchUrl)}" style="position:relative;border-radius:var(--radius-sm);overflow:hidden;cursor:pointer;">` +
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

  return wrap(tile, html`
    ${title ? html`<div class="pulse-tile__headline" style="font-size: var(--font-size-sm);">${title}</div>` : html``}
    ${mediaEl}
    ${caption ? html`<div class="dim" style="font-size: var(--font-size-xs);">${caption}</div>` : html``}
  `);
}

// ── Phase 2 renderers ───────────────────────────────────────────────────

function renderComparison(tile: PulseTile, wrap: TileWrapFn): SafeHtml {
  const ll = tile.slots.left_label ? String(tile.slots.left_label) : 'A';
  const lv = tile.slots.left_value !== undefined ? stringify(tile.slots.left_value) : '--';
  const rl = tile.slots.right_label ? String(tile.slots.right_label) : 'B';
  const rv = tile.slots.right_value !== undefined ? stringify(tile.slots.right_value) : '--';
  const title = tile.slots.title ? String(tile.slots.title) : '';

  // Color-code: if both values are numeric, green the higher one.
  const ln = Number(lv), rn = Number(rv);
  const leftColor = !isNaN(ln) && !isNaN(rn) && ln > rn ? 'color: var(--color-ok);' : '';
  const rightColor = !isNaN(ln) && !isNaN(rn) && rn > ln ? 'color: var(--color-ok);' : '';

  return wrap(tile, html`
    ${title ? html`<div style="font-size: var(--font-size-xs); color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: var(--space-2);">${title}</div>` : html``}
    <div style="display: flex; align-items: center; gap: var(--space-3); flex: 1;">
      <div style="flex: 1; text-align: center;">
        <div style="font-size: var(--font-size-xs); color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-family: var(--font-mono);">${ll}</div>
        <div style="font-size: 1.5rem; font-weight: var(--weight-bold); font-family: var(--font-mono); line-height: 1.2; margin-top: 2px; ${leftColor}">${lv}</div>
      </div>
      <div style="font-size: var(--font-size-xs); color: var(--color-text-subtle); font-weight: var(--weight-semibold);">vs</div>
      <div style="flex: 1; text-align: center;">
        <div style="font-size: var(--font-size-xs); color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-family: var(--font-mono);">${rl}</div>
        <div style="font-size: 1.5rem; font-weight: var(--weight-bold); font-family: var(--font-mono); line-height: 1.2; margin-top: 2px; ${rightColor}">${rv}</div>
      </div>
    </div>
  `);
}

function renderKeyValueGrid(tile: PulseTile, wrap: TileWrapFn): SafeHtml {
  const title = tile.slots.title ? String(tile.slots.title) : '';
  let pairs: Array<{ label: string; value: string }> = [];

  const raw = tile.slots.pairs;
  if (Array.isArray(raw)) {
    pairs = raw.map((p) => {
      if (typeof p === 'object' && p !== null) {
        const obj = p as Record<string, unknown>;
        return { label: String(obj.label ?? obj.key ?? ''), value: stringify(obj.value ?? '') };
      }
      return { label: '', value: stringify(p) };
    });
  } else if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        pairs = parsed.map((p: Record<string, unknown>) => ({
          label: String(p.label ?? p.key ?? ''),
          value: stringify(p.value ?? ''),
        }));
      }
    } catch { /* not JSON */ }
  }

  if (pairs.length === 0) {
    return wrap(tile, html`<p class="dim" style="font-size: var(--font-size-xs);">No data</p>`);
  }

  const cols = Math.min(pairs.length, 3);
  const cells = pairs.map((p) => html`
    <div style="text-align: center; padding: var(--space-2);">
      <div style="font-size: var(--font-size-xs); color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-family: var(--font-mono);">${p.label}</div>
      <div style="font-size: var(--font-size-sm); font-weight: var(--weight-semibold); font-family: var(--font-mono); margin-top: 2px;">${p.value}</div>
    </div>
  `);

  return wrap(tile, html`
    ${title ? html`<div style="font-size: var(--font-size-xs); color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: var(--space-2);">${title}</div>` : html``}
    <div style="display: grid; grid-template-columns: repeat(${String(cols)}, 1fr); gap: var(--space-1); background: var(--color-surface-raised); border-radius: var(--radius-sm); padding: var(--space-2);">
      ${cells as unknown as SafeHtml[]}
    </div>
  `);
}

function renderStory(tile: PulseTile, wrap: TileWrapFn): SafeHtml {
  const whatChanged = tile.slots.what_changed ? String(tile.slots.what_changed) : '';
  const timePeriod = tile.slots.time_period ? String(tile.slots.time_period) : '';
  const whatItMeans = tile.slots.what_it_means ? String(tile.slots.what_it_means) : '';

  return wrap(tile, html`
    <div style="display: flex; flex-direction: column; gap: var(--space-2); flex: 1;">
      ${whatChanged ? html`<div style="font-size: var(--font-size-sm); font-weight: var(--weight-bold); line-height: 1.4;">${whatChanged}</div>` : html``}
      ${timePeriod ? html`<div><span class="badge badge--muted" style="font-size: 10px;">${timePeriod}</span></div>` : html``}
      ${whatItMeans ? html`<div style="font-size: var(--font-size-xs); color: var(--color-text-muted); line-height: 1.5;">${whatItMeans}</div>` : html``}
    </div>
  `);
}

function renderFunnel(tile: PulseTile, wrap: TileWrapFn): SafeHtml {
  let stages: Array<{ label: string; value: number; color?: string }> = [];

  const raw = tile.slots.stages;
  if (Array.isArray(raw)) {
    stages = raw.map((s) => {
      if (typeof s === 'object' && s !== null) {
        const obj = s as Record<string, unknown>;
        return { label: String(obj.label ?? ''), value: Number(obj.value ?? 0), color: obj.color ? String(obj.color) : undefined };
      }
      return { label: String(s), value: 0 };
    });
  } else if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        stages = parsed.map((s: Record<string, unknown>) => ({
          label: String(s.label ?? ''),
          value: Number(s.value ?? 0),
          color: s.color ? String(s.color) : undefined,
        }));
      }
    } catch { /* not JSON */ }
  }

  if (stages.length === 0) {
    return wrap(tile, html`<p class="dim" style="font-size: var(--font-size-xs);">No stages</p>`);
  }

  const maxVal = Math.max(...stages.map((s) => s.value), 1);
  const defaultColors = ['#2dd4bf', '#60a5fa', '#a78bfa', '#fb923c', '#f87171', '#fbbf24'];

  const bars = stages.map((s, i) => {
    const pct = Math.max(20, (s.value / maxVal) * 100); // min 20% width for label visibility
    const color = s.color ?? defaultColors[i % defaultColors.length];
    return html`
      <div style="display: flex; align-items: center; gap: var(--space-2);">
        <div style="width: ${String(Math.round(pct))}%; background: ${color}; border-radius: var(--radius-sm); padding: 4px var(--space-2); font-size: 10px; font-family: var(--font-mono); color: #fff; font-weight: var(--weight-semibold); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${s.label}
        </div>
        <span style="font-size: var(--font-size-xs); font-family: var(--font-mono); color: var(--color-text-muted); white-space: nowrap;">${String(s.value)}</span>
      </div>
    `;
  });

  return wrap(tile, html`
    <div style="display: flex; flex-direction: column; gap: var(--space-1); flex: 1;">
      ${bars as unknown as SafeHtml[]}
    </div>
  `);
}

// ── Dispatcher ───────────────────────────────────────────────────────────

export function renderTile(tile: PulseTile, wrap: TileWrapFn): SafeHtml {
  const { template } = normalizeSignal(tile.signal);
  switch (template as SignalTemplate) {
    case 'metric': return renderMetric(tile, wrap);
    case 'text-headline': return renderTextHeadline(tile, wrap);
    case 'table': return renderTable(tile, wrap);
    case 'status': return renderStatus(tile, wrap);
    case 'time-series': return renderTimeSeries(tile, wrap);
    case 'image': return renderImage(tile, wrap);
    case 'text-image': return renderTextImage(tile, wrap);
    case 'media': return renderMedia(tile, wrap);
    case 'widget': return renderWidgetTile(tile, wrap);
    case 'comparison': return renderComparison(tile, wrap);
    case 'key-value': return renderKeyValueGrid(tile, wrap);
    case 'story': return renderStory(tile, wrap);
    case 'funnel': return renderFunnel(tile, wrap);
    default: return renderTextHeadline(tile, wrap);
  }
}

function renderWidgetTile(tile: PulseTile, wrap: TileWrapFn): SafeHtml {
  const agent = tile.agent;
  if (!agent.outputWidget || !tile.lastRun?.result) {
    return wrap(tile, html`<p class="dim" style="font-size: var(--font-size-xs);">No widget output yet.</p>`);
  }
  const widgetHtml = renderOutputWidget(agent.outputWidget, tile.lastRun.result, agent.id);
  return wrap(tile, widgetHtml ?? html`<p class="dim" style="font-size: var(--font-size-xs);">Widget render failed.</p>`);
}
