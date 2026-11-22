// sua's A2UI client: the sua catalog's components (Metric, Badge, KeyValue,
// Table, Link, Code, SanitizedHtml) on top of the vendored A2UI renderer, and
// a mounter that draws every <div data-a2ui-surface> on the page from the
// A2UI v1.0 messages embedded inside it as JSON (ADR-0084).
//
// Component props MUST match the schemas in packages/core/src/a2ui/catalog.ts
// (the server validates views against those; a test compares the names).
// A button/choice `action` in a surface is re-dispatched from its host as a
// bubbling `a2ui-action` CustomEvent; the page decides what it means (agent
// chat sends it as the next turn).
import {
  MessageProcessor, Catalog, CommonSchemas, A2uiLitElement, basicCatalog,
  setMarkdownRenderer, html, css, nothing, z,
} from '/assets/vendor/a2ui-v1_0.js';
import { niceTicks, nearestPoint, pointNote, pointHref } from '/assets/chart-math.js';
import { surfaceIdOf, componentsOf, dataOf, surfaceDelta } from '/assets/surface-diff.js';
import { suaFunctions, suaAgentFunctions } from '/assets/sua-functions.js';
import { recomputeDiagram, layoutDiagram, diagramParamWords } from '/assets/diagram-math.js';
import { filterChoices, applyFilters, liveSelection, ADDED_CHOICES } from '/assets/option-filters.js';
import { collapseRepeats, matchEvent, whenRange } from '/assets/timeline-events.js';
import { groupBy, matchQuote, monogram, sourceName, textItems, agendaText, planText } from '/assets/briefing.js';

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

// A Row wraps instead of clipping what doesn't fit (answer buttons in a
// narrow panel, metrics on a phone). The basic Row's styles are in its
// shadow root, so they're extended here, before or after it's defined.
{
  const Row = basicCatalog.components.get('Row')?.element;
  const wrap = css`:host, a2ui-basic-row { flex-wrap: wrap; }`;
  if (Row?.elementStyles) Row.elementStyles.push(wrap);
  else if (Row) Row.styles = [].concat(Row.styles ?? [], wrap);
}

const Common = CommonSchemas.ComponentCommon.omit({ id: true });
const Str = CommonSchemas.DynamicString;
const tones = new Set(['neutral', 'ok', 'warn', 'err']);
const tone = (t) => (tones.has(t) ? t : 'neutral');
// http(s), or a same-origin dashboard path ("/x", not "//host").
const safeUrl = (u) => (typeof u === 'string' && /^(https?:\/\/|\/(?!\/))/i.test(u) ? u : undefined);
/** A link's text when nothing names one: a dashboard path's last part ("run ab12cd34" for a run), a web address without its scheme or www, kept short. */
const linkLabel = (u) => {
  if (u.startsWith('/')) {
    const parts = u.split(/[?#]/)[0].split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
    if (parts[0] === 'runs' && parts[1]) return `run ${parts[1].slice(0, 8)}`;
    return parts[parts.length - 1] || u;
  }
  const t = u.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  return t.length > 48 ? `${t.slice(0, 45)}…` : t;
};

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
  (p) => html`${p.label ? html`<div class="label">${p.label}</div>` : nothing}
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
    dt { color: var(--color-text-muted); } dd { margin: 0; overflow-wrap: anywhere; }
    dd a { color: var(--color-primary); text-decoration: none; } dd a:hover { text-decoration: underline; }
    .note { display: block; margin-top: 2px; font-size: var(--font-size-xs); line-height: 1.5; color: var(--color-text-muted); }`,
  (p) => {
    const items = Array.isArray(p.items) ? p.items : [];
    // An item may link its value (`url`) and carry a short line under it (`note`: a source, a quote).
    const value = (it) => { const t = typeof it?.value === 'object' ? JSON.stringify(it.value) : String(it?.value ?? ''); const u = safeUrl(it?.url); return u ? html`<a href=${u} target="_blank" rel="noopener noreferrer">${t} ↗</a>` : t; };
    return html`<dl>${items.map((it) => html`<dt>${it?.label ?? ''}</dt><dd>${value(it)}${it?.note ? html`<span class="note">${it.note}</span>` : nothing}</dd>`)}</dl>`;
  });

/** A table cell that's a date ("2026-11-09", or with a time): kept on one line, so it doesn't break at its dashes. */
const isDateCell = (row, col) => {
  const v = row?.[col?.key];
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(v.trim());
};

// A {label, url} link cell sorts and filters by its label.
const cellText = (v) => (v == null ? '' : typeof v === 'object' ? (typeof v.label === 'string' ? v.label : typeof v.text === 'string' ? v.text : JSON.stringify(v)) : String(v));
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
    columns: z.array(z.object({ key: z.string(), label: z.string(), format: z.enum(['text', 'link']).optional(), linkText: z.string().optional() }).strict()).min(1).max(12),
    maxRows: z.number().int().min(1).max(200).optional(),
    sortColumns: z.array(z.string()).max(12).optional(),
    defaultSort: z.string().max(80).optional(),
    filterColumns: z.array(z.string()).max(12).optional(),
    filterPlaceholder: z.string().max(80).optional(),
    pageSize: z.number().int().min(1).max(200).optional(),
    // Clicking a row sends this action with the row's fields as inputs (plain strings: the Table reads the row, not the renderer).
    rowAction: z.object({ name: z.string().min(1).max(64), agent: z.string().min(1).max(128).optional(), inputs: z.record(z.string(), z.string()).optional() }).strict().optional(),
  }).strict(),
  css`
    /* A block, so a table wider than its place (a narrow panel) scrolls sideways instead of being cut off. */
    :host { display: block; max-width: 100%; overflow-x: auto; }
    table { border-collapse: collapse; width: 100%; font-size: var(--font-size-sm); }
    tr.act { cursor: pointer; }
    tr.act:hover td, tr.act:focus-visible td { background: var(--color-surface-raised); }
    tr.act:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; }
    th { text-align: left; font-weight: 500; color: var(--color-text-muted); font-size: var(--font-size-xs); text-transform: uppercase; letter-spacing: .04em; }
    th button { all: unset; cursor: pointer; } th button:focus-visible { outline: 2px solid var(--color-primary); }
    th, td { padding: 6px 8px; border-bottom: 1px solid var(--color-border); vertical-align: top; overflow-wrap: break-word; }
    td.date { white-space: nowrap; }
    th { white-space: nowrap; }
    /* Link text is a name or a short address (≤48 characters), so it wraps like words. */
    td a { overflow-wrap: break-word; }
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
      if (col.format === 'link') {
        // A cell may be the address, or {label, url}; the column's linkText names a row field for the text.
        const obj = v && typeof v === 'object' ? v : undefined;
        const u = safeUrl(obj ? (obj.url ?? obj.href) : v);
        if (!u) return cellText(obj ? (obj.label ?? obj.text) : v);
        const named = col.linkText ? cellText(row?.[col.linkText]) : obj ? cellText(obj.label ?? obj.text) : '';
        return html`<a href="${u}" target="_blank" rel="noopener noreferrer" title="${u}">${named || linkLabel(u)}</a>`;
      }
      return cellText(v);
    };
    const header = (c) => {
      if (!sortable.has(c.key)) return html`<th>${c.label}</th>`;
      const active = this._sort?.col === c.key;
      const next = active && this._sort.dir === 'asc' ? 'desc' : 'asc';
      return html`<th aria-sort="${active ? (this._sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button @click=${() => set('_sort', { col: c.key, dir: next })}>${c.label}${active ? (this._sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>`;
    };
    // A row action: each input is read from the clicked row (a {label, url} cell sends its url). A click on a link in the row is the link's.
    const act = p.rowAction;
    const fire = (row, e) => {
      if (e.target?.closest?.('a')) return;
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      const context = act.agent ? { agent: act.agent } : {};
      for (const [input, field] of Object.entries(act.inputs ?? {})) {
        const v = row?.[field];
        const text = v && typeof v === 'object' ? String(v.url ?? v.href ?? v.label ?? v.text ?? '') : v == null ? '' : String(v);
        if (text !== '') context['in_' + input] = text;
      }
      this.dispatchEvent(new CustomEvent('a2ui-action', { bubbles: true, composed: true, detail: { name: act.name, context } }));
    };
    const tr = (r) => (act
      ? html`<tr class="act" tabindex="0" role="button" @click=${(e) => fire(r, e)} @keydown=${(e) => fire(r, e)}>${p.columns.map((c) => html`<td class=${isDateCell(r, c) ? 'date' : ''}>${cell(r, c)}</td>`)}</tr>`
      : html`<tr>${p.columns.map((c) => html`<td class=${isDateCell(r, c) ? 'date' : ''}>${cell(r, c)}</td>`)}</tr>`);
    return html`
      ${filterCols.length ? html`<div class="tools"><input type="search" aria-label="${p.filterPlaceholder ?? 'Filter'}" placeholder="${p.filterPlaceholder ?? 'Filter…'}" .value=${this._filter ?? ''} @input=${(e) => { this._page = 0; set('_filter', e.target.value); }}></div>` : nothing}
      <table><thead><tr>${p.columns.map(header)}</tr></thead>
        <tbody>${visible.map(tr)}</tbody></table>
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
/** Money: "$4,023"; a million and up "$18M", "$2.5B" (views/notebooks.ts formatMoney). */
function fmtMoney(n) {
  const a = Math.abs(n);
  const one = (x) => x.toLocaleString('en-US', { maximumFractionDigits: 1 });
  return a >= 1e9 ? `$${one(n / 1e9)}B` : a >= 1e6 ? `$${one(n / 1e6)}M` : `$${nfmt(n)}`;
}

function fmtField(f, v) {
  if (v == null || v === '') return '';
  if (typeof v === 'object' && typeof v.min === 'number' && typeof v.max === 'number') {
    if (v.min === v.max) return fmtField(f, v.min);
    const one = (n) => (f?.type === 'money' ? fmtMoney(n) : nfmt(n));
    return `${one(v.min)}–${one(v.max)}${f?.unit && f.type !== 'money' ? ` ${f.unit}` : ''}`;
  }
  if (typeof v === 'number') {
    if (f?.type === 'money') return fmtMoney(v);
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
    csvHref: z.string().max(300).regex(/^\/[^\s"'<>?#]*$/).optional(),
    onlyChosen: z.boolean().optional(),
    stageChips: z.boolean().optional(),
    filters: z.array(z.union([z.string().max(64), z.object({ key: z.string().max(64), label: z.string().max(60).optional() }).strict()])).max(8).optional(),
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
    .pic { position: relative; aspect-ratio: 4 / 3; overflow: hidden; background: color-mix(in srgb, var(--color-primary) 10%, var(--color-surface-raised)); display: grid; place-items: center; color: var(--color-text-subtle, var(--color-text-muted)); }
    /* The whole picture, scaled to fit the frame (never cropped); absolute so a tall one can't stretch the card. */
    .pic img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; display: block; }
    .pic { background: radial-gradient(120% 90% at 50% 75%, color-mix(in srgb, var(--color-primary) 22%, transparent), color-mix(in srgb, var(--color-primary) 4%, var(--color-surface-raised))); }
    .nophoto { display: flex; flex-direction: column; align-items: center; gap: 6px; color: color-mix(in srgb, var(--color-primary) 70%, var(--color-text-muted)); font-size: var(--font-size-xs); }
    .gone-why { color: var(--color-text-muted); }
    .pic img.drawn { object-fit: contain; padding: 8px; box-sizing: border-box; }
    .pic:has(img:not(.drawn)) { background: var(--color-surface); }
    /* A logo: an app icon sits at about half the frame; a wordmark fills its width. */
    .pic img.logo { background: #fff; padding: 22%; }
    .pic img.logo.wide { padding: 8% 10%; }
    .pickind { position: absolute; bottom: 8px; left: 8px; font: 600 10px/1 var(--font-mono); letter-spacing: .04em; padding: 3px 6px; border-radius: 4px; background: color-mix(in srgb, var(--color-surface) 85%, transparent); color: var(--color-text-muted); border: 1px solid var(--color-border); }
    .menu .btn.gone { border-color: var(--color-text-muted); }
    .rank { position: absolute; top: 8px; left: 8px; min-width: 24px; height: 24px; padding: 0 6px; box-sizing: border-box; border-radius: 999px; display: grid; place-items: center; font: 700 12px/1 var(--font-mono); background: var(--color-surface); color: var(--color-text); border: 1px solid var(--color-border-strong, var(--color-border)); }
    .best .rank { background: var(--color-primary); color: var(--color-bg); border-color: var(--color-primary); }
    .ribbon { position: absolute; top: 8px; right: 8px; font: 600 10px/1 var(--font-mono); letter-spacing: .06em; text-transform: uppercase; padding: 4px 6px; border-radius: 4px; background: var(--color-surface); color: var(--color-primary); border: 1px solid var(--color-primary); }
    .ribbon.chosen { background: var(--color-primary); color: var(--color-bg); }
    .card.chosen { border-color: var(--color-primary); }
    .chip.chosen { background: var(--color-primary); color: var(--color-bg); border-color: var(--color-primary); border-radius: 999px; font-weight: 600; }
    .body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 6px; flex: 1; }
    .title { font-weight: 600; font-size: var(--font-size-sm); line-height: 1.3; }
    .out .title { text-decoration: line-through; }
    .title a { color: inherit; text-decoration: none; }
    .title a:hover, .title a:focus-visible { color: var(--color-primary); text-decoration: underline; }
    .price { font: 700 1.35rem/1 var(--font-mono); color: var(--color-text); }
    .score { font-size: var(--font-size-sm); color: var(--color-text-muted); }
    .quote { margin: 0; padding-left: var(--space-2); border-left: 2px solid var(--color-border); font-size: var(--font-size-xs); line-height: 1.5; color: var(--color-text-muted); }
    .quote.checked { border-left-color: var(--color-primary); }
    .quote .qt { font-style: italic; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .quote a, .quote .qtag { display: block; white-space: nowrap; color: var(--color-primary); text-decoration: none; }
    .quote .qtag { color: var(--color-text-muted); }
    .ok { color: var(--color-primary); }
    .score b { font: 700 1.35rem/1 var(--font-mono); color: var(--color-primary); }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .chip { font: var(--font-size-xs)/1.6 var(--font-mono); padding: 0 6px; border-radius: 4px; background: var(--color-surface-raised); border: 1px solid var(--color-border); white-space: nowrap; }
    .chip.est { border-style: dashed; color: var(--color-text-muted); }
    a.chip.src { color: var(--color-primary); text-decoration: none; }
    a.chip.src:hover { border-color: var(--color-primary); }
    .chip.stage { background: var(--color-primary-soft); color: var(--color-primary); border-color: transparent; border-radius: 999px; }
    .chip.better { color: var(--color-ok); border-color: var(--color-ok); } .chip.worse { color: var(--color-warn); border-color: var(--color-warn); }
    .chip.gone { border-style: dashed; color: var(--color-text-muted); }
    .chip.new { color: var(--color-primary); border-color: var(--color-primary); }
    .why { font-size: var(--font-size-xs); color: var(--color-warn); }
    .acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: auto; padding-top: 4px; align-items: center; }
    .btn { all: unset; cursor: pointer; font-size: var(--font-size-xs); padding: 3px 8px; border-radius: 6px; border: 1px solid var(--color-border); color: var(--color-text); background: var(--color-surface); }
    .btn:hover, .btn:focus-visible { border-color: var(--color-primary); }
    .btn.ghost { border-color: transparent; color: var(--color-text-muted); }
    .btn.pick[aria-pressed="true"] { background: var(--color-primary); color: var(--color-bg); border-color: var(--color-primary); font-weight: 600; }
    a.btn { color: var(--color-primary); }
    .menu { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px; margin-top: 4px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-surface-raised); }
    .menu input { flex: 1 1 140px; min-width: 0; font: inherit; font-size: var(--font-size-xs); padding: 3px 6px; border: 1px solid var(--color-border); border-radius: 4px; background: var(--color-surface); color: var(--color-text); }
    table { width: 100%; border-collapse: collapse; font-size: var(--font-size-sm); }
    th { text-align: left; font-weight: 500; font-size: var(--font-size-xs); color: var(--color-text-muted); text-transform: uppercase; letter-spacing: .04em; }
    th, td { padding: 6px 8px; border-bottom: 1px solid var(--color-border); vertical-align: middle; }
    td.num { font-family: var(--font-mono); white-space: nowrap; }
    tr.out td { opacity: .55; } tr.best td { background: color-mix(in srgb, var(--color-primary) 8%, transparent); }
    .thumb { width: 56px; height: 42px; object-fit: contain; border-radius: 4px; display: block; background: var(--color-surface-raised); }
    .empty { color: var(--color-text-muted); font-size: var(--font-size-sm); }
    .filters { display: flex; flex-direction: column; gap: 6px; margin: -2px 0 12px; }
    .frow { display: flex; align-items: flex-start; gap: 8px; }
    .flabel { flex: none; width: 84px; padding-top: 3px; font-size: var(--font-size-xs); color: var(--color-text-muted); overflow-wrap: anywhere; }
    .fchips { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
    .fchip.none { color: var(--color-text-subtle, var(--color-text-muted)); border-style: dashed; }
    .fchip { all: unset; cursor: pointer; font-size: var(--font-size-xs); padding: 2px 9px; border-radius: 999px; border: 1px solid var(--color-border); color: var(--color-text); background: var(--color-surface); }
    .csvlink { font-size: var(--font-size-xs); color: var(--color-primary); text-decoration: none; white-space: nowrap; }
    .csvlink:hover, .csvlink:focus-visible { text-decoration: underline; }
    .fchip .n { margin-left: 4px; font-family: var(--font-mono); color: var(--color-text-muted); }
    .fchip[aria-pressed="true"] { background: var(--color-primary-soft); border-color: var(--color-primary); color: var(--color-primary); font-weight: 600; }
    .fchip[aria-pressed="true"] .n { color: var(--color-primary); }
    .fchip:focus-visible, .fclear:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; }
    .fclear { all: unset; cursor: pointer; align-self: flex-start; font-size: var(--font-size-xs); color: var(--color-primary); }`,
  function (p) {
    const fields = Array.isArray(p.fields) ? p.fields : [];
    // stageChips: false hides stages entirely (chips, column, filter, Move): steps say how far each got.
    const showStages = p.stageChips !== false;
    const stages = showStages && Array.isArray(p.stages) ? p.stages.map(String) : [];
    const byRole = (r) => fields.find((f) => f.role === r);
    const priceF = byRole('price'); const measureF = byRole('measure'); const scoreF = byRole('score');
    const priceBetter = priceF?.better ?? 'lower';
    // Ruled out (and gone) options are hidden unless you ask to see them; your choice is kept in this browser.
    const all = (Array.isArray(p.options) ? p.options : []).filter(Boolean);
    const outCount = all.filter((o) => o.ruledOut).length;
    let showOut; try { showOut = localStorage.getItem('sua-option-show-out') === '1'; } catch { showOut = false; }
    if (this._showOut !== undefined) showOut = this._showOut;
    if (p.ruledOut === 'show') showOut = true;
    let opts = all.filter((o) => showOut || !o.ruledOut);
    // After a decision, the shortlist is the final set (chosen first, and only
    // them until you untick it; kept per page in this browser).
    const chosenCount = all.filter((o) => o.chosen && !o.ruledOut).length;
    const chosenKey = `sua-option-only-chosen:${location.pathname}`;
    let onlyChosen; try { const kept = localStorage.getItem(chosenKey); onlyChosen = kept === null ? !!p.onlyChosen : kept === '1'; } catch { onlyChosen = !!p.onlyChosen; }
    if (this._onlyChosen !== undefined) onlyChosen = this._onlyChosen;
    onlyChosen = onlyChosen && chosenCount > 0;
    if (onlyChosen) opts = opts.filter((o) => o.chosen && !o.ruledOut);
    // Sort: in the running first, then by the chosen field (price by default, the better way first).
    const [skey, sdir] = String(p.sort ?? 'price').trim().split(/\s+/);
    const sval = (o) => (skey === 'price' || skey === 'measure' ? o[skey] : getPath(o.fields ?? {}, skey));
    const dir = sdir === 'desc' || (sdir === undefined && skey === 'price' && priceBetter === 'higher') ? -1 : 1;
    opts = opts.map((o, i) => [o, i]).sort((a, b) => (Number(!!a[0].ruledOut) - Number(!!b[0].ruledOut))
      || (Number(!!b[0].chosen) - Number(!!a[0].chosen))
      || (sval(a[0]) == null) - (sval(b[0]) == null) || compare(sval(a[0]) ?? '', sval(b[0]) ?? '') * dir || a[1] - b[1]).map((x) => x[0]);
    if (!all.length) return html`<p class="empty">No options yet.</p>`;
    // Filters (by stage, still listed, or any fact): chips for values the options
    // have. Ranks and the best stay those of the whole list; the choice is kept per page.
    const fmtKey = (key, v) => { const f = fields.find((x) => x.key === key); return f ? fmtField(f, v) : String(v); };
    const labelOf = (key) => fields.find((x) => x.key === key)?.label ?? key;
    const filterKey = `sua-option-filters:${location.pathname}`;
    if (this._sel === undefined) {
      try { this._sel = JSON.parse(localStorage.getItem(filterKey) ?? '{}') || {}; } catch { this._sel = {}; }
      // A link to "the new ones" (?added=new, from the header) starts with only those.
      const asked = new URLSearchParams(location.search).get('added');
      if (ADDED_CHOICES[asked]) {
        // Kept like a filter you picked, and the address tidied, so a refresh or Clear filters behaves as usual.
        this._sel = { added: ADDED_CHOICES[asked] };
        try { localStorage.setItem(filterKey, JSON.stringify(this._sel)); } catch { /* not kept */ }
        try { const u = new URL(location.href); u.searchParams.delete('added'); history.replaceState(history.state, '', u); } catch { /* left as is */ }
        setTimeout(() => this.scrollIntoView?.({ block: 'start', behavior: 'smooth' }), 300);
      }
    }
    const sel = liveSelection(this._sel, filterChoices(opts, p.filters, { fmt: fmtKey, label: labelOf, stages }));
    const choices = filterChoices(opts, p.filters, { fmt: fmtKey, label: labelOf, stages, selected: sel });
    const keepSel = (next) => { this._sel = next; try { localStorage.setItem(filterKey, JSON.stringify(next)); } catch { /* not kept */ } this.requestUpdate(); };
    const pick = (key, v) => { const next = { ...sel }; if (next[key] === v) delete next[key]; else next[key] = v; keepSel(next); };
    const ranked = opts;
    opts = applyFilters(ranked, sel, fmtKey);
    if (p.maxItems) opts = opts.slice(0, p.maxItems);
    // Grid or Table: your last choice, kept in this browser.
    let saved; try { saved = localStorage.getItem('sua-option-layout') ?? undefined; } catch { saved = undefined; }
    const layout = this._layout ?? (saved === 'grid' || saved === 'table' ? saved : undefined) ?? p.layout ?? 'grid';
    const set = (k, v) => { this[k] = v; if (k === '_layout') { try { localStorage.setItem('sua-option-layout', v); } catch { /* not kept */ } } this.requestUpdate(); };
    const act = (detail) => this.dispatchEvent(new CustomEvent('a2ui-action', { bubbles: true, composed: true, detail: { name: 'notebook-option', context: detail } }));
    // Its name opens its own page, when it has one.
    const named = (o) => { const href = pointHref(o.page); return href ? html`<a href=${href}>${o.name ?? o.title}</a>` : (o.name ?? o.title); };
    const next = (o) => { const i = stages.indexOf(o.stage); return i >= 0 ? stages[i + 1] : undefined; };
    const facts = (o) => fields.filter((f) => f.role !== 'price' && f.role !== 'score' && f.role !== 'link' && f.role !== 'image' && f.type !== 'url' && f.type !== 'image')
      .map((f) => ({ key: f.key, label: f.label, text: fmtField(f, o.fields?.[f.key]) })).filter((x) => x.text).slice(0, 5);
    // A fact sua wasn't sure of reads "≈ …"; one with a source links to it.
    const fact = (o, key, text, label) => {
      const m = o.factMeta?.[key] ?? {};
      const shown = m.estimate ? `≈ ${text}` : text;
      const why = [label, m.estimate ? 'an estimate' : '', m.source ? `source: ${m.source}` : ''].filter(Boolean).join(' · ');
      // A fact whose value is a web address links to it, shown as its site ("target.com ↗").
      const own = /^https?:\/\/\S+$/i.test(String(text).trim()) ? safeUrl(String(text).trim()) : undefined;
      if (own) return html`<a class="chip src" href=${own} target="_blank" rel="noopener noreferrer" title="${label}: ${own}">${own.replace(/^https?:\/\/(www\.)?/i, '').split(/[/?#]/)[0]} ↗</a>`;
      return safeUrl(m.source)
        ? html`<a class="chip src${m.estimate ? ' est' : ''}" href=${safeUrl(m.source)} target="_blank" rel="noopener noreferrer" title=${why}>${shown} ↗</a>`
        : html`<span class="chip${m.estimate ? ' est' : ''}" title=${why}>${shown}</span>`;
    };
    const est = (o, f) => (f && o.factMeta?.[f.key]?.estimate ? '≈ ' : '');
    // The words in the source that back a fact (the fit first), and whether code found them there.
    const quoteOf = (o) => {
      const key = [scoreF?.key, ...fields.map((f) => f.key)].find((k) => k && o.factMeta?.[k]?.quote);
      const m = key ? o.factMeta[key] : undefined;
      if (!m) return nothing;
      const href = safeUrl(m.source);
      const tag = m.checked ? '✓ checked in the source' : 'from the source';
      return html`<blockquote class="quote${m.checked ? ' checked' : ''}"><span class="qt" title=${m.quote}>“${m.quote}”</span>${href
        ? html`<a href=${href} target="_blank" rel="noopener noreferrer">${tag} ↗</a>`
        : html`<span class="qtag">${tag}</span>`}</blockquote>`;
    };
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
      ${safeUrl(o.link) ? (o.linkIsList
        ? html`<a class="btn ghost" href=${safeUrl(o.link)} target="_blank" rel="noopener noreferrer" title="Where it was found: a search page that lists many, not this one's own">Search page ↗</a>`
        : html`<a class="btn" href=${safeUrl(o.link)} target="_blank" rel="noopener noreferrer">${byRole('link')?.label ?? 'Listing'} ↗</a>`) : nothing}
      ${p.actions && !o.ruledOut ? html`<button type="button" class="btn pick" aria-pressed=${o.chosen ? 'true' : 'false'} title=${o.chosen ? 'Picked. Click to take the pick back.' : 'Pick this one (bought it, or going with it). The notebook stays open.'} @click=${() => act({ op: o.chosen ? 'unchoose' : 'choose', id: o.id })}>${o.chosen ? '✓ Picked' : 'Pick'}</button>` : nothing}
      ${p.actions && !o.ruledOut && next(o) ? html`<button type="button" class="btn" @click=${() => act({ op: 'move', id: o.id, stage: next(o) })}>${next(o)} →</button>` : nothing}
      ${p.actions && !o.ruledOut ? html`<button type="button" class="btn ghost" aria-expanded=${this._menu === o.id ? 'true' : 'false'} @click=${() => set('_menu', this._menu === o.id ? '' : o.id)}>Rule out…</button>` : nothing}
      ${p.actions && o.ruledOut ? html`<button type="button" class="btn ghost" @click=${() => act({ op: 'reinstate', id: o.id })}>Bring back</button>` : nothing}
    </div>${ruleMenu(o)}`;
    const active = ranked.filter((o) => !o.ruledOut);
    const best = active[0];
    const filtered = Object.keys(sel).length > 0;
    const shownActive = opts.filter((o) => !o.ruledOut).length;
    const toggleChosen = () => { const v = !onlyChosen; this._onlyChosen = v; try { localStorage.setItem(chosenKey, v ? '1' : '0'); } catch { /* not kept */ } this.requestUpdate(); };
    const toggleOut = () => { const v = !showOut; this._showOut = v; try { localStorage.setItem('sua-option-show-out', v ? '1' : '0'); } catch { /* not kept */ } this.requestUpdate(); };
    const filterBar = choices.length ? html`<div class="filters" role="group" aria-label="Filter options">
      ${choices.map((f) => html`<div class="frow"><span class="flabel">${f.label}</span><span class="fchips">
        ${f.choices.map((c) => html`<button type="button" class="fchip ${c.count ? '' : 'none'}" aria-pressed=${sel[f.key] === c.value ? 'true' : 'false'} @click=${() => pick(f.key, c.value)}>${c.value}<span class="n">${c.count}</span></button>`)}</span></div>`)}
      ${filtered ? html`<button type="button" class="fclear" @click=${() => keepSel({})}>Clear filters</button>` : nothing}</div>` : nothing;
    const toggle = html`<div class="bar"><span>${onlyChosen ? `${filtered ? `${shownActive} of ` : ''}${chosenCount} chosen, of ${all.filter((o) => !o.ruledOut).length} in the running` : `${filtered ? `${shownActive} of ${active.length}` : active.length} in the running`}</span>
      ${chosenCount ? html`<label class="showout"><input type="checkbox" .checked=${onlyChosen} @change=${toggleChosen}> Only chosen (${chosenCount})</label>` : nothing}
      ${outCount ? html`<label class="showout"><input type="checkbox" .checked=${showOut} @change=${toggleOut}> Show ruled out (${outCount})</label>` : nothing}
      ${p.csvHref && opts.length ? html`<a class="csvlink" href=${`${p.csvHref}?rows=all&ids=${opts.map((o) => encodeURIComponent(o.id)).join(',')}`} download title="Exactly the options shown here, as a spreadsheet">CSV of these ${opts.length}</a>` : nothing}
      <span class="sp"></span>
      <div class="seg" role="group" aria-label="Layout">
        <button type="button" aria-pressed=${layout === 'grid' ? 'true' : 'false'} @click=${() => set('_layout', 'grid')}>Grid</button>
        <button type="button" aria-pressed=${layout === 'table' ? 'true' : 'false'} @click=${() => set('_layout', 'table')}>Table</button>
      </div></div>${filterBar}`;
    if (!opts.length) return html`${toggle}<p class="empty">No options match these filters. <button type="button" class="fclear" @click=${() => keepSel({})}>Clear filters</button></p>`;
    if (layout === 'table') {
      return html`${toggle}<table><thead><tr><th>#</th><th></th><th>Option</th>${scoreF ? html`<th>${scoreF.label}</th>` : nothing}<th>${priceF?.label ?? 'Price'}</th><th>${measureF?.label ?? ''}</th><th>${showStages ? 'Stage' : ''}</th><th></th></tr></thead><tbody>
        ${opts.map((o) => html`<tr class="${o.ruledOut ? 'out' : o === best ? 'best' : ''}">
          <td class="num">${o.ruledOut ? '·' : active.indexOf(o) + 1}</td>
          <td>${safeUrl(o.image) ? html`<img class="thumb" src=${safeUrl(o.image)} alt="" loading="lazy">` : nothing}</td>
          <td><div class="title">${named(o)}</div>${o.ruledOut ? html`<div class="why">${o.ruledOut.gone ? 'No longer available' : `Ruled out: ${o.ruledOut.reason}`}</div>` : nothing}</td>
          ${scoreF ? html`<td class="num" title=${o.factMeta?.[scoreF.key]?.quote ? `“${o.factMeta[scoreF.key].quote}”` : ''}>${est(o, scoreF)}${fmtField(scoreF, o.fields?.[scoreF.key])}${o.factMeta?.[scoreF.key]?.checked ? html` <span class="ok" aria-label="quote checked in the source">✓</span>` : nothing}</td>` : nothing}
          <td class="num">${priceF && o.fields?.[priceF.key] != null ? html`${est(o, priceF)}${fmtField(priceF, o.fields[priceF.key])}` : ''} ${change(o)}</td>
          <td class="num">${measureF && o.fields?.[measureF.key] != null ? html`${est(o, measureF)}${fmtField(measureF, o.fields[measureF.key])}` : ''}</td>
          <td>${o.chosen && !o.ruledOut ? html`<span class="chip chosen">✓ chosen</span> ` : nothing}${o.stage && showStages ? html`<span class="chip stage">${o.stage}</span>` : nothing}</td>
          <td>${actions(o)}</td></tr>`)}</tbody></table>`;
    }
    return html`${toggle}<div class="grid">${opts.map((o) => html`<article class="card ${o.ruledOut ? 'out' : ''} ${o === best ? 'best' : ''} ${o.chosen && !o.ruledOut ? 'chosen' : ''}">
      <div class="pic">
        ${safeUrl(o.image) ? html`<img src=${safeUrl(o.image)} alt="" loading="lazy" class="${o.imageKind === 'illustration' ? 'drawn' : o.imageKind === 'logo' ? (o.imageShape === 'wide' ? 'drawn logo wide' : 'drawn logo') : ''}">${o.imageKind && o.imageKind !== 'listing' && o.imageKind !== 'logo' ? html`<span class="pickind" title="${o.imageKind === 'illustration' ? 'A drawing, not this exact one' : 'A representative photo, not this exact one'}">${o.imageKind === 'illustration' ? 'illustration' : 'example photo'}</span>` : nothing}`
          : html`<div class="nophoto"><svg aria-hidden="true" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="9" cy="10" r="2"></circle><path d="M21 16l-5-5-8 8"></path></svg><span>No photo yet</span></div>`}
        <span class="rank">${o.ruledOut ? '·' : active.indexOf(o) + 1}</span>
        ${o.chosen && !o.ruledOut ? html`<span class="ribbon chosen" title="Picked${o === best ? `; also the ${scoreF ? 'best fit' : 'best price'}` : ''}">✓ chosen</span>`
          : o === best ? html`<span class="ribbon">${scoreF ? 'best fit' : `best ${priceBetter === 'higher' ? 'pay' : 'price'}`}</span>` : nothing}
      </div>
      <div class="body">
        <div class="title" title=${o.title}>${named(o)}</div>
        ${scoreF && o.fields?.[scoreF.key] != null ? html`<div class="score" title="${scoreF.label}"><b>${est(o, scoreF)}${fmtField(scoreF, o.fields[scoreF.key])}</b> ${scoreF.label.toLowerCase()}</div>` : nothing}
        ${quoteOf(o)}
        ${priceF && o.fields?.[priceF.key] != null ? html`<div class="price">${est(o, priceF)}${fmtField(priceF, o.fields[priceF.key])}</div>` : nothing}
        <div class="chips">${o.added === 'new' && !o.ruledOut ? html`<span class="chip new" title="First found by the last run">new</span>` : nothing}${facts(o).map((f) => fact(o, f.key, f.text, f.label))}${change(o)}
          ${o.notSeenLately && !o.ruledOut ? html`<span class="chip gone" title="Recent searches found others but not this one">not seen lately</span><button type="button" class="btn ghost" @click=${() => act({ op: 'gone', id: o.id })}>Mark gone</button>` : nothing}</div>
        ${o.stage && !o.ruledOut && showStages ? html`<div class="chips"><span class="chip stage">${o.stage}</span></div>` : nothing}
        ${o.ruledOut ? (o.ruledOut.gone ? html`<div class="why gone-why">No longer available</div>` : html`<div class="why">Ruled out${o.ruledOut.stage && showStages ? ` at ${o.ruledOut.stage}` : ''}: ${o.ruledOut.reason}</div>`) : nothing}
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
    points: CommonSchemas.DynamicValue, x: z.string(), y: z.string(), label: z.string().optional(), href: z.string().max(64).optional(),
    xLabel: Str.optional(), yLabel: Str.optional(), xFormat: z.enum(['number', 'money']).optional(), yFormat: z.enum(['number', 'money']).optional(),
    xBand: CommonSchemas.DynamicValue.optional(), yBand: CommonSchemas.DynamicValue.optional(),
    xBetter: z.enum(['higher', 'lower']).optional(), yBetter: z.enum(['higher', 'lower']).optional(),
  }).strict(),
  css`
    .plot { position: relative; }
    .chart { outline: none; border-radius: var(--radius-sm, 6px); }
    .chart:focus-visible { box-shadow: 0 0 0 2px var(--color-primary); }
    .chart svg { display: block; width: 100%; height: auto; max-height: 320px; }
    .axis { fill: var(--color-text-muted); font: 10px var(--font-mono); }
    .gridline { stroke: var(--color-border); }
    .band { fill: var(--color-primary); fill-opacity: .08; stroke: var(--color-primary); stroke-opacity: .45; stroke-dasharray: 4 3; }
    .dot { fill: var(--color-text-muted); fill-opacity: .7; stroke: var(--color-surface); stroke-width: 1.5; transition: r 80ms ease-out; }
    .dot.best { fill: var(--color-primary); fill-opacity: 1; }
    .dot.out { fill: none; stroke: var(--color-text-muted); stroke-dasharray: 2 2; }
    .dot.hot { fill-opacity: 1; stroke: var(--color-text); stroke-width: 2; }
    .dot.best.hot { stroke: var(--color-primary); }
    .halo { fill: var(--color-primary); fill-opacity: .18; }
    .lbl { fill: var(--color-text); font: 600 11px var(--font-sans, system-ui); paint-order: stroke; stroke: var(--color-surface); stroke-width: 3px; }
    .lbl.dim { opacity: 0; }
    .tip { position: absolute; z-index: 1; pointer-events: none; max-width: 300px; padding: var(--space-2, 8px) var(--space-3, 12px);
      background: var(--color-surface); border: 1px solid var(--color-border-strong, var(--color-border)); border-radius: var(--radius-sm, 6px);
      transition: opacity 80ms ease-out; }
    .tip[hidden] { display: block; opacity: 0; visibility: hidden; }
    .tip .name { font-weight: 600; font-size: var(--font-size-sm); color: var(--color-text); overflow-wrap: anywhere; }
    .tip .values { font: var(--font-size-xs) var(--font-mono); color: var(--color-text); margin-top: 2px; white-space: nowrap; }
    .tip .status { font-size: var(--font-size-xs); color: var(--color-text-muted); margin-top: 2px; }
    .tip .open { display: inline-block; margin-top: 4px; font-size: var(--font-size-xs); font-weight: 600; color: var(--color-primary); text-decoration: none; }
    .tip.tapped { pointer-events: auto; }
    .chart.linked.over { cursor: pointer; }
    .legend { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3, 12px); font-size: var(--font-size-xs); color: var(--color-text-muted); margin-top: var(--space-1, 4px); }
    .legend span { display: inline-flex; align-items: center; gap: var(--space-1, 4px); }
    .legend svg { display: block; }
    .legend .hint { margin-left: auto; }
    .legend .hint.touch { display: none; }
    @media (hover: none) { .legend .hint.mouse { display: none; } .legend .hint.touch { display: inline-flex; } }
    .empty { color: var(--color-text-muted); font-size: var(--font-size-sm); }`,
  function (p) {
    const n = (Array.isArray(p.points) ? p.points : []).filter((o) => Number.isFinite(Number(getPath(o, p.x))) && Number.isFinite(Number(getPath(o, p.y)))).length;
    if (n === 0) return html`<p class="empty">Nothing to plot yet: options need ${p.xLabel ?? p.x} and ${p.yLabel ?? p.y}.</p>`;
    const banded = (b) => b && typeof b.min === 'number';
    const anyOut = (Array.isArray(p.points) ? p.points : []).some((o) => o?.ruledOut);
    // `href` names each point's link (a path on this dashboard): a click opens it.
    const linked = !!p.href && (Array.isArray(p.points) ? p.points : []).some((o) => pointHref(getPath(o, p.href)));
    // Whole <svg> per template: a nested template would make <circle> an HTML element.
    const swatch = (cls) => (cls === 'band'
      ? html`<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect class="band" x="1" y="2" width="10" height="8"></rect></svg>`
      : html`<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><circle class="dot ${cls}" cx="6" cy="6" r="4.5"></circle></svg>`);
    return html`<div class="plot">
        <div class="chart ${linked ? 'linked' : ''}" tabindex="0" role="group" aria-label="${p.yLabel ?? p.y} by ${p.xLabel ?? p.x} for ${n} options. Use the arrow keys to read each one${linked ? ', and Enter to open it' : ''}."></div>
        <div class="tip" hidden aria-live="polite"><div class="name"></div><div class="values"></div><div class="status"></div><a class="open" hidden>Open →</a></div>
      </div>
      <div class="legend">
        <span>${swatch('best')} ${bestWord(p)}</span>
        <span>${swatch('')} in the running</span>
        ${anyOut ? html`<span>${swatch('out')} ruled out</span>` : nothing}
        ${banded(p.xBand) || banded(p.yBand) ? html`<span>${swatch('band')} your limits</span>` : nothing}
        ${linked
          ? html`<span class="hint mouse">hover for details, click to open</span><span class="hint touch">tap a dot, then Open →</span>`
          : html`<span class="hint">hover or tap a dot for details</span>`}
      </div>`;
  },
  {
    updated() {
      const box = this.renderRoot.querySelector('.chart');
      const p = this.controller?.props;
      if (!box || !p) return;
      const band = (b) => (b && typeof b.min === 'number' && typeof b.max === 'number' ? b : undefined);
      const xb = band(p.xBand); const yb = band(p.yBand);
      const xMoney = p.xFormat === 'money'; const yMoney = p.yFormat === 'money';
      const pts = (Array.isArray(p.points) ? p.points : []).map((o) => ({ o, x: Number(getPath(o, p.x)), y: Number(getPath(o, p.y)) }))
        .filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y));
      const W = 520, H = 260, L = 48, R = 14, T = 26, B = 30;
      const xs = [...pts.map((d) => d.x), ...(xb ? [xb.min, xb.max] : [])];
      const ys = [...pts.map((d) => d.y), ...(yb ? [yb.min, yb.max] : [])];
      const pad = (lo, hi) => { const s = hi - lo || Math.abs(hi) || 1; return [lo - s * 0.08, hi + s * 0.08]; };
      const [x0, x1] = pad(Math.min(...xs), Math.max(...xs)); const [y0, y1] = pad(Math.min(...ys), Math.max(...ys));
      const sx = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
      const sy = (v) => H - B - ((v - y0) / (y1 - y0)) * (H - T - B);
      const inside = (d) => (!xb || (d.x >= xb.min && d.x <= xb.max)) && (!yb || (d.y >= yb.min && d.y <= yb.max));
      const ybetter = p.yBetter ?? 'lower';
      const best = pts.filter((d) => !d.o?.ruledOut).sort((a, b) => (Number(inside(b)) - Number(inside(a))) || (ybetter === 'lower' ? a.y - b.y : b.y - a.y))[0];
      const nameOf = (d) => String(p.label ? getPath(d.o, p.label) ?? '' : '') || String(d.o?.title ?? '').split(',')[0];
      const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });
      for (const v of niceTicks(y0, y1)) {
        svg.append(svgEl('line', { class: 'gridline', x1: L, x2: W - R, y1: sy(v), y2: sy(v) }));
        svg.append(svgEl('text', { class: 'axis', x: L - 6, y: sy(v) + 3, 'text-anchor': 'end' }, short(v, yMoney)));
      }
      for (const v of niceTicks(x0, x1)) svg.append(svgEl('text', { class: 'axis', x: sx(v), y: H - B + 14, 'text-anchor': 'middle' }, short(v, xMoney)));
      if (xb || yb) {
        const bx0 = sx(xb ? xb.min : x0); const bx1 = sx(xb ? xb.max : x1); const by0 = sy(yb ? yb.max : y1); const by1 = sy(yb ? yb.min : y0);
        svg.append(svgEl('rect', { class: 'band', x: bx0, y: by0, width: bx1 - bx0, height: by1 - by0 }));
      }
      svg.append(svgEl('text', { class: 'axis', x: W - R, y: H - 4, 'text-anchor': 'end' }, `${p.xLabel ?? p.x} →`));
      svg.append(svgEl('text', { class: 'axis', x: 4, y: 12 }, `${p.yLabel ?? p.y}`));
      if (best) svg.append(svgEl('circle', { class: 'halo', cx: sx(best.x), cy: sy(best.y), r: 16 }));
      // Ruled-out rings first, so a live option is never drawn under one.
      const drawn = [...pts].sort((a, b) => Number(!!b.o?.ruledOut) - Number(!!a.o?.ruledOut));
      for (const d of drawn) {
        d.r = d === best ? 8 : 6; d.px = sx(d.x); d.py = sy(d.y);
        d.el = svgEl('circle', { class: `dot ${d.o?.ruledOut ? 'out' : d === best ? 'best' : ''}`, cx: d.px, cy: d.py, r: d.r });
        svg.append(d.el);
      }
      let label;
      if (best) {
        const name = nameOf(best).slice(0, 30);
        const right = sx(best.x) > W / 2;
        label = svgEl('text', { class: 'lbl', x: right ? sx(best.x) - 14 : sx(best.x) + 14, y: sy(best.y) - 12, 'text-anchor': right ? 'end' : 'start' }, name);
        svg.append(label);
      }
      box.replaceChildren(svg);

      // Hover / keyboard annotation: the point nearest the pointer, within reach.
      const tip = this.renderRoot.querySelector('.tip');
      const order = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
      const hrefOf = (d) => (d && p.href ? pointHref(getPath(d.o, p.href)) : undefined);
      const show = (d, tapped = false) => {
        for (const q of pts) { q.el.classList.toggle('hot', q === d); q.el.setAttribute('r', String(q === d ? q.r + 2 : q.r)); }
        // The note names the point, so the static label steps back while it shows.
        label?.classList.toggle('dim', !!d);
        this.__hot = d;
        if (!d || !tip) { if (tip) tip.hidden = true; return; }
        const note = pointNote({
          name: nameOf(d), x: d.x, y: d.y, xLabel: p.xLabel ?? p.x, yLabel: p.yLabel ?? p.y, xMoney, yMoney,
          best: d === best, bestWord: bestWord(p), ruledOut: d.o?.ruledOut, stage: d.o?.stage,
          inLimits: xb || yb ? inside(d) : undefined,
        });
        tip.querySelector('.name').textContent = note.name;
        tip.querySelector('.values').textContent = note.values;
        tip.querySelector('.status').textContent = note.status;
        tip.querySelector('.status').hidden = !note.status;
        // Its link: on a touch screen the first tap shows the note, and Open → goes there.
        const open = tip.querySelector('.open'); const href = hrefOf(d);
        open.hidden = !href;
        if (href) open.setAttribute('href', href); else open.removeAttribute('href');
        tip.classList.toggle('tapped', tapped && !!href);
        tip.hidden = false;
        // Place it above the dot (below when there's no room), inside the chart.
        const m = svg.getScreenCTM(); const r = box.getBoundingClientRect();
        if (!m) return;
        const cx = m.a * d.px + m.e - r.left; const cy = m.d * d.py + m.f - r.top;
        // Measure at the left edge, where it isn't squeezed by its last position.
        tip.style.left = '0px'; tip.style.top = '0px';
        const tw = tip.offsetWidth; const th = tip.offsetHeight;
        const left = Math.max(0, Math.min(box.clientWidth - tw, cx - tw / 2));
        const top = cy - th - 12 >= 0 ? cy - th - 12 : cy + 14;
        tip.style.left = `${left}px`; tip.style.top = `${top}px`;
      };
      this.__show = show;
      if (!box.__wired) {
        box.__wired = true;
        const at = (e) => {
          const st = this.__scatter; const m = st?.svg.getScreenCTM(); if (!m) return;
          // Screen → chart units (the svg can be letterboxed when the panel is wide).
          const d = nearestPoint(st.pts, (e.clientX - m.e) / m.a, (e.clientY - m.f) / m.d, 18 / m.a);
          box.classList.toggle('over', !!st.hrefOf(d));
          return d;
        };
        box.addEventListener('pointermove', (e) => this.__show(at(e)));
        // A tap on a touch screen sends no hover moves: it shows the note (with Open →).
        box.addEventListener('pointerdown', (e) => { this.__pointer = e.pointerType; this.__show(at(e), e.pointerType !== 'mouse'); });
        // A mouse click on a linked dot opens it (Cmd/Ctrl-click in a new tab).
        box.addEventListener('click', (e) => {
          if (this.__pointer && this.__pointer !== 'mouse') return;
          const href = this.__scatter?.hrefOf(at(e));
          if (!href) return;
          if (e.metaKey || e.ctrlKey) window.open(href, '_blank', 'noopener'); else window.location.assign(href);
        });
        box.addEventListener('pointerleave', () => { if (this.renderRoot.activeElement !== box) this.__show(undefined); });
        // Focus going to the note's Open → (a tap on it) keeps the note up.
        box.addEventListener('blur', (e) => { if (!this.renderRoot.querySelector('.tip')?.contains(e.relatedTarget)) this.__show(undefined); });
        box.addEventListener('keydown', (e) => {
          const st = this.__scatter; if (!st) return;
          if (e.key === 'Escape') { this.__show(undefined); return; }
          if (e.key === 'Enter') { const href = st.hrefOf(this.__hot); if (href) { e.preventDefault(); window.location.assign(href); } return; }
          const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
          if (!step) return;
          e.preventDefault();
          const i = st.order.indexOf(this.__hot);
          this.__show(st.order[i < 0 ? (step > 0 ? 0 : st.order.length - 1) : (i + step + st.order.length) % st.order.length]);
        });
      }
      this.__scatter = { pts, order, svg, hrefOf };
      if (this.__hot) show(pts.find((q) => q.o === this.__hot.o));
    },
  });

/** What the highlighted point is called in the legend and its note: "best price", "best pay". */
function bestWord(p) {
  const y = String(p.yLabel ?? p.y).toLowerCase();
  return `best ${y}`;
}

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
    /* One column on a phone; minmax(0, …) so a wide table inside scrolls in its part instead of widening the page. */
    @media (max-width: 760px) { .cols { grid-template-columns: minmax(0, 1fr) !important; } }`,
  function (p) {
    const kids = Array.isArray(p.children) ? p.children : [];
    const w = kids.map((_, i) => Number(p.widths?.[i] ?? 1));
    return html`<div class="cols ${p.align === 'start' ? 'start' : ''}" style="grid-template-columns: ${w.map((n) => `minmax(0, ${n}fr)`).join(' ')}">${kids.map((c) => this.renderNode(c))}</div>`;
  });

// A part of a page, in one of a few treatments (DESIGN.md "Notebook pages"):
// plain is a frame; lede, feature and aside are unframed and set apart by
// type and rules; band is a full-width tinted strip.
const Panel = define('Panel', 'sua-a2ui-panel',
  Common.extend({ title: Str, note: Str.optional(), child: CommonSchemas.ComponentId, treatment: z.enum(['plain', 'lede', 'feature', 'aside', 'band']).optional(), hero: z.boolean().optional(), pending: z.boolean().optional() }).strict(),
  css`
    :host { display: block; min-width: 0; height: 100%; }
    /* hero: the one part a composed page leads with; its title in display type. */

    .frame { box-sizing: border-box; height: 100%; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg, 14px); padding: var(--space-4, 16px); }
    .head { display: flex; align-items: baseline; gap: 8px; margin-bottom: var(--space-3, 12px); }
    h3 { margin: 0; font: 700 15px/1.2 var(--font-mono); color: var(--color-text); }
    .note { margin-left: auto; font-size: var(--font-size-xs); color: var(--color-text-muted); text-align: right; }
    .lede, .feature, .aside { background: none; border: 0; border-radius: 0; padding: 0; }
    .lede h3 { font: 600 11px/1 var(--font-mono); text-transform: uppercase; letter-spacing: .1em; color: var(--color-primary); }
    .feature { border-top: 2px solid var(--color-text); padding-top: var(--space-3, 12px); }
    .feature h3 { font: 700 var(--font-size-lg, 17px)/1.2 var(--font-mono); }
    .aside { border-left: 1px solid var(--color-border-strong, var(--color-border)); padding-left: var(--space-4, 16px); }
    .aside h3 { font: 600 11px/1 var(--font-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--color-text-muted); }
    .band { border: 0; border-radius: var(--radius-md, 10px); background: var(--color-surface-raised); padding: var(--space-3, 12px) var(--space-4, 16px); }
    .band h3 { font: 600 11px/1 var(--font-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--color-text-muted); }
    /* hero: the one part a composed page leads with; its title in display type, whatever its treatment. */
    .frame.hero h3 { font: 700 var(--font-size-2xl, 28px)/1.15 var(--font-display, var(--font-mono)); letter-spacing: -.01em; text-transform: none; color: var(--color-text); }
    .frame.hero .head { margin-bottom: var(--space-4, 16px); }
    /* pending: a step is running and this part has nothing yet; its title and grey rules hold its place. No motion. */
    .skel { display: grid; gap: 10px; padding: 4px 0; }
    .skel i { display: block; height: 10px; border-radius: 4px; background: var(--color-surface-raised); }
    .skel i:nth-child(1) { width: 88%; } .skel i:nth-child(2) { width: 64%; } .skel i:nth-child(3) { width: 42%; }`,
  function (p) { return html`<section class="frame ${p.treatment && p.treatment !== 'plain' ? p.treatment : ''} ${p.hero ? 'hero' : ''}"><div class="head"><h3>${p.title}</h3>${p.note ? html`<span class="note">${p.note}</span>` : nothing}</div>${p.pending ? html`<div class="skel" role="status" aria-busy="true" aria-label="Not yet"><i></i><i></i><i></i></div>` : this.renderNode(p.child)}</section>`; });

// **bold** only; everything else escaped (same rule as Text's markdown).
// A value where words belong, as words. A page can bind a text prop to a whole item ({title, url, …}) or a
// list instead of its string field; that must never print as "[object Object]" or "undefined": an item is
// said by its title (or headline, text, name, label, summary), a list by its first item, nothing by nothing.
const said = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.length ? said(v[0]) : '';
  if (typeof v === 'object') { for (const k of ['title', 'headline', 'text', 'name', 'label', 'summary']) { if (typeof v[k] === 'string' && v[k].trim()) return v[k]; } }
  return '';
};
const boldOnly = (s) => esc(s).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
const Callout = define('Callout', 'sua-a2ui-callout',
  Common.extend({ label: Str.optional(), text: Str, next: Str.optional(), nextLabel: Str.optional(), image: Str.optional() }).strict(),
  css`
    :host { display: block; }
    .box { padding: var(--space-4, 16px); background: var(--color-surface); border: 1px solid var(--color-border); border-left: 3px solid var(--color-primary); border-radius: var(--radius-md, 10px); }
    .art { float: right; width: 96px; height: 72px; margin: 0 0 8px 16px; border-radius: 8px; }
    /* A source's own photo beside a briefing's lead: larger, shown whole. */
    .art.photo { width: 168px; height: 112px; object-fit: contain; background: var(--color-surface-raised); border: 1px solid var(--color-border); }
    @media (max-width: 560px) { .art { display: none; } }
    .label { font: 600 11px/1 var(--font-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--color-primary); }
    .text { margin: 8px 0 0; font-size: var(--font-size-lg, 17px); line-height: 1.45; color: var(--color-text); }
    .text strong { font-weight: 600; }
    .next { margin: 8px 0 0; font-size: var(--font-size-sm); color: var(--color-text-muted); }
    .next b { color: var(--color-text); }`,
  function () { const img = this.controller?.props?.image; const photo = typeof img === 'string' && /^\/notebooks\/[^/]+\/entries\/[^/]+\/photo$/.test(img); return html`<div class="box">${typeof img === 'string' && (photo || /^data:image\/svg\+xml;base64,/.test(img)) ? html`<img class="art${photo ? ' photo' : ''}" src=${img} alt="">` : nothing}${said(this.controller?.props?.label) ? html`<div class="label">${said(this.controller.props.label)}</div>` : nothing}<p class="text"></p>${said(this.controller?.props?.next) ? html`<p class="next"><b>${said(this.controller.props.nextLabel) || 'Next:'}</b> ${said(this.controller.props.next)}</p>` : nothing}</div>`; },
  { updated() { const el = this.renderRoot.querySelector('.text'); const v = said(this.controller?.props?.text); if (el && el.__v !== v) { el.innerHTML = boldOnly(v); el.__v = v; } } });

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
    return html`<div class="groups">${groups.map((g) => html`<div class="g">${g?.title ? html`<h4>${g.title}</h4>` : nothing}
      ${(Array.isArray(g?.items) ? g.items : []).map((it) => html`<label class="${it?.done ? 'done' : ''}"><input type="checkbox" .checked=${!!it?.done} ?disabled=${!p.actions} @change=${(e) => act(g.id, it.text, e.target.checked)}><span>${it?.text ?? ''}</span></label>`)}</div>`)}</div>`;
  });

// Groups the filter chips use; an event's `kind` decides which it's in.
const TIMELINE_GROUPS = [
  { id: 'search', label: 'Searches', kinds: ['search'] },
  { id: 'note', label: 'Notes', kinds: ['note', 'evidence'] },
  { id: 'decision', label: 'Decisions and rulings', kinds: ['decision', 'out'] },
  { id: 'move', label: 'Moves', kinds: ['move'] },
];
// Any timeline: same-again events fold into one row ("×7", expand to see
// each), and a long one gets a search box (`search`, on past 8 events).
const Timeline = define('Timeline', 'sua-a2ui-timeline',
  Common.extend({ events: CommonSchemas.DynamicValue, maxItems: z.number().int().min(1).max(50).optional(), filters: z.boolean().optional(), search: z.boolean().optional() }).strict(),
  css`
    .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin-bottom: 16px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; height: var(--control-h-sm, 28px); font-size: var(--font-size-xs); padding: 0 10px; border-radius: 999px; border: 1px solid var(--color-border); color: var(--color-text-muted); background: var(--color-surface); }
    .chip[aria-pressed="true"] { background: var(--color-primary-soft); color: var(--color-primary); border-color: transparent; font-weight: 600; }
    .chip:focus-visible, .find:focus-visible, .more:focus-visible, .fold:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; }
    .chip .n { font-variant-numeric: tabular-nums; opacity: .7; margin-left: 4px; }
    .find { box-sizing: border-box; height: var(--control-h-sm, 28px); min-width: 0; flex: 0 1 220px; margin-left: auto; padding: 0 10px; font: inherit; font-size: var(--font-size-xs); color: var(--color-text); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-sm, 6px); }
    .count { font-size: var(--font-size-xs); color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
    ol { position: relative; list-style: none; margin: 0; padding: 0 0 0 22px; display: grid; gap: 16px; }
    ol::before { content: ""; position: absolute; left: 5px; top: 6px; bottom: 6px; width: 2px; background: var(--color-border); border-radius: 1px; }
    li { position: relative; min-width: 0; }
    li::before { content: ""; position: absolute; left: -22px; top: 3px; width: 8px; height: 8px; border-radius: 50%; background: var(--color-surface); border: 2px solid var(--color-primary); }
    li.decision::before { border-color: var(--color-ok); } li.search::before { border-color: var(--accent-blue, var(--color-primary)); background: var(--accent-blue, var(--color-primary)); }
    li.out::before { border-color: var(--color-warn); } li.move::before { border-color: var(--accent-purple, var(--color-primary)); } li.faded::before { border-color: var(--color-border-strong, var(--color-border)); background: var(--color-surface); }
    .when { font-size: var(--font-size-xs); line-height: 1.4; color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
    .when a { color: var(--color-primary); font-family: var(--font-mono); }
    .who { color: var(--color-text); }
    .t { margin-top: 2px; font-size: var(--font-size-sm); font-weight: 600; line-height: 1.4; color: var(--color-text); }
    .x { margin-left: 6px; font-weight: 400; color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
    .b { margin-top: 2px; font-size: var(--font-size-sm); line-height: 1.5; color: var(--color-text-muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .faded .t, .faded .b { color: var(--color-text-subtle, var(--color-text-muted)); }
    .tag { margin-left: 6px; font: var(--font-size-xs)/1 var(--font-mono); padding: 1px 5px; border-radius: 4px; border: 1px dashed var(--color-border-strong, var(--color-border)); color: var(--color-text-muted); font-weight: 400; }
    .fold { all: unset; cursor: pointer; margin-left: 6px; font-size: var(--font-size-xs); font-weight: 400; color: var(--color-primary); }
    .runs { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 2px; }
    .runs::before { display: none; } .runs li::before { display: none; }
    .more { all: unset; cursor: pointer; margin-top: 16px; font-size: var(--font-size-xs); color: var(--color-primary); }
    .empty { margin: 0; font-size: var(--font-size-sm); color: var(--color-text-muted); }`,
  function (p) {
    const all = Array.isArray(p.events) ? p.events : [];
    if (!all.length) return html`<p class="empty">Nothing yet.</p>`;
    const group = TIMELINE_GROUPS.find((g) => g.id === this._group);
    const q = this._q ?? '';
    const shown = all.filter((e) => (!group || group.kinds.includes(e?.kind)) && matchEvent(e, q));
    const rows = collapseRepeats(shown);
    const max = this._all ? rows.length : (p.maxItems ?? 12);
    const open = (this._open ??= new Set());
    const set = (k, v) => { this[k] = v; this.requestUpdate(); };
    const when = (at) => { const d = new Date(at); return Number.isFinite(d.getTime()) ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };
    const counts = TIMELINE_GROUPS.map((g) => ({ ...g, n: all.filter((e) => g.kinds.includes(e?.kind)).length })).filter((g) => g.n);
    const chips = p.filters && counts.length > 1;
    const searchable = p.search ?? all.length > 8;
    const link = (e) => (safeUrl(e?.link) ? html` · <a href=${safeUrl(e.link)}>${e.linkText ?? 'run'}</a>` : nothing);
    const key = (r) => `${r.items[0]?.at ?? ''}|${r.title ?? ''}`;
    const toggle = (r) => { const k = key(r); if (open.has(k)) open.delete(k); else open.add(k); this.requestUpdate(); };
    const row = (r) => {
      const many = r.count > 1;
      const expanded = many && open.has(key(r));
      return html`<li class="${r.kind ?? ''} ${r.faded ? 'faded' : ''}">
        <div class="when">${many ? whenRange(r, when) : when(r.at)}${r.who ? html` · <span class="who">${r.who}</span>` : nothing}${many ? nothing : link(r)}</div>
        <div class="t">${r.title ?? ''}${many ? html`<span class="x">×${r.count}</span>` : nothing}${r.tag ? html`<span class="tag">${r.tag}</span>` : nothing}${many ? html`<button type="button" class="fold" aria-expanded=${expanded ? 'true' : 'false'} @click=${() => toggle(r)}>${expanded ? 'hide' : `show ${r.count}`}</button>` : nothing}</div>
        ${r.body ? html`<div class="b" title=${r.body}>${r.body}</div>` : nothing}
        ${expanded ? html`<ul class="runs">${r.items.map((e) => html`<li class="when">${when(e.at)}${link(e)}</li>`)}</ul>` : nothing}
      </li>`;
    };
    return html`
      ${chips || searchable ? html`<div class="bar">
        ${chips ? html`<div class="chips" role="group" aria-label="Show">
          <button type="button" class="chip" aria-pressed=${!group ? 'true' : 'false'} @click=${() => { this._all = false; set('_group', ''); }}>All<span class="n">${all.length}</span></button>
          ${counts.map((g) => html`<button type="button" class="chip" aria-pressed=${group?.id === g.id ? 'true' : 'false'} @click=${() => { this._all = false; set('_group', g.id); }}>${g.label}<span class="n">${g.n}</span></button>`)}
        </div>` : nothing}
        ${searchable ? html`<input type="search" class="find" placeholder="Search the history" aria-label="Search the history" .value=${q} @input=${(e) => { this._all = false; set('_q', e.target.value); }}>` : nothing}
        ${group || q ? html`<span class="count" role="status">${shown.length} of ${all.length}</span>` : nothing}
      </div>` : nothing}
      ${rows.length ? html`<ol>${rows.slice(0, max).map(row)}</ol>` : html`<p class="empty">No events match.</p>`}
      ${rows.length > max ? html`<button type="button" class="more" @click=${() => set('_all', true)}>Show ${rows.length - max} more</button>` : nothing}`;
  });

// ── Briefing components: who someone is, what's known, what they said, what to talk about.
// Generic (any data in these shapes), so boards and agent views can use them too.
const sectionHead = css`
  .h { margin: 0 0 8px; font: 600 11px/1 var(--font-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--color-text-muted); }
  .empty { margin: 0; font-size: var(--font-size-sm); color: var(--color-text-muted); }`;
const outLink = (u, text) => (safeUrl(u) ? html`<a href=${safeUrl(u)} target=${u.startsWith('/') ? nothing : '_blank'} rel="noopener noreferrer">${text}</a>` : text);

const ProfileCard = define('ProfileCard', 'sua-a2ui-profile-card',
  Common.extend({ name: Str, role: Str.optional(), org: Str.optional(), about: Str.optional(), image: Str.optional(), imageFrom: Str.optional(), imageWhy: Str.optional(), rejectHref: Str.optional(), links: CommonSchemas.DynamicValue.optional(), asOf: Str.optional(), variant: z.enum(['card', 'cover']).optional(), quote: Str.optional(), quoteFrom: Str.optional(), quoteBy: Str.optional() }).strict(),
  css`
    .card { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 14px 16px; align-items: start; }
    .pic { width: 72px; height: 72px; border-radius: var(--radius-md, 10px); object-fit: contain; background: var(--color-surface-raised); border: 1px solid var(--color-border); }
    .mono { display: grid; place-items: center; font: 700 24px/1 var(--font-mono); color: var(--color-primary); background: var(--color-primary-soft); border-color: transparent; }
    .name { margin: 0; font-size: var(--font-size-xl, 22px); line-height: 1.2; color: var(--color-text); text-wrap: balance; }
    .line { margin: 4px 0 0; font-size: var(--font-size-sm); color: var(--color-text-muted); }
    .line b { font-weight: 600; color: var(--color-text); }
    .about { margin: 8px 0 0; max-width: 65ch; font-size: var(--font-size-sm); line-height: 1.5; color: var(--color-text); display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
    .links { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .links a { font: var(--font-size-xs)/1.8 var(--font-mono); padding: 0 8px; border-radius: 6px; border: 1px solid var(--color-border); text-decoration: none; }
    .links a:hover { border-color: var(--color-primary); }
    .asof { margin: 8px 0 0; font-size: var(--font-size-xs); color: var(--color-text-subtle, var(--color-text-muted)); }
    /* cover: the lead of a briefing (a large portrait, the name in display type, a pull quote). */
    .cover { grid-template-columns: 160px minmax(0, 1fr); gap: 16px 24px; }
    .cover .pic { width: 160px; height: 160px; }
    .cover .mono { font-size: 56px; }
    .cover .name { font: 700 var(--font-size-2xl, 28px)/1.15 var(--font-display, var(--font-mono)); letter-spacing: -.01em; }
    .cover .line { font-size: var(--font-size-md, 14px); }
    .cover .about { -webkit-line-clamp: 5; font-size: var(--font-size-md, 14px); }
    .pull { grid-column: 1 / -1; margin: 4px 0 0; padding: 0 0 0 20px; position: relative; font: 500 var(--font-size-lg, 17px)/1.45 var(--font-display, var(--font-sans)); color: var(--color-text); text-wrap: balance; }
    .pull cite { display: block; margin-top: 6px; font: 400 var(--font-size-xs)/1.4 var(--font-sans); font-style: normal; color: var(--color-text-muted); }
    .pull cite a { color: inherit; text-decoration: none; } .pull cite a:hover { color: var(--color-primary); }
    .pull::before { content: "“"; position: absolute; left: -4px; top: -10px; font: 700 44px/1 var(--font-display, var(--font-mono)); color: var(--color-primary); }
    @media (max-width: 560px) { .cover { grid-template-columns: 96px minmax(0, 1fr); } .cover .pic { width: 96px; height: 96px; } .cover .mono { font-size: 32px; } }
    @media (max-width: 420px) { .card { grid-template-columns: 1fr; } }
    /* Where their photo came from, and Not them: a person can check it's them. */
    .picbox { display: grid; gap: 4px; justify-items: start; }
    .from { max-width: 160px; font-size: var(--font-size-xs); line-height: 1.35; color: var(--color-text-muted); overflow-wrap: anywhere; }
    .from a { text-decoration: none; }
    .notthem { margin: 0; }
    .notthem button { all: unset; cursor: pointer; font-size: var(--font-size-xs); color: var(--color-text-muted); text-decoration: underline; text-underline-offset: 2px; }
    .notthem button:hover { color: var(--color-err); }`,
  (p) => {
    const links = (Array.isArray(p.links) ? p.links : []).map((l) => (typeof l === 'string' ? { url: l } : l ?? {})).filter((l) => safeUrl(l.url)).slice(0, 6);
    const img = safeUrl(p.image);
    return html`<div class="card ${p.variant === 'cover' ? 'cover' : ''}">
      ${img ? html`<div class="picbox"><img class="pic" src=${img} alt=${p.name ? `Photo of ${p.name}` : ''}>
          ${safeUrl(p.imageFrom) ? html`<span class="from" title=${p.imageWhy ?? nothing}>Photo: <a href=${safeUrl(p.imageFrom)} target="_blank" rel="noopener noreferrer">${sourceName(p.imageFrom)} ↗</a></span>` : nothing}
          ${p.rejectHref && /^\/(?!\/)/.test(p.rejectHref) ? html`<form class="notthem" method="POST" action=${p.rejectHref}><button type="submit" title="Not a photo of them: remove it, and don't use it again">Not them</button></form>` : nothing}
        </div>` : html`<div class="pic mono" aria-hidden="true">${monogram(p.name) || '?'}</div>`}
      <div>
        <h3 class="name">${p.name ?? ''}</h3>
        ${p.role || p.org ? html`<p class="line">${p.role ?? ''}${p.role && p.org ? ' · ' : ''}${p.org ? html`<b>${p.org}</b>` : nothing}</p>` : nothing}
        ${p.about ? html`<p class="about" title=${p.about}>${p.about}</p>` : nothing}
        ${links.length ? html`<div class="links">${links.map((l) => html`<a href=${safeUrl(l.url)} target="_blank" rel="noopener noreferrer">${l.label || sourceName(l.url) || 'link'} ↗</a>`)}</div>` : nothing}
        ${p.asOf ? html`<p class="asof">As of ${p.asOf}</p>` : nothing}
      </div>
      ${p.quote ? html`<blockquote class="pull">${p.quote}${safeUrl(p.quoteFrom) ? html`<cite><a href=${safeUrl(p.quoteFrom)} target="_blank" rel="noopener noreferrer">${p.quoteBy || sourceName(p.quoteFrom)} ↗</a></cite>` : nothing}</blockquote>` : nothing}
    </div>`;
  });

const FactSheet = define('FactSheet', 'sua-a2ui-fact-sheet',
  Common.extend({ facts: CommonSchemas.DynamicValue, missing: CommonSchemas.DynamicValue.optional(), variant: z.enum(['grid', 'ruled']).optional() }).strict(),
  css`${sectionHead}
    .groups { display: grid; gap: 16px; }
    dl { display: grid; grid-template-columns: minmax(6rem, max-content) minmax(0, 1fr); gap: 6px 14px; margin: 0; font-size: var(--font-size-sm); }
    dt { color: var(--color-text-muted); }
    dd { margin: 0; min-width: 0; overflow-wrap: anywhere; color: var(--color-text); }
    .est { border-bottom: 1px dashed var(--color-border-strong, var(--color-border)); cursor: help; }
    .src { margin-left: 6px; font-size: var(--font-size-xs); color: var(--color-text-muted); white-space: nowrap; }
    .src a { text-decoration: none; }
    .miss { margin: 12px 0 0; font-size: var(--font-size-xs); color: var(--color-text-muted); }
    .miss b { font-weight: 600; color: var(--color-warn); }
    /* ruled: each fact on its own line under a hairline, its label in small caps above (an aside). */
    .ruled dl { display: block; }
    .ruled dt { margin: 0; padding-top: 8px; border-top: 1px solid var(--color-border); font: 600 10px/1.2 var(--font-mono); text-transform: uppercase; letter-spacing: .08em; }
    .ruled dd { margin: 3px 0 8px; }
    .ruled .src { display: block; margin: 2px 0 0; }
    /* What the latest run learned or changed (What's new since the last run). */
    .mark { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 999px; font: 600 10px/16px var(--font-mono); text-transform: uppercase; letter-spacing: .06em; vertical-align: 1px; background: var(--color-primary-soft); color: var(--color-primary); }
    .mark--changed { background: var(--color-warn-soft, var(--color-primary-soft)); color: var(--color-warn, var(--color-primary)); cursor: help; }`,
  (p) => {
    const facts = (Array.isArray(p.facts) ? p.facts : []).filter((f) => f && typeof f === 'object' && String(f.label ?? '').trim());
    const mark = (f) => (f.mark === 'new' ? html`<span class="mark">new</span>`
      : f.mark === 'changed' ? html`<span class="mark mark--changed" title=${f.was ? `Was ${f.was}` : 'Changed'}>changed</span>` : nothing);
    const missing = textItems(p.missing).map((m) => m.text);
    if (!facts.length && !missing.length) return html`<p class="empty">Nothing found yet.</p>`;
    const value = (f) => {
      const v = typeof f.value === 'object' && f.value ? JSON.stringify(f.value) : String(f.value ?? '');
      return f.estimate ? html`<span class="est" title="An estimate">≈ ${v}</span>` : v;
    };
    const source = (f) => {
      const u = safeUrl(f.url ?? f.source);
      // Not from a page: from something the person gave the notebook.
      if (!u && !f.at && f.from) return html`<span class="src">from ${f.from}</span>`;
      if (!u && !f.at) return nothing;
      return html`<span class="src">${u ? html`<a href=${u} target="_blank" rel="noopener noreferrer" title=${u}>${sourceName(u) || 'source'} ↗</a>` : nothing}${u && f.at ? ' · ' : ''}${f.at ?? ''}</span>`;
    };
    return html`<div class="groups ${p.variant === 'ruled' ? 'ruled' : ''}">${groupBy(facts).map((g) => html`<section>
        ${g.group ? html`<h4 class="h">${g.group}</h4>` : nothing}
        <dl>${g.items.map((f) => html`<dt>${f.label}</dt><dd>${value(f)}${mark(f)}${source(f)}</dd>`)}</dl>
      </section>`)}</div>
      ${missing.length ? html`<p class="miss"><b>Not found:</b> ${missing.join(', ')}</p>` : nothing}`;
  });

const QuoteList = define('QuoteList', 'sua-a2ui-quote-list',
  Common.extend({ items: CommonSchemas.DynamicValue, grouped: z.boolean().optional(), maxItems: z.number().int().min(1).max(50).optional(), search: z.boolean().optional(), lead: z.boolean().optional() }).strict(),
  css`${sectionHead}
    .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 14px; }
    .find { box-sizing: border-box; height: var(--control-h-sm, 28px); min-width: 0; flex: 0 1 240px; padding: 0 10px; font: inherit; font-size: var(--font-size-xs); color: var(--color-text); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-sm, 6px); }
    .find:focus-visible, .more:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; }
    .count { font-size: var(--font-size-xs); color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
    .groups { display: grid; gap: 18px; }
    .h .n { margin-left: 6px; font-weight: 400; opacity: .7; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
    li { min-width: 0; padding-left: 12px; border-left: 2px solid var(--color-border); }
    li.chosen { border-left-color: var(--color-primary); }
    blockquote { margin: 0; font-size: var(--font-size-sm); line-height: 1.55; color: var(--color-text); }
    .meta { margin-top: 4px; font-size: var(--font-size-xs); color: var(--color-text-muted); }
    .meta a { text-decoration: none; }
    .meta .t { color: var(--color-text); font-weight: 600; }
    .tag { margin-left: 6px; font: var(--font-size-xs)/1 var(--font-mono); padding: 1px 5px; border-radius: 4px; background: var(--color-primary-soft); color: var(--color-primary); }
    .ask { margin: 6px 0 0; font-size: var(--font-size-sm); color: var(--color-text); }
    .ask b { font: 600 11px/1 var(--font-mono); text-transform: uppercase; letter-spacing: .06em; color: var(--color-primary); margin-right: 4px; }
    .more { all: unset; cursor: pointer; margin-top: 14px; font-size: var(--font-size-xs); color: var(--color-primary); }
    /* lead: the first quote as a pull quote, above the rest. */
    .lead { margin: 0 0 20px; padding: 0 0 16px 22px; position: relative; border-bottom: 1px solid var(--color-border); }
    .lead blockquote { font: 500 var(--font-size-xl, 22px)/1.35 var(--font-display, var(--font-sans)); text-wrap: balance; }
    .lead::before { content: "“"; position: absolute; left: -2px; top: -8px; font: 700 48px/1 var(--font-display, var(--font-mono)); color: var(--color-primary); }`,
  function (p) {
    const all = (Array.isArray(p.items) ? p.items : []).filter((it) => it && typeof it === 'object' && String(it.quote ?? it.title ?? '').trim());
    if (!all.length) return html`<p class="empty">Nothing yet.</p>`;
    const q = this._q ?? '';
    // Led by its first quote (unless searching): that one is set large, the rest follow.
    const leadItem = p.lead && !q ? all[0] : undefined;
    const shown = all.filter((it) => it !== leadItem && matchQuote(it, q));
    const max = this._all ? shown.length : (p.maxItems ?? 4);
    const set = (k, v) => { this[k] = v; this.requestUpdate(); };
    // Show N more counts quotes, across groups.
    let left = max;
    const groups = (p.grouped === false ? [{ group: '', items: shown }] : groupBy(shown))
      .map((g) => { const items = g.items.slice(0, Math.max(0, left)); left -= items.length; return { ...g, total: g.items.length, items }; })
      .filter((g) => g.items.length);
    const item = (it) => {
      const src = safeUrl(it.source);
      return html`<li class="${it.chosen ? 'chosen' : ''}">
        ${it.quote ? html`<blockquote>${it.quote}</blockquote>` : nothing}
        <div class="meta">${it.title ? html`<span class="t">${safeUrl(it.href) ? outLink(it.href, it.title) : it.title}</span>` : nothing}${it.chosen ? html`<span class="tag">chosen</span>` : nothing}${src ? html`${it.title ? ' · ' : ''}<a href=${src} target="_blank" rel="noopener noreferrer" title=${src}>${it.sourceText || sourceName(src)} ↗</a>` : nothing}${it.at ? html` · ${it.at}` : nothing}</div>
        ${it.ask ? html`<p class="ask"><b>Ask</b>${it.ask}</p>` : nothing}
      </li>`;
    };
    const searchable = p.search ?? all.length > 8;
    return html`
      ${searchable ? html`<div class="bar">
        <input type="search" class="find" placeholder="Search what they said" aria-label="Search what they said" .value=${q} @input=${(e) => { this._all = false; set('_q', e.target.value); }}>
        ${q ? html`<span class="count" role="status">${shown.length} of ${all.length}</span>` : nothing}
      </div>` : nothing}
      ${leadItem ? html`<div class="lead">${leadItem.quote ? html`<blockquote>${leadItem.quote}</blockquote>` : nothing}<div class="meta">${leadItem.title ? html`<span class="t">${safeUrl(leadItem.href) ? outLink(leadItem.href, leadItem.title) : leadItem.title}</span>` : nothing}${safeUrl(leadItem.source) ? html` · <a href=${safeUrl(leadItem.source)} target="_blank" rel="noopener noreferrer">${leadItem.sourceText || sourceName(leadItem.source)} ↗</a>` : nothing}${leadItem.at ? html` · ${leadItem.at}` : nothing}</div></div>` : nothing}
      ${groups.length ? html`<div class="groups">${groups.map((g) => html`<section>
        ${g.group ? html`<h4 class="h">${g.group}<span class="n">${g.total}</span></h4>` : nothing}
        <ul>${g.items.map(item)}</ul>
      </section>`)}</div>` : leadItem ? nothing : html`<p class="empty">Nothing matches.</p>`}
      ${shown.length > max ? html`<button type="button" class="more" @click=${() => set('_all', true)}>Show ${shown.length - max} more</button>` : nothing}`;
  });

// Ticks are this browser's own (per page and agenda): a list to work through in the meeting.
const agendaKey = (el) => `sua-agenda:${location.pathname}:${el.context?.componentModel?.id ?? ''}`;
// How a point's sources traced (an answer's findings, ADR-0082): its tag and what it means.
const TRACED = {
  verified: ['Verified', 'Confirmed where it comes from: its quote is on a primary page (the thing itself), or every option it cites passed every check, quoted from its own page'],
  supported: ['Supported', 'Partly confirmed: its quote is on a page that isn\u2019t primary, or the options it cites passed some checks'],
  interpretation: ['Interpretation', 'What the answer draws from its sources, not something a source says'],
  unverified: ['Unverified', 'The quotes it cites weren\u2019t found on their pages, or the pages couldn\u2019t be read'],
};
const Agenda = define('Agenda', 'sua-a2ui-agenda',
  Common.extend({ points: CommonSchemas.DynamicValue, questions: CommonSchemas.DynamicValue.optional(), maxQuestions: z.number().int().min(1).max(20).optional(), watch: CommonSchemas.DynamicValue.optional(), title: Str.optional(), check: z.boolean().optional(), copy: z.boolean().optional(), editHref: Str.optional(), replaceHref: Str.optional(), variant: z.enum(['list', 'numerals']).optional(), questionsLabel: Str.optional(), watchLabel: Str.optional(), empty: Str.optional() }).strict(),
  css`${sectionHead}
    .top { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .top .h { margin: 0; }
    .acts { margin-left: auto; display: inline-flex; gap: 6px; }
    .copy { all: unset; cursor: pointer; font-size: var(--font-size-xs); padding: 0 10px; height: var(--control-h-sm, 28px); display: inline-flex; align-items: center; border-radius: var(--radius-sm, 6px); border: 1px solid var(--color-border); color: var(--color-text-muted); }
    .copy:hover { border-color: var(--color-primary); color: var(--color-primary); }
    .copy:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; }
    .status { font-size: var(--font-size-xs); color: var(--color-ok); }
    ol { margin: 0 0 16px; padding: 0; list-style: none; display: grid; gap: 10px; }
    ol li { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 2px 10px; }
    ol li > :not(.pt) { grid-column: 2; }
    ol li > form.swap { grid-column: 3; grid-row: 1; margin: 0; }
    .swaps ol li { grid-template-columns: 24px minmax(0, 1fr) auto; }
    .swaps.numerals ol li { grid-template-columns: 44px minmax(0, 1fr) auto; }
    form.swap .copy { opacity: 0; }
    li:hover form.swap .copy, form.swap .copy:focus-visible { opacity: 1; }
    @media (hover: none) { form.swap .copy { opacity: 1; } }
    .pt { display: contents; font-size: var(--font-size-sm); font-weight: 600; line-height: 1.45; color: var(--color-text); }
    .num { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font: 700 11px/1 var(--font-mono); color: var(--color-primary); background: var(--color-primary-soft); }
    .pt .t { font-size: var(--font-size-sm); font-weight: 600; line-height: 1.45; color: var(--color-text); padding-top: 2px; }
    label.pt { cursor: pointer; }
    label.pt:hover .num { box-shadow: 0 0 0 2px var(--color-primary); }
    .sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); border: 0; }
    .sr:focus-visible + .num { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .done .num { color: var(--color-bg); background: var(--color-ok); }
    .done .pt .t { color: var(--color-text-muted); text-decoration: line-through; }
    .note { font-size: var(--font-size-sm); line-height: 1.5; color: var(--color-text-muted); }
    .refs { display: flex; flex-wrap: wrap; gap: 4px 8px; font-size: var(--font-size-xs); }
    .refs a { text-decoration: none; }
    .tr { font: 600 10px/1 var(--font-mono); letter-spacing: 0.04em; text-transform: uppercase; padding: 3px 6px; border-radius: var(--radius-sm, 6px); align-self: center; }
    .tr--verified { color: var(--color-ok); background: var(--color-ok-soft); }
    .tr--supported { color: var(--color-info); background: var(--color-info-soft); }
    .tr--unverified { color: var(--color-warn); background: var(--color-warn-soft); }
    .tr--interpretation { color: var(--color-text-muted); background: transparent; box-shadow: inset 0 0 0 1px var(--color-border); }
    ul { margin: 0 0 16px; padding-left: 18px; display: grid; gap: 6px; font-size: var(--font-size-sm); line-height: 1.5; color: var(--color-text); }
    ul:last-child, ol:last-child { margin-bottom: 0; }
    .watch li::marker { color: var(--color-warn); }
    .more { all: unset; cursor: pointer; display: block; margin: -8px 0 16px; font-size: var(--font-size-xs); color: var(--color-primary); }
    .more:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; }
    /* numerals: large teal numbers, the points as headlines. */
    .numerals ol { gap: 16px; }
    .numerals ol li { grid-template-columns: 44px minmax(0, 1fr); }
    .numerals .num { width: auto; height: auto; border-radius: 0; background: none; place-items: start; font: 700 var(--font-size-2xl, 28px)/1 var(--font-mono); color: var(--color-primary); }
    .numerals .done .num { background: none; color: var(--color-ok); }
    .numerals .pt .t { font-size: var(--font-size-md, 14px); padding-top: 4px; }`,
  function (p) {
    const points = textItems(p.points);
    const questions = textItems(p.questions);
    const watch = textItems(p.watch);
    if (!points.length && !questions.length && !watch.length) return html`<p class="empty">${p.empty ?? 'Nothing to talk about yet.'}</p>`;
    if (!this._done) { try { this._done = new Set(JSON.parse(localStorage.getItem(agendaKey(this)) ?? '[]')); } catch { this._done = new Set(); } }
    const done = this._done;
    const tick = (text, on) => {
      if (on) done.add(text); else done.delete(text);
      try { localStorage.setItem(agendaKey(this), JSON.stringify([...done])); } catch { /* ticks just aren't kept */ }
      this.requestUpdate();
    };
    const copy = async () => {
      const text = agendaText({ pointsLabel: p.title, points, questions, watch, questionsLabel: p.questionsLabel, watchLabel: p.watchLabel });
      try { await navigator.clipboard.writeText(text); this._copied = 'Copied'; } catch { this._copied = 'Couldn’t copy here'; }
      this.requestUpdate();
      setTimeout(() => { this._copied = ''; this.requestUpdate(); }, 2500);
    };
    const checkable = p.check !== false;
    const maxQ = p.maxQuestions ?? 3;
    const refs = (pt) => (Array.isArray(pt.refs) ? pt.refs : []).filter((r) => r && safeUrl(r.href) && r.label).slice(0, 6);
    const replace = p.replaceHref && safeUrl(p.replaceHref) ? p.replaceHref : '';
    return html`<div class="${[p.variant === 'numerals' ? 'numerals' : '', replace ? 'swaps' : ''].filter(Boolean).join(' ')}">
      <div class="top"><h4 class="h">${p.title ?? 'Talking points'}</h4>${this._copied ? html`<span class="status" role="status">${this._copied}</span>` : nothing}<span class="acts">${p.editHref && safeUrl(p.editHref) ? html`<a class="copy" href=${p.editHref}>Edit</a>` : nothing}${p.copy === false ? nothing : html`<button type="button" class="copy" @click=${copy}>Copy as text</button>`}</span></div>
      ${points.length ? html`<ol>${points.map((pt, i) => html`<li class="${checkable && done.has(pt.text) ? 'done' : ''}">
        ${checkable
          ? html`<label class="pt"><input class="sr" type="checkbox" .checked=${done.has(pt.text)} @change=${(e) => tick(pt.text, e.target.checked)}><span class="num" title="Tick it off">${done.has(pt.text) ? '✓' : i + 1}</span><span class="t">${pt.text}</span></label>`
          : html`<div class="pt"><span class="num">${i + 1}</span><span class="t">${pt.text}</span></div>`}
        ${replace ? html`<form class="swap" method="POST" action=${replace}><input type="hidden" name="at" value=${String(i)}><input type="hidden" name="text" value=${pt.text}><button type="submit" class="copy" title="Strike this point; sua writes a new one in its place">Replace</button></form>` : nothing}
        ${pt.note ? html`<div class="note">${pt.note}</div>` : nothing}
        ${refs(pt).length || TRACED[pt.trace] ? html`<div class="refs">${TRACED[pt.trace] ? html`<span class="tr tr--${pt.trace}" title=${TRACED[pt.trace][1]}>${TRACED[pt.trace][0]}</span>` : nothing}${refs(pt).map((r) => outLink(r.href, r.label))}</div>` : nothing}
      </li>`)}</ol>` : nothing}
      ${questions.length ? html`<h4 class="h">${p.questionsLabel ?? 'Questions to ask'}</h4><ul>${questions.slice(0, this._allQ ? questions.length : maxQ).map((q) => html`<li>${q.text}${q.href && safeUrl(q.href) && q.label ? html` <span class="refs">${outLink(q.href, q.label)}</span>` : nothing}</li>`)}</ul>
        ${!this._allQ && questions.length > maxQ ? html`<button type="button" class="more" @click=${() => { this._allQ = true; this.requestUpdate(); }}>Show ${questions.length - maxQ} more</button>` : nothing}` : nothing}
      ${watch.length ? html`<h4 class="h">${p.watchLabel ?? 'Watch out for'}</h4><ul class="watch">${watch.map((w) => html`<li>${w.text}</li>`)}</ul>` : nothing}
    </div>`;
  });

// What changed since last time (a watch notebook's latest search against the
// one before, or any agent's list of changes): grouped by kind, each linking
// to its page, a price change marked better or worse.
const CHANGE_GROUPS = [['new', 'New', '+'], ['price', 'Price changes', '$'], ['changed', 'Changed', '~'], ['gone', 'Gone', '×'], ['missing', 'Not seen lately', '?']];
const Changes = define('Changes', 'sua-a2ui-changes',
  Common.extend({ items: CommonSchemas.DynamicValue, title: Str.optional(), empty: Str.optional(), maxItems: z.number().int().min(1).max(50).optional() }).strict(),
  css`${sectionHead}
    .more { all: unset; cursor: pointer; margin-top: 6px; display: inline-block; font-size: var(--font-size-xs); color: var(--color-primary); }
    .more:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; }
    .group { margin: 0 0 14px; }
    .group:last-child { margin-bottom: 0; }
    .group .h { display: flex; align-items: center; gap: 6px; }
    .n { font: 600 var(--font-size-xs)/1 var(--font-mono); color: var(--color-text-muted); }
    ul { margin: 6px 0 0; padding: 0; list-style: none; display: grid; gap: 8px; }
    li { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 2px 10px; align-items: start; }
    .mark { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font: 700 12px/1 var(--font-mono); background: var(--color-surface-raised, var(--color-surface)); color: var(--color-text-muted); border: 1px solid var(--color-border); }
    .ok .mark { color: var(--color-ok); border-color: var(--color-ok); }
    .warn .mark { color: var(--color-warn); border-color: var(--color-warn); }
    .t { font-size: var(--font-size-sm); font-weight: 600; line-height: 1.45; color: var(--color-text); overflow-wrap: anywhere; }
    .t a { color: inherit; text-decoration: none; }
    .t a:hover, .t a:focus-visible { color: var(--color-primary); text-decoration: underline; }
    .d { grid-column: 2; font-size: var(--font-size-sm); line-height: 1.5; color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
    .k-price.ok .d { color: var(--color-ok); }
    .k-price.warn .d { color: var(--color-warn); }`,
  function (p) {
    const items = (Array.isArray(p.items) ? p.items : []).filter((x) => x && typeof x.title === 'string' && x.title);
    if (!items.length) return html`<p class="empty">${p.empty ?? 'Nothing changed since last time.'}</p>`;
    // A long group shows its first few, then "Show N more" (a search can bring dozens).
    const max = p.maxItems ?? 5;
    this._all ??= new Set();
    return html`<div>${CHANGE_GROUPS.map(([kind, label, mark]) => {
      const all = items.filter((x) => x.kind === kind);
      if (!all.length) return nothing;
      const open = this._all.has(kind);
      const list = open ? all : all.slice(0, max);
      return html`<section class="group"><h4 class="h">${label} <span class="n">${all.length}</span></h4><ul>${list.map((x) => html`<li class="k-${kind}${x.tone === 'ok' || x.tone === 'warn' ? ` ${x.tone}` : ''}">
        <span class="mark" aria-hidden="true">${kind === 'price' && x.tone ? (x.tone === 'ok' ? '↓' : '↑') : mark}</span>
        <span class="t">${x.href && safeUrl(x.href) ? html`<a href=${x.href}>${x.title}</a>` : x.title}</span>
        ${x.detail ? html`<span class="d">${x.detail}</span>` : nothing}
      </li>`)}</ul>${all.length > max ? html`<button type="button" class="more" aria-expanded=${open ? 'true' : 'false'} @click=${() => { if (open) this._all.delete(kind); else this._all.add(kind); this.requestUpdate(); }}>${open ? 'Show fewer' : `Show ${all.length - max} more`}</button>` : nothing}</section>`;
    })}</div>`;
  });

// A thumbnail: http(s), a dashboard path, or a small base64 image (a drawing sua or an example made).
const imageUrl = (u) => safeUrl(u) ?? (typeof u === 'string' && /^data:image\/(svg\+xml|png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(u) ? u : undefined);
/** A story's date, short ("Nov 6"; with the year when it's not this one); other text as given. */
const storyDate = (at) => {
  if (typeof at !== 'string' || !at.trim()) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime()) || !/\d{4}/.test(at)) return at.trim();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) });
};

// Articles or posts, as a feed gives them: a thumbnail (or the source's
// initials), the title linked to the article, a line of summary, then
// source · date. A news tile, a reading list, a digest.
const Stories = define('Stories', 'sua-a2ui-stories',
  Common.extend({ items: CommonSchemas.DynamicValue, title: Str.optional(), empty: Str.optional(), maxItems: z.number().int().min(1).max(50).optional(), thumbs: z.enum(['show', 'hide']).optional() }).strict(),
  css`${sectionHead}
    ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 12px; }
    li { display: flex; gap: 12px; align-items: flex-start; min-width: 0; }
    .pic { flex: 0 0 72px; width: 72px; aspect-ratio: 4 / 3; border-radius: var(--radius-sm, 6px); overflow: hidden; background: var(--color-surface-raised); border: 1px solid var(--color-border); display: grid; place-items: center; }
    .pic img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .pic span { font: 700 var(--font-size-sm)/1 var(--font-mono); color: var(--color-text-muted); letter-spacing: .04em; }
    .body { min-width: 0; flex: 1; display: grid; gap: 2px; }
    .t { font-size: var(--font-size-sm); font-weight: 600; line-height: 1.4; color: var(--color-text); overflow-wrap: anywhere; }
    .t a { color: inherit; text-decoration: none; }
    .t a:hover, .t a:focus-visible { color: var(--color-primary); text-decoration: underline; }
    .s { font-size: var(--font-size-sm); line-height: 1.5; color: var(--color-text-muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .m { font: 500 var(--font-size-xs)/1.5 var(--font-mono); color: var(--color-text-subtle, var(--color-text-muted)); text-transform: uppercase; letter-spacing: .04em; overflow-wrap: anywhere; }
    .more { all: unset; cursor: pointer; margin-top: 8px; display: inline-block; font-size: var(--font-size-xs); color: var(--color-primary); }
    .more:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; }`,
  function (p) {
    const items = (Array.isArray(p.items) ? p.items : []).filter((x) => x && typeof x.title === 'string' && x.title.trim());
    if (!items.length) return html`<p class="empty">${p.empty ?? 'No stories yet.'}</p>`;
    const max = p.maxItems ?? 10;
    const list = this._all ? items : items.slice(0, max);
    const thumbs = p.thumbs !== 'hide';
    const pic = (x) => {
      const img = imageUrl(x.image);
      if (img) return html`<div class="pic"><img src=${img} alt="" loading="lazy"></div>`;
      const who = typeof x.source === 'string' && x.source.trim() ? x.source : sourceName(x.url);
      return html`<div class="pic" aria-hidden="true"><span>${monogram(who) || '·'}</span></div>`;
    };
    const meta = (x) => {
      const src = typeof x.source === 'string' && x.source.trim() ? x.source.trim() : sourceName(x.url);
      const when = storyDate(x.at);
      return [src, when].filter(Boolean).join(' · ');
    };
    return html`<div>
      ${p.title ? html`<h4 class="h">${p.title}</h4>` : nothing}
      <ul>${list.map((x) => html`<li>
        ${thumbs ? pic(x) : nothing}
        <div class="body">
          <div class="t">${safeUrl(x.url) ? html`<a href=${safeUrl(x.url)} target="_blank" rel="noopener noreferrer">${x.title}</a>` : x.title}</div>
          ${typeof x.summary === 'string' && x.summary.trim() ? html`<div class="s">${x.summary}</div>` : nothing}
          ${meta(x) ? html`<div class="m">${meta(x)}</div>` : nothing}
        </div>
      </li>`)}</ul>
      ${items.length > max ? html`<button type="button" class="more" aria-expanded=${this._all ? 'true' : 'false'} @click=${() => { this._all = !this._all; this.requestUpdate(); }}>${this._all ? 'Show fewer' : `Show ${items.length - max} more`}</button>` : nothing}
    </div>`;
  });

// A plan in order (a notebook's write step with shape "plan", or any agent's):
// a heading per day, week or slot with its items (each with its note and
// the options it uses), then what to do first and what's still open.
const Itinerary = define('Itinerary', 'sua-a2ui-itinerary',
  Common.extend({ days: CommonSchemas.DynamicValue, before: CommonSchemas.DynamicValue.optional(), open: CommonSchemas.DynamicValue.optional(), title: Str.optional(), beforeLabel: Str.optional(), openLabel: Str.optional(), empty: Str.optional(), copy: z.boolean().optional() }).strict(),
  css`${sectionHead}
    .top { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .top .h { margin: 0; }
    .copy { all: unset; cursor: pointer; margin-left: auto; font-size: var(--font-size-xs); padding: 0 10px; height: var(--control-h-sm, 28px); display: inline-flex; align-items: center; border-radius: var(--radius-sm, 6px); border: 1px solid var(--color-border); color: var(--color-text-muted); }
    .copy:hover { border-color: var(--color-primary); color: var(--color-primary); }
    .copy:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; }
    .status { font-size: var(--font-size-xs); color: var(--color-ok); }
    .days { margin: 0 0 16px; padding: 0; list-style: none; display: grid; gap: 14px; }
    .day { display: grid; grid-template-columns: minmax(5.5rem, 8rem) minmax(0, 1fr); gap: 4px 16px; padding-top: 12px; border-top: 1px solid var(--color-border); }
    .day:first-child { border-top: 0; padding-top: 0; }
    .when { font: 700 var(--font-size-sm)/1.45 var(--font-mono); color: var(--color-primary); overflow-wrap: anywhere; }
    .items { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; min-width: 0; }
    .t { font-size: var(--font-size-sm); font-weight: 600; line-height: 1.45; color: var(--color-text); }
    .note { font-size: var(--font-size-sm); line-height: 1.5; color: var(--color-text-muted); }
    .refs { display: flex; flex-wrap: wrap; gap: 4px 8px; font-size: var(--font-size-xs); }
    .refs a { text-decoration: none; }
    ul.plain { margin: 0 0 16px; padding-left: 18px; display: grid; gap: 6px; font-size: var(--font-size-sm); line-height: 1.5; color: var(--color-text); }
    ul.plain:last-child { margin-bottom: 0; }
    @media (max-width: 560px) { .day { grid-template-columns: minmax(0, 1fr); } }`,
  function (p) {
    const days = (Array.isArray(p.days) ? p.days : []).map((d) => ({ when: typeof d?.when === 'string' ? d.when : '', items: textItems(d?.items) })).filter((d) => d.items.length);
    const before = textItems(p.before);
    const open = textItems(p.open);
    if (!days.length && !before.length && !open.length) return html`<p class="empty">${p.empty ?? 'No plan yet.'}</p>`;
    const copy = async () => {
      const text = planText({ title: p.title, days: p.days, before: p.before, open: p.open, beforeLabel: p.beforeLabel, openLabel: p.openLabel });
      try { await navigator.clipboard.writeText(text); this._copied = 'Copied'; } catch { this._copied = 'Couldn’t copy here'; }
      this.requestUpdate();
      setTimeout(() => { this._copied = ''; this.requestUpdate(); }, 2500);
    };
    const refs = (it) => (Array.isArray(it.refs) ? it.refs : []).filter((r) => r && safeUrl(r.href) && r.label).slice(0, 6);
    return html`<div>
      <div class="top"><h4 class="h">${p.title ?? 'The plan'}</h4>${this._copied ? html`<span class="status" role="status">${this._copied}</span>` : nothing}${p.copy === false ? nothing : html`<button type="button" class="copy" @click=${copy}>Copy as text</button>`}</div>
      ${days.length ? html`<ol class="days">${days.map((d) => html`<li class="day"><div class="when">${d.when || 'Anytime'}</div><ul class="items">${d.items.map((it) => html`<li>
        <div class="t">${it.text}</div>
        ${it.note ? html`<div class="note">${it.note}</div>` : nothing}
        ${refs(it).length ? html`<div class="refs">${refs(it).map((r) => outLink(r.href, r.label))}</div>` : nothing}
      </li>`)}</ul></li>`)}</ol>` : nothing}
      ${before.length ? html`<h4 class="h">${p.beforeLabel ?? 'Before you start'}</h4><ul class="plain">${before.map((b) => html`<li>${b.text}</li>`)}</ul>` : nothing}
      ${open.length ? html`<h4 class="h">${p.openLabel ?? 'Still open'}</h4><ul class="plain">${open.map((o) => html`<li>${o.text}</li>`)}</ul>` : nothing}
    </div>`;
  });

// **bold** in text as lit parts, never markup.
const boldParts = (s) => String(s ?? '').split(/\*\*([^*\n]+)\*\*/g).map((t, i) => (i % 2 ? html`<strong>${t}</strong>` : t));

// The parts an answer was asked for: the steps to take (numbered), a table
// (a rubric, a comparison), a short explanation, a diagram sua laid out. The
// styles and drawing are shared by AnswerSections (several parts) and Figure
// (one part, drawn large as a page's hero).
const sectionStyles = css`${sectionHead}
    .sec + .sec { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--color-border); }
    ol.steps { margin: 0; padding: 0; list-style: none; counter-reset: step; display: grid; gap: 12px; }
    ol.steps > li { counter-increment: step; display: grid; grid-template-columns: 1.75rem minmax(0, 1fr); gap: 2px 10px; }
    ol.steps > li::before { content: counter(step); grid-row: span 8; font: 700 var(--font-size-sm)/1.45 var(--font-mono); color: var(--color-primary); }
    /* A runbook's step: how long it takes, whether it's advice, then how, what you'll see and if not. */
    .t .time, .t .advice { margin-left: 8px; font: 600 var(--font-size-xs)/1.4 var(--font-mono); letter-spacing: 0.04em; color: var(--color-text-muted); white-space: nowrap; }
    .t .advice { padding: 1px 6px; border: 1px solid var(--color-border); border-radius: var(--radius-sm, 4px); text-transform: uppercase; }
    dl.run { margin: 4px 0 0; display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 3px 10px; font-size: var(--font-size-sm); line-height: 1.5; }
    dl.run dt { font: 600 var(--font-size-xs)/1.7 var(--font-mono); text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-muted); }
    dl.run dd { margin: 0; color: var(--color-text); }
    dl.run dd.ifnot { color: var(--color-text-muted); }
    /* A runbook's steps as cards (style "runbook"): a big number, the action, how, a ✓ what you'll see, an if-not aside, the part to copy inside its step, a box to tick. */
    ol.rb { margin: 0; padding: 0; list-style: none; counter-reset: step; display: grid; gap: 14px; }
    ol.rb > li { counter-increment: step; display: grid; grid-template-columns: 2.5rem minmax(0, 1fr); gap: 4px 14px; padding: 14px 16px; border: 1px solid var(--color-border); border-radius: var(--radius-md, 8px); background: var(--color-surface); }
    ol.rb > li::before { content: counter(step); grid-row: span 9; font: 700 var(--font-size-2xl, 28px)/1 var(--font-mono); color: var(--color-primary); }
    ol.rb > li.done { background: var(--color-surface-raised, var(--color-surface)); }
    ol.rb > li.done::before { content: "✓"; }
    ol.rb .head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
    ol.rb .head .t { font-size: var(--font-size-md, 1rem); }
    ol.rb .tick { display: inline-flex; align-items: center; gap: 6px; flex: none; font-size: var(--font-size-xs); color: var(--color-text-muted); cursor: pointer; }
    ol.rb .tick input { width: 16px; height: 16px; margin: 0; accent-color: var(--color-primary); cursor: pointer; }
    ol.rb .how { margin: 2px 0 0; font-size: var(--font-size-sm); line-height: 1.6; color: var(--color-text); }
    ol.rb .see { margin: 6px 0 0; font-size: var(--font-size-sm); line-height: 1.5; color: var(--color-text); }
    ol.rb .see b { color: var(--color-primary); margin-right: 4px; }
    ol.rb .ifnot { margin: 6px 0 0; padding: 6px 10px; border-left: 3px solid var(--color-warn); border-radius: 0 var(--radius-sm, 4px) var(--radius-sm, 4px) 0; background: color-mix(in srgb, var(--color-warn) 10%, transparent); font-size: var(--font-size-sm); line-height: 1.5; color: var(--color-text); }
    ol.rb .ifnot b { font: 600 var(--font-size-xs)/1.5 var(--font-mono); text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-warn); margin-right: 6px; }
    ol.rb figure.copy { margin-top: 10px; }
    ol.rb .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    ol.rb .refs { margin-top: 6px; }
    ol.rb > li.next { border-color: var(--color-primary); }
    ol.rb .mks { display: inline-flex; gap: 3px; margin-left: 6px; vertical-align: super; }
    ol.rb .mk { font: 600 10px/1 var(--font-mono); color: var(--color-primary); text-decoration: none; }
    ol.rb .mk:hover { text-decoration: underline; }
    ol.rb details.stuck { margin: 6px 0 0; font-size: var(--font-size-sm); color: var(--color-text-muted); }
    ol.rb details.stuck summary { cursor: pointer; width: fit-content; font: 600 var(--font-size-xs)/1.6 var(--font-mono); text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-warn); }
    ol.rb details.stuck p { margin: 4px 0 0; padding-left: 10px; border-left: 2px solid var(--color-warn); line-height: 1.5; color: var(--color-text); }
    .rbbar { position: sticky; top: 0; z-index: 2; margin: 0 0 12px; padding: 10px 0 8px; background: var(--color-bg); }
    .rbbar__row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; }
    .rbbar__n { font: 700 var(--font-size-sm)/1.3 var(--font-mono); color: var(--color-text); }
    .rbbar__left { font: 500 var(--font-size-xs)/1.3 var(--font-mono); color: var(--color-text-muted); }
    .rbbar__menu { margin-left: auto; position: relative; }
    .rbbar__menu summary { cursor: pointer; font: 600 var(--font-size-xs)/1.6 var(--font-mono); color: var(--color-primary); list-style: none; }
    .rbbar__menu summary::after { content: " ▾"; }
    .rbbar__menu ol { position: absolute; right: 0; top: calc(100% + 6px); z-index: 3; width: min(360px, 80vw); max-height: 60vh; overflow: auto; margin: 0; padding: 6px; list-style: none; border: 1px solid var(--color-border); border-radius: var(--radius-md, 10px); background: var(--color-surface); }
    .rbbar__menu li button { display: grid; grid-template-columns: 1.5rem minmax(0, 1fr); gap: 6px; width: 100%; padding: 6px 8px; border: 0; border-radius: var(--radius-sm, 6px); background: none; color: var(--color-text); font: inherit; font-size: var(--font-size-sm); text-align: left; cursor: pointer; }
    .rbbar__menu li button:hover, .rbbar__menu li button:focus-visible { background: var(--color-surface-raised); }
    .rbbar__menu li .o { font: 700 var(--font-size-sm)/1.4 var(--font-mono); color: var(--color-primary); }
    .rbbar__menu li.done button { color: var(--color-text-muted); }
    .rbbar__track { height: 4px; margin-top: 8px; border-radius: 2px; background: var(--color-surface-raised); overflow: hidden; }
    .rbbar__track span { display: block; height: 100%; background: var(--color-primary); transition: width 0.2s ease; }
    @media (prefers-reduced-motion: reduce) { .rbbar__track span { transition: none; } }
    h5.ph { margin: 18px 0 8px; font: 600 var(--font-size-xs)/1.2 var(--font-mono); text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-primary); }
    h5.ph span { color: var(--color-text-muted); }
    .rbbar + h5.ph { margin-top: 4px; }
    .rbbar__go { margin-left: auto; padding: 0 10px; height: 28px; border: 1px solid var(--color-primary); border-radius: var(--radius-sm, 6px); background: none; color: var(--color-primary); font: 600 var(--font-size-sm)/1 var(--font-mono); cursor: pointer; }
    .rbbar__go:hover, .rbbar__go:focus-visible { background: var(--color-primary-soft, color-mix(in srgb, var(--color-primary) 10%, transparent)); }
    .rbbar__go + .rbbar__menu { margin-left: 0; }
    .fa { position: fixed; inset: 0; z-index: 1000; display: flex; flex-direction: column; padding: 20px max(20px, calc((100vw - 760px) / 2)); background: var(--color-bg); color: var(--color-text); overflow: auto; outline: none; overscroll-behavior: contain; }
    .fa__top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .fa__where { font: 600 var(--font-size-sm)/1.4 var(--font-mono); color: var(--color-text-muted); }
    .fa__where b { color: var(--color-primary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }
    .fa__x { height: 28px; padding: 0 10px; border: 1px solid var(--color-border-strong, var(--color-border)); border-radius: var(--radius-sm, 6px); background: none; color: var(--color-text); font: 600 var(--font-size-sm)/1 var(--font-mono); cursor: pointer; }
    .fa__track { height: 4px; margin: 14px 0 0; border-radius: 2px; background: var(--color-surface-raised); overflow: hidden; }
    .fa__track span { display: block; height: 100%; background: var(--color-primary); }
    .fa__resume { margin: 12px 0 0; font: 500 var(--font-size-sm)/1.4 var(--font-mono); color: var(--color-primary); }
    .fa__body { flex: 1 0 auto; display: grid; align-content: center; gap: 16px; padding: 32px 0; }
    .fa__t { margin: 0; font: 700 var(--font-size-2xl, 28px)/1.25 var(--font-display, var(--font-mono)); text-wrap: balance; }
    .fa__ok { color: var(--color-primary); }
    .fa__how { margin: 0; font-size: 20px; line-height: 1.55; }
    .fa__see { margin: 0; font-size: 18px; line-height: 1.5; }
    .fa__see b { margin-right: 6px; color: var(--color-primary); }
    .fa details.stuck { font-size: 16px; }
    .fa details.stuck summary { cursor: pointer; width: fit-content; font: 600 var(--font-size-sm)/1.6 var(--font-mono); text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-warn); }
    .fa details.stuck p { margin: 6px 0 0; padding-left: 12px; border-left: 2px solid var(--color-warn); line-height: 1.5; }
    .fa__nav { position: sticky; bottom: 0; display: grid; grid-template-columns: 1fr 1fr 2fr; gap: 10px; padding: 12px 0 calc(12px + env(safe-area-inset-bottom, 0px)); background: var(--color-bg); }
    .fa__nav button { height: 48px; border: 1px solid var(--color-border-strong, var(--color-border)); border-radius: var(--radius-md, 10px); background: var(--color-surface); color: var(--color-text); font: 600 var(--font-size-md, 14px)/1 var(--font-mono); cursor: pointer; }
    .fa__nav button.pri { border-color: var(--color-primary); background: var(--color-primary); color: var(--color-bg); }
    .fa__nav button:disabled { opacity: 0.4; cursor: default; }
    .fa button:focus-visible, .fa summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    /* What goes wrong (style "runbook"): what you see, then the fix, the likely cause beneath. */
    .fixes { display: grid; gap: 0; }
    .fixes .r { display: grid; grid-template-columns: minmax(8rem, 38%) minmax(0, 1fr); gap: 4px 16px; padding: 10px 0; border-bottom: 1px solid var(--color-border); }
    .fixes .r:last-child { border-bottom: 0; }
    .fixes .sym { font-size: var(--font-size-sm); font-weight: 600; line-height: 1.45; color: var(--color-text); }
    .fixes .fix { font-size: var(--font-size-sm); line-height: 1.5; color: var(--color-text); }
    .fixes .fix::before { content: "→ "; color: var(--color-primary); font-weight: 700; }
    .fixes .cause { grid-column: 2; font-size: var(--font-size-xs); line-height: 1.5; color: var(--color-text-muted); }
    .fixes .refs { grid-column: 2; }
    @media (max-width: 560px) { .fixes .r { grid-template-columns: 1fr; } .fixes .cause, .fixes .refs { grid-column: 1; } ol.rb > li { grid-template-columns: 1.75rem minmax(0, 1fr); padding: 12px; } ol.rb > li::before { font-size: var(--font-size-lg, 20px); } }
    /* Something to copy: its label and a Copy button over the text as written. */
    figure.copy { margin: 0; border: 1px solid var(--color-border); border-radius: var(--radius-md, 8px); overflow: hidden; }
    figure.copy figcaption { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; background: var(--color-surface-raised, var(--color-surface)); border-bottom: 1px solid var(--color-border); font-size: var(--font-size-xs); color: var(--color-text-muted); }
    figure.copy button { font: 600 var(--font-size-xs)/1.4 var(--font-sans, inherit); padding: 3px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-sm, 4px); background: var(--color-surface); color: var(--color-text); cursor: pointer; }
    figure.copy button:hover, figure.copy button:focus-visible { border-color: var(--color-primary); color: var(--color-primary); }
    figure.copy pre { margin: 0; padding: 10px 12px; max-height: 360px; overflow: auto; font: var(--font-size-xs)/1.55 var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; color: var(--color-text); }
    .t { font-size: var(--font-size-sm); font-weight: 600; line-height: 1.45; color: var(--color-text); }
    .note { font-size: var(--font-size-sm); line-height: 1.5; color: var(--color-text-muted); }
    .refs { display: flex; flex-wrap: wrap; gap: 4px 8px; font-size: var(--font-size-xs); }
    .refs a { text-decoration: none; }
    .wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: var(--font-size-sm); line-height: 1.45; }
    th { text-align: left; font: 600 var(--font-size-xs)/1.4 var(--font-mono); text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-text-muted); padding: 0 12px 6px 0; border-bottom: 1px solid var(--color-border); }
    td { vertical-align: top; padding: 8px 12px 8px 0; border-bottom: 1px solid var(--color-border); color: var(--color-text); }
    td:first-child { font-weight: 600; }
    tr:last-child td { border-bottom: 0; }
    td .refs { margin-top: 4px; }
    p.body { margin: 0; font-size: var(--font-size-sm); line-height: 1.6; color: var(--color-text); }
    p.foot { margin: 8px 0 0; font-size: var(--font-size-xs); color: var(--color-text-muted); }
    .lad { display: grid; gap: 8px; }
    .lad .row { display: grid; grid-template-columns: minmax(6rem, 30%) minmax(0, 1fr); gap: 10px; align-items: center; }
    .lad .lab { font-size: var(--font-size-sm); font-weight: 600; color: var(--color-text); overflow-wrap: anywhere; }
    .lad .track { position: relative; height: 26px; border-radius: 4px; background: var(--color-surface-raised); }
    .lad .bar { position: absolute; top: 0; bottom: 0; border-radius: 4px; background: var(--color-primary); }
    .lad .bn { position: absolute; top: 50%; transform: translateY(-50%); font: 600 var(--font-size-xs)/1 var(--font-mono); color: var(--color-text); white-space: nowrap; }
    .lad .bn.in { color: var(--color-surface); }
    .lad .axis { position: relative; height: 16px; margin-left: calc(min(30%, 100%) + 10px); }
    .lad .tick { position: absolute; transform: translateX(-50%); font: 400 var(--font-size-xs)/1 var(--font-mono); color: var(--color-text-muted); white-space: nowrap; }
    .lad .tick:first-child { transform: none; } .lad .tick:last-child { transform: translateX(-100%); }
    .split .bars { display: flex; height: 30px; border-radius: 4px; overflow: hidden; gap: 2px; }
    .split .seg { background: var(--color-primary); min-width: 4px; }
    .split .seg:nth-child(even) { background: var(--color-primary-strong, var(--color-text-muted)); }
    .split ul { margin: 10px 0 0; padding: 0; list-style: none; display: grid; gap: 4px; font-size: var(--font-size-sm); }
    .split li b { font-family: var(--font-mono); color: var(--color-primary); margin-right: 6px; }
    .split .tot { font: 600 var(--font-size-xs)/1 var(--font-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--color-text-muted); margin-bottom: 6px; }
    ol.flow { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 8px; counter-reset: fl; }
    ol.flow li { counter-increment: fl; flex: 1 1 9rem; padding: 8px 10px; border: 1px solid var(--color-border); border-radius: 6px; font-size: var(--font-size-sm); color: var(--color-text); position: relative; }
    ol.flow li::before { content: counter(fl); display: block; font: 700 var(--font-size-xs)/1.4 var(--font-mono); color: var(--color-primary); }
    ol.flow li .note { margin-top: 2px; }
    .foot.every { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; margin-top: 8px; font-size: var(--font-size-xs); color: var(--color-text-muted); }
    .cap { margin: 8px 0 0; font-size: var(--font-size-xs); color: var(--color-text-muted); }
    /* what-if: a value the reader can move, the drawing following; mono values, one control height (DESIGN.md). */
    .whatif { display: flex; flex-wrap: wrap; gap: 8px 20px; align-items: end; margin: 0 0 12px; }
    .whatif .wi { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; align-items: center; flex: 1 1 14rem; max-width: 24rem; }
    .whatif .wl { grid-column: 1 / -1; font: 600 var(--font-size-xs)/1 var(--font-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--color-text-muted); }
    .whatif input[type=range] { width: 100%; margin: 0; height: var(--control-h-sm, 28px); accent-color: var(--color-primary); }
    .whatif .wv { font: 600 var(--font-size-sm)/1 var(--font-mono); color: var(--color-primary); min-width: 5ch; text-align: right; white-space: nowrap; }
    .whatif .reset { height: var(--control-h-sm, 28px); padding: 0 10px; border: 1px solid var(--color-border); border-radius: 6px; background: transparent; font: 500 var(--font-size-sm)/1 inherit; color: var(--color-text-muted); cursor: pointer; }
    .whatif .reset:hover { color: var(--color-text); border-color: var(--color-text-muted); }
    .big .whatif .wv { font-size: var(--font-size-md, 15px); }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    /* rubric: an If / Then / Why table as ruled decision rows, not a grid. */
    .rubric { display: grid; gap: 0; }
    .rubric .r { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: 4px 16px; padding: 10px 0; border-top: 1px solid var(--color-border); }
    .rubric .r:first-child { border-top: 0; padding-top: 0; }
    .rubric .if { font-size: var(--font-size-md, 15px); font-weight: 700; line-height: 1.35; color: var(--color-text); }
    .rubric .then { font-size: var(--font-size-sm); font-weight: 600; line-height: 1.45; color: var(--color-primary); }
    .rubric .why { grid-column: 2; font-size: var(--font-size-sm); line-height: 1.5; color: var(--color-text-muted); }
    .rubric .r .refs { grid-column: 2; }
    @media (max-width: 560px) { .rubric .r { grid-template-columns: 1fr; } .rubric .why, .rubric .r .refs { grid-column: 1; } }
    /* big: a hero figure (Figure size "hero"): taller bars, larger labels, more air. */
    .big .lad { gap: 12px; }
    .big .lad .track { height: 36px; border-radius: 6px; }
    .big .lad .bar { border-radius: 6px; }
    .big .lad .lab { font-size: var(--font-size-md, 15px); }
    .big .lad .bn { font-size: var(--font-size-sm); }
    .big .lad .axis { height: 20px; }
    .big .lad .tick { font-size: var(--font-size-sm); }
    .big .split .bars { height: 44px; border-radius: 6px; }
    .big .split ul { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px 16px; font-size: var(--font-size-md, 15px); }
    .big .split li b { font-size: var(--font-size-lg, 17px); }
    .big ol.flow li { flex-basis: 12rem; padding: 12px 14px; font-size: var(--font-size-md, 15px); }
    .big ol.steps { gap: 16px; }
    .big ol.steps > li { grid-template-columns: 2.25rem minmax(0, 1fr); }
    .big ol.steps > li::before { font-size: var(--font-size-lg, 17px); }
    .big .t, .big td, .big .rubric .if { font-size: var(--font-size-md, 15px); }
    .big p.body { font-size: var(--font-size-md, 15px); line-height: 1.6; }`;

const pctClamp = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(100, x)) : 0);

// A diagram's what-ifs, per reader: what they moved it to is kept in this
// browser only (by notebook page and part), never written to the notebook.
const whatIfKey = (key) => `sua.whatif:${location.pathname}:${String(key)}`;
function whatIfRead(key) {
  try { const v = JSON.parse(localStorage.getItem(whatIfKey(key)) ?? 'null'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
function whatIfWrite(key, values) {
  try { if (Object.keys(values).length) localStorage.setItem(whatIfKey(key), JSON.stringify(values)); else localStorage.removeItem(whatIfKey(key)); } catch { /* private window, blocked storage: the page still moves */ }
}
/**
 * A diagram with what-ifs (its `source` and `params`, lib/answer-art.ts),
 * at the values this reader moved it to: a row of sliders above it, the
 * drawing recomputed and laid out again here (assets/diagram-math.js), and
 * Reset back to what was written. `host` is the element keeping the state.
 */
function whatIf(d, host, key) {
  const params = Array.isArray(d?.params) && d.source ? d.params.filter((p) => p && typeof p.key === 'string') : [];
  if (!params.length || !host) return { view: d, controls: nothing };
  host._whatIf ??= {};
  const values = host._whatIf[key] ??= whatIfRead(key);
  const at = (p) => (typeof values[p.key] === 'number' ? Math.max(p.min, Math.min(p.max, values[p.key])) : p.value);
  const changed = params.some((p) => at(p) !== p.value);
  const set = (p, v) => { const n = Number(v); if (!Number.isFinite(n)) return; if (n === p.value) delete values[p.key]; else values[p.key] = n; whatIfWrite(key, values); host.requestUpdate(); };
  const reset = () => { for (const p of params) delete values[p.key]; whatIfWrite(key, values); host.requestUpdate(); };
  const view = changed ? { ...layoutDiagram(recomputeDiagram(d.source, Object.fromEntries(params.map((p) => [p.key, at(p)])))), source: d.source, params } : d;
  const controls = html`<div class="whatif" role="group" aria-label="What if">${params.map((p) => html`<label class="wi"><span class="wl">${p.label}</span><input type="range" min=${p.min} max=${p.max} step=${p.step} .value=${String(at(p))} aria-valuetext=${diagramParamWords(p.key, at(p))} @input=${(e) => set(p, e.target.value)}><output class="wv">${diagramParamWords(p.key, at(p))}</output></label>`)}${changed ? html`<button type="button" class="reset" @click=${reset}>Reset</button>` : nothing}</div>`;
  return { view, controls };
}

/** A diagram sua laid out (lib/answer-art.ts): a ladder on a month axis, a split bar, or a flow of boxes; with a text version for screen readers. */
function drawDiagram(given, host, key) {
  const { view: d, controls } = whatIf(given, host, key);
  const n = pctClamp;
  const text = html`<ul class="sr">${(Array.isArray(d?.lines) ? d.lines : []).map((l) => html`<li>${l}</li>`)}</ul>`;
  if (d?.type === 'ladder') {
    return html`${controls}<div class="lad" role="img" aria-label=${(d.lines ?? []).join('; ')}>${(d.rungs ?? []).map((r) => html`<div class="row"><div class="lab">${r.label}</div><div class="track"><div class="bar" style=${`left:${n(r.left)}%;width:${n(r.width)}%`}></div><span class=${n(r.left) + n(r.width) > 62 ? 'bn in' : 'bn'} style=${n(r.left) + n(r.width) > 62 ? `right:${100 - n(r.left) - n(r.width)}%;margin-right:8px` : `left:${n(r.left) + n(r.width)}%;margin-left:6px`}>${r.note}</span></div></div>`)}
      <div class="axis" aria-hidden="true">${(d.axis ?? []).map((t) => html`<span class="tick" style=${`left:${n(t.at)}%`}>${t.label}</span>`)}</div></div>${text}`;
  }
  if (d?.type === 'split') {
    return html`${controls}<div class="split"><div class="tot">${d.total}</div><div class="bars" role="img" aria-label=${(d.lines ?? []).join('; ')}>${(d.parts ?? []).map((x) => html`<span class="seg" style=${`flex:0 0 ${n(x.width)}%`} title=${`${x.label}: ${x.amount}`}></span>`)}</div>
      <ul>${(d.parts ?? []).map((x) => html`<li><b>${x.amount}</b>${x.label}${x.note ? html` <span class="note">${x.note}</span>` : nothing}</li>`)}</ul></div>`;
  }
  if (d?.type === 'flow') return html`<ol class="flow">${(d.nodes ?? []).map((x) => html`<li>${x.label}${x.note ? html`<div class="note">${x.note}</div>` : nothing}</li>`)}</ol>`;
  return nothing;
}
const sectionRefs = (it) => {
  const r = (Array.isArray(it?.refs) ? it.refs : []).filter((x) => x && safeUrl(x.href) && x.label).slice(0, 4);
  return r.length ? html`<div class="refs">${r.map((x) => outLink(x.href, x.label))}</div>` : nothing;
};
/** A table that reads as a rubric: 2–3 columns, the first a condition (core looksLikeRubric). */
const looksLikeRubric = (cols) => cols.length >= 2 && cols.length <= 3 && typeof cols[0] === 'string' && /^(if|when|need|you|your)\b/i.test(cols[0].trim());
/** Something to copy (a runbook's prompt, a starter file): its label, a Copy button, and the text as written. */
function copyBlock(x) {
  const copy = async (e) => {
    const b = e.currentTarget;
    try { await navigator.clipboard.writeText(x.body ?? ''); b.textContent = 'Copied'; } catch { b.textContent = 'Couldn\u2019t copy here'; }
    setTimeout(() => { b.textContent = 'Copy'; }, 1800);
  };
  return html`<figure class="copy"><figcaption><span>${x.label ?? (x.lang === 'prompt' ? 'A prompt to paste' : '')}</span><button type="button" @click=${copy} aria-label=${`Copy ${x.label ?? x.title ?? 'this'}`}>Copy</button></figcaption><pre><code>${x.body ?? ''}</code></pre></figure>`;
}
/** A box to tick on a runbook's step: remembered in this browser only, for this page and step (a convenience; it can be empty). */
const tickKey = (sec, i) => { try { return `sua-runbook:${location.pathname}:${sec}:${String(i)}`; } catch { return ''; } };
const ticked = (k) => { try { return !!k && localStorage.getItem(k) === '1'; } catch { return false; } };
const setTicked = (k, on) => { try { if (k) { if (on) localStorage.setItem(k, '1'); else localStorage.removeItem(k); } } catch { /* a convenience */ } };
/** The column of a what-goes-wrong table that says the fix ("Fix", "What to do", "Try"), else its last. */
const fixColumn = (cols) => { const i = cols.findIndex((c) => /\b(fix|fixes|what to do|do this|solution|try|remedy)\b/i.test(String(c))); return i > 0 ? i : cols.length - 1; };
/** A runbook step's time in minutes, low and high ("5–10 min" → [5, 10]), as core runbookMinutes reads it. */
const stepMinutes = (t) => {
  const m = /^\s*(?:about\s+)?(\d+(?:\.\d+)?)\s*(?:[–-]\s*(\d+(?:\.\d+)?))?\s*(sec|secs|second|seconds|s|min|mins|minute|minutes|m|hr|hrs|hour|hours|h)\b/i.exec(String(t ?? ''));
  if (!m) return undefined;
  const per = /^(sec|secs|second|seconds|s)$/i.test(m[3]) ? 1 / 60 : /^(hr|hrs|hour|hours|h)$/i.test(m[3]) ? 60 : 1;
  const lo = Number(m[1]) * per, hi = Number(m[2] ?? m[1]) * per;
  return [lo, hi];
};
/** Minutes as words: "about 4 min", "4–6 min", "1 hr 10 min". */
const minutesWords = (lo, hi) => {
  const r = (x) => Math.max(1, Math.round(x));
  const w = (x) => (x >= 60 ? `${Math.floor(r(x) / 60)} hr${r(x) % 60 ? ` ${r(x) % 60} min` : ''}` : `${r(x)} min`);
  return r(lo) === r(hi) ? `about ${w(lo)}` : hi < 60 ? `${r(lo)}–${r(hi)} min` : `${w(lo)} to ${w(hi)}`;
};
/** The step to follow next: the first not done from `from` on, else the first not done, else the last. */
const nextUndone = (done, from = 0) => { const a = done.findIndex((d, i) => i >= from && !d); if (a >= 0) return a; const b = done.findIndex((d) => !d); return b >= 0 ? b : Math.max(0, done.length - 1); };
/** Keep the screen awake while following along (a convenience: without the Wake Lock API it still works). */
async function keepAwake(host, on) {
  try {
    if (on) { if (!host._rbWake && navigator.wakeLock?.request) host._rbWake = await navigator.wakeLock.request('screen'); }
    else { await host._rbWake?.release?.(); host._rbWake = undefined; }
  } catch { host._rbWake = undefined; }
}
/**
 * Following a runbook one step at a time (ADR-0097): a full-screen view of
 * one step in large type, Back, Next and Done & next (ticking it, as the card
 * does), the arrow keys and a swipe to move, Esc to close. Your place is kept
 * in this browser, and the screen is kept awake while it's open.
 */
function followAlong(x, host, all, keys, done) {
  const st = host._rbFollow;
  if (!st) return nothing;
  const i = Math.min(Math.max(0, st.i), all.length - 1);
  const it = all[i] ?? {};
  const placeKey = tickKey(x.key ?? '', 'follow');
  const move = (to) => { host._rbFollow = { ...st, i: Math.min(Math.max(0, to), all.length - 1), finished: false, resumed: false }; try { localStorage.setItem(placeKey, String(host._rbFollow.i)); } catch { /* a convenience */ } host.requestUpdate(); setTimeout(() => host.renderRoot?.querySelector('.fa')?.focus(), 0); };
  const close = () => { host._rbFollow = undefined; keepAwake(host, false); try { document.documentElement.style.overflow = host._rbOverflow ?? ''; } catch { /* fine */ } host.requestUpdate(); };
  const doneNext = () => {
    setTicked(keys[i], true);
    const now = keys.map((k) => ticked(k));
    if (now.every(Boolean)) { host._rbFollow = { ...st, finished: true }; host.requestUpdate(); return; }
    move(nextUndone(now, i + 1));
  };
  const key = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); move(i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); move(i - 1); }
    else if (e.key === 'Tab') {
      // Focus stays inside the view.
      const f = [...(host.renderRoot?.querySelectorAll('.fa button:not([disabled]), .fa summary, .fa a[href]') ?? [])];
      if (!f.length) return;
      const at = f.indexOf(host.renderRoot.activeElement);
      if (e.shiftKey && at <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && at === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  };
  const down = (e) => { host._rbSwipe = e.clientX; };
  const up = (e) => { const dx = e.clientX - (host._rbSwipe ?? e.clientX); host._rbSwipe = undefined; if (Math.abs(dx) > 60 && e.pointerType !== 'mouse') move(dx < 0 ? i + 1 : i - 1); };
  if (st.finished) {
    return html`<div class="fa" role="dialog" aria-modal="true" aria-label="Following along" tabindex="-1" @keydown=${key}>
      <div class="fa__top"><span class="fa__where">All ${String(all.length)} steps done</span><button type="button" class="fa__x" @click=${close} aria-label="Close">Close</button></div>
      <div class="fa__body"><p class="fa__t"><span class="fa__ok">✓</span> All done.</p><p class="fa__how">Close this to see how you know you’re finished, and what to remember.</p></div>
      <div class="fa__nav"><button type="button" @click=${() => move(all.length - 1)}>Back</button><span></span><button type="button" class="pri" @click=${close}>Close</button></div>
    </div>`;
  }
  return html`<div class="fa" role="dialog" aria-modal="true" aria-label=${`Step ${String(i + 1)} of ${String(all.length)}`} tabindex="-1" @keydown=${key} @pointerdown=${down} @pointerup=${up}>
    <div class="fa__top"><span class="fa__where">${it.phase ? html`<b>${it.phase}</b> · ` : nothing}Step ${String(i + 1)} of ${String(all.length)}${it.time ? html` · ${it.time}` : nothing}</span><button type="button" class="fa__x" @click=${close} aria-label="Close">Close</button></div>
    <div class="fa__track" aria-hidden="true"><span style=${`width:${Math.round((done.filter(Boolean).length / Math.max(1, all.length)) * 100)}%`}></span></div>
    ${st.resumed ? html`<p class="fa__resume">Picking up at step ${String(i + 1)}.</p>` : nothing}
    <div class="fa__body">
      <p class="fa__t">${done[i] ? html`<span class="fa__ok">✓</span> ` : nothing}${boldParts(it.text)}</p>
      ${it.how ? html`<p class="fa__how">${boldParts(it.how)}</p>` : nothing}
      ${it.copyPart ? copyBlock(it.copyPart) : nothing}
      ${it.see ? html`<p class="fa__see"><b aria-hidden="true">✓</b><span class="sr">You’ll see: </span>${boldParts(it.see)}</p>` : nothing}
      ${it.ifNot ? html`<details class="stuck"><summary>Stuck?</summary><p>${boldParts(it.ifNot)}</p></details>` : nothing}
    </div>
    <div class="fa__nav"><button type="button" @click=${() => move(i - 1)} ?disabled=${i === 0}>Back</button><button type="button" @click=${() => move(i + 1)} ?disabled=${i === all.length - 1}>Next</button><button type="button" class="pri" @click=${doneNext}>${done[i] ? 'Next not done' : 'Done & next'}</button></div>
  </div>`;
}
/** Open following along: at the step you were on, else the first not done. */
function openFollow(x, host, keys) {
  const done = keys.map((k) => ticked(k));
  let saved = -1; try { const v = localStorage.getItem(tickKey(x.key ?? '', 'follow')); saved = v === null ? -1 : Number(v); } catch { /* a convenience */ }
  const at = Number.isInteger(saved) && saved >= 0 && saved < keys.length && !done[saved] ? saved : nextUndone(done);
  host._rbFollow = { i: at, resumed: done.some(Boolean) };
  keepAwake(host, true);
  // The page behind stays put while following along.
  try { host._rbOverflow = document.documentElement.style.overflow; document.documentElement.style.overflow = 'hidden'; } catch { /* fine */ }
  // The screen sleeps again when the page is hidden; ask again when it's back.
  if (!host._rbVis) { host._rbVis = () => { if (document.visibilityState === 'visible' && host._rbFollow) keepAwake(host, true); }; try { document.addEventListener('visibilitychange', host._rbVis); } catch { /* fine */ } }
  host.requestUpdate();
  setTimeout(() => host.renderRoot?.querySelector('.fa')?.focus(), 0);
}

/**
 * A runbook's steps as cards (ADR-0097): grouped by phase, a sticky bar that
 * says how many are done and how long the rest takes (and lists the steps, to
 * jump to one), each step's sources as small numbered marks, "Stuck?" folded,
 * and Done that moves you on to the next step. Ticks are kept in this browser.
 */
function runbookSteps(x, host) {
  const all = Array.isArray(x.items) ? x.items : [];
  const keys = all.map((_, i) => tickKey(x.key ?? '', i));
  const done = keys.map((k) => ticked(k));
  const count = done.filter(Boolean).length;
  // What's left: the unticked steps' times, when each says one.
  const left = all.map((it, i) => (done[i] ? [0, 0] : stepMinutes(it.time)));
  const leftWords = count < all.length && left.every(Boolean) ? minutesWords(left.reduce((a, b) => a + b[0], 0), left.reduce((a, b) => a + b[1], 0)) : undefined;
  const next = done.findIndex((d) => !d);
  // Its sources as numbered marks, numbered in the order the steps first cite them.
  const marks = new Map();
  for (const it of all) for (const r of (Array.isArray(it.refs) ? it.refs : [])) if (r && safeUrl(r.href) && r.label && !marks.has(r.href)) marks.set(r.href, { n: marks.size + 1, label: r.label });
  const markLinks = (it) => {
    const r = (Array.isArray(it.refs) ? it.refs : []).filter((y) => y && marks.has(y.href)).slice(0, 4);
    return r.length ? html`<span class="mks">${r.map((y) => html`<a class="mk" href=${y.href} target="_blank" rel="noopener" title=${marks.get(y.href).label}>${marks.get(y.href).n}</a>`)}</span>` : nothing;
  };
  const go = (i) => {
    const li = host?.renderRoot?.querySelector(`li[data-step="${String(i)}"]`);
    let still = false; try { still = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* default */ }
    li?.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
  };
  const toggle = (i) => (e) => {
    const on = e.currentTarget.checked;
    setTicked(keys[i], on);
    host?.requestUpdate?.();
    // Done: on to the next step not yet done.
    if (on) { const j = keys.findIndex((k, n) => n > i && !ticked(k)); if (j >= 0) setTimeout(() => go(j), 60); }
  };
  // Consecutive steps with one phase, numbered across them.
  const groups = [];
  all.forEach((it, i) => { const last = groups[groups.length - 1]; if (last && (last.phase ?? '') === (it.phase ?? '')) last.steps.push(i); else groups.push({ phase: it.phase, steps: [i] }); });
  const span = (g) => (g.steps.length === 1 ? `step ${g.steps[0] + 1}` : `steps ${g.steps[0] + 1}–${g.steps[g.steps.length - 1] + 1}`);
  const card = (it, i) => html`<li data-step=${String(i)} class=${[done[i] ? 'done' : '', i === next ? 'next' : ''].join(' ').trim()}>
      <div class="head"><div class="t">${boldParts(it.text)}${it.time ? html`<span class="time">${it.time}</span>` : nothing}${it.advice ? html`<span class="advice" title="The writer's own advice, not something a source says">Advice</span>` : nothing}${markLinks(it)}</div><label class="tick"><input type="checkbox" .checked=${done[i]} @change=${toggle(i)} aria-label=${`Done: step ${String(i + 1)}`}>Done</label></div>
      ${it.detail ? html`<div class="note">${boldParts(it.detail)}</div>` : nothing}
      ${it.how ? html`<p class="how">${boldParts(it.how)}</p>` : nothing}
      ${it.copyPart ? copyBlock(it.copyPart) : nothing}
      ${it.see ? html`<p class="see"><b aria-hidden="true">✓</b><span class="sr">You’ll see: </span>${boldParts(it.see)}</p>` : nothing}
      ${it.ifNot ? html`<details class="stuck"><summary>Stuck?</summary><p>${boldParts(it.ifNot)}</p></details>` : nothing}
    </li>`;
  return html`<div class="rbbar" role="status">
      <div class="rbbar__row"><span class="rbbar__n">${count === all.length ? 'All done' : `${String(count)} of ${String(all.length)} done`}</span>${leftWords ? html`<span class="rbbar__left">${leftWords} to go</span>` : nothing}
        <button type="button" class="rbbar__go" @click=${() => openFollow(x, host, keys)}>Follow along</button>
        <details class="rbbar__menu"><summary>${next >= 0 ? `Step ${String(next + 1)} of ${String(all.length)}` : 'Steps'}</summary><ol>${all.map((it, i) => html`<li class=${done[i] ? 'done' : ''}><button type="button" @click=${(e) => { e.currentTarget.closest('details').open = false; go(i); }}><span class="o">${done[i] ? '✓' : String(i + 1)}</span>${it.text}</button></li>`)}</ol></details></div>
      <div class="rbbar__track" aria-hidden="true"><span style=${`width:${all.length ? Math.round((count / all.length) * 100) : 0}%`}></span></div>
    </div>
    ${groups.map((g) => html`${g.phase ? html`<h5 class="ph">${g.phase} <span>· ${span(g)}</span></h5>` : nothing}<ol class="rb" style=${`counter-reset: step ${String(g.steps[0])}`}>${g.steps.map((i) => card(all[i], i))}</ol>`)}
    ${followAlong(x, host, all, keys, done)}`;
}
/** What goes wrong as rows: what you see, then the fix, the likely cause beneath. */
function runbookFixes(x) {
  const refs = sectionRefs;
  const cols = Array.isArray(x.columns) ? x.columns : [];
  const f = fixColumn(cols);
  return html`<div class="fixes">${(x.rows ?? []).map((r) => {
    const cells = r.cells ?? [];
    const cause = cells.map((c, i) => (i !== 0 && i !== f && c ? c : '')).filter(Boolean);
    return html`<div class="r"><div class="sym">${boldParts(cells[0] ?? '')}</div><div class="fix">${boldParts(cells[f] ?? '')}</div>${cause.length ? html`<div class="cause">${cols.length > 2 ? html`${cols.find((_, i) => i !== 0 && i !== f) ?? ''}: ` : nothing}${cause.map((c, i) => html`${i ? ' · ' : ''}${boldParts(c)}`)}</div>` : nothing}${refs(r)}</div>`;
  })}</div>${x.note ? html`<p class="foot">${x.note}</p>` : nothing}${Array.isArray(x.refs) && x.refs.length ? html`<div class="foot every">Every row: ${refs(x)}</div>` : nothing}`;
}
/** One written part: steps numbered, a table (as a grid, or as ruled decision rows when `rubric`: true, or "auto" and it reads as one), a diagram, a paragraph. `style: "runbook"`: steps as cards, a what-goes-wrong table as symptom → fix. */
function drawPart(x, { rubric = false, host, style } = {}) {
  const refs = sectionRefs;
  if (style === 'runbook' && x.kind === 'steps') return runbookSteps(x, host);
  if (style === 'runbook' && x.kind === 'table' && x.role === 'trouble' && (x.columns ?? []).length >= 2) return runbookFixes(x);
  if (x.kind === 'steps') return html`<ol class="steps">${(x.items ?? []).map((it) => {
    // A runbook's step says how, what you'll see and what to do if not; advice is the writer's own, marked.
    const run = [['How', it.how, ''], ['You\u2019ll see', it.see, ''], ['If not', it.ifNot, 'ifnot']].filter(([, v]) => typeof v === 'string' && v);
    return html`<li><div class="t">${boldParts(it.text)}${it.time ? html`<span class="time">${it.time}</span>` : nothing}${it.advice ? html`<span class="advice" title="The writer's own advice, not something a source says">Advice</span>` : nothing}</div>${it.detail ? html`<div class="note">${boldParts(it.detail)}</div>` : nothing}${run.length ? html`<dl class="run">${run.map(([k, v, c]) => html`<dt>${k}</dt><dd class=${c}>${boldParts(v)}</dd>`)}</dl>` : nothing}${refs(it)}</li>`;
  })}</ol>`;
  if (x.kind === 'copy') return copyBlock(x);
  if (x.kind === 'table') {
    const cols = Array.isArray(x.columns) ? x.columns : [];
    const every = Array.isArray(x.refs) && x.refs.length ? html`<div class="foot every">Every row: ${refs(x)}</div>` : nothing;
    // A rubric: each row reads "if… → then…", with why beneath; the first column is the condition.
    if ((rubric === true || (rubric === 'auto' && looksLikeRubric(cols))) && cols.length >= 2) {
      return html`<div class="rubric">${(x.rows ?? []).map((r) => html`<div class="r"><div class="if">${boldParts(r.cells?.[0] ?? '')}</div><div class="then">${boldParts(r.cells?.[1] ?? '')}</div>${cols.length > 2 && (r.cells ?? []).slice(2).some(Boolean) ? html`<div class="why">${(r.cells ?? []).slice(2).filter(Boolean).map((c, i) => html`${i ? ' · ' : ''}${boldParts(c)}`)}</div>` : nothing}${refs(r)}</div>`)}</div>${x.note ? html`<p class="foot">${x.note}</p>` : nothing}${every}`;
    }
    return html`<div class="wrap"><table><thead><tr>${cols.map((c) => html`<th scope="col">${c}</th>`)}</tr></thead><tbody>${(x.rows ?? []).map((r) => html`<tr>${cols.map((_, i) => html`<td>${boldParts(r.cells?.[i] ?? '')}${i === cols.length - 1 ? refs(r) : nothing}</td>`)}</tr>`)}</tbody></table></div>${x.note ? html`<p class="foot">${x.note}</p>` : nothing}${every}`;
  }
  if (x.kind === 'diagram') return html`${drawDiagram(x.diagram, host, x.key)}${x.caption ? html`<p class="cap">${x.caption}</p>` : nothing}`;
  // A paragraph of a subject briefing says which sources it rests on.
  return html`<p class="body">${boldParts(x.body)}</p>${Array.isArray(x.refs) && x.refs.length ? html`<div class="foot">${refs(x)}</div>` : nothing}`;
}

const AnswerSections = define('AnswerSections', 'sua-a2ui-answer-sections',
  Common.extend({ sections: CommonSchemas.DynamicValue, title: Str.optional(), empty: Str.optional(), only: z.array(Str).optional(), rest: z.boolean().optional(), skip: z.array(Str).optional(), rubric: z.union([z.boolean(), z.literal('auto')]).optional(), roles: z.array(Str).optional(), style: z.literal('runbook').optional(), skipRoles: z.array(Str).optional() }).strict(),
  sectionStyles,
  function (p) {
    const given = (Array.isArray(p.sections) ? p.sections : []).filter((x) => x && typeof x.title === 'string');
    // Placed by key ("only", in that order), or everything another part of the page didn't place ("skip").
    const only = Array.isArray(p.only) ? p.only : undefined;
    const skip = Array.isArray(p.skip) ? p.skip : [];
    // …or by what each is for in a runbook (`roles`); a part to copy drawn inside its step isn't drawn again on its own.
    const roles = Array.isArray(p.roles) ? p.roles : undefined;
    const skipRoles = Array.isArray(p.skipRoles) ? p.skipRoles : [];
    const runbook = p.style === 'runbook';
    const sections = (only ? only.map((k) => given.find((x) => x.key === k)).filter(Boolean) : given.filter((x) => !skip.includes(x.key)))
      .filter((x) => (!roles || roles.includes(x.role)) && !skipRoles.includes(x.role) && !(runbook && x.inStep));
    // One part on its own: the panel around it says its title.
    const untitled = !!only && only.length === 1;
    if (!sections.length) return only || skip.length ? nothing : html`<p class="empty">${p.empty ?? 'Nothing more yet.'}</p>`;
    // One part by role ("The steps"): the panel's title says it, unless there are several.
    const bare = untitled || (!!roles && sections.length === 1);
    return html`<div>${sections.map((x) => html`<section class="sec">${bare ? nothing : html`<h4 class="h">${x.title}</h4>`}${drawPart(x, { rubric: p.rubric === 'auto' ? 'auto' : !!p.rubric, host: this, style: p.style })}</section>`)}</div>`;
  });

// A runbook read as a lesson (ADR-0097): what you'll make and be able to do,
// what you'll need (a box to tick for each, kept in this browser), and how it
// ends: you're done when…, key points, what's next, a self-check.
const RunbookLesson = define('RunbookLesson', 'sua-a2ui-runbook-lesson',
  Common.extend({ lesson: CommonSchemas.DynamicValue, part: z.enum(['opening', 'needs', 'finish']), outcome: Str.optional() }).strict(),
  css`
    :host { display: block; }
    .lab { margin: 16px 0 6px; font: 600 var(--font-size-xs)/1.2 var(--font-mono); text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-text-muted); }
    .lab:first-child { margin-top: 0; }
    .out { margin: 0; font-size: var(--font-size-lg, 17px); line-height: 1.5; color: var(--color-text); }
    .out strong { font-weight: 600; }
    ul.goals { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
    ul.goals li { display: grid; grid-template-columns: 1.25rem minmax(0, 1fr); gap: 8px; font-size: var(--font-size-md, 14px); line-height: 1.5; color: var(--color-text); }
    ul.goals li::before { content: "→"; color: var(--color-primary); font-family: var(--font-mono); }
    ul.needs { margin: 0; padding: 0; list-style: none; columns: 2 220px; column-gap: 24px; }
    ul.needs li { break-inside: avoid; }
    ul.needs label { display: flex; align-items: baseline; gap: 10px; padding: 4px 0; font-size: var(--font-size-md, 14px); line-height: 1.45; color: var(--color-text); cursor: pointer; }
    ul.needs input { width: 16px; height: 16px; margin: 0; flex: none; transform: translateY(2px); accent-color: var(--color-primary); cursor: pointer; }
    ul.needs label.on span { color: var(--color-text-muted); text-decoration: line-through; }
    .count { margin-top: 8px; font: 500 var(--font-size-xs)/1.2 var(--font-mono); color: var(--color-text-muted); }
    .done { margin: 0; padding: 12px 14px; border-left: 3px solid var(--color-primary); background: var(--color-primary-soft, color-mix(in srgb, var(--color-primary) 10%, transparent)); border-radius: 0 var(--radius-sm, 6px) var(--radius-sm, 6px) 0; font-size: var(--font-size-md, 14px); line-height: 1.5; color: var(--color-text); }
    .done b { margin-right: 6px; color: var(--color-primary); }
    ol.kp { margin: 0; padding: 0; list-style: none; counter-reset: kp; display: grid; gap: 8px; }
    ol.kp li { counter-increment: kp; display: grid; grid-template-columns: 1.75rem minmax(0, 1fr); gap: 8px; font-size: var(--font-size-md, 14px); line-height: 1.5; color: var(--color-text); }
    ol.kp li::before { content: counter(kp); font: 700 var(--font-size-lg, 17px)/1.3 var(--font-mono); color: var(--color-primary); }
    .next { margin: 0; font-size: var(--font-size-md, 14px); line-height: 1.5; color: var(--color-text); }
    details { border-top: 1px solid var(--color-border); padding: 8px 0; }
    details:last-of-type { border-bottom: 1px solid var(--color-border); }
    summary { cursor: pointer; font-size: var(--font-size-md, 14px); line-height: 1.45; color: var(--color-text); }
    summary::marker { color: var(--color-primary); }
    details p { margin: 6px 0 0 1.1rem; font-size: var(--font-size-sm); line-height: 1.5; color: var(--color-text-muted); }`,
  function (p) {
    const l = p.lesson && typeof p.lesson === 'object' ? p.lesson : {};
    const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);
    if (p.part === 'opening') {
      const text = typeof p.outcome === 'string' ? p.outcome : '';
      // A lesson leads with its outcome in a sentence; a runbook written before lessons says its whole answer.
      const out = l.written ? (text.match(/^.*?[.!?](?:\*\*)?(?=\s|$)/)?.[0] ?? text) : text;
      const goals = list(l.goals);
      return html`${out ? html`<p class="out">${boldParts(out)}</p>` : nothing}${goals.length ? html`<div class="lab">You\u2019ll be able to</div><ul class="goals">${goals.map((g) => html`<li>${boldParts(g)}</li>`)}</ul>` : nothing}`;
    }
    if (p.part === 'needs') {
      const needs = list(l.needs);
      if (!needs.length) return nothing;
      const count = () => needs.filter((_, i) => ticked(tickKey('needs', i))).length;
      const toggle = (i) => (e) => { setTicked(tickKey('needs', i), e.currentTarget.checked); e.currentTarget.closest('label')?.classList.toggle('on', e.currentTarget.checked); this.requestUpdate(); };
      const have = count();
      return html`<ul class="needs">${needs.map((n, i) => { const on = ticked(tickKey('needs', i)); return html`<li><label class=${on ? 'on' : ''}><input type="checkbox" .checked=${on} @change=${toggle(i)}><span>${boldParts(n)}</span></label></li>`; })}</ul><div class="count">${have === needs.length ? 'All set' : `${String(have)} of ${String(needs.length)} ready`}</div>`;
    }
    const keys = list(l.keyPoints);
    const checks = (Array.isArray(l.selfCheck) ? l.selfCheck : []).filter((c) => c && c.q && c.a);
    return html`${l.done ? html`<p class="done"><b aria-hidden="true">\u2713</b><span>You\u2019re done when ${boldParts(l.done.replace(/^you(\u2019|')re done when\s*/i, '').replace(/^([A-Z])(?=[a-z])/, (m) => m.toLowerCase()))}</span></p>` : nothing}
      ${keys.length ? html`<div class="lab">Key points</div><ol class="kp">${keys.map((k) => html`<li>${boldParts(k)}</li>`)}</ol>` : nothing}
      ${l.next ? html`<div class="lab">What\u2019s next</div><p class="next">${boldParts(l.next)}</p>` : nothing}
      ${checks.length ? html`<div class="lab">Check yourself</div>${checks.map((c) => html`<details><summary>${c.q}</summary><p>${c.a}</p></details>`)}` : nothing}`;
  });

// One written part (/notebook/section/<key>) on its own, drawn large when it
// is the page's hero: a ladder with tall bars, a split as a wide band, a rubric
// as ruled rows. Its title comes from the Panel around it.
const Figure = define('Figure', 'sua-a2ui-figure',
  Common.extend({ section: CommonSchemas.DynamicValue, size: z.enum(['hero', 'inline']).optional(), caption: Str.optional(), rubric: z.union([z.boolean(), z.literal('auto')]).optional(), style: z.literal('runbook').optional() }).strict(),
  sectionStyles,
  function (p) {
    const x = p.section && typeof p.section === 'object' && typeof p.section.kind === 'string' ? p.section : undefined;
    if (!x) return nothing;
    const big = (p.size ?? 'inline') === 'hero';
    const cap = typeof p.caption === 'string' && p.caption ? p.caption : undefined;
    return html`<figure class=${big ? 'big' : ''} style="margin:0">${drawPart(cap && x.kind === 'diagram' ? { ...x, caption: undefined } : x, { rubric: p.rubric === 'auto' ? 'auto' : !!p.rubric, host: this, style: p.style })}${cap ? html`<figcaption class="cap">${cap}</figcaption>` : nothing}</figure>`;
  });

// The one number that matters, set large: a stat {value, label, note?, href?,
// tone?} from the notebook (/notebook/numbers/<field>/best), or given.
const Lead = define('Lead', 'sua-a2ui-lead',
  Common.extend({ stat: CommonSchemas.DynamicValue.optional(), value: Str.optional(), label: Str.optional(), note: Str.optional(), tone: Str.optional(), href: Str.optional() }).strict(),
  css`
    :host { display: block; }
    .label { font: 600 11px/1 var(--font-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--color-text-muted); }
    .value { margin-top: 6px; font: 700 var(--font-size-2xl, 28px)/1.1 var(--font-display, var(--font-mono)); letter-spacing: -.01em; color: var(--color-primary); overflow-wrap: anywhere; }
    .value.neutral { color: var(--color-text); } .value.warn { color: var(--color-warn); } .value.err { color: var(--color-err); }
    .note { margin-top: 6px; font-size: var(--font-size-sm); line-height: 1.45; color: var(--color-text-muted); }
    .note a { color: inherit; }`,
  (p) => {
    const st = p.stat && typeof p.stat === 'object' ? p.stat : {};
    const value = p.value ?? st.value;
    if (value === undefined || value === null || value === '') return nothing;
    const label = p.label ?? st.label;
    const note = p.note ?? st.note;
    const href = p.href ?? st.href;
    const t = p.tone ?? st.tone ?? 'ok';
    return html`${label ? html`<div class="label">${label}</div>` : nothing}<div class="value ${tone(t)}">${value}</div>${note ? html`<div class="note">${href && safeUrl(href) ? outLink(href, note) : note}</div>` : nothing}`;
  });

// One number per day as columns (a count that changes from day to day: matches found, PRs open), the latest in the
// accent. Values sit over the columns and are in each column's title, so nothing depends on the bar's height alone.
const DayBars = define('DayBars', 'sua-a2ui-day-bars',
  Common.extend({ days: CommonSchemas.DynamicValue, title: Str.optional() }).strict(),
  css`
    :host { display: block; min-width: 0; }
    figure { margin: 0; display: grid; gap: var(--space-2, 8px); }
    figcaption { font: 600 var(--font-size-xs)/1.2 var(--font-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--color-text-muted); }
    ol { list-style: none; margin: 0; padding: 0; display: flex; align-items: flex-end; gap: 2px; height: 104px; }
    li { flex: 1 1 0; min-width: 0; max-width: 64px; height: 100%; display: grid; grid-template-rows: auto 1fr auto; align-items: end; gap: 2px; text-align: center; }
    .v { font: var(--font-size-xs)/1.2 var(--font-mono); color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
    .bar { display: block; align-self: end; min-height: 4px; background: var(--color-primary-soft); border: 1px solid var(--color-border); border-bottom: 0; border-radius: 4px 4px 0 0; }
    .d { font-size: var(--font-size-xs); color: var(--color-text-muted); border-top: 1px solid var(--color-border); padding-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    li.now .bar { background: var(--color-primary); border-color: var(--color-primary); }
    li.now .v, li.now .d { color: var(--color-text); font-weight: 600; }`,
  (p) => {
    const days = (Array.isArray(p.days) ? p.days : []).filter((d) => d && typeof d === 'object' && Number.isFinite(Number(d.value))).slice(-14);
    if (days.length < 3) return nothing;
    const max = Math.max(1, ...days.map((d) => Math.max(0, Number(d.value))));
    const said = (d) => String(d.text ?? d.value);
    return html`<figure aria-label="${p.title ?? 'By day'}: ${days.map((d) => `${d.label ?? ''} ${said(d)}`).join(', ')}">
      ${p.title ? html`<figcaption>${p.title}</figcaption>` : nothing}
      <ol>${days.map((d, i) => html`<li class="${i === days.length - 1 ? 'now' : ''}" title="${d.label ?? ''}: ${said(d)}">
        <span class="v">${said(d)}</span>
        <span class="bar" style="height: ${Math.max(4, Math.round((Math.max(0, Number(d.value)) / max) * 100))}%"></span>
        <span class="d">${d.label ?? ''}</span>
      </li>`)}</ol>
    </figure>`;
  });

// The notebook's TL;DR picture (its own data as one image, as last redrawn). It links to where it's redrawn and
// downloaded. With no browser on the dashboard's machine to make it, there's no image: the part hides itself.
const Picture = define('Picture', 'sua-a2ui-picture',
  Common.extend({ picture: CommonSchemas.DynamicValue, caption: Str.optional() }).strict(),
  css`
    :host { display: block; }
    figure { margin: 0; }
    a.pic { display: inline-block; max-width: 100%; }
    /* Never taller than about half a screen: a square or tall picture at the column's full width would push the page a screen down. A wide one still fills the width. */
    img { display: block; max-width: 100%; max-height: min(60vh, 520px); width: auto; height: auto; border: 1px solid var(--color-border); border-radius: var(--radius-md, 8px); background: var(--color-surface); }
    a.pic:hover img, a.pic:focus-visible img { border-color: var(--color-primary); }
    figcaption { margin-top: 6px; font-size: var(--font-size-xs); color: var(--color-text-muted); }`,
  (p) => {
    const pic = p.picture && typeof p.picture === 'object' ? p.picture : {};
    const src = safeUrl(pic.src);
    if (!src) return nothing;
    const href = safeUrl(pic.href);
    const hide = (e) => { const f = e.target.closest('figure'); if (f) f.hidden = true; };
    const img = html`<img src=${src} alt=${typeof pic.alt === 'string' ? pic.alt : ''} loading="lazy" @error=${hide}>`;
    const cap = p.caption ?? pic.caption;
    const title = typeof pic.title === 'string' && pic.title ? pic.title : 'Redraw or download this picture';
    return html`<figure>${href ? html`<a class="pic" href=${href} title=${title}>${img}</a>` : img}${cap ? html`<figcaption>${cap}</figcaption>` : nothing}</figure>`;
  });

/** A field's numeric value: a number, a numeric string ("4.4 %", "$5,000"), or a range's midpoint. */
function fieldNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (v && typeof v === 'object' && typeof v.min === 'number' && typeof v.max === 'number') return (v.min + v.max) / 2;
  if (typeof v === 'string') { const n = Number(v.replace(/[$,%\s]/g, '').replace(/[a-zA-Z]+$/, '')); return Number.isFinite(n) && v.trim() !== '' ? n : undefined; }
  return undefined;
}

// Options as horizontal bars by one numeric field (APY by account, salary by
// role, price by listing): code sorts, formats and marks the best; the page
// only names the field. Ruled-out options are left out.
const Bars = define('Bars', 'sua-a2ui-bars',
  Common.extend({ options: CommonSchemas.DynamicValue, fields: CommonSchemas.DynamicValue.optional(), by: z.string().min(1).max(64), top: z.number().int().min(2).max(20).optional(), label: z.string().max(64).optional(), empty: Str.optional() }).strict(),
  css`
    :host { display: block; }
    .bars { display: grid; gap: 8px; }
    .row { display: grid; grid-template-columns: minmax(6rem, 32%) minmax(0, 1fr); gap: 10px; align-items: center; }
    .lab { font-size: var(--font-size-sm); font-weight: 600; color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .lab a { color: inherit; text-decoration: none; } .lab a:hover { text-decoration: underline; }
    .track { position: relative; height: 24px; border-radius: 4px; background: var(--color-surface-raised); }
    .bar { position: absolute; top: 0; bottom: 0; left: 0; border-radius: 4px; background: var(--color-text-muted); opacity: .55; }
    .best .bar { background: var(--color-primary); opacity: 1; }
    .val { position: absolute; top: 50%; transform: translateY(-50%); font: 600 var(--font-size-xs)/1 var(--font-mono); color: var(--color-text); white-space: nowrap; }
    .val.in { color: var(--color-surface); }
    .best .lab { color: var(--color-primary); }
    .foot { margin: 8px 0 0; font-size: var(--font-size-xs); color: var(--color-text-muted); }
    .empty { margin: 0; font-size: var(--font-size-sm); color: var(--color-text-muted); }`,
  (p) => {
    const fields = Array.isArray(p.fields) ? p.fields : [];
    const f = fields.find((x) => x && x.key === p.by);
    const rows = (Array.isArray(p.options) ? p.options : []).filter((o) => o && !o.ruledOut)
      .map((o) => ({ o, n: fieldNumber(getPath(o, `fields.${p.by}`) ?? o[p.by]), raw: getPath(o, `fields.${p.by}`) ?? o[p.by] }))
      .filter((r) => r.n !== undefined);
    if (!rows.length) return html`<p class="empty">${p.empty ?? `Nothing to draw yet: options need ${f?.label ?? p.by}.`}</p>`;
    const lower = f?.better === 'lower' || (!f?.better && f?.role === 'price');
    rows.sort((a, b) => (lower ? a.n - b.n : b.n - a.n));
    const shown = rows.slice(0, p.top ?? 8);
    const max = Math.max(...rows.map((r) => r.n), 0);
    const fmt = (r) => (f ? fmtField(f, r.raw) : typeof r.raw === 'string' ? r.raw : nfmt(r.n));
    const name = (o) => (p.label ? String(getPath(o, p.label) ?? o.name ?? '') : o.name ?? o.title ?? '');
    return html`<div class="bars" role="list">${shown.map((r, i) => { const w = max > 0 ? Math.max(2, (r.n / max) * 100) : 0; const inside = w > 60; return html`<div class="row ${i === 0 ? 'best' : ''}" role="listitem"><div class="lab">${r.o.page ? outLink(r.o.page, name(r.o)) : name(r.o)}</div><div class="track"><div class="bar" style=${`width:${w}%`}></div><span class=${inside ? 'val in' : 'val'} style=${inside ? `right:${100 - w}%;margin-right:8px` : `left:${w}%;margin-left:6px`}>${fmt(r)}</span></div></div>`; })}</div>
      ${rows.length > shown.length ? html`<p class="foot">${shown.length} of ${rows.length}, ${lower ? 'lowest' : 'highest'} ${f?.label ?? p.by} first.</p>` : html`<p class="foot">${lower ? 'Lowest' : 'Highest'} ${f?.label ?? p.by} first.</p>`}`;
  });

// Two or three options side by side, their facts ruled line by line: the top
// ones as the notebook ranks them (or by one field), so a reader can see the
// choice at a glance.
const Compare = define('Compare', 'sua-a2ui-compare',
  Common.extend({ options: CommonSchemas.DynamicValue, fields: CommonSchemas.DynamicValue.optional(), top: z.number().int().min(2).max(3).optional(), by: z.string().max(64).optional(), facts: z.array(z.string().max(64)).max(8).optional(), empty: Str.optional() }).strict(),
  css`
    :host { display: block; }
    .wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: var(--font-size-sm); line-height: 1.45; table-layout: fixed; }
    th { text-align: left; vertical-align: bottom; padding: 0 12px 8px 0; border-bottom: 2px solid var(--color-text); }
    th.k { width: 28%; }
    th .nm { font: 700 var(--font-size-md, 15px)/1.3 var(--font-mono); color: var(--color-text); }
    th .nm a { color: inherit; text-decoration: none; } th .nm a:hover { text-decoration: underline; }
    th .sub { display: block; font: 400 var(--font-size-xs)/1.3 var(--font-mono); color: var(--color-text-muted); margin-top: 2px; }
    td { vertical-align: top; padding: 8px 12px 8px 0; border-bottom: 1px solid var(--color-border); color: var(--color-text); overflow-wrap: anywhere; }
    td.k { font: 600 11px/1.4 var(--font-mono); text-transform: uppercase; letter-spacing: .06em; color: var(--color-text-muted); }
    tr:last-child td { border-bottom: 0; }
    .empty { margin: 0; font-size: var(--font-size-sm); color: var(--color-text-muted); }`,
  (p) => {
    const fields = (Array.isArray(p.fields) ? p.fields : []).filter((f) => f && f.key);
    let opts = (Array.isArray(p.options) ? p.options : []).filter((o) => o && !o.ruledOut);
    if (p.by) {
      const f = fields.find((x) => x.key === p.by);
      const lower = f?.better === 'lower' || (!f?.better && f?.role === 'price');
      opts = opts.map((o) => ({ o, n: fieldNumber(getPath(o, `fields.${p.by}`)) })).filter((r) => r.n !== undefined).sort((a, b) => (lower ? a.n - b.n : b.n - a.n)).map((r) => r.o);
    }
    const shown = opts.slice(0, p.top ?? 2);
    if (shown.length < 2) return html`<p class="empty">${p.empty ?? 'Nothing to compare yet: it takes two options.'}</p>`;
    // The facts to show: the ones named, else every field that's not a link or a long text, that at least one of them has.
    const keys = (Array.isArray(p.facts) && p.facts.length ? p.facts : fields.filter((f) => f.type !== 'url' && f.type !== 'image' && f.role !== 'quote').map((f) => f.key))
      .filter((k) => shown.some((o) => { const v = getPath(o, `fields.${k}`); return v !== undefined && v !== null && v !== ''; }));
    const fmt = (k, v) => { const f = fields.find((x) => x.key === k); return v === undefined || v === null || v === '' ? '—' : f ? fmtField(f, v) : String(v); };
    return html`<div class="wrap"><table><thead><tr><th class="k"></th>${shown.map((o) => html`<th><span class="nm">${o.page ? outLink(o.page, o.name ?? o.title ?? '') : (o.name ?? o.title ?? '')}</span>${o.org || o.place ? html`<span class="sub">${o.org ?? o.place}</span>` : nothing}</th>`)}</tr></thead>
      <tbody>${keys.map((k) => html`<tr><td class="k">${fields.find((x) => x.key === k)?.label ?? k}</td>${shown.map((o) => html`<td>${fmt(k, getPath(o, `fields.${k}`))}</td>`)}</tr>`)}</tbody></table></div>`;
  });

// A notebook page's header is drawn by the page itself (its buttons are forms
// the page's scripts handle); in the layout it only says how. Nothing here.
const NotebookHeader = define('NotebookHeader', 'sua-a2ui-notebook-header',
  Common.extend({ cover: z.enum(['lead', 'none']).optional(), subtitle: Str.optional(), statement: z.boolean().optional(), steps: z.enum(['show', 'fold']).optional(), side: CommonSchemas.ComponentId.optional() }).strict(),
  css`:host { display: none; }`,
  () => nothing);

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
  .icon-btn { background: none; border: 0; padding: 2px 4px; color: var(--color-text-muted); cursor: pointer; font-size: var(--font-size-sm); line-height: 1; text-decoration: none; border-radius: var(--radius-sm, 4px); }
  .icon-btn:hover, .icon-btn:focus-visible { color: var(--color-text); background: var(--color-surface-raised); outline: none; }
  form { display: inline; margin: 0; }
  .body { flex: 1; min-width: 0; overflow: auto; }
  .note { color: var(--color-text-muted); font-size: var(--font-size-sm); margin: 0; }
  footer { display: flex; align-items: center; gap: 8px; border-top: 1px solid var(--color-border); margin-top: 10px; padding-top: 8px; font-size: var(--font-size-xs); }
  footer .agent { font-family: var(--font-mono); color: var(--color-primary); text-decoration: none; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .age { margin-left: auto; color: var(--color-text-muted); text-decoration: none; white-space: nowrap; }
  footer .change { color: var(--color-text-muted); text-decoration: none; white-space: nowrap; }
  footer .change:hover, footer .change:focus-visible { color: var(--color-primary); text-decoration: underline; }
  .run { font: inherit; font-size: var(--font-size-xs); padding: 3px 10px; border-radius: var(--radius-sm, 4px); border: 0; background: var(--color-primary); color: var(--color-bg); cursor: pointer; text-decoration: none; white-space: nowrap; }
  .run[disabled] { opacity: .6; cursor: default; }
  .err { color: var(--color-err); }
  .tile { position: relative; }
  .pick { position: absolute; inset: -1px; z-index: 2; background: transparent; border: 2px dashed var(--color-border-strong); border-radius: var(--radius-md, 8px); cursor: pointer; }
  .pick:hover, .pick:focus-visible { border-color: var(--color-primary); outline: none; }
  .tile.selected .pick { border: 2px solid var(--color-primary); background: color-mix(in srgb, var(--color-primary) 8%, transparent); }
  /* chrome: bare (a composed page): no frame, no header; the Panel around it titles it. */
  .tile.bare, .tile.bare[data-accent] { border: 0; background: none; border-radius: 0; padding: 0; min-height: 0; }
  .tile.bare footer { border-top: 0; margin-top: 6px; padding-top: 0; }`;

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

/** The agent tiles on this page by agent id, so a tile's action can run (and refresh) another tile on the same board. */
const agentTiles = new Map();

const AgentTile = define('AgentTile', 'sua-a2ui-agent-tile',
  Common.extend({ agentId: z.string().min(1).max(128), palette: z.string().optional(), chrome: z.string().optional() }).strict(),
  tileStyles,
  function (p) {
    const t = this._entry ?? boardTile(p.agentId);
    if (!t) return html`<div class="tile"><p class="note"><code>${p.agentId}</code> isn't installed, or has no tile.</p></div>`;
    this.wire(p.agentId, t);
    if (!this._body || this._bodyFor !== t) { this._bodyFor = t; this._body = tileBody.call(this, t); }
    const href = `/agents/${encodeURIComponent(p.agentId)}`;
    const bare = p.chrome === 'bare';
    const palette = bare ? undefined : p.palette && p.palette !== 'default' ? p.palette : t.autoPalette;
    const sel = boardEdit.on && boardEdit.selected === selfId(this);
    return html`<div class="tile ${sel ? 'selected' : ''} ${bare ? 'bare' : ''}" data-agent-id=${p.agentId} data-palette=${palette ?? nothing} data-accent=${t.accent ?? nothing}>
      ${boardEdit.on ? html`<button type="button" class="pick" aria-label="Select ${t.title}" aria-pressed=${sel ? 'true' : 'false'} @click=${(e) => selectNode(this, e)}></button>` : nothing}
      ${bare ? nothing : html`<header>
        ${t.icon ? html`<span aria-hidden="true">${t.icon}</span>` : nothing}
        <span class="title" title=${t.title}>${t.title}</span>
        ${t.archived ? html`<a class="archived" href=${href} title="This agent is archived; open it to restore">archived</a>` : nothing}
        ${t.configure ? html`<a class="icon-btn" href=${`${href}/view?redesign=1#redesign`} title="Redesign this widget with sua" aria-label="Redesign ${t.title}">✎</a>` : nothing}
        ${t.configure ? html`<button type="button" class="icon-btn" title="Configure tile" aria-label="Configure ${t.title}" @click=${() => this.configure(p.agentId, t)}>⚙</button>` : nothing}
        ${t.hideAction ? html`<form method="POST" action=${t.hideAction}><button type="submit" class="icon-btn" title="Hide from Pulse (restore it from the hidden section)" aria-label="Hide ${t.title} from Pulse">×</button></form>` : nothing}
      </header>`}
      <div class="body">${this._body}</div>
      <footer>
        <a class="agent" href=${href}>${p.agentId}</a>
        ${this._running ? html`<span class="age">running…</span>` : t.runHref ? html`<a class="age" href=${t.runHref}>${t.age}</a>` : html`<span class="age">${t.age}</span>`}
        ${t.changeHref ? html`<a class="change" href=${t.changeHref} title="Change what it runs with, on the agent's page">Change inputs…</a>` : nothing}
        ${t.run === 'button' ? html`<button type="button" class="run" ?disabled=${this._running} title=${t.runBody ? 'Run it again with the same inputs' : nothing} @click=${() => this.runTile(p.agentId, t.runBody || '')}>Run</button>` : nothing}
        ${t.run === 'link' ? html`<a class="run" href=${href} title="This agent needs input before it can run">Run…</a>` : nothing}
      </footer>
      ${this._error ? html`<p class="note err" role="alert">${this._error}</p>` : nothing}
    </div>`;
  },
  {
    wire(agentId, t) {
      agentTiles.set(agentId, this);
      if (!this._listening) {
        // Run actions from inside the nested surface (forms, "Run again", a
        // table row) run in this tile, or, when the server let the action name
        // another agent placed on this board, in that agent's tile.
        this._listening = true;
        this.addEventListener('a2ui-action', (e) => {
          const a = e.detail || {};
          const c = a.context || {};
          if (a.name !== 'run-agent') return;
          const target = c.agent === agentId ? this : agentTiles.get(c.agent);
          if (!target) return;
          e.stopPropagation();
          const body = new URLSearchParams();
          for (const k of Object.keys(c)) {
            if (!k.startsWith('in_')) continue;
            let v = c[k]; if (Array.isArray(v)) v = v[0];
            if (v !== undefined && v !== null && String(v) !== '') body.append('input_' + k.slice(3), String(v));
          }
          if (target !== this) target.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
          target.runTile(c.agent, body.toString());
        });
      }
      if (t.refreshMs && !this._timer) this._timer = setInterval(() => { if (!this._running && document.visibilityState === 'visible') this.reload(agentId); }, t.refreshMs);
    },
    disconnectedCallback() {
      A2uiLitElement.prototype.disconnectedCallback?.call(this);
      if (this._timer) { clearInterval(this._timer); this._timer = undefined; }
      for (const [id, el] of agentTiles) if (el === this) agentTiles.delete(id);
    },
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
        // A composed page's parts bound to this agent take the new result too.
        this.dispatchEvent(new CustomEvent('sua-board-data-stale', { bubbles: true, composed: true, detail: { agentId } }));
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

// Any chart, from a Vega-Lite spec (ADR-0089): the same component as A2UI's
// vegachart catalog. Vega loads only when a page draws one, and draws CSP-safe
// with nothing fetched (assets/vendor/a2ui-vega.js); colours from the page's tokens.
let vegaModule;
const VegaChart = define('VegaChart', 'sua-a2ui-vega-chart',
  Common.extend({ spec: CommonSchemas.DynamicValue, height: CommonSchemas.DynamicNumber.optional() }).strict(),
  css`
    .chart { width: 100%; min-height: 40px; }
    .chart svg { max-width: 100%; height: auto; }
    .note { font-size: var(--font-size-xs); color: var(--color-text-muted); }`,
  function (p) {
    // A binding inside the spec (data.values: { "@path": "/notebook/options" }) is read from the surface's data here,
    // through its signal, so the chart draws again when that data changes.
    const dc = this.context?.dataContext;
    const resolve = (v) => {
      if (Array.isArray(v)) return v.map(resolve);
      if (!v || typeof v !== 'object') return v;
      const keys = Object.keys(v);
      if (keys.length === 1 && typeof v['@path'] === 'string' && dc) { try { return dc.resolveSignal({ '@path': v['@path'] }).value; } catch { return undefined; } }
      return Object.fromEntries(keys.map((k) => [k, resolve(v[k])]));
    };
    this._spec = p.spec && typeof p.spec === 'object' ? resolve(p.spec) : null;
    return html`<div class="chart" role="img" aria-label="Chart"></div>${this._err ? html`<p class="note">${this._err}</p>` : nothing}`;
  },
  {
    updated() {
      const p = this.controller?.props;
      const el = this.renderRoot.querySelector('.chart');
      if (!p || !el) return;
      const key = JSON.stringify([this._spec, p.height]);
      if (key === this._drawn) return;
      this._drawn = key;
      const spec = this._spec ? JSON.parse(JSON.stringify(this._spec)) : null;
      if (!spec) { this._err = 'No chart to draw.'; this.requestUpdate(); return; }
      const cs = getComputedStyle(this);
      const tok = (n, d) => cs.getPropertyValue(n).trim() || d;
      const ink = tok('--color-text-muted', '#666'), line = tok('--color-border', '#ddd');
      const config = { background: 'transparent', font: tok('--font-sans', 'sans-serif'),
        axis: { domainColor: line, gridColor: line, tickColor: line, labelColor: ink, titleColor: tok('--color-text', '#222') },
        legend: { labelColor: ink, titleColor: tok('--color-text', '#222') }, title: { color: tok('--color-text', '#222') },
        view: { stroke: 'transparent' }, range: { category: [tok('--color-primary', '#0f766e'), '#64748b', '#b45309', '#2563eb', '#be123c', '#4d7c0f'] },
        mark: { color: tok('--color-primary', '#0f766e') } };
      const height = typeof p.height === 'number' ? p.height : 240;
      vegaModule ??= import('/assets/vendor/a2ui-vega.js');
      vegaModule
        .then((m) => { this._view?.finalize?.(); return m.drawVega(el, { width: 'container', height, ...spec, config: { ...config, ...(spec.config ?? {}) } }); })
        .then((res) => { this._view = res?.view; if (this._err) { this._err = ''; this.requestUpdate(); } })
        .catch((e) => { this._err = `This chart couldn't be drawn: ${String(e?.message ?? e).slice(0, 160)}`; this.requestUpdate(); });
    },
    disconnectedCallback() { A2uiLitElement.prototype.disconnectedCallback?.call(this); this._view?.finalize?.(); },
  });

export const suaComponents = [VegaChart, Metric, Badge, KeyValue, Table, Disclosure, Link, Code, Sparkline, Funnel, OptionGrid, Scatter, Columns, Panel, Callout, StatStrip, Steps, Coverage, Checklist, Timeline, ProfileCard, FactSheet, QuoteList, Agenda, Itinerary, AnswerSections, RunbookLesson, Figure, Lead, Bars, Compare, Changes, Stories, NotebookHeader, ChipList, SanitizedHtml, Grid, Cell, Section, AgentTile, SystemTile, Picture, DayBars];
export const suaCatalog = new Catalog(SUA_CATALOG_ID, '1.0',
  [...basicCatalog.components.values(), ...suaComponents],
  // sua's own functions (join, relativeTime, formatRange, count) beside the basic ones (ADR-0087).
  [...basicCatalog.functions.values(), ...suaFunctions(z, CommonSchemas), ...suaAgentFunctions(z, CommonSchemas)]);

/**
 * A call the renderer can't make itself (an agent function, ADR-0088), sent
 * to the dashboard; its answer goes back into the same processor, which draws
 * it. A call it can't answer comes back as an error and draws as nothing.
 */
function askAgent(processor, message) {
  if (!message || !message.callAgentFunction) return;
  const id = message.callAgentFunction.functionCallId;
  fetch('/a2ui/agent-functions', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: JSON.stringify(message) })
    .then((r) => r.json())
    .catch(() => ({ version: '1.0', agentFunctionResponse: { functionCallId: id, error: { code: 'UNAVAILABLE', message: 'The dashboard could not be reached.' } } }))
    .then((answer) => { try { processor.processMessages([answer]); } catch { /* drawn as nothing */ } });
}

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
  }, { outboundListener: (message) => askAgent(processor, message) });
  const el = document.createElement('a2ui-surface');
  processor.onSurfaceCreated((s) => { el.surface = s; });
  // Its components and data as sent (before the processor works on them), so the surface can take a new copy in place (updateSurface).
  const drawn = drawnState(messages);
  try { processor.processMessages(messages); }
  catch (e) {
    host.insertAdjacentHTML('beforeend', `<p class="flash flash--error">This widget couldn't be drawn: ${esc(e.message)}</p>`);
    return;
  }
  host.appendChild(el);
  host._a2ui = { processor, ...drawn };
}

/** What a drawn surface was drawn from: its id, its components by id (as JSON), its data. */
const drawnState = (messages) => ({ surfaceId: surfaceIdOf(messages), byId: new Map(componentsOf(messages).map((c) => [c.id, JSON.stringify(c)])), data: dataOf(messages) });

/**
 * A new copy of a mounted surface, taken in place (A2UI 1.0, ADR-0086): only
 * the components that changed or appeared are sent (updateComponents upserts
 * them by id; one that went is no longer anyone's child), and only the data
 * paths that changed (updateDataModel). Nothing else is redrawn, so a figure
 * keeps its what-if and an open panel stays open. False when it can't be (not
 * mounted, another surface, no root); the caller redraws the whole thing then.
 */
export function updateSurface(host, messages) {
  const kept = host?._a2ui;
  if (!kept || !Array.isArray(messages)) return false;
  const delta = surfaceDelta(kept, messages);
  if (!delta) return false;
  if (delta.messages.length) {
    try { kept.processor.processMessages(delta.messages); } catch { return false; }
  }
  Object.assign(kept, delta.next);
  // How the last update landed (components and data paths sent): for tests and a look in the inspector.
  host.setAttribute('data-a2ui-delta', `${String(delta.changed)}c ${String(delta.paths)}d`);
  return true;
}

export function mountSurfaces(root = document) {
  root.querySelectorAll('[data-a2ui-surface]:not([data-a2ui-mounted])').forEach(mountSurface);
}

mountSurfaces();
// Surfaces added later (a chat reply re-rendered from source) mount themselves.
new MutationObserver(() => mountSurfaces()).observe(document.body, { childList: true, subtree: true });

// A composed board (ADR-0070): its parts bound to /board/... take new data in
// place, fetched on the board's refresh cadence (the shortest of its tiles')
// and after a tile's Run. Parts that appear or go redraw the whole board.
(function watchBoard() {
  const host = document.querySelector('[data-board-canvas][data-board-composed]');
  if (!host) return;
  const ms = Number(host.getAttribute('data-board-refresh-ms') || 0);
  let busy = false;
  async function refresh() {
    if (busy || boardEdit.on || document.visibilityState !== 'visible') return;
    busy = true;
    try {
      const res = await fetch(`/boards/${encodeURIComponent(boardId())}/data.json`);
      if (!res.ok) return;
      const j = await res.json();
      // New tiles join the registry first, so a tile the update adds in place finds what it shows.
      boardTile('');
      Object.assign(boardTiles, j.tiles || {});
      if (!updateSurface(host, j.messages)) remountBoard(host, j.messages, j.tiles);
    } catch { /* next time */ } finally { busy = false; }
  }
  if (ms > 0) setInterval(refresh, ms);
  document.addEventListener('sua-board-data-stale', () => { refresh(); });
})();
window.suaA2ui = { mountSurfaces, updateSurface, suaCatalog };
