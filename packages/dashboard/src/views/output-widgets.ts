/**
 * Output widget SSR renderers. Each widget type gets a renderer that takes
 * the agent's OutputWidgetSchema + run output text and returns SafeHtml.
 *
 * Widget types:
 *   - diff-apply: classification badge, side-by-side diff, action buttons
 *   - key-value: labeled stats grid
 *   - raw: pre-formatted output with field extraction
 */

import type { OutputWidgetSchema, WidgetControl, WidgetField, AgentInputSpec } from '@some-useful-agents/core';
import { sanitizeHtml, substitutePlaceholders } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from './html.js';

/**
 * URL-driven state for a widget's interactive controls. Threaded from the
 * route handlers (run-detail, agent overview) which read query params and
 * pass them through. Pulse tiles + home widgets don't pass this — they
 * render in static mode (no controls row, all fields visible).
 */
export interface WidgetControlState {
  /** Active `view-switch` view id (from ?wv=); when absent, the control's `default` is used. */
  view?: string;
  /** Field names hidden via `?wh=csv`. Already-parsed by the caller. */
  hiddenFields?: ReadonlySet<string>;
  /**
   * Sort instructions keyed by control `field`. From `?ws_<field>=<col>-<asc|desc>`.
   * Per-field so a widget with multiple `sort` controls (e.g. one for `daily`
   * and one for `models`) keeps independent state — without this, the same
   * `?ws=` would apply to every control that recognised the column.
   */
  sort?: ReadonlyMap<string, { column: string; direction: 'asc' | 'desc' }>;
  /** Filter queries keyed by control `field`. From `?wf_<field>=<query>`. */
  filter?: ReadonlyMap<string, string>;
  /** 1-based page indices keyed by control `field`. From `?wp_<field>=<n>`. */
  page?: ReadonlyMap<string, number>;
}

/**
 * Extract a field value from run output text. Supports three extraction
 * modes, in order:
 *
 *   1. XML tags: `<fieldName>value</fieldName>` (used by agent-analyzer).
 *   2. Whole-output JSON: `JSON.parse(output)` succeeds and the field is
 *      a top-level key (or found via shallow deep search for branch-node
 *      `{ merged: { nodeId: { field } } }` shapes).
 *   3. Embedded trailing JSON: the agent emitted human prose followed by
 *      a JSON object as the last block. Common shape for claude-code
 *      summarisers that want both a human-readable run.result AND
 *      machine-readable widget fields.
 *
 * Exported for direct testing; widgets call `extractFields` which loops
 * over a schema's declared fields.
 */
export function extractField(output: string, fieldName: string): string | undefined {
  // Try XML tag extraction first (used by agent-analyzer).
  const tagMatch = output.match(new RegExp(`<${fieldName}>([\\s\\S]*?)</${fieldName}>`, 'i'));
  if (tagMatch) return tagMatch[1].trim();

  const parsed = parseJsonFromOutput(output);
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (fieldName in record) {
      const val = record[fieldName];
      return typeof val === 'string' ? val : JSON.stringify(val, null, 2);
    }
    const found = deepFind(record, fieldName);
    if (found !== undefined) {
      return typeof found === 'string' ? found : JSON.stringify(found, null, 2);
    }
  }

  return undefined;
}

/**
 * Try to recover a JSON object from the run output. Strategies, in order:
 *   - Strict `JSON.parse(output)` — fast path for pure-JSON agents.
 *   - Trailing-object scan: walk every `{` position from rightmost to
 *     leftmost, slicing to the last `}`; the first slice that parses
 *     wins. This finds the agent's final emitted JSON object even when
 *     human prose precedes it.
 *
 * Returns the parsed object, or `undefined` when no JSON is recoverable.
 * Limited to a few-KB outputs by construction — agent run output today
 * is bounded by the output-framing layer.
 */
function parseJsonFromOutput(output: string): unknown {
  // Fast path: the whole thing is JSON.
  try {
    const parsed = JSON.parse(output);
    if (parsed !== null && typeof parsed === 'object') return parsed;
  } catch { /* fall through */ }

  // Embedded JSON: find the rightmost balanced object whose `}` is the
  // last `}` in the text. Walking `{` from rightmost to leftmost gives
  // the smallest trailing object first — preferred so we don't accidentally
  // engulf earlier prose that happens to contain `{` characters.
  const lastClose = output.lastIndexOf('}');
  if (lastClose === -1) return undefined;
  let openPos = output.lastIndexOf('{', lastClose);
  while (openPos !== -1) {
    try {
      const candidate = JSON.parse(output.slice(openPos, lastClose + 1));
      if (candidate !== null && typeof candidate === 'object') return candidate;
    } catch { /* try the next `{` to the left */ }
    if (openPos === 0) break;
    openPos = output.lastIndexOf('{', openPos - 1);
  }
  return undefined;
}

/**
 * Recursively search an object for a field name. Returns the first match
 * found via breadth-first traversal. Handles { merged: { nodeId: { field } } }
 * patterns from branch nodes.
 */
function deepFind(obj: unknown, field: string, depth = 0): unknown {
  if (depth > 4 || obj === null || obj === undefined) return undefined;
  if (typeof obj !== 'object') return undefined;
  const record = obj as Record<string, unknown>;
  // Check this level.
  if (field in record) return record[field];
  // Search children.
  for (const val of Object.values(record)) {
    if (typeof val === 'object' && val !== null) {
      const found = deepFind(val, field, depth + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

// ── array-data controls (sort / filter / paginate) ────────────────────

/**
 * Metadata produced by `applyControlsToArrayData` — fed to the controls-row
 * renderer so it can show "Page 2 of 7" / display the effective sort etc.
 * Keyed by the array field name (the `field` on each sort/filter/paginate
 * control). Fields that lack a particular control kind are simply absent
 * from that map.
 */
interface ArrayControlMetadata {
  pageInfo: Map<string, { totalAfterFilter: number; pageCount: number; currentPage: number; pageSize: number }>;
  appliedSort: Map<string, { column: string; direction: 'asc' | 'desc' } | null>;
  appliedFilter: Map<string, string>;
}

/**
 * Apply sort / filter / paginate controls to top-level arrays in the
 * substitution map. Mutates `outputs` in place — the named array is
 * replaced with its filtered+sorted+paged copy. Idempotent: re-running
 * with the same state produces the same result.
 *
 * Order per field: filter → sort → paginate. Filter first so page count
 * reflects the visible (filtered) set; sort before paginate so pagination
 * is consistent with the current order.
 */
function applyControlsToArrayData(
  outputs: Record<string, unknown>,
  schema: OutputWidgetSchema,
  state: WidgetControlState,
): ArrayControlMetadata {
  const pageInfo: ArrayControlMetadata['pageInfo'] = new Map();
  const appliedSort: ArrayControlMetadata['appliedSort'] = new Map();
  const appliedFilter: ArrayControlMetadata['appliedFilter'] = new Map();

  // Group controls by their target field so a single per-field pass can
  // run filter → sort → paginate in the right order regardless of the
  // controls' declaration order in the schema.
  type ArrayCtrl = Extract<WidgetControl, { type: 'sort' | 'filter' | 'paginate' }>;
  const byField = new Map<string, { sort?: Extract<ArrayCtrl, { type: 'sort' }>; filter?: Extract<ArrayCtrl, { type: 'filter' }>; paginate?: Extract<ArrayCtrl, { type: 'paginate' }> }>();
  for (const c of schema.controls ?? []) {
    if (c.type === 'sort' || c.type === 'filter' || c.type === 'paginate') {
      const entry = byField.get(c.field) ?? {};
      // Assignment to a discriminated-union prop keyed by `c.type` —
      // narrow via the runtime check above; TS can't follow the dynamic key.
      (entry as Record<string, unknown>)[c.type] = c;
      byField.set(c.field, entry);
    }
  }

  for (const [field, controls] of byField) {
    const arr = outputs[field];
    if (!Array.isArray(arr)) continue;
    let working: unknown[] = arr.slice();

    // 1. Filter
    if (controls.filter) {
      const raw = (state.filter?.get(field) ?? '').trim();
      appliedFilter.set(field, raw);
      if (raw.length > 0) {
        const q = raw.toLowerCase();
        const cols = controls.filter.columns;
        working = working.filter((row) => {
          if (!row || typeof row !== 'object') return false;
          const rec = row as Record<string, unknown>;
          for (const col of cols) {
            const v = rec[col];
            if (v != null && String(v).toLowerCase().includes(q)) return true;
          }
          return false;
        });
      }
    }

    // 2. Sort
    if (controls.sort) {
      const eff = effectiveSort(state.sort?.get(field), controls.sort);
      appliedSort.set(field, eff);
      if (eff) working = stableSortByColumn(working, eff.column, eff.direction);
    }

    // 3. Paginate
    if (controls.paginate) {
      const pageSize = controls.paginate.pageSize;
      const total = working.length;
      const pageCount = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.max(1, Math.min(state.page?.get(field) ?? 1, pageCount));
      pageInfo.set(field, { totalAfterFilter: total, pageCount, currentPage: page, pageSize });
      const start = (page - 1) * pageSize;
      working = working.slice(start, start + pageSize);
    }

    outputs[field] = working;
  }

  return { pageInfo, appliedSort, appliedFilter };
}

/**
 * Resolve the effective sort instruction for a single field. URL state
 * wins when it picks a valid column; otherwise fall back to the control's
 * `default` string (parsed as `"<column>"` or `"<column> ASC|DESC"`).
 */
function effectiveSort(
  stateSort: { column: string; direction: 'asc' | 'desc' } | undefined,
  control: Extract<WidgetControl, { type: 'sort' }>,
): { column: string; direction: 'asc' | 'desc' } | null {
  if (stateSort && control.columns.includes(stateSort.column)) return stateSort;
  if (control.default) {
    const m = /^([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(asc|desc))?$/i.exec(control.default.trim());
    if (m && control.columns.includes(m[1])) {
      return { column: m[1], direction: ((m[2] ?? 'asc').toLowerCase() as 'asc' | 'desc') };
    }
  }
  return null;
}

/**
 * Try to read a value as a number, stripping common formatting decoration
 * that agent templates produce for display:
 *   - currency prefixes: `$`, `€`, `£`, `¥`
 *   - percent suffix: `%`
 *   - thousands separators: `,`
 *   - whitespace
 *
 * Returns `null` when the value can't be reduced to a plain number — that
 * signals "not numeric in this column" to the caller, which then falls
 * back to string sort. SI suffixes (`K`/`M`/`B`/`T`) are deliberately
 * NOT handled here — they imply magnitude logic that needs intentional
 * design. Agents that want SI-formatted display + numeric sort should
 * surface a parallel `<col>_raw` numeric column.
 */
function tryAsNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed === '') return null;
  // Strip $/€/£/¥, %, and thousands commas. Single regex so the order
  // of decoration doesn't matter ("$1,234.5%" → "1234.5").
  const stripped = trimmed.replace(/[$€£¥%,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(stripped)) return null;
  return Number(stripped);
}

/**
 * Stable sort an array of row-objects by one of their columns. Type per
 * column is inferred from the actual values: if every non-null cell
 * parses as a number (via `tryAsNumber`, which understands common
 * formatting like `$1,234.56` and `42%`), sort numerically. Otherwise
 * case-insensitive locale-string. Nulls / undefineds sort last regardless
 * of direction.
 */
function stableSortByColumn(rows: unknown[], col: string, dir: 'asc' | 'desc'): unknown[] {
  const sign = dir === 'desc' ? -1 : 1;
  const valuesByIndex = rows.map((r) =>
    r && typeof r === 'object' ? (r as Record<string, unknown>)[col] : undefined,
  );
  // Treat the column as numeric only if every non-null cell parses as a
  // number — a single un-parseable cell forces string sort to keep the
  // ordering well-defined.
  const numericByIndex = valuesByIndex.map((v) => tryAsNumber(v));
  const allNumeric = valuesByIndex.every(
    (v, i) => v === null || v === undefined || numericByIndex[i] !== null,
  );
  const indexed = rows.map((row, i) => ({ row, i, v: valuesByIndex[i], n: numericByIndex[i] }));
  indexed.sort((a, b) => {
    const aNil = a.v === null || a.v === undefined;
    const bNil = b.v === null || b.v === undefined;
    if (aNil && bNil) return a.i - b.i;
    if (aNil) return 1;
    if (bNil) return -1;
    if (allNumeric) {
      const an = a.n!;
      const bn = b.n!;
      if (an < bn) return -1 * sign;
      if (an > bn) return 1 * sign;
      return a.i - b.i;
    }
    const cmp = String(a.v).localeCompare(String(b.v), undefined, { sensitivity: 'base' });
    return cmp !== 0 ? cmp * sign : a.i - b.i;
  });
  return indexed.map((e) => e.row);
}

/**
 * Extract all declared fields from run output.
 */
function extractFields(
  output: string,
  schema: OutputWidgetSchema,
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const field of schema.fields ?? []) {
    result[field.name] = extractField(output, field.name);
  }
  return result;
}

/**
 * Render a file preview iframe for a 'preview' field type. The value should
 * be a file path that gets served via GET /output-file?path=<path>.
 */
function renderPreview(label: string, filePath: string): SafeHtml {
  if (!filePath) return html`<p class="dim" style="font-size: var(--font-size-xs);">No file path</p>`;
  const encodedPath = encodeURIComponent(filePath);
  const lower = filePath.toLowerCase();
  const isImage = /\.(png|jpe?g|gif|svg|webp|bmp)$/.test(lower);

  const header = html`
    <div style="display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-2);">
      <h4 style="font-size: var(--font-size-xs); color: var(--color-text-muted); margin: 0;">${label}</h4>
      <a href="/output-file?path=${encodedPath}" target="_blank" rel="noopener" style="font-size: var(--font-size-xs); color: var(--color-primary);">Open in tab \u2197</a>
    </div>
  `;

  if (isImage) {
    return html`
      <section style="margin-bottom: var(--space-3);">
        ${header}
        <img src="/output-file?path=${encodedPath}" alt="${label}" style="max-width: 100%; border-radius: var(--radius-sm); border: 1px solid var(--color-border);" loading="lazy">
      </section>
    `;
  }

  return html`
    <section style="margin-bottom: var(--space-3);">
      ${header}
      <iframe src="/output-file?path=${encodedPath}" sandbox="allow-same-origin" style="width: 100%; height: 400px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: #fff;"></iframe>
    </section>
  `;
}

/**
 * Resolve which fields should be visible given the widget's controls and the
 * URL-driven state. Order: start with declared fields → if a view-switch is
 * active, intersect with that view's `fields[]` → drop any field hidden via
 * `field-toggle`. Returns a (possibly narrower) clone of the schema; never
 * mutates the input.
 */
function applyControlsToFields(
  schema: OutputWidgetSchema,
  state?: WidgetControlState,
): OutputWidgetSchema {
  if (!schema.controls?.length || !schema.fields) return schema;

  const allFieldNames = new Set(schema.fields.map((f) => f.name));
  let visible: Set<string> = new Set(allFieldNames);

  for (const c of schema.controls) {
    if (c.type === 'view-switch') {
      const activeId = state?.view ?? c.default;
      const activeView = c.views.find((v) => v.id === activeId) ?? c.views.find((v) => v.id === c.default);
      if (activeView) {
        visible = new Set([...visible].filter((n) => activeView.fields.includes(n)));
      }
    }
  }

  // field-toggle: when ?wh is present in the URL (even as ?wh=), it is
  // authoritative — exactly the listed fields are hidden, all others shown.
  // Absent ?wh = per-control defaults apply.
  const hiddenFromDefaults = new Set<string>();
  for (const c of schema.controls) {
    if (c.type === 'field-toggle' && c.default === 'hidden') {
      for (const n of c.fields) hiddenFromDefaults.add(n);
    }
  }
  const hidden = state?.hiddenFields !== undefined ? state.hiddenFields : hiddenFromDefaults;
  for (const n of hidden) visible.delete(n);

  const filteredFields: WidgetField[] = schema.fields.filter((f) => visible.has(f.name));
  return { ...schema, fields: filteredFields };
}

/**
 * Render a widget from an agent's outputWidget schema and run output.
 * Returns undefined if the schema type is unknown.
 *
 * `controlState` (4th arg) is opt-in: when provided, the widget renders an
 * interactive controls row above the body and applies URL-driven view /
 * field-toggle filtering. Callers that pass nothing get the static render.
 */
export function renderOutputWidget(
  schema: OutputWidgetSchema,
  output: string,
  agentId: string,
  controlState?: WidgetControlState,
  /**
   * The agent's declared input specs. Threaded through so the inline replay
   * form can pre-fill `default` values and render `<select>` for enum/boolean
   * types instead of a bare text input. Also drives default-replay synthesis
   * (when no replay control is declared, one is wired with these input names
   * so authors don't have to remember the boilerplate).
   * Pulse / home tiles pass no `controlState` and so still render in static
   * mode regardless.
   */
  agentInputs?: Record<string, AgentInputSpec>,
): SafeHtml | undefined {
  // ai-template widgets render their own layout via the stored template;
  // field-toggle / view-switch don't apply (rejected at schema time). Only
  // the body+optional replay control row are emitted.
  const filtered = schema.type === 'ai-template' ? schema : applyControlsToFields(schema, controlState);
  const fields = extractFields(output, filtered);

  let body: SafeHtml | undefined;
  let arrayMeta: ArrayControlMetadata | undefined;
  switch (filtered.type) {
    case 'diff-apply':
      body = renderDiffApply(filtered, fields, agentId);
      break;
    case 'key-value':
      body = renderKeyValue(filtered, fields);
      break;
    case 'raw':
      body = renderRaw(filtered, fields);
      break;
    case 'dashboard':
      body = renderDashboard(filtered, fields);
      break;
    case 'ai-template': {
      const r = renderAiTemplate(filtered, output, fields, controlState);
      body = r.body;
      arrayMeta = r.metadata;
      break;
    }
    default:
      return undefined;
  }

  if (!controlState) return body;
  const effectiveSchema = ensureReplayControl(schema, agentInputs);
  if (!effectiveSchema.controls?.length) return body;
  const controlsRow = renderControlsRow(effectiveSchema, agentId, controlState, agentInputs, arrayMeta);
  return html`${controlsRow}${body}`;
}

/**
 * Return the schema unchanged when it already has a `replay` control or
 * when the caller didn't supply input specs to wire one with. Otherwise
 * return a shallow copy with a synthesised replay control prepended so
 * every detail-page widget gets a Re-run button for free.
 */
function ensureReplayControl(
  schema: OutputWidgetSchema,
  agentInputs: Record<string, AgentInputSpec> | undefined,
): OutputWidgetSchema {
  const hasReplay = schema.controls?.some((c) => c.type === 'replay');
  if (hasReplay) return schema;
  const inputNames = agentInputs ? Object.keys(agentInputs) : [];
  const synthesized: WidgetControl = {
    type: 'replay',
    label: 'Run again',
    inputs: inputNames.length > 0 ? inputNames : undefined,
  };
  return { ...schema, controls: [synthesized, ...(schema.controls ?? [])] };
}

/**
 * Render the controls row above a widget body. URL-param-driven; every
 * interaction is a full page reload via <a> or a POST <form>. No client JS.
 */
function renderControlsRow(
  schema: OutputWidgetSchema,
  agentId: string,
  state: WidgetControlState,
  agentInputs?: Record<string, AgentInputSpec>,
  arrayMeta?: ArrayControlMetadata,
): SafeHtml {
  const controls = schema.controls ?? [];
  const groups = controls.map((c) => {
    if (c.type === 'replay') return renderReplayControl(c, agentId, agentInputs);
    if (c.type === 'view-switch') return renderViewSwitchControl(c, state);
    if (c.type === 'field-toggle') return renderFieldToggleControl(c, schema, state);
    if (c.type === 'sort') return renderSortControl(c, state, arrayMeta);
    if (c.type === 'filter') return renderFilterControl(c, state, arrayMeta);
    if (c.type === 'paginate') return renderPaginateControl(c, state, arrayMeta);
    return html``;
  });
  // Classes are intentionally minimal — appearance is owned by the
  // dashboard's default widget-controls CSS plus any agent <style> block
  // that wants to restyle. See packages/dashboard/src/assets/components.css
  // for the full class catalogue.
  return html`
    <div class="wc-row" data-widget-control-row="">
      ${groups as unknown as SafeHtml[]}
    </div>
  `;
}

function renderReplayControl(
  c: Extract<WidgetControl, { type: 'replay' }>,
  agentId: string,
  agentInputs?: Record<string, AgentInputSpec>,
): SafeHtml {
  const label = c.label ?? 'Run again';
  const inlineInputs = (c.inputs ?? []).map((name) => {
    const spec = agentInputs?.[name];
    const defVal = spec?.default !== undefined ? String(spec.default) : '';
    let inputEl: SafeHtml;
    if (spec?.type === 'enum' && Array.isArray(spec.values) && spec.values.length > 0) {
      const options = spec.values.map((v) => {
        const val = String(v);
        const selected = val === defVal ? ' selected' : '';
        return `<option value="${val}"${selected}>${val}</option>`;
      });
      inputEl = unsafeHtml(`<select class="wc-input" name="input_${name}">${options.join('')}</select>`);
    } else if (spec?.type === 'boolean') {
      inputEl = unsafeHtml(
        `<select class="wc-input" name="input_${name}">` +
        `<option value="true"${defVal === 'true' ? ' selected' : ''}>true</option>` +
        `<option value="false"${defVal !== 'true' ? ' selected' : ''}>false</option>` +
        `</select>`
      );
    } else {
      inputEl = html`<input class="wc-input wc-input--text" type="text" name="input_${name}" value="${defVal}" placeholder="${defVal || '(empty)'}">`;
    }
    return html`
      <label class="wc-field">
        <span class="wc-field__name">${name}</span>
        ${inputEl}
      </label>
    `;
  });
  return html`
    <form class="wc-group wc-group--replay" method="POST" action="/agents/${encodeURIComponent(agentId)}/run">
      ${inlineInputs as unknown as SafeHtml[]}
      <button type="submit" class="wc-button wc-button--primary" data-widget-control="replay">${label}</button>
    </form>
  `;
}

function renderViewSwitchControl(
  c: Extract<WidgetControl, { type: 'view-switch' }>,
  state: WidgetControlState,
): SafeHtml {
  const activeId = state.view ?? c.default;
  const chips = c.views.map((v) => {
    const isActive = v.id === activeId;
    const cls = isActive ? 'wc-chip wc-chip--active' : 'wc-chip';
    const href = v.id === c.default ? '?' : `?wv=${encodeURIComponent(v.id)}`;
    return html`<a href="${href}" class="${cls}" data-widget-control="view-switch" data-view-id="${v.id}" data-active="${isActive ? 'true' : 'false'}">${v.id}</a>`;
  });
  return html`
    <div class="wc-group wc-group--view-switch">
      <span class="wc-label">${c.label}:</span>
      ${chips as unknown as SafeHtml[]}
    </div>
  `;
}

function renderFieldToggleControl(
  c: Extract<WidgetControl, { type: 'field-toggle' }>,
  schema: OutputWidgetSchema,
  state: WidgetControlState,
): SafeHtml {
  const labelByName = new Map<string, string>();
  for (const f of schema.fields ?? []) labelByName.set(f.name, f.label ?? f.name);

  const effectiveHidden = state.hiddenFields !== undefined
    ? new Set(state.hiddenFields)
    : new Set(c.default === 'hidden' ? c.fields : []);

  const chips = c.fields.map((name) => {
    const isHidden = effectiveHidden.has(name);
    const next = new Set(effectiveHidden);
    if (isHidden) next.delete(name); else next.add(name);
    const wh = [...next].join(',');
    const href = `?wh=${encodeURIComponent(wh)}`;
    const cls = isHidden ? 'wc-chip' : 'wc-chip wc-chip--active';
    const symbol = isHidden ? '○' : '●';
    return html`<a href="${href}" class="${cls}" data-widget-control="field-toggle" data-field="${name}" data-hidden="${isHidden ? '1' : '0'}">${symbol} ${labelByName.get(name) ?? name}</a>`;
  });
  return html`
    <div class="wc-group wc-group--field-toggle">
      <span class="wc-label">${c.label}:</span>
      ${chips as unknown as SafeHtml[]}
    </div>
  `;
}

// ── sort / filter / paginate renderers ────────────────────────────────

/**
 * Build a query string that preserves the OTHER widget params while
 * overriding ONE control on the named `field`. Pass `null` to clear that
 * field's param; pass a value to set it; omit the key to leave it as-is.
 *
 * Page resets to 1 (omitted from the URL) for the SAME field whenever the
 * override touches its sort or filter — those re-shape the visible set,
 * so a stale page index would be misleading. Pages on OTHER fields are
 * preserved unchanged.
 */
function buildWidgetUrl(
  state: WidgetControlState,
  field: string,
  overrides: {
    sort?: { column: string; direction: 'asc' | 'desc' } | null;
    filter?: string | null;
    page?: number | null;
  } = {},
): string {
  const params: string[] = [];
  if (state.view) params.push(`wv=${encodeURIComponent(state.view)}`);
  if (state.hiddenFields !== undefined) {
    params.push(`wh=${encodeURIComponent([...state.hiddenFields].join(','))}`);
  }

  // For each per-field map, walk every key and emit a param. Override the
  // single `field` we're touching; keep the others' current state intact.
  const writeSort = (f: string, v: { column: string; direction: 'asc' | 'desc' } | undefined) => {
    if (v) params.push(`ws_${encodeURIComponent(f)}=${encodeURIComponent(`${v.column}-${v.direction}`)}`);
  };
  const writeFilter = (f: string, v: string | undefined) => {
    if (v) params.push(`wf_${encodeURIComponent(f)}=${encodeURIComponent(v)}`);
  };
  const writePage = (f: string, v: number | undefined) => {
    if (v && v > 1) params.push(`wp_${encodeURIComponent(f)}=${v}`);
  };

  // Sort: preserve all fields, override the named one if requested.
  for (const [f, v] of state.sort ?? []) {
    if (f !== field) writeSort(f, v);
  }
  const sortOverride = 'sort' in overrides ? overrides.sort : state.sort?.get(field);
  writeSort(field, sortOverride ?? undefined);

  // Filter: same shape.
  for (const [f, v] of state.filter ?? []) {
    if (f !== field) writeFilter(f, v);
  }
  const filterOverride = 'filter' in overrides ? overrides.filter : state.filter?.get(field);
  writeFilter(field, filterOverride ?? undefined);

  // Page: same shape, with the "reset on sort/filter change" rule on the
  // target field only.
  const resetPage = 'sort' in overrides || 'filter' in overrides;
  for (const [f, v] of state.page ?? []) {
    if (f !== field) writePage(f, v);
  }
  const pageOverride = resetPage ? null : ('page' in overrides ? overrides.page : state.page?.get(field));
  writePage(field, pageOverride ?? undefined);

  return params.length > 0 ? `?${params.join('&')}` : '?';
}

function renderSortControl(
  c: Extract<WidgetControl, { type: 'sort' }>,
  state: WidgetControlState,
  arrayMeta?: ArrayControlMetadata,
): SafeHtml {
  const active = arrayMeta?.appliedSort.get(c.field) ?? null;
  const label = c.label ?? 'Sort';
  const chips = c.columns.map((col) => {
    const isActive = active?.column === col;
    const nextDir: 'asc' | 'desc' = isActive && active?.direction === 'asc' ? 'desc' : 'asc';
    const href = buildWidgetUrl(state, c.field, { sort: { column: col, direction: nextDir } });
    const arrow = isActive ? (active!.direction === 'asc' ? '↑' : '↓') : '';
    const cls = isActive ? 'wc-chip wc-chip--active' : 'wc-chip';
    return html`<a href="${href}" class="${cls}" data-widget-control="sort" data-field="${c.field}" data-column="${col}" data-active="${isActive ? 'true' : 'false'}">${col}${arrow ? html` ${arrow}` : html``}</a>`;
  });
  const clear = active
    ? html`<a href="${buildWidgetUrl(state, c.field, { sort: null })}" class="wc-clear" data-widget-control="sort-clear" data-field="${c.field}">clear</a>`
    : html``;
  return html`
    <div class="wc-group wc-group--sort" data-field="${c.field}">
      <span class="wc-label">${label}:</span>
      ${chips as unknown as SafeHtml[]}
      ${clear}
    </div>
  `;
}

function renderFilterControl(
  c: Extract<WidgetControl, { type: 'filter' }>,
  state: WidgetControlState,
  arrayMeta?: ArrayControlMetadata,
): SafeHtml {
  const current = arrayMeta?.appliedFilter.get(c.field) ?? state.filter?.get(c.field) ?? '';
  const label = c.label ?? 'Filter';
  const hiddens: SafeHtml[] = [];
  if (state.view) hiddens.push(html`<input type="hidden" name="wv" value="${state.view}">`);
  if (state.hiddenFields !== undefined) {
    hiddens.push(html`<input type="hidden" name="wh" value="${[...state.hiddenFields].join(',')}">`);
  }
  for (const [f, v] of state.sort ?? []) {
    hiddens.push(html`<input type="hidden" name="ws_${f}" value="${v.column}-${v.direction}">`);
  }
  for (const [f, v] of state.filter ?? []) {
    if (f === c.field) continue;
    hiddens.push(html`<input type="hidden" name="wf_${f}" value="${v}">`);
  }
  for (const [f, v] of state.page ?? []) {
    if (f === c.field) continue;
    hiddens.push(html`<input type="hidden" name="wp_${f}" value="${String(v)}">`);
  }
  const placeholder = c.placeholder ?? `filter ${c.columns.join(', ')}`;
  return html`
    <form class="wc-group wc-group--filter" method="get" action="" data-field="${c.field}">
      ${hiddens as unknown as SafeHtml[]}
      <label class="wc-field">
        <span class="wc-label">${label}:</span>
        <input type="text" class="wc-input wc-input--text" name="wf_${c.field}" value="${current}" placeholder="${placeholder}" data-widget-control="filter" data-field="${c.field}">
      </label>
      ${current ? html`<a href="${buildWidgetUrl(state, c.field, { filter: null })}" class="wc-clear" data-widget-control="filter-clear" data-field="${c.field}">clear</a>` : html``}
    </form>
  `;
}

function renderPaginateControl(
  c: Extract<WidgetControl, { type: 'paginate' }>,
  state: WidgetControlState,
  arrayMeta?: ArrayControlMetadata,
): SafeHtml {
  const info = arrayMeta?.pageInfo.get(c.field);
  if (!info) {
    return html`<span class="wc-group wc-group--paginate wc-page-info wc-page-info--empty">page —</span>`;
  }
  const prevHref = info.currentPage > 1 ? buildWidgetUrl(state, c.field, { page: info.currentPage - 1 }) : null;
  const nextHref = info.currentPage < info.pageCount ? buildWidgetUrl(state, c.field, { page: info.currentPage + 1 }) : null;
  const dis = (label: SafeHtml, key: string) =>
    html`<span class="wc-chip wc-chip--disabled" data-widget-control="${key}-disabled" data-field="${c.field}">${label}</span>`;
  const link = (href: string, label: SafeHtml, key: string) =>
    html`<a href="${href}" class="wc-chip" data-widget-control="${key}" data-field="${c.field}">${label}</a>`;
  return html`
    <div class="wc-group wc-group--paginate" data-field="${c.field}">
      ${prevHref ? link(prevHref, html`← prev`, 'paginate-prev') : dis(html`← prev`, 'paginate-prev')}
      <span class="wc-page-info"><span class="wc-page-info__current">page ${String(info.currentPage)} of ${String(info.pageCount)}</span> <span class="wc-page-info__total">(${String(info.totalAfterFilter)} rows)</span></span>
      ${nextHref ? link(nextHref, html`next →`, 'paginate-next') : dis(html`next →`, 'paginate-next')}
    </div>
  `;
}

/**
 * Parse `?wh=foo,bar` from a query string into a Set of field names.
 * Returns `undefined` when the param is absent (so per-control defaults
 * apply); returns an empty Set for `?wh=` (so the URL becomes authoritative
 * and reveals every default-hidden field). Exported so route handlers can
 * build a {@link WidgetControlState} without duplicating the CSV grammar.
 */
export function parseHiddenFieldsParam(value: string | undefined): Set<string> | undefined {
  if (value === undefined) return undefined;
  return new Set(value.split(',').map((s) => s.trim()).filter(Boolean));
}

/**
 * Parse a single `ws_<field>=<column>-<asc|desc>` value. Returns
 * `undefined` for malformed input so the caller can drop that key
 * silently (the control then falls back to its schema `default`).
 */
function parseSortValue(value: string | undefined): { column: string; direction: 'asc' | 'desc' } | undefined {
  if (!value) return undefined;
  const m = /^([a-zA-Z_][a-zA-Z0-9_]*)-(asc|desc)$/i.exec(value.trim());
  if (!m) return undefined;
  return { column: m[1], direction: m[2].toLowerCase() as 'asc' | 'desc' };
}

/**
 * Build the per-field `sort` map from a query bag (Express's `req.query`
 * or an equivalent record). Walks every `ws_<field>` key and parses its
 * value. Unknown / malformed entries are skipped — no errors thrown.
 * Returns `undefined` when no `ws_*` keys exist so the caller can omit
 * the map entirely (cheaper than passing an empty Map).
 */
export function parseSortParamsFromQuery(query: Record<string, unknown>): Map<string, { column: string; direction: 'asc' | 'desc' }> | undefined {
  let result: Map<string, { column: string; direction: 'asc' | 'desc' }> | undefined;
  for (const [k, v] of Object.entries(query)) {
    if (!k.startsWith('ws_') || typeof v !== 'string') continue;
    const field = k.slice(3);
    if (!field) continue;
    const parsed = parseSortValue(v);
    if (!parsed) continue;
    if (!result) result = new Map();
    result.set(field, parsed);
  }
  return result;
}

/**
 * Build the per-field `filter` map from a query bag. Walks every
 * `wf_<field>` key. Empty-string values are kept (so authors can clear
 * a filter by submitting an empty input); only undefined / non-string
 * values are skipped.
 */
export function parseFilterParamsFromQuery(query: Record<string, unknown>): Map<string, string> | undefined {
  let result: Map<string, string> | undefined;
  for (const [k, v] of Object.entries(query)) {
    if (!k.startsWith('wf_') || typeof v !== 'string') continue;
    const field = k.slice(3);
    if (!field) continue;
    if (!result) result = new Map();
    result.set(field, v);
  }
  return result;
}

/**
 * Build the per-field `page` map from a query bag. Walks every
 * `wp_<field>` key. Values that aren't positive integers are skipped.
 */
export function parsePageParamsFromQuery(query: Record<string, unknown>): Map<string, number> | undefined {
  let result: Map<string, number> | undefined;
  for (const [k, v] of Object.entries(query)) {
    if (!k.startsWith('wp_') || typeof v !== 'string') continue;
    const field = k.slice(3);
    if (!field) continue;
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < 1) continue;
    if (!result) result = new Map();
    result.set(field, n);
  }
  return result;
}

// ── ai-template ────────────────────────────────────────────────────────

/**
 * Render the agent's stored HTML template after substituting
 * {{outputs.X}} / {{result}} placeholders with the run's actual output,
 * then running the result back through the sanitizer for defense-in-depth
 * (the template was sanitized at save time, but values may contain HTML).
 */
function renderAiTemplate(
  schema: OutputWidgetSchema,
  output: string,
  fields: Record<string, string | undefined>,
  controlState?: WidgetControlState,
): { body: SafeHtml; metadata?: ArrayControlMetadata } {
  if (!schema.template) {
    return { body: html`<p class="dim">No template stored. Click "Generate" in the agent's Output Widget settings to build one.</p>` };
  }

  // Build a unified outputs map. Start with the parsed JSON's top-level
  // keys (so arrays/objects are accessible to {{#each}} and {{{var}}}),
  // then layer declared scalar fields on top so explicit field config wins.
  //
  // We use `parseJsonFromOutput` (same recovery PR #274 added for
  // extractField) instead of a bare `JSON.parse(output)` so prose-wrapped
  // or markdown-fenced JSON still surfaces arrays / objects to the
  // template. Without this, `{{#each outputs.rows as r}}` blocks render
  // empty whenever the agent emits anything other than pure JSON —
  // which most claude-code summarisers do (markdown fences, leading
  // notes, trailing commentary).
  const outputsForSub: Record<string, unknown> = {};
  const parsed = parseJsonFromOutput(output);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [k, v] of Object.entries(parsed)) outputsForSub[k] = v;
  }
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string') outputsForSub[k] = v;
  }

  // Backfill any {{outputs.NAME}} the template references but isn't in the
  // map yet — only matters for non-JSON outputs where extractField has a
  // fallback path.
  const re = /\{\{\s*outputs\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(schema.template)) !== null) {
    const name = m[1];
    if (outputsForSub[name] === undefined) {
      const v = extractField(output, name);
      if (typeof v === 'string') outputsForSub[name] = v;
    }
  }

  // Apply array-data controls (sort / filter / paginate) BEFORE
  // substitution so the `{{#each}}` blocks see the transformed arrays.
  // No-op when no such controls are declared or no controlState was
  // threaded through (e.g. Pulse tiles render statically).
  const metadata = controlState ? applyControlsToArrayData(outputsForSub, schema, controlState) : undefined;

  const substituted = substitutePlaceholders(schema.template, { outputs: outputsForSub, result: output });
  const safe = sanitizeHtml(substituted);
  return { body: unsafeHtml(`<div class="ai-template-widget">${safe}</div>`), metadata };
}

// ── diff-apply ──────────────────────────────────────────────────────────

function renderDiffApply(
  schema: OutputWidgetSchema,
  fields: Record<string, string | undefined>,
  agentId: string,
): SafeHtml {
  const classification = fields.classification?.toUpperCase().trim() ?? '';
  const summary = fields.summary ?? '';
  const details = fields.details ?? '';
  const yaml = fields.yaml ?? '';

  // Badge color by classification.
  const badgeClass = classification === 'NO_IMPROVEMENTS' ? 'badge--ok'
    : classification === 'REWRITE' ? 'badge--err'
    : 'badge--warn';
  const badgeLabel = classification === 'NO_IMPROVEMENTS' ? 'No improvements needed'
    : classification === 'REWRITE' ? 'Recommend rewrite'
    : classification || 'Analysis complete';

  const sections: SafeHtml[] = [];

  // Badge
  sections.push(html`
    <div style="margin-bottom: var(--space-3);">
      <span class="badge ${badgeClass}">${badgeLabel}</span>
    </div>
  `);

  // Summary
  if (summary) {
    sections.push(html`
      <p style="font-weight: var(--weight-medium); margin: 0 0 var(--space-3);">${summary}</p>
    `);
  }

  // Details
  if (details) {
    sections.push(html`
      <div style="font-size: var(--font-size-sm); line-height: 1.6; margin: 0 0 var(--space-3); color: var(--color-text-muted); max-height: 250px; overflow-y: auto;">
        ${details}
      </div>
    `);
  }

  // YAML (code block)
  if (yaml) {
    sections.push(html`
      <details style="margin-bottom: var(--space-3);">
        <summary style="cursor: pointer; font-size: var(--font-size-xs); color: var(--color-text-muted); font-weight: var(--weight-semibold);">Suggested YAML</summary>
        <pre style="font-size: var(--font-size-xs); background: var(--color-surface-raised); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-3); margin-top: var(--space-2); max-height: 300px; overflow-y: auto; white-space: pre-wrap;">${yaml}</pre>
      </details>
    `);
  }

  // Actions
  if (schema.actions?.length) {
    const actionButtons = schema.actions.map((action) => {
      const endpoint = action.endpoint.replace('{agentId}', encodeURIComponent(agentId));
      return html`
        <button type="button" class="btn btn--primary btn--sm"
          data-widget-action="${action.id}"
          data-widget-endpoint="${endpoint}"
          data-widget-method="${action.method}"
          ${action.payloadField ? `data-widget-payload-field="${action.payloadField}"` : ''}
        >${action.label}</button>
      `;
    });
    sections.push(html`
      <div style="display: flex; gap: var(--space-2); flex-wrap: wrap;">
        ${actionButtons as unknown as SafeHtml[]}
      </div>
    `);
  }

  return html`
    <div class="output-widget output-widget--diff-apply">
      ${sections as unknown as SafeHtml[]}
    </div>
  `;
}

// ── key-value ───────────────────────────────────────────────────────────

function renderKeyValue(
  schema: OutputWidgetSchema,
  fields: Record<string, string | undefined>,
): SafeHtml {
  const rows = (schema.fields ?? [])
    .filter((f) => fields[f.name] !== undefined)
    .map((f) => {
      const value = fields[f.name] ?? '';
      const label = f.label ?? f.name;
      if (f.type === 'preview') {
        return renderPreview(label, value);
      }
      if (f.type === 'badge') {
        return html`<dt>${label}</dt><dd><span class="badge">${value}</span></dd>`;
      }
      if (f.type === 'code') {
        return html`<dt>${label}</dt><dd><code class="mono" style="font-size: var(--font-size-xs);">${value}</code></dd>`;
      }
      return html`<dt>${label}</dt><dd>${value}</dd>`;
    });

  return html`
    <div class="output-widget output-widget--key-value">
      <dl class="kv">
        ${rows as unknown as SafeHtml[]}
      </dl>
    </div>
  `;
}

// ── raw ─────────────────────────────────────────────────────────────────

function renderRaw(
  schema: OutputWidgetSchema,
  fields: Record<string, string | undefined>,
): SafeHtml {
  const sections = (schema.fields ?? [])
    .filter((f) => fields[f.name] !== undefined)
    .map((f) => {
      const value = fields[f.name] ?? '';
      const label = f.label ?? f.name;
      if (f.type === 'preview') {
        return renderPreview(label, value);
      }
      if (f.type === 'code') {
        return html`
          <section style="margin-bottom: var(--space-3);">
            <h4 style="font-size: var(--font-size-xs); color: var(--color-text-muted); margin: 0 0 var(--space-1);">${label}</h4>
            <pre style="font-size: var(--font-size-xs); background: var(--color-surface-raised); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-3); max-height: 300px; overflow-y: auto; white-space: pre-wrap;">${value}</pre>
          </section>
        `;
      }
      if (f.type === 'badge') {
        return html`
          <div style="margin-bottom: var(--space-2);">
            <span class="dim" style="font-size: var(--font-size-xs);">${label}:</span>
            <span class="badge">${value}</span>
          </div>
        `;
      }
      return html`
        <section style="margin-bottom: var(--space-3);">
          <h4 style="font-size: var(--font-size-xs); color: var(--color-text-muted); margin: 0 0 var(--space-1);">${label}</h4>
          <div style="font-size: var(--font-size-sm); line-height: 1.6;">${value}</div>
        </section>
      `;
    });

  return html`
    <div class="output-widget output-widget--raw">
      ${sections as unknown as SafeHtml[]}
    </div>
  `;
}

// ── dashboard ───────────────────────────────────────────────────────────
// Visual dashboard panel: hero metrics up top, stats grid in the middle,
// text/badge fields at the bottom. Field types drive layout placement:
//   metric → hero row (big number + label)
//   stat   → stats grid (compact label + value cards)
//   badge  → inline pill
//   text   → bottom section

function renderDashboard(
  schema: OutputWidgetSchema,
  fields: Record<string, string | undefined>,
): SafeHtml {
  const heroes: SafeHtml[] = [];
  const badges: SafeHtml[] = [];
  const stats: SafeHtml[] = [];
  const texts: SafeHtml[] = [];

  for (const f of schema.fields ?? []) {
    const value = fields[f.name];
    if (value === undefined) continue;
    const label = f.label ?? f.name;

    if (f.type === 'metric') {
      heroes.push(html`
        <div style="text-align: center; flex: 1; min-width: 80px;">
          <div style="font-size: 1.5rem; font-weight: var(--weight-bold, 700); font-family: var(--font-mono); color: var(--color-text); line-height: 1.2;">${value}</div>
          <div style="font-size: var(--font-size-xs); color: var(--color-text-muted); margin-top: 2px;">${label}</div>
        </div>
      `);
    } else if (f.type === 'stat') {
      stats.push(html`
        <div style="background: var(--color-surface-raised); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3); text-align: center; min-width: 80px;">
          <div style="font-size: var(--font-size-sm); font-weight: var(--weight-semibold); font-family: var(--font-mono);">${value}</div>
          <div style="font-size: 10px; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2px;">${label}</div>
        </div>
      `);
    } else if (f.type === 'badge') {
      badges.push(html`
        <div style="text-align: center; flex: 1; min-width: 80px;">
          <span class="badge" style="font-size: var(--font-size-sm);">${value}</span>
          <div style="font-size: var(--font-size-xs); color: var(--color-text-muted); margin-top: 2px;">${label}</div>
        </div>
      `);
    } else if (f.type === 'preview') {
      texts.push(renderPreview(label, value));
    } else {
      texts.push(html`
        <div style="font-size: var(--font-size-sm); color: var(--color-text-muted);">
          <span style="font-size: var(--font-size-xs); text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-muted); opacity: 0.7;">${label}</span>
          <div style="margin-top: 2px;">${value}</div>
        </div>
      `);
    }
  }

  // Combine heroes + badges into one top row so badges sit alongside metrics
  const topRow = [...heroes, ...badges];

  return html`
    <div class="output-widget output-widget--dashboard" style="display: flex; flex-direction: column; gap: var(--space-3); max-width: 480px;">
      ${topRow.length > 0 ? html`
        <div style="display: flex; gap: var(--space-4); justify-content: center; align-items: flex-start; padding: var(--space-2) 0; flex-wrap: wrap;">
          ${topRow as unknown as SafeHtml[]}
        </div>
      ` : html``}
      ${stats.length > 0 ? html`
        <div style="display: grid; grid-template-columns: repeat(${String(Math.min(stats.length, 4))}, 1fr); gap: var(--space-2);">
          ${stats as unknown as SafeHtml[]}
        </div>
      ` : html``}
      ${texts.length > 0 ? html`
        <div style="display: flex; flex-direction: column; gap: var(--space-2); border-top: 1px solid var(--color-border); padding-top: var(--space-2);">
          ${texts as unknown as SafeHtml[]}
        </div>
      ` : html``}
    </div>
  `;
}
