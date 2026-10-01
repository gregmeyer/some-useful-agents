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
const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : undefined);

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
    .delta { font-size: var(--font-size-xs); color: var(--color-text-muted); }`,
  (p) => html`<div class="label">${p.label}</div>
    <div class="value ${tone(p.tone)}">${p.value}${p.unit ? html`<span class="unit">${p.unit}</span>` : nothing}</div>
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

const Table = define('Table', 'sua-a2ui-table',
  Common.extend({
    rows: CommonSchemas.DynamicValue,
    columns: z.array(z.object({ key: z.string(), label: z.string(), format: z.enum(['text', 'link']).optional() }).strict()).min(1).max(12),
    maxRows: z.number().int().min(1).max(200).optional(),
  }).strict(),
  css`
    :host { overflow-x: auto; }
    table { border-collapse: collapse; width: 100%; font-size: var(--font-size-sm); }
    th { text-align: left; font-weight: 500; color: var(--color-text-muted); font-size: var(--font-size-xs); text-transform: uppercase; letter-spacing: .04em; }
    th, td { padding: 6px 8px; border-bottom: 1px solid var(--color-border); vertical-align: top; overflow-wrap: anywhere; }`,
  (p) => {
    const rows = (Array.isArray(p.rows) ? p.rows : []).slice(0, p.maxRows ?? 50);
    const cell = (row, col) => {
      const v = row?.[col.key];
      if (col.format === 'link') { const u = safeUrl(v); return u ? html`<a href="${u}" target="_blank" rel="noopener noreferrer">${u.replace(/^https?:\/\//, '')}</a>` : String(v ?? ''); }
      return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    };
    return html`<table><thead><tr>${p.columns.map((c) => html`<th>${c.label}</th>`)}</tr></thead>
      <tbody>${rows.map((r) => html`<tr>${p.columns.map((c) => html`<td>${cell(r, c)}</td>`)}</tr>`)}</tbody></table>`;
  });

const Link = define('Link', 'sua-a2ui-link',
  Common.extend({ text: Str, url: Str }).strict(),
  css`:host { display: inline; }`,
  (p) => { const u = safeUrl(p.url); return u ? html`<a href="${u}" target="_blank" rel="noopener noreferrer">${p.text}</a>` : html`<span>${p.text}</span>`; });

const Code = define('Code', 'sua-a2ui-code',
  Common.extend({ text: Str, language: z.string().max(32).optional() }).strict(),
  css`pre { margin: 0; padding: 8px; background: var(--color-surface-raised); border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: var(--font-size-xs); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 20rem; overflow: auto; }`,
  (p) => html`<pre>${p.text}</pre>`);

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

export const suaComponents = [Metric, Badge, KeyValue, Table, Link, Code, SanitizedHtml];
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
