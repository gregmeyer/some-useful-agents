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
    .stage { margin: 6px 0; }
    .row { display: flex; justify-content: space-between; gap: 8px; font-size: var(--font-size-xs); }
    .track { position: relative; height: 10px; border-radius: 5px; background: var(--color-surface-raised); overflow: hidden; }
    .bar { height: 100%; background: var(--color-primary); border-radius: 5px; opacity: .85; }
    .val { font-family: var(--font-mono); color: var(--color-text-muted); white-space: nowrap; }
    .out { color: var(--color-warn); }`,
  (p) => {
    // {label, value} or a notebook's funnel ({stage, reached, here, ruledOut, reasons}).
    const stages = (Array.isArray(p.stages) ? p.stages : []).map((s) => ({
      label: String(s?.label ?? s?.name ?? s?.stage ?? ''),
      value: Number(s?.value ?? s?.count ?? s?.reached ?? 0),
      out: Number(s?.ruledOut ?? s?.out ?? 0),
      reasons: Array.isArray(s?.reasons) ? s.reasons.map((r) => `${r.reason} ×${r.count}`).join(', ') : '',
    }));
    const max = Math.max(1, ...stages.map((s) => s.value));
    return html`${stages.map((s) => html`<div class="stage" title=${s.reasons ? `Ruled out here: ${s.reasons}` : nothing}>
      <div class="row"><span>${s.label}</span><span class="val">${s.value}${s.out ? html` <span class="out">−${s.out}</span>` : nothing}</span></div>
      <div class="track"><div class="bar" style="width: ${s.value ? Math.max(3, (s.value / max) * 100) : 0}%"></div></div></div>`)}`;
  });

// ── Notebook widgets: options as cards or a table, and two fields plotted ──
// Values are formatted with the notebook's fields: money "$4,023", a unit
// "149,652 mi", a range "$150,000–$180,000", a year as written.
const getPath = (o, key) => String(key).split('.').reduce((v, k) => (v == null ? undefined : v[k]), o);
const nfmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
function fmtField(f, v) {
  if (v == null || v === '') return '';
  if (typeof v === 'object' && typeof v.min === 'number' && typeof v.max === 'number') {
    if (v.min === v.max) return fmtField(f, v.min);
    const one = (n) => (f?.type === 'money' ? `$${nfmt(n)}` : nfmt(n));
    return `${one(v.min)}–${one(v.max)}${f?.unit && f.type !== 'money' ? ` ${f.unit}` : ''}`;
  }
  if (typeof v === 'number') {
    if (f?.type === 'money') return `$${nfmt(v)}`;
    if (f?.type === 'number' && !f.unit && Number.isInteger(v) && v >= 1900 && v <= 2100) return String(v);
    return f?.unit ? `${nfmt(v)} ${f.unit}` : nfmt(v);
  }
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}
const short = (n, money) => {
  const a = Math.abs(n);
  const s = a >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : a >= 1e3 ? `${+(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k` : `${+n.toFixed(1)}`;
  return money ? `$${s}` : s;
};
const QUICK_REASONS = ['Not interested', 'Too expensive', 'No reply', 'Failed a check'];

const OptionGrid = define('OptionGrid', 'sua-a2ui-option-grid',
  Common.extend({
    options: CommonSchemas.DynamicValue, fields: CommonSchemas.DynamicValue.optional(), stages: CommonSchemas.DynamicValue.optional(),
    layout: z.enum(['grid', 'table']).optional(), sort: z.string().max(80).optional(), ruledOut: z.enum(['show', 'hide']).optional(),
    actions: z.boolean().optional(), maxItems: z.number().int().min(1).max(100).optional(),
  }).strict(),
  css`
    .bar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: var(--font-size-xs); color: var(--color-text-muted); }
    .bar .sp { flex: 1; }
    .showout { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
    .showout input { margin: 0; accent-color: var(--color-primary); }
    .seg { display: inline-flex; border: 1px solid var(--color-border); border-radius: 6px; overflow: hidden; }
    .seg button { all: unset; cursor: pointer; padding: 3px 10px; font-size: var(--font-size-xs); color: var(--color-text-muted); }
    .seg button[aria-pressed="true"] { background: var(--color-primary); color: var(--color-bg); }
    .seg button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
    .card { display: flex; flex-direction: column; border: 1px solid var(--color-border); border-radius: var(--radius-md, 10px); overflow: hidden; background: var(--color-surface); min-width: 0; }
    .card.best { border-color: var(--color-primary); box-shadow: 0 0 0 1px var(--color-primary); }
    .card.out { opacity: .55; }
    .pic { position: relative; aspect-ratio: 4 / 3; background: color-mix(in srgb, var(--color-primary) 10%, var(--color-surface-raised)); display: grid; place-items: center; color: var(--color-text-subtle, var(--color-text-muted)); }
    .pic img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .pic { background: radial-gradient(120% 90% at 50% 75%, color-mix(in srgb, var(--color-primary) 22%, transparent), color-mix(in srgb, var(--color-primary) 4%, var(--color-surface-raised))); }
    .nophoto { display: flex; flex-direction: column; align-items: center; gap: 6px; color: color-mix(in srgb, var(--color-primary) 70%, var(--color-text-muted)); font-size: var(--font-size-xs); }
    .gone-why { color: var(--color-text-muted); }
    .menu .btn.gone { border-color: var(--color-text-muted); }
    .rank { position: absolute; top: 8px; left: 8px; min-width: 24px; height: 24px; padding: 0 6px; box-sizing: border-box; border-radius: 999px; display: grid; place-items: center; font: 700 12px/1 var(--font-mono); background: var(--color-surface); color: var(--color-text); border: 1px solid var(--color-border-strong, var(--color-border)); }
    .best .rank { background: var(--color-primary); color: var(--color-bg); border-color: var(--color-primary); }
    .ribbon { position: absolute; top: 8px; right: 8px; font: 600 10px/1 var(--font-mono); letter-spacing: .06em; text-transform: uppercase; padding: 4px 6px; border-radius: 4px; background: var(--color-surface); color: var(--color-primary); border: 1px solid var(--color-primary); }
    .body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 6px; flex: 1; }
    .title { font-weight: 600; font-size: var(--font-size-sm); line-height: 1.3; }
    .out .title { text-decoration: line-through; }
    .price { font: 700 1.35rem/1 var(--font-mono); color: var(--color-text); }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .chip { font: var(--font-size-xs)/1.6 var(--font-mono); padding: 0 6px; border-radius: 4px; background: var(--color-surface-raised); border: 1px solid var(--color-border); white-space: nowrap; }
    .chip.stage { background: var(--color-primary-soft); color: var(--color-primary); border-color: transparent; border-radius: 999px; }
    .chip.better { color: var(--color-ok); border-color: var(--color-ok); } .chip.worse { color: var(--color-warn); border-color: var(--color-warn); }
    .chip.gone { border-style: dashed; color: var(--color-text-muted); }
    .why { font-size: var(--font-size-xs); color: var(--color-warn); }
    .acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: auto; padding-top: 4px; align-items: center; }
    .btn { all: unset; cursor: pointer; font-size: var(--font-size-xs); padding: 3px 8px; border-radius: 6px; border: 1px solid var(--color-border); color: var(--color-text); background: var(--color-surface); }
    .btn:hover, .btn:focus-visible { border-color: var(--color-primary); }
    .btn.ghost { border-color: transparent; color: var(--color-text-muted); }
    a.btn { color: var(--color-primary); }
    .menu { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px; margin-top: 4px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-surface-raised); }
    .menu input { flex: 1 1 140px; min-width: 0; font: inherit; font-size: var(--font-size-xs); padding: 3px 6px; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-surface); color: var(--color-text); }
    table { width: 100%; border-collapse: collapse; font-size: var(--font-size-sm); }
    th { text-align: left; font-weight: 500; font-size: var(--font-size-xs); color: var(--color-text-muted); text-transform: uppercase; letter-spacing: .04em; }
    th, td { padding: 6px 8px; border-bottom: 1px solid var(--color-border); vertical-align: middle; }
    td.num { font-family: var(--font-mono); white-space: nowrap; }
    tr.out td { opacity: .55; } tr.best td { background: color-mix(in srgb, var(--color-primary) 8%, transparent); }
    .thumb { width: 56px; height: 42px; object-fit: cover; border-radius: 4px; display: block; }
    .empty { color: var(--color-text-muted); font-size: var(--font-size-sm); }`,
  function (p) {
    const fields = Array.isArray(p.fields) ? p.fields : [];
    const stages = Array.isArray(p.stages) ? p.stages.map(String) : [];
    const byRole = (r) => fields.find((f) => f.role === r);
    const priceF = byRole('price'); const measureF = byRole('measure');
    const priceBetter = priceF?.better ?? 'lower';
    // Ruled out (and gone) options are hidden unless you ask to see them; your choice is kept in this browser.
    const all = (Array.isArray(p.options) ? p.options : []).filter(Boolean);
    const outCount = all.filter((o) => o.ruledOut).length;
    let showOut; try { showOut = localStorage.getItem('sua-option-show-out') === '1'; } catch { showOut = false; }
    if (this._showOut !== undefined) showOut = this._showOut;
    if (p.ruledOut === 'show') showOut = true;
    let opts = all.filter((o) => showOut || !o.ruledOut);
    // Sort: in the running first, then by the chosen field (price by default, the better way first).
    const [skey, sdir] = String(p.sort ?? 'price').trim().split(/\s+/);
    const sval = (o) => (skey === 'price' || skey === 'measure' ? o[skey] : getPath(o.fields ?? {}, skey));
    const dir = sdir === 'desc' || (sdir === undefined && skey === 'price' && priceBetter === 'higher') ? -1 : 1;
    opts = opts.map((o, i) => [o, i]).sort((a, b) => (Number(!!a[0].ruledOut) - Number(!!b[0].ruledOut))
      || (sval(a[0]) == null) - (sval(b[0]) == null) || compare(sval(a[0]) ?? '', sval(b[0]) ?? '') * dir || a[1] - b[1]).map((x) => x[0]);
    if (p.maxItems) opts = opts.slice(0, p.maxItems);
    if (!all.length) return html`<p class="empty">No options yet.</p>`;
    // Grid or Table: your last choice, kept in this browser.
    let saved; try { saved = localStorage.getItem('sua-option-layout') ?? undefined; } catch { saved = undefined; }
    const layout = this._layout ?? (saved === 'grid' || saved === 'table' ? saved : undefined) ?? p.layout ?? 'grid';
    const set = (k, v) => { this[k] = v; if (k === '_layout') { try { localStorage.setItem('sua-option-layout', v); } catch { /* not kept */ } } this.requestUpdate(); };
    const act = (detail) => this.dispatchEvent(new CustomEvent('a2ui-action', { bubbles: true, composed: true, detail: { name: 'notebook-option', context: detail } }));
    const next = (o) => { const i = stages.indexOf(o.stage); return i >= 0 ? stages[i + 1] : undefined; };
    const facts = (o) => fields.filter((f) => f.role !== 'price' && f.role !== 'link' && f.role !== 'image' && f.type !== 'url' && f.type !== 'image')
      .map((f) => fmtField(f, o.fields?.[f.key])).filter(Boolean).slice(0, 5);
    const change = (o) => {
      const c = o.priceChange; if (!c || !priceF) return nothing;
      const down = c.to < c.from; const good = down === (priceBetter === 'lower');
      return html`<span class="chip ${good ? 'better' : 'worse'}" title="${fmtField(priceF, c.from)} → ${fmtField(priceF, c.to)}">${down ? '↓' : '↑'} ${fmtField(priceF, Math.abs(c.to - c.from))}</span>`;
    };
    const ruleMenu = (o) => (this._menu === o.id ? html`<div class="menu" role="group" aria-label="Why rule it out?">
      <button type="button" class="btn gone" title="Sold, filled or taken down: not your call" @click=${() => { set('_menu', ''); act({ op: 'gone', id: o.id }); }}>No longer available</button>
      ${QUICK_REASONS.map((r) => html`<button type="button" class="btn" @click=${() => { set('_menu', ''); act({ op: 'ruleOut', id: o.id, reason: r }); }}>${r}</button>`)}
      <input type="text" placeholder="or your words" aria-label="Reason" @keydown=${(e) => { if (e.key === 'Enter' && e.target.value.trim()) { set('_menu', ''); act({ op: 'ruleOut', id: o.id, reason: e.target.value.trim() }); } }}>
    </div>` : nothing);
    const actions = (o) => html`<div class="acts">
      ${safeUrl(o.link) ? html`<a class="btn" href=${safeUrl(o.link)} target="_blank" rel="noopener noreferrer">Listing ↗</a>` : nothing}
      ${p.actions && !o.ruledOut && next(o) ? html`<button type="button" class="btn" @click=${() => act({ op: 'move', id: o.id, stage: next(o) })}>${next(o)} →</button>` : nothing}
      ${p.actions && !o.ruledOut ? html`<button type="button" class="btn ghost" aria-expanded=${this._menu === o.id ? 'true' : 'false'} @click=${() => set('_menu', this._menu === o.id ? '' : o.id)}>Rule out…</button>` : nothing}
      ${p.actions && o.ruledOut ? html`<button type="button" class="btn ghost" @click=${() => act({ op: 'reinstate', id: o.id })}>Bring back</button>` : nothing}
    </div>${ruleMenu(o)}`;
    const active = opts.filter((o) => !o.ruledOut);
    const best = active[0];
    const toggleOut = () => { const v = !showOut; this._showOut = v; try { localStorage.setItem('sua-option-show-out', v ? '1' : '0'); } catch { /* not kept */ } this.requestUpdate(); };
    const toggle = html`<div class="bar"><span>${active.length} in the running</span>
      ${outCount ? html`<label class="showout"><input type="checkbox" .checked=${showOut} @change=${toggleOut}> Show ruled out (${outCount})</label>` : nothing}
      <span class="sp"></span>
      <div class="seg" role="group" aria-label="Layout">
        <button type="button" aria-pressed=${layout === 'grid' ? 'true' : 'false'} @click=${() => set('_layout', 'grid')}>Grid</button>
        <button type="button" aria-pressed=${layout === 'table' ? 'true' : 'false'} @click=${() => set('_layout', 'table')}>Table</button>
      </div></div>`;
    if (layout === 'table') {
      return html`${toggle}<table><thead><tr><th>#</th><th></th><th>Option</th><th>${priceF?.label ?? 'Price'}</th><th>${measureF?.label ?? ''}</th><th>Stage</th><th></th></tr></thead><tbody>
        ${opts.map((o) => html`<tr class="${o.ruledOut ? 'out' : o === best ? 'best' : ''}">
          <td class="num">${o.ruledOut ? '·' : active.indexOf(o) + 1}</td>
          <td>${safeUrl(o.image) ? html`<img class="thumb" src=${safeUrl(o.image)} alt="" loading="lazy">` : nothing}</td>
          <td><div class="title">${o.name ?? o.title}</div>${o.ruledOut ? html`<div class="why">${o.ruledOut.gone ? 'No longer available' : `Ruled out: ${o.ruledOut.reason}`}</div>` : nothing}</td>
          <td class="num">${priceF ? fmtField(priceF, o.fields?.[priceF.key]) : ''} ${change(o)}</td>
          <td class="num">${measureF ? fmtField(measureF, o.fields?.[measureF.key]) : ''}</td>
          <td>${o.stage ? html`<span class="chip stage">${o.stage}</span>` : nothing}</td>
          <td>${actions(o)}</td></tr>`)}</tbody></table>`;
    }
    return html`${toggle}<div class="grid">${opts.map((o) => html`<article class="card ${o.ruledOut ? 'out' : ''} ${o === best ? 'best' : ''}">
      <div class="pic">
        ${safeUrl(o.image) ? html`<img src=${safeUrl(o.image)} alt="" loading="lazy">`
          : html`<div class="nophoto"><svg aria-hidden="true" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="9" cy="10" r="2"></circle><path d="M21 16l-5-5-8 8"></path></svg><span>No photo yet</span></div>`}
        <span class="rank">${o.ruledOut ? '·' : active.indexOf(o) + 1}</span>
        ${o === best ? html`<span class="ribbon">best ${priceBetter === 'higher' ? 'pay' : 'price'}</span>` : nothing}
      </div>
      <div class="body">
        <div class="title" title=${o.title}>${o.name ?? o.title}</div>
        ${priceF && o.fields?.[priceF.key] != null ? html`<div class="price">${fmtField(priceF, o.fields[priceF.key])}</div>` : nothing}
        <div class="chips">${facts(o).map((f) => html`<span class="chip">${f}</span>`)}${change(o)}
          ${o.notSeenLately && !o.ruledOut ? html`<span class="chip gone" title="Recent searches found others but not this one">not seen lately</span><button type="button" class="btn ghost" @click=${() => act({ op: 'gone', id: o.id })}>Mark gone</button>` : nothing}</div>
        <div class="chips">${o.stage && !o.ruledOut ? html`<span class="chip stage">${o.stage}</span>` : nothing}</div>
        ${o.ruledOut ? (o.ruledOut.gone ? html`<div class="why gone-why">No longer available</div>` : html`<div class="why">Ruled out${o.ruledOut.stage ? ` at ${o.ruledOut.stage}` : ''}: ${o.ruledOut.reason}</div>`) : nothing}
        ${actions(o)}
      </div></article>`)}</div>`;
  });

// Drawn with DOM calls after render (the vendored lit has no svg tag); text
// goes in with textContent, so a title is never markup.
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}, text) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  return n;
}

const Scatter = define('Scatter', 'sua-a2ui-scatter',
  Common.extend({
    points: CommonSchemas.DynamicValue, x: z.string(), y: z.string(), label: z.string().optional(),
    xLabel: Str.optional(), yLabel: Str.optional(), xFormat: z.enum(['number', 'money']).optional(), yFormat: z.enum(['number', 'money']).optional(),
    xBand: CommonSchemas.DynamicValue.optional(), yBand: CommonSchemas.DynamicValue.optional(),
    xBetter: z.enum(['higher', 'lower']).optional(), yBetter: z.enum(['higher', 'lower']).optional(),
  }).strict(),
  css`
    .chart svg { display: block; width: 100%; height: auto; max-height: 320px; }
    .axis { fill: var(--color-text-muted); font: 10px var(--font-mono); }
    .gridline { stroke: var(--color-border); }
    .band { fill: var(--color-primary); fill-opacity: .08; stroke: var(--color-primary); stroke-opacity: .45; stroke-dasharray: 4 3; }
    .dot { fill: var(--accent-blue, #60a5fa); stroke: var(--color-surface); stroke-width: 1.5; }
    .dot.best { fill: var(--color-primary); }
    .dot.out { fill: none; stroke: var(--color-text-muted); stroke-dasharray: 2 2; }
    .halo { fill: var(--color-primary); fill-opacity: .18; }
    .lbl { fill: var(--color-text); font: 600 11px var(--font-sans, system-ui); }
    .legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: var(--font-size-xs); color: var(--color-text-muted); margin-top: 4px; }
    .empty { color: var(--color-text-muted); font-size: var(--font-size-sm); }`,
  function (p) {
    const n = (Array.isArray(p.points) ? p.points : []).filter((o) => Number.isFinite(Number(getPath(o, p.x))) && Number.isFinite(Number(getPath(o, p.y)))).length;
    if (n === 0) return html`<p class="empty">Nothing to plot yet: options need ${p.xLabel ?? p.x} and ${p.yLabel ?? p.y}.</p>`;
    const banded = (b) => b && typeof b.min === 'number';
    return html`<div class="chart" role="img" aria-label="${p.yLabel ?? p.y} by ${p.xLabel ?? p.x} for ${n} options"></div>
      <div class="legend"><span>● in the running</span><span>◌ ruled out</span>${banded(p.xBand) || banded(p.yBand) ? html`<span>▭ your limits</span>` : nothing}</div>`;
  },
  {
    updated() {
      const box = this.renderRoot.querySelector('.chart');
      const p = this.controller?.props;
      if (!box || !p) return;
      const band = (b) => (b && typeof b.min === 'number' && typeof b.max === 'number' ? b : undefined);
      const xb = band(p.xBand); const yb = band(p.yBand);
      const pts = (Array.isArray(p.points) ? p.points : []).map((o) => ({ o, x: Number(getPath(o, p.x)), y: Number(getPath(o, p.y)) }))
        .filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y));
      const W = 520, H = 260, L = 48, R = 14, T = 16, B = 30;
      const xs = [...pts.map((d) => d.x), ...(xb ? [xb.min, xb.max] : [])];
      const ys = [...pts.map((d) => d.y), ...(yb ? [yb.min, yb.max] : [])];
      const pad = (lo, hi) => { const s = hi - lo || Math.abs(hi) || 1; return [lo - s * 0.1, hi + s * 0.1]; };
      const [x0, x1] = pad(Math.min(...xs), Math.max(...xs)); const [y0, y1] = pad(Math.min(...ys), Math.max(...ys));
      const sx = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
      const sy = (v) => H - B - ((v - y0) / (y1 - y0)) * (H - T - B);
      const ticks = (lo, hi) => [0, 1, 2, 3].map((i) => lo + ((hi - lo) * (i + 0.5)) / 4);
      const inside = (d) => (!xb || (d.x >= xb.min && d.x <= xb.max)) && (!yb || (d.y >= yb.min && d.y <= yb.max));
      const ybetter = p.yBetter ?? 'lower';
      const best = pts.filter((d) => !d.o?.ruledOut).sort((a, b) => (Number(inside(b)) - Number(inside(a))) || (ybetter === 'lower' ? a.y - b.y : b.y - a.y))[0];
      const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });
      for (const v of ticks(y0, y1)) {
        svg.append(svgEl('line', { class: 'gridline', x1: L, x2: W - R, y1: sy(v), y2: sy(v) }));
        svg.append(svgEl('text', { class: 'axis', x: L - 6, y: sy(v) + 3, 'text-anchor': 'end' }, short(v, p.yFormat === 'money')));
      }
      for (const v of ticks(x0, x1)) svg.append(svgEl('text', { class: 'axis', x: sx(v), y: H - B + 14, 'text-anchor': 'middle' }, short(v, p.xFormat === 'money')));
      if (xb || yb) {
        const bx0 = sx(xb ? xb.min : x0); const bx1 = sx(xb ? xb.max : x1); const by0 = sy(yb ? yb.max : y1); const by1 = sy(yb ? yb.min : y0);
        svg.append(svgEl('rect', { class: 'band', x: bx0, y: by0, width: bx1 - bx0, height: by1 - by0 }));
      }
      svg.append(svgEl('text', { class: 'axis', x: W - R, y: H - 4, 'text-anchor': 'end' }, `${p.xLabel ?? p.x} →`));
      svg.append(svgEl('text', { class: 'axis', x: 4, y: T - 4 }, `${p.yLabel ?? p.y}`));
      if (best) svg.append(svgEl('circle', { class: 'halo', cx: sx(best.x), cy: sy(best.y), r: 16 }));
      for (const d of pts) {
        const c = svgEl('circle', { class: `dot ${d.o?.ruledOut ? 'out' : d === best ? 'best' : ''}`, cx: sx(d.x), cy: sy(d.y), r: d === best ? 8 : 6 });
        c.append(svgEl('title', {}, `${d.o?.title ?? ''}: ${short(d.y, p.yFormat === 'money')}, ${short(d.x, p.xFormat === 'money')}${d.o?.ruledOut ? ' (ruled out)' : ''}`));
        svg.append(c);
      }
      if (best) {
        const name = String(p.label ? getPath(best.o, p.label) ?? '' : best.o?.title ?? '').split(',')[0].slice(0, 30);
        const tx = sx(best.x) > W / 2 ? sx(best.x) - 14 : sx(best.x) + 14;
        svg.append(svgEl('text', { class: 'lbl', x: tx, y: sy(best.y) - 12, 'text-anchor': sx(best.x) > W / 2 ? 'end' : 'start' }, name));
      }
      box.replaceChildren(svg);
    },
  });

// ── Notebook story pieces (artboard 23): a titled frame, a callout, a stat
// strip, progress steps, where a search looked, checklists, a timeline, chips.
const mono = css`font-family: var(--font-mono);`;

const Columns = define('Columns', 'sua-a2ui-columns',
  Common.extend({ children: CommonSchemas.ChildList, widths: z.array(z.number().min(1).max(12)).max(6).optional(), align: z.enum(['stretch', 'start']).optional() }).strict(),
  css`
    :host { display: block; }
    .cols { display: grid; gap: var(--space-4, 16px); align-items: stretch; }
    .cols.start { align-items: start; }
    .cols.start > * { height: auto; }
    @media (max-width: 760px) { .cols { grid-template-columns: 1fr !important; } }`,
  function (p) {
    const kids = Array.isArray(p.children) ? p.children : [];
    const w = kids.map((_, i) => Number(p.widths?.[i] ?? 1));
    return html`<div class="cols ${p.align === 'start' ? 'start' : ''}" style="grid-template-columns: ${w.map((n) => `minmax(0, ${n}fr)`).join(' ')}">${kids.map((c) => this.renderNode(c))}</div>`;
  });

const Panel = define('Panel', 'sua-a2ui-panel',
  Common.extend({ title: Str, note: Str.optional(), child: CommonSchemas.ComponentId }).strict(),
  css`
    :host { display: block; min-width: 0; height: 100%; }
    .frame { box-sizing: border-box; height: 100%; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg, 14px); padding: var(--space-4, 16px); }
    .head { display: flex; align-items: baseline; gap: 8px; margin-bottom: var(--space-3, 12px); }
    h3 { margin: 0; font: 700 15px/1.2 var(--font-mono); color: var(--color-text); }
    .note { margin-left: auto; font-size: var(--font-size-xs); color: var(--color-text-muted); text-align: right; }`,
  function (p) { return html`<section class="frame"><div class="head"><h3>${p.title}</h3>${p.note ? html`<span class="note">${p.note}</span>` : nothing}</div>${this.renderNode(p.child)}</section>`; });

// **bold** only; everything else escaped (same rule as Text's markdown).
const boldOnly = (s) => esc(s).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
const Callout = define('Callout', 'sua-a2ui-callout',
  Common.extend({ label: Str.optional(), text: Str, next: Str.optional() }).strict(),
  css`
    :host { display: block; }
    .box { padding: var(--space-4, 16px); background: var(--color-surface); border: 1px solid var(--color-border); border-left: 3px solid var(--color-primary); border-radius: var(--radius-md, 10px); }
    .label { font: 600 11px/1 var(--font-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--color-primary); }
    .text { margin: 8px 0 0; font-size: var(--font-size-lg, 17px); line-height: 1.45; color: var(--color-text); }
    .text strong { font-weight: 600; }
    .next { margin: 8px 0 0; font-size: var(--font-size-sm); color: var(--color-text-muted); }
    .next b { color: var(--color-text); }`,
  function () { return html`<div class="box">${this.controller?.props?.label ? html`<div class="label">${this.controller.props.label}</div>` : nothing}<p class="text"></p>${this.controller?.props?.next ? html`<p class="next"><b>Next:</b> ${this.controller.props.next}</p>` : nothing}</div>`; },
  { updated() { const el = this.renderRoot.querySelector('.text'); const v = this.controller?.props?.text ?? ''; if (el && el.__v !== v) { el.innerHTML = boldOnly(v); el.__v = v; } } });

const StatStrip = define('StatStrip', 'sua-a2ui-stat-strip',
  Common.extend({ items: CommonSchemas.DynamicValue }).strict(),
  css`
    .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: var(--space-3, 12px); }
    .stat { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border-radius: var(--radius-md, 10px); background: var(--color-surface); border: 1px solid var(--color-border); min-width: 0; }
    b { font: 700 1.6rem/1 var(--font-mono); color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    b.ok { color: var(--color-primary); } b.warn { color: var(--color-warn); } b.err { color: var(--color-err); }
    span { font-size: var(--font-size-xs); color: var(--color-text-muted); }`,
  (p) => html`<div class="row">${(Array.isArray(p.items) ? p.items : []).map((s) => html`<div class="stat"><b class="${tone(s?.tone)}">${s?.value ?? ''}</b><span>${s?.label ?? ''}${s?.sub ? html` · ${s.sub}` : nothing}</span></div>`)}</div>`);

const Steps = define('Steps', 'sua-a2ui-steps',
  Common.extend({ steps: CommonSchemas.DynamicValue, label: Str.optional() }).strict(),
  css`
    .top { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
    .ring-bg { fill: none; stroke: var(--color-border); stroke-width: 7; }
    .ring { fill: none; stroke: var(--color-primary); stroke-width: 7; stroke-linecap: round; }
    .ring-txt { fill: var(--color-text); font: 700 15px var(--font-mono); }
    .label { font: 600 11px/1 var(--font-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--color-text-muted); }
    .sub { margin-top: 6px; font-size: var(--font-size-xs); color: var(--color-text-muted); }
    ol { list-style: none; margin: 0; padding: 0; }
    li { position: relative; padding: 0 0 14px 28px; }
    li:last-child { padding-bottom: 0; }
    li::before { content: ""; position: absolute; left: 9px; top: 20px; bottom: 0; width: 2px; background: var(--color-border); }
    li:last-child::before { display: none; }
    .dot { position: absolute; left: 0; top: 0; width: 20px; height: 20px; box-sizing: border-box; border-radius: 50%; border: 2px solid var(--color-border-strong, var(--color-border)); background: var(--color-surface); display: grid; place-items: center; font: 700 10px/1 var(--font-mono); color: var(--color-text-muted); }
    .met .dot { background: var(--color-ok); border-color: var(--color-ok); color: var(--color-bg); }
    .now .dot { border-color: var(--color-primary); color: var(--color-primary); box-shadow: 0 0 0 4px var(--color-primary-soft); }
    .t { font-size: var(--font-size-sm); font-weight: 600; color: var(--color-text); }
    .todo .t { color: var(--color-text-muted); font-weight: 500; }
    .n { font-size: var(--font-size-xs); color: var(--color-text-muted); }`,
  (p) => {
    const steps = (Array.isArray(p.steps) ? p.steps : []).map((s) => ({ text: String(s?.text ?? s?.label ?? ''), met: !!s?.met, note: s?.note }));
    const met = steps.filter((s) => s.met).length; const total = steps.length || 1;
    const nowAt = steps.findIndex((s) => !s.met);
    const C = 2 * Math.PI * 26; const dash = (met / total) * C;
    return html`<div class="top">
      <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="${met} of ${steps.length} done">
        <circle class="ring-bg" cx="32" cy="32" r="26"></circle>
        <circle class="ring" cx="32" cy="32" r="26" stroke-dasharray="${dash} ${C}" transform="rotate(-90 32 32)"></circle>
        <text class="ring-txt" x="32" y="37" text-anchor="middle">${met}/${steps.length}</text>
      </svg>
      <div><div class="label">${p.label ?? 'Done when'}</div><div class="sub">${steps.length - met ? `${steps.length - met} to go` : 'All done'}</div></div>
    </div>
    <ol>${steps.map((s, i) => html`<li class="${s.met ? 'met' : i === nowAt ? 'now' : 'todo'}"><span class="dot">${s.met ? '✓' : i + 1}</span><div class="t">${s.text}</div>${s.note ? html`<div class="n">${s.note}</div>` : nothing}</li>`)}</ol>`;
  });

const Coverage = define('Coverage', 'sua-a2ui-coverage',
  Common.extend({ sources: CommonSchemas.DynamicValue, note: Str.optional() }).strict(),
  css`
    .src { display: grid; grid-template-columns: minmax(90px, 40%) 1fr auto; align-items: center; gap: 10px; font-size: var(--font-size-sm); margin-bottom: 10px; }
    .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .track { height: 10px; border-radius: 5px; background: var(--color-surface-raised); overflow: hidden; }
    .fill { height: 100%; border-radius: 5px; background: var(--color-primary); }
    .blocked .track { background: repeating-linear-gradient(135deg, var(--color-warn-soft) 0 5px, transparent 5px 10px); border: 1px solid var(--color-warn-border, var(--color-warn)); }
    .skipped .track { background: none; border: 1px dashed var(--color-border-strong, var(--color-border)); }
    .val { font: var(--font-size-xs) var(--font-mono); white-space: nowrap; color: var(--color-text-muted); }
    .found .val { color: var(--color-primary); } .blocked .val { color: var(--color-warn); }
    .skipped .name, .skipped .val { color: var(--color-text-subtle, var(--color-text-muted)); }
    .note { font-size: var(--font-size-xs); color: var(--color-text-muted); margin-top: 4px; }
    .empty { font-size: var(--font-size-sm); color: var(--color-text-muted); }`,
  (p) => {
    const src = (Array.isArray(p.sources) ? p.sources : []).map((s) => ({ name: String(s?.name ?? ''), found: Number(s?.found ?? 0), status: String(s?.status ?? (Number(s?.found) > 0 ? 'found' : 'none')), note: s?.note }));
    if (!src.length) return html`<p class="empty">The next search will show which sites it reached here.</p>`;
    const max = Math.max(1, ...src.map((s) => s.found));
    const label = (s) => (s.status === 'found' ? `${s.found} found` : s.status === 'blocked' ? 'blocked' : s.status === 'skipped' ? 'skipped' : 'none');
    return html`${src.map((s) => html`<div class="src ${s.status}" title=${s.note ?? nothing}><span class="name">${s.name}</span><span class="track">${s.status === 'found' ? html`<span class="fill" style="display:block;width:${Math.max(6, (s.found / max) * 100)}%"></span>` : nothing}</span><span class="val">${label(s)}</span></div>`)}
      ${p.note ? html`<div class="note">${p.note}</div>` : nothing}`;
  });

const Checklist = define('Checklist', 'sua-a2ui-checklist',
  Common.extend({ groups: CommonSchemas.DynamicValue, actions: z.boolean().optional() }).strict(),
  css`
    .groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px 16px; }
    .g + .g { padding-top: 0; }
    .g h4 { margin: 0 0 6px; font-size: var(--font-size-sm); font-weight: 600; color: var(--color-text); }
    label { display: flex; align-items: center; gap: 10px; padding: 5px 0; font-size: var(--font-size-sm); color: var(--color-text); cursor: pointer; }
    label.done span { color: var(--color-text-muted); text-decoration: line-through; }
    input { width: 16px; height: 16px; margin: 0; accent-color: var(--color-primary); }
    .empty { font-size: var(--font-size-sm); color: var(--color-text-muted); }`,
  function (p) {
    const groups = Array.isArray(p.groups) ? p.groups : [];
    if (!groups.length) return html`<p class="empty">Nothing to check yet.</p>`;
    const act = (id, item, done) => this.dispatchEvent(new CustomEvent('a2ui-action', { bubbles: true, composed: true, detail: { name: 'notebook-option', context: { op: 'check', id, item, done } } }));
    return html`<div class="groups">${groups.map((g) => html`<div class="g"><h4>${g?.title ?? ''}</h4>
      ${(Array.isArray(g?.items) ? g.items : []).map((it) => html`<label class="${it?.done ? 'done' : ''}"><input type="checkbox" .checked=${!!it?.done} ?disabled=${!p.actions} @change=${(e) => act(g.id, it.text, e.target.checked)}><span>${it?.text ?? ''}</span></label>`)}</div>`)}</div>`;
  });

const Timeline = define('Timeline', 'sua-a2ui-timeline',
  Common.extend({ events: CommonSchemas.DynamicValue, maxItems: z.number().int().min(1).max(50).optional() }).strict(),
  css`
    ol { list-style: none; margin: 0 0 0 6px; padding: 0 0 0 18px; border-left: 2px solid var(--color-border); display: grid; gap: 14px; }
    li { position: relative; }
    li::before { content: ""; position: absolute; left: -25px; top: 3px; width: 10px; height: 10px; border-radius: 50%; background: var(--color-surface); border: 2px solid var(--color-primary); }
    li.decision::before { border-color: var(--color-ok); } li.search::before { border-color: var(--accent-blue, var(--color-primary)); }
    li.out::before { border-color: var(--color-warn); } li.faded::before { border-color: var(--color-border-strong, var(--color-border)); }
    .when { font: var(--font-size-xs)/1.4 var(--font-mono); color: var(--color-text-muted); }
    .when a { color: var(--color-primary); }
    .t { font-size: var(--font-size-sm); font-weight: 600; color: var(--color-text); }
    .b { margin-top: 2px; font-size: var(--font-size-sm); color: var(--color-text-muted); }
    .faded .t, .faded .b { color: var(--color-text-subtle, var(--color-text-muted)); }
    .tag { margin-left: 6px; font: var(--font-size-xs)/1 var(--font-mono); padding: 1px 5px; border-radius: 4px; border: 1px dashed var(--color-border-strong, var(--color-border)); color: var(--color-text-muted); font-weight: 400; }
    .empty { font-size: var(--font-size-sm); color: var(--color-text-muted); }`,
  (p) => {
    const ev = (Array.isArray(p.events) ? p.events : []).slice(0, p.maxItems ?? 12);
    if (!ev.length) return html`<p class="empty">Nothing yet.</p>`;
    const when = (at) => { const d = new Date(at); return Number.isFinite(d.getTime()) ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };
    return html`<ol>${ev.map((e) => html`<li class="${e?.kind ?? ''} ${e?.faded ? 'faded' : ''}"><div class="when">${when(e?.at)}${safeUrl(e?.link) ? html` · <a href=${safeUrl(e.link)}>${e.linkText ?? 'run'}</a>` : nothing}</div>
      <div class="t">${e?.title ?? ''}${e?.tag ? html`<span class="tag">${e.tag}</span>` : nothing}</div>${e?.body ? html`<div class="b">${e.body}</div>` : nothing}</li>`)}</ol>`;
  });

const ChipList = define('ChipList', 'sua-a2ui-chip-list',
  Common.extend({ items: CommonSchemas.DynamicValue }).strict(),
  css`
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { font: var(--font-size-xs)/1.7 var(--font-mono); padding: 0 8px; border-radius: 6px; background: var(--color-surface-raised); border: 1px solid var(--color-border); color: var(--color-text); }
    .chip.warn { background: var(--color-warn-soft); border-color: var(--color-warn-border, var(--color-warn)); color: var(--color-warn); }
    .chip.ok { background: var(--color-ok-soft); color: var(--color-ok); }`,
  (p) => html`<div class="chips">${(Array.isArray(p.items) ? p.items : []).map((c) => (typeof c === 'string'
    ? html`<span class="chip">${c}</span>`
    : html`<span class="chip ${tone(c?.tone)}" title=${c?.title ?? nothing}>${c?.text ?? ''}</span>`))}</div>`);

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
  .tile[data-accent="teal"] { border-left: 4px solid var(--accent-teal); } .tile[data-accent="blue"] { border-left: 4px solid var(--accent-blue); }
  .tile[data-accent="green"] { border-left: 4px solid var(--accent-green); } .tile[data-accent="orange"] { border-left: 4px solid var(--accent-orange); }
  .tile[data-accent="red"] { border-left: 4px solid var(--accent-red); } .tile[data-accent="purple"] { border-left: 4px solid var(--accent-purple); }
  .tile[data-palette="dark"] { --color-surface: var(--palette-dark-surface); --color-text: var(--palette-dark-text); --color-text-muted: var(--palette-dark-text-muted); --color-border: var(--palette-dark-border); --color-surface-raised: var(--palette-dark-surface-raised); }
  .tile[data-palette="light"] { --color-surface: var(--palette-light-surface); --color-text: var(--palette-light-text); --color-text-muted: var(--palette-light-text-muted); --color-border: var(--palette-light-border); --color-surface-raised: var(--palette-light-surface-raised); }
  .tile[data-palette="accent-teal"] { background: color-mix(in srgb, var(--accent-teal) 8%, transparent); border-color: var(--color-primary); }
  .tile[data-palette="accent-red"] { background: color-mix(in srgb, var(--accent-red) 8%, transparent); border-color: var(--color-err); }
  .tile[data-palette="accent-green"] { background: color-mix(in srgb, var(--accent-green) 8%, transparent); border-color: var(--color-ok); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .archived { flex: none; font-size: var(--font-size-xs); color: var(--color-warn); border: 1px solid currentColor; border-radius: 999px; padding: 0 6px; text-decoration: none; }
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
        ${t.archived ? html`<a class="archived" href=${href} title="This agent is archived; open it to restore">archived</a>` : nothing}
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

export const suaComponents = [Metric, Badge, KeyValue, Table, Disclosure, Link, Code, Sparkline, Funnel, OptionGrid, Scatter, Columns, Panel, Callout, StatStrip, Steps, Coverage, Checklist, Timeline, ChipList, SanitizedHtml, Grid, Cell, Section, AgentTile, SystemTile];
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
