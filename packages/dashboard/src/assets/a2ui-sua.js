// sua's A2UI client: the sua catalog's components (Metric, Badge, KeyValue,
// Table, Link, Code, SanitizedHtml) on top of the vendored A2UI renderer, and
// a mounter that draws every <div data-a2ui-surface> on the page from the
// A2UI v0.9 messages embedded inside it as JSON.
//
// Component props MUST match the schemas in packages/core/src/a2ui/catalog.ts
// (the server validates views against those; a test compares the names).
// A button/choice `action` in a surface is re-dispatched from its host as a
// bubbling `a2ui-action` CustomEvent; the page decides what it means (agent
// chat sends it as the next turn).
import {
  MessageProcessor, Catalog, CommonSchemas, A2uiLitElement, basicCatalog,
  setMarkdownRenderer, html, css, nothing, z,
} from '/assets/vendor/a2ui-v0_9.js';

export const SUA_CATALOG_ID = 'https://some-useful-agents.dev/a2ui/catalogs/sua/v1.json';

// ── Markdown for Text: escape first, then a few inline marks. No HTML from data.
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
setMarkdownRenderer((value) => esc(value)
  .replace(/`([^`\n]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  .replace(/\n/g, '<br>'));

const Common = CommonSchemas.ComponentCommon.omit({ id: true });
const Str = CommonSchemas.DynamicString;
const tones = new Set(['neutral', 'ok', 'warn', 'err']);
const tone = (t) => (tones.has(t) ? t : 'neutral');
// http(s), or a same-origin dashboard path ("/x", not "//host").
const safeUrl = (u) => (typeof u === 'string' && /^(https?:\/\/|\/(?!\/))/i.test(u) ? u : undefined);

const shared = css`
  :host { display: block; color: var(--color-text); font-size: var(--font-size-sm); }
  .ok { color: var(--color-ok); } .warn { color: var(--color-warn); } .err { color: var(--color-err); }
  .dim { color: var(--color-text-muted); }
  a { color: var(--color-primary); }
`;

function define(name, tag, schema, styles, render, extra = {}) {
  const api = { name, schema };
  class El extends A2uiLitElement {
    constructor() { super(); this.api = api; }
    render() { const p = this.controller?.props; return p ? render.call(this, p) : nothing; }
  }
  El.styles = [shared, styles];
  Object.assign(El.prototype, extra);
  customElements.define(tag, El);
  return { ...api, tagName: tag };
}

const Metric = define('Metric', 'sua-a2ui-metric',
  Common.extend({ label: Str, value: Str, unit: Str.optional(), delta: Str.optional(), tone: Str.optional() }).strict(),
  css`
    .label { font-size: var(--font-size-xs); color: var(--color-text-muted); text-transform: uppercase; letter-spacing: .04em; }
    .value { font-family: var(--font-mono); font-size: 2rem; line-height: 1.1; }
    .unit { font-size: var(--font-size-sm); color: var(--color-text-muted); margin-left: .25rem; }
    .delta { font-size: var(--font-size-xs); color: var(--color-text-muted); }
    .value.long { font-family: inherit; font-size: var(--font-size-md, 1rem); line-height: 1.4; }`,
  // A "metric" that's really a sentence (e.g. a day's forecast) reads as text, not a big number.
  (p) => html`<div class="label">${p.label}</div>
    <div class="value ${tone(p.tone)} ${String(p.value ?? '').length > 14 ? 'long' : ''}">${p.value}${p.unit ? html`<span class="unit">${p.unit}</span>` : nothing}</div>
    ${p.delta ? html`<div class="delta">${p.delta}</div>` : nothing}`);

const Badge = define('Badge', 'sua-a2ui-badge',
  Common.extend({ text: Str, tone: Str.optional() }).strict(),
  css`
    :host { display: inline-block; }
    span { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: var(--font-size-xs); background: var(--color-surface-raised); }
    .ok { background: var(--color-ok-soft); } .warn { background: var(--color-warn-soft); } .err { background: var(--color-err-soft); }`,
  (p) => html`<span class="${tone(p.tone)}">${p.text}</span>`);

const KeyValue = define('KeyValue', 'sua-a2ui-keyvalue',
  Common.extend({ items: CommonSchemas.DynamicValue }).strict(),
  css`
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0; }
    dt { color: var(--color-text-muted); } dd { margin: 0; overflow-wrap: anywhere; }`,
  (p) => {
    const items = Array.isArray(p.items) ? p.items : [];
    return html`<dl>${items.map((it) => html`<dt>${it?.label ?? ''}</dt><dd>${typeof it?.value === 'object' ? JSON.stringify(it.value) : String(it?.value ?? '')}</dd>`)}</dl>`;
  });

const cellText = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const compare = (a, b) => {
  const na = Number(a); const nb = Number(b);
  if (a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return cellText(a).localeCompare(cellText(b), undefined, { numeric: true, sensitivity: 'base' });
};

// Sort (click a sortable header), filter (substring across filterColumns)
// and pages all happen here, on the rows the view bound: no round trip.
const Table = define('Table', 'sua-a2ui-table',
  Common.extend({
    rows: CommonSchemas.DynamicValue,
    columns: z.array(z.object({ key: z.string(), label: z.string(), format: z.enum(['text', 'link']).optional() }).strict()).min(1).max(12),
    maxRows: z.number().int().min(1).max(200).optional(),
    sortColumns: z.array(z.string()).max(12).optional(),
    defaultSort: z.string().max(80).optional(),
    filterColumns: z.array(z.string()).max(12).optional(),
    filterPlaceholder: z.string().max(80).optional(),
    pageSize: z.number().int().min(1).max(200).optional(),
  }).strict(),
  css`
    :host { overflow-x: auto; }
    table { border-collapse: collapse; width: 100%; font-size: var(--font-size-sm); }
    th { text-align: left; font-weight: 500; color: var(--color-text-muted); font-size: var(--font-size-xs); text-transform: uppercase; letter-spacing: .04em; }
    th button { all: unset; cursor: pointer; } th button:focus-visible { outline: 2px solid var(--color-primary); }
    th, td { padding: 6px 8px; border-bottom: 1px solid var(--color-border); vertical-align: top; overflow-wrap: anywhere; }
    .tools { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
    input[type=search] { flex: 1; padding: 4px 8px; background: var(--color-surface-raised); color: var(--color-text); border: 1px solid var(--color-border); border-radius: var(--radius-sm); font: inherit; font-size: var(--font-size-sm); }
    .pager { display: flex; gap: 8px; align-items: center; justify-content: flex-end; margin-top: 6px; font-size: var(--font-size-xs); color: var(--color-text-muted); }
    .pager button { padding: 2px 8px; background: var(--color-surface-raised); color: var(--color-text); border: 1px solid var(--color-border); border-radius: var(--radius-sm); cursor: pointer; }
    .pager button[disabled] { opacity: .4; cursor: default; }`,
  function (p) {
    if (this._sort === undefined && p.defaultSort) {
      const [col, dir] = String(p.defaultSort).trim().split(/\s+/);
      this._sort = { col, dir: dir === 'desc' ? 'desc' : 'asc' };
    }
    const sortable = new Set(p.sortColumns ?? []);
    const filterCols = p.filterColumns ?? [];
    let rows = Array.isArray(p.rows) ? p.rows.slice() : [];
    const q = (this._filter ?? '').trim().toLowerCase();
    if (q && filterCols.length) rows = rows.filter((r) => filterCols.some((c) => cellText(r?.[c]).toLowerCase().includes(q)));
    if (this._sort) {
      const { col, dir } = this._sort;
      rows = rows.map((r, i) => [r, i]).sort((x, y) => compare(x[0]?.[col], y[0]?.[col]) * (dir === 'desc' ? -1 : 1) || x[1] - y[1]).map((x) => x[0]);
    }
    const size = p.pageSize ?? p.maxRows ?? 50;
    const pages = Math.max(1, Math.ceil(rows.length / size));
    const page = Math.min(this._page ?? 0, pages - 1);
    const visible = rows.slice(page * size, page * size + size);
    const set = (k, v) => { this[k] = v; this.requestUpdate(); };
    const cell = (row, col) => {
      const v = row?.[col.key];
      if (col.format === 'link') { const u = safeUrl(v); return u ? html`<a href="${u}" target="_blank" rel="noopener noreferrer">${u.replace(/^https?:\/\//, '')}</a>` : cellText(v); }
      return cellText(v);
    };
    const header = (c) => {
      if (!sortable.has(c.key)) return html`<th>${c.label}</th>`;
      const active = this._sort?.col === c.key;
      const next = active && this._sort.dir === 'asc' ? 'desc' : 'asc';
      return html`<th aria-sort="${active ? (this._sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button @click=${() => set('_sort', { col: c.key, dir: next })}>${c.label}${active ? (this._sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>`;
    };
    return html`
      ${filterCols.length ? html`<div class="tools"><input type="search" aria-label="${p.filterPlaceholder ?? 'Filter'}" placeholder="${p.filterPlaceholder ?? 'Filter…'}" .value=${this._filter ?? ''} @input=${(e) => { this._page = 0; set('_filter', e.target.value); }}></div>` : nothing}
      <table><thead><tr>${p.columns.map(header)}</tr></thead>
        <tbody>${visible.map((r) => html`<tr>${p.columns.map((c) => html`<td>${cell(r, c)}</td>`)}</tr>`)}</tbody></table>
      ${pages > 1 ? html`<div class="pager"><button ?disabled=${page === 0} @click=${() => set('_page', page - 1)}>‹ Prev</button><span>${page + 1} / ${pages}</span><button ?disabled=${page >= pages - 1} @click=${() => set('_page', page + 1)}>Next ›</button></div>` : nothing}`;
  });

const Disclosure = define('Disclosure', 'sua-a2ui-disclosure',
  Common.extend({ label: Str, child: CommonSchemas.ComponentId, open: z.boolean().optional() }).strict(),
  css`
    details > summary { cursor: pointer; font-size: var(--font-size-xs); color: var(--color-text-muted); text-transform: uppercase; letter-spacing: .04em; margin: 4px 0; }
    details[open] > summary { margin-bottom: 8px; }`,
  function (p) { return html`<details ?open=${p.open}><summary>${p.label}</summary>${this.renderNode(p.child)}</details>`; });

const Link = define('Link', 'sua-a2ui-link',
  Common.extend({ text: Str, url: Str }).strict(),
  css`:host { display: inline; }`,
  (p) => { const u = safeUrl(p.url); return u ? html`<a href="${u}" target="_blank" rel="noopener noreferrer">${p.text}</a>` : html`<span>${p.text}</span>`; });

const Code = define('Code', 'sua-a2ui-code',
  Common.extend({ text: Str, language: z.string().max(32).optional() }).strict(),
  css`pre { margin: 0; padding: 8px; background: var(--color-surface-raised); border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: var(--font-size-xs); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 20rem; overflow: auto; }`,
  (p) => html`<pre>${p.text}</pre>`);

const numbers = (v) => (Array.isArray(v) ? v : []).map((x) => Number(typeof x === 'object' && x ? (x.value ?? x.y ?? x.count) : x)).filter((n) => Number.isFinite(n));

const Sparkline = define('Sparkline', 'sua-a2ui-sparkline',
  Common.extend({ values: CommonSchemas.DynamicValue, label: Str.optional(), current: Str.optional() }).strict(),
  css`
    .head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .label { font-size: var(--font-size-xs); color: var(--color-text-muted); text-transform: uppercase; letter-spacing: .04em; }
    .current { font-family: var(--font-mono); font-size: 1.5rem; }
    svg { display: block; width: 100%; height: 48px; margin-top: 4px; }
    polyline { fill: none; stroke: var(--color-primary); stroke-width: 2; vector-effect: non-scaling-stroke; }
    .empty { font-size: var(--font-size-xs); color: var(--color-text-muted); }`,
  (p) => {
    const v = numbers(p.values);
    const last = v.length ? v[v.length - 1] : undefined;
    const head = html`<div class="head"><span class="label">${p.label ?? ''}</span><span class="current">${p.current ?? (last ?? '')}</span></div>`;
    if (v.length < 2) return html`${head}<div class="empty">Not enough points yet.</div>`;
    const min = Math.min(...v); const max = Math.max(...v); const span = max - min || 1;
    const pts = v.map((n, i) => `${(i / (v.length - 1)) * 100},${40 - ((n - min) / span) * 36 - 2}`).join(' ');
    return html`${head}<svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="${p.label ?? 'trend'}"><polyline points="${pts}"></polyline></svg>`;
  });

const Funnel = define('Funnel', 'sua-a2ui-funnel',
  Common.extend({ stages: CommonSchemas.DynamicValue }).strict(),
  css`
    .stage { margin: 4px 0; }
    .row { display: flex; justify-content: space-between; font-size: var(--font-size-xs); }
    .bar { height: 8px; background: var(--color-primary); border-radius: 4px; opacity: .85; }
    .val { font-family: var(--font-mono); color: var(--color-text-muted); }`,
  (p) => {
    const stages = (Array.isArray(p.stages) ? p.stages : []).map((s) => ({ label: String(s?.label ?? s?.name ?? ''), value: Number(s?.value ?? s?.count ?? 0) }));
    const max = Math.max(1, ...stages.map((s) => s.value));
    return html`${stages.map((s) => html`<div class="stage"><div class="row"><span>${s.label}</span><span class="val">${s.value}</span></div>
      <div class="bar" style="width: ${Math.max(2, (s.value / max) * 100)}%"></div></div>`)}`;
  });

// The server resolves and sanitizes SanitizedHtml's html (core
// prepareViewForRender) before the view is sent, so what arrives is already
// allowlisted HTML. It's rendered in this element's shadow root.
const SanitizedHtml = define('SanitizedHtml', 'sua-a2ui-html',
  Common.extend({ html: Str }).strict(),
  css`:host { display: block; overflow-wrap: anywhere; } img { max-width: 100%; }`,
  function () { return html`<div class="sua-html"></div>`; },
  {
    updated() {
      const box = this.renderRoot.querySelector('.sua-html');
      const value = this.controller?.props?.html ?? '';
      if (box && box.__html !== value) { box.innerHTML = value; box.__html = value; }
    },
  });

// ── Canvas boards (docs/boards.md, lib/board-canvas.ts) ───────────────
// A board is one surface: layout components (Column/Row/Tabs/Card from the
// basic catalog, plus Grid, Cell and Section) whose leaves are AgentTile and
// SystemTile. Each tile draws its agent's body as its OWN nested surface (own
// processor, data model and actions) from the page's tile registry,
// <script id="board-tiles">, and refreshes itself from /boards/tile/<id>.json.
let boardTiles;
function boardTile(id) {
  if (!boardTiles) {
    try { boardTiles = JSON.parse(document.getElementById('board-tiles')?.textContent || '{}'); } catch { boardTiles = {}; }
  }
  return boardTiles[id];
}
const boardId = () => document.querySelector('[data-board-canvas]')?.getAttribute('data-board-canvas') || '';

// Arranging a canvas (assets/board-canvas-editor.js): tiles become selectable
// and the selected node is outlined. The editor flips this and redraws.
export const boardEdit = { on: false, selected: '' };
const selfId = (el) => el.context?.componentModel?.id ?? '';
function selectNode(el, e) {
  e.preventDefault(); e.stopPropagation();
  el.dispatchEvent(new CustomEvent('sua-board-select', { bubbles: true, composed: true, detail: { id: selfId(el) } }));
}

/** Redraw a board surface from new messages, merging new tiles into the registry. */
export function remountBoard(host, messages, tiles = {}) {
  boardTile('');
  Object.assign(boardTiles, tiles);
  host.querySelector('a2ui-surface')?.remove();
  host.querySelectorAll(':scope > p.flash').forEach((p) => p.remove());
  const script = host.querySelector('script[type="application/json"]');
  if (script) script.textContent = JSON.stringify(messages);
  host.removeAttribute('data-a2ui-mounted');
  mountSurface(host);
}

const Grid = define('Grid', 'sua-a2ui-grid',
  Common.extend({ children: CommonSchemas.ChildList, minWidth: z.number().int().min(120).max(800).optional() }).strict(),
  css`.sel { outline: 2px solid var(--color-primary); outline-offset: 4px; border-radius: 4px; }
  .grid { min-height: 40px; } .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(var(--min, 280px), 100%), 1fr)); gap: var(--space-3, 12px); align-items: start; grid-auto-flow: dense; }`,
  function (p) {
    const kids = Array.isArray(p.children) ? p.children : [];
    const sel = boardEdit.on && boardEdit.selected === selfId(this);
    return html`<div class="grid ${sel ? 'sel' : ''}" style="--min: ${p.minWidth ?? 280}px">${kids.map((c) => this.renderNode(c))}</div>`;
  });

const Cell = define('Cell', 'sua-a2ui-cell',
  Common.extend({ child: CommonSchemas.ComponentId, span: z.number().int().min(1).max(4).optional(), rows: z.number().int().min(1).max(4).optional() }).strict(),
  css`:host { min-width: 0; } @media (max-width: 640px) { :host { grid-column: auto !important; } }`,
  function (p) {
    this.style.gridColumn = p.span > 1 ? `span ${p.span}` : '';
    this.style.gridRow = p.rows > 1 ? `span ${p.rows}` : '';
    return this.renderNode(p.child);
  });

const Section = define('Section', 'sua-a2ui-section',
  Common.extend({ title: Str, child: CommonSchemas.ComponentId }).strict(),
  css`
    :host { margin-bottom: var(--space-5, 20px); }
    h2 { margin: 0 0 var(--space-3, 12px); font-size: var(--font-size-md); font-weight: var(--weight-semibold, 600); color: var(--color-text); }
    .sel { outline: 2px solid var(--color-primary); outline-offset: 6px; border-radius: 4px; }
    .pick-title { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline dotted; }`,
  function (p) {
    const sel = boardEdit.on && boardEdit.selected === selfId(this);
    return html`<section class=${sel ? 'sel' : ''}><h2>${boardEdit.on ? html`<button type="button" class="pick-title" @click=${(e) => selectNode(this, e)}>${p.title}</button>` : p.title}</h2>${this.renderNode(p.child)}</section>`;
  });

const tileStyles = css`
  :host { display: block; min-width: 0; height: 100%; }
  .tile { box-sizing: border-box; height: 100%; display: flex; flex-direction: column; min-height: 120px; background: var(--color-surface); color: var(--color-text); border: 1px solid var(--color-border); border-radius: var(--radius-md, 8px); padding: var(--space-3, 12px); }
  .tile[data-accent="teal"] { border-left: 4px solid #2dd4bf; } .tile[data-accent="blue"] { border-left: 4px solid #60a5fa; }
  .tile[data-accent="green"] { border-left: 4px solid #4ade80; } .tile[data-accent="orange"] { border-left: 4px solid #fb923c; }
  .tile[data-accent="red"] { border-left: 4px solid #f87171; } .tile[data-accent="purple"] { border-left: 4px solid #a78bfa; }
  .tile[data-palette="dark"] { --color-surface: #1a1918; --color-text: #e7e5e4; --color-text-muted: #a8a29e; --color-border: #3d3a37; --color-surface-raised: #2e2c2a; }
  .tile[data-palette="light"] { --color-surface: #ffffff; --color-text: #1c1917; --color-text-muted: #78716c; --color-border: #e7e5e4; --color-surface-raised: #f5f4f2; }
  .tile[data-palette="accent-teal"] { background: rgba(45,212,191,0.08); border-color: var(--color-primary); }
  .tile[data-palette="accent-red"] { background: rgba(248,113,113,0.08); border-color: var(--color-err); }
  .tile[data-palette="accent-green"] { background: rgba(74,222,128,0.08); border-color: var(--color-ok); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .title { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: var(--font-size-xs); text-transform: uppercase; letter-spacing: .08em; color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .icon-btn { background: none; border: 0; padding: 2px 4px; color: var(--color-text-muted); cursor: pointer; font-size: var(--font-size-sm); line-height: 1; border-radius: var(--radius-sm, 4px); }
  .icon-btn:hover, .icon-btn:focus-visible { color: var(--color-text); background: var(--color-surface-raised); outline: none; }
  form { display: inline; margin: 0; }
  .body { flex: 1; min-width: 0; overflow: auto; }
  .note { color: var(--color-text-muted); font-size: var(--font-size-sm); margin: 0; }
  footer { display: flex; align-items: center; gap: 8px; border-top: 1px solid var(--color-border); margin-top: 10px; padding-top: 8px; font-size: var(--font-size-xs); }
  footer .agent { font-family: var(--font-mono); color: var(--color-primary); text-decoration: none; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .age { margin-left: auto; color: var(--color-text-muted); text-decoration: none; white-space: nowrap; }
  .run { font: inherit; font-size: var(--font-size-xs); padding: 3px 10px; border-radius: var(--radius-sm, 4px); border: 0; background: var(--color-primary); color: var(--color-bg); cursor: pointer; text-decoration: none; white-space: nowrap; }
  .run[disabled] { opacity: .6; cursor: default; }
  .err { color: var(--color-err); }
  .tile { position: relative; }
  .pick { position: absolute; inset: -1px; z-index: 2; background: transparent; border: 2px dashed var(--color-border-strong); border-radius: var(--radius-md, 8px); cursor: pointer; }
  .pick:hover, .pick:focus-visible { border-color: var(--color-primary); outline: none; }
  .tile.selected .pick { border: 2px solid var(--color-primary); background: color-mix(in srgb, var(--color-primary) 8%, transparent); }`;

/** Draw messages as a nested surface; its actions bubble out of `host` (crossing shadow roots). */
function nestedSurface(host, messages) {
  const el = document.createElement('a2ui-surface');
  const processor = new MessageProcessor([suaCatalog], (action) => {
    host.dispatchEvent(new CustomEvent('a2ui-action', { bubbles: true, composed: true, detail: action }));
  });
  processor.onSurfaceCreated((s) => { el.surface = s; });
  try { processor.processMessages(messages); } catch (e) {
    const p = document.createElement('p'); p.className = 'note err'; p.textContent = `This tile couldn't be drawn: ${e.message}`; return p;
  }
  return el;
}
const note = (text) => Object.assign(document.createElement('p'), { className: 'note', textContent: text });
function tileBody(t) {
  if (t.messages) return nestedSurface(this, t.messages);
  if (t.unsupported) return note(`${t.unsupported} It shows on the agent's page.`);
  return note(t.empty || 'No output yet.');
}

const AgentTile = define('AgentTile', 'sua-a2ui-agent-tile',
  Common.extend({ agentId: z.string().min(1).max(128), palette: z.string().optional() }).strict(),
  tileStyles,
  function (p) {
    const t = this._entry ?? boardTile(p.agentId);
    if (!t) return html`<div class="tile"><p class="note"><code>${p.agentId}</code> isn't installed, or has no tile.</p></div>`;
    this.wire(p.agentId, t);
    if (!this._body || this._bodyFor !== t) { this._bodyFor = t; this._body = tileBody.call(this, t); }
    const href = `/agents/${encodeURIComponent(p.agentId)}`;
    const palette = p.palette && p.palette !== 'default' ? p.palette : t.autoPalette;
    const sel = boardEdit.on && boardEdit.selected === selfId(this);
    return html`<div class="tile ${sel ? 'selected' : ''}" data-agent-id=${p.agentId} data-palette=${palette ?? nothing} data-accent=${t.accent ?? nothing}>
      ${boardEdit.on ? html`<button type="button" class="pick" aria-label="Select ${t.title}" aria-pressed=${sel ? 'true' : 'false'} @click=${(e) => selectNode(this, e)}></button>` : nothing}
      <header>
        ${t.icon ? html`<span aria-hidden="true">${t.icon}</span>` : nothing}
        <span class="title" title=${t.title}>${t.title}</span>
        ${t.configure ? html`<button type="button" class="icon-btn" title="Configure tile" aria-label="Configure ${t.title}" @click=${() => this.configure(p.agentId, t)}>⚙</button>` : nothing}
        ${t.hideAction ? html`<form method="POST" action=${t.hideAction}><button type="submit" class="icon-btn" title="Hide from Pulse (restore it from the hidden section)" aria-label="Hide ${t.title} from Pulse">×</button></form>` : nothing}
      </header>
      <div class="body">${this._body}</div>
      <footer>
        <a class="agent" href=${href}>${p.agentId}</a>
        ${this._running ? html`<span class="age">running…</span>` : t.runHref ? html`<a class="age" href=${t.runHref}>${t.age}</a>` : html`<span class="age">${t.age}</span>`}
        ${t.run === 'button' ? html`<button type="button" class="run" ?disabled=${this._running} @click=${() => this.runTile(p.agentId, '')}>Run</button>` : nothing}
        ${t.run === 'link' ? html`<a class="run" href=${href} title="This agent needs input before it can run">Run…</a>` : nothing}
      </footer>
      ${this._error ? html`<p class="note err" role="alert">${this._error}</p>` : nothing}
    </div>`;
  },
  {
    wire(agentId, t) {
      if (!this._listening) {
        // Run actions from inside the nested surface (forms, "Run again") run in this tile.
        this._listening = true;
        this.addEventListener('a2ui-action', (e) => {
          const a = e.detail || {};
          const c = a.context || {};
          if (a.name !== 'run-agent' || c.agent !== agentId) return;
          e.stopPropagation();
          const body = new URLSearchParams();
          for (const k of Object.keys(c)) {
            if (!k.startsWith('in_')) continue;
            let v = c[k]; if (Array.isArray(v)) v = v[0];
            if (v !== undefined && v !== null && String(v) !== '') body.append('input_' + k.slice(3), String(v));
          }
          this.runTile(agentId, body.toString());
        });
      }
      if (t.refreshMs && !this._timer) this._timer = setInterval(() => { if (!this._running && document.visibilityState === 'visible') this.reload(agentId); }, t.refreshMs);
    },
    disconnectedCallback() { A2uiLitElement.prototype.disconnectedCallback?.call(this); if (this._timer) { clearInterval(this._timer); this._timer = undefined; } },
    async reload(agentId) {
      const res = await fetch(`/boards/tile/${encodeURIComponent(agentId)}.json?board=${encodeURIComponent(boardId())}`);
      if (res.ok) { this._entry = await res.json(); this.requestUpdate(); }
    },
    async runTile(agentId, body) {
      this._running = true; this._error = ''; this.requestUpdate();
      try {
        const res = await fetch(`/agents/${encodeURIComponent(agentId)}/widget-run`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.runId) throw new Error(json.error || 'The run didn’t start.');
        let status = '';
        for (let i = 0; i < 400; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          const st = await (await fetch(`/runs/${encodeURIComponent(json.runId)}/widget-status`)).json().catch(() => ({}));
          status = st.status || '';
          if (status === 'failed') { this._error = st.error || 'The run failed.'; break; }
          if (status && status !== 'running' && status !== 'pending') break;
        }
        await this.reload(agentId);
      } catch (e) {
        this._error = e.message;
      } finally { this._running = false; this.requestUpdate(); }
    },
    configure(agentId, t) {
      // The page's configure modal (views/pulse-configure.js.ts) listens for this.
      this.dispatchEvent(new CustomEvent('sua-configure-tile', { bubbles: true, composed: true, detail: { agentId, config: t.configure.config, outputFields: t.configure.outputFields } }));
    },
  });

const SystemTile = define('SystemTile', 'sua-a2ui-system-tile',
  Common.extend({ tileId: z.string().min(1).max(64), palette: z.string().optional() }).strict(),
  tileStyles,
  function (p) {
    const t = boardTile(p.tileId);
    if (!t) return nothing;
    if (!this._body) this._body = tileBody.call(this, t);
    const sel = boardEdit.on && boardEdit.selected === selfId(this);
    return html`<div class="tile ${sel ? 'selected' : ''}" data-palette=${p.palette && p.palette !== 'default' ? p.palette : nothing}>
      ${boardEdit.on ? html`<button type="button" class="pick" aria-label="Select ${t.title}" @click=${(e) => selectNode(this, e)}></button>` : nothing}
      <header>${t.icon ? html`<span aria-hidden="true">${t.icon}</span>` : nothing}<span class="title">${t.title}</span></header>
      <div class="body">${this._body}</div>
    </div>`;
  });

export const suaComponents = [Metric, Badge, KeyValue, Table, Disclosure, Link, Code, Sparkline, Funnel, SanitizedHtml, Grid, Cell, Section, AgentTile, SystemTile];
export const suaCatalog = new Catalog(SUA_CATALOG_ID, '0.9',
  [...basicCatalog.components.values(), ...suaComponents],
  [...basicCatalog.functions.values()]);

/** Draw one surface host: <div data-a2ui-surface><script type="application/json">[messages]</script></div>. */
export function mountSurface(host) {
  if (host.hasAttribute('data-a2ui-mounted')) return;
  host.setAttribute('data-a2ui-mounted', '');
  const script = host.querySelector('script[type="application/json"]');
  let messages;
  try { messages = JSON.parse(script?.textContent ?? '[]'); }
  catch (e) { host.insertAdjacentHTML('beforeend', `<p class="flash flash--error">This widget's data is unreadable.</p>`); return; }
  const processor = new MessageProcessor([suaCatalog], (action) => {
    host.dispatchEvent(new CustomEvent('a2ui-action', { bubbles: true, detail: action }));
  });
  const el = document.createElement('a2ui-surface');
  processor.onSurfaceCreated((s) => { el.surface = s; });
  try { processor.processMessages(messages); }
  catch (e) {
    host.insertAdjacentHTML('beforeend', `<p class="flash flash--error">This widget couldn't be drawn: ${esc(e.message)}</p>`);
    return;
  }
  host.appendChild(el);
}

export function mountSurfaces(root = document) {
  root.querySelectorAll('[data-a2ui-surface]:not([data-a2ui-mounted])').forEach(mountSurface);
}

mountSurfaces();
// Surfaces added later (a chat reply re-rendered from source) mount themselves.
new MutationObserver(() => mountSurfaces()).observe(document.body, { childList: true, subtree: true });
window.suaA2ui = { mountSurfaces, suaCatalog };
