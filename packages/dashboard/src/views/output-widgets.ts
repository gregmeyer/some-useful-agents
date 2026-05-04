/**
 * Output widget SSR renderers. Each widget type gets a renderer that takes
 * the agent's OutputWidgetSchema + run output text and returns SafeHtml.
 *
 * Widget types:
 *   - diff-apply: classification badge, side-by-side diff, action buttons
 *   - key-value: labeled stats grid
 *   - raw: pre-formatted output with field extraction
 */

import type { OutputWidgetSchema, WidgetControl, WidgetField } from '@some-useful-agents/core';
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
}

/**
 * Extract a field value from run output text. Supports two extraction modes:
 *   1. XML tags: <fieldName>value</fieldName>
 *   2. JSON: parse as JSON and read the key
 */
function extractField(output: string, fieldName: string): string | undefined {
  // Try XML tag extraction first (used by agent-analyzer).
  const tagMatch = output.match(new RegExp(`<${fieldName}>([\\s\\S]*?)</${fieldName}>`, 'i'));
  if (tagMatch) return tagMatch[1].trim();

  // Try JSON — top-level first, then deep search.
  try {
    const parsed = JSON.parse(output);
    if (typeof parsed === 'object' && parsed !== null) {
      // Top-level match (fast path).
      if (fieldName in parsed) {
        const val = parsed[fieldName];
        return typeof val === 'string' ? val : JSON.stringify(val, null, 2);
      }
      // Deep search: walk nested objects to find the field.
      const found = deepFind(parsed, fieldName);
      if (found !== undefined) {
        return typeof found === 'string' ? found : JSON.stringify(found, null, 2);
      }
    }
  } catch { /* not JSON */ }

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
): SafeHtml | undefined {
  // ai-template widgets render their own layout via the stored template;
  // field-toggle / view-switch don't apply (rejected at schema time). Only
  // the body+optional replay control row are emitted.
  const filtered = schema.type === 'ai-template' ? schema : applyControlsToFields(schema, controlState);
  const fields = extractFields(output, filtered);

  let body: SafeHtml | undefined;
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
    case 'ai-template':
      body = renderAiTemplate(filtered, output, fields);
      break;
    default:
      return undefined;
  }

  if (!controlState || !schema.controls?.length) return body;
  const controlsRow = renderControlsRow(schema, agentId, controlState);
  return html`${controlsRow}${body}`;
}

/**
 * Render the controls row above a widget body. URL-param-driven; every
 * interaction is a full page reload via <a> or a POST <form>. No client JS.
 */
function renderControlsRow(
  schema: OutputWidgetSchema,
  agentId: string,
  state: WidgetControlState,
): SafeHtml {
  const controls = schema.controls ?? [];
  const groups = controls.map((c) => {
    if (c.type === 'replay') return renderReplayControl(c, agentId);
    if (c.type === 'view-switch') return renderViewSwitchControl(c, state);
    if (c.type === 'field-toggle') return renderFieldToggleControl(c, schema, state);
    return html``;
  });
  return html`
    <div class="output-widget__controls" style="display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; margin-bottom: var(--space-3); padding-bottom: var(--space-3); border-bottom: 1px solid var(--color-border);">
      ${groups as unknown as SafeHtml[]}
    </div>
  `;
}

function renderReplayControl(c: Extract<WidgetControl, { type: 'replay' }>, agentId: string): SafeHtml {
  const label = c.label ?? 'Run again';
  const inlineInputs = (c.inputs ?? []).map((name) => html`
    <label style="display: inline-flex; align-items: center; gap: var(--space-1); font-size: var(--font-size-xs);">
      <span class="dim">${name}</span>
      <input type="text" name="input_${name}" style="padding: 2px var(--space-2); font-size: var(--font-size-xs); border: 1px solid var(--color-border); border-radius: var(--radius-sm); width: 8em;">
    </label>
  `);
  return html`
    <form method="POST" action="/agents/${encodeURIComponent(agentId)}/run" style="display: inline-flex; gap: var(--space-2); align-items: center; margin: 0;">
      ${inlineInputs as unknown as SafeHtml[]}
      <button type="submit" class="btn btn--sm btn--primary" data-widget-control="replay">${label}</button>
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
    const cls = isActive ? 'badge' : 'badge badge--muted';
    const style = isActive
      ? 'cursor: default; text-decoration: none;'
      : 'cursor: pointer; text-decoration: none;';
    // The default view's URL omits `?wv=` (cleaner share links). All other
    // views set it explicitly. `wh` is preserved by the caller via the form/
    // link grammar — controls share state through query string only, so
    // clicking a view-switch resets the hidden-fields list. Acceptable for v1.
    const href = v.id === c.default ? '?' : `?wv=${encodeURIComponent(v.id)}`;
    return html`<a href="${href}" class="${cls}" style="${style}" data-widget-control="view-switch" data-view-id="${v.id}">${v.id}</a>`;
  });
  return html`
    <div style="display: inline-flex; gap: var(--space-2); align-items: center;">
      <span class="dim" style="font-size: var(--font-size-xs);">${c.label}:</span>
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

  // Reconstruct the effective hidden set so each chip can render its
  // current state and link to the toggled URL. ?wh present (even empty) =
  // authoritative; absent = per-control defaults.
  const effectiveHidden = state.hiddenFields !== undefined
    ? new Set(state.hiddenFields)
    : new Set(c.default === 'hidden' ? c.fields : []);

  const chips = c.fields.map((name) => {
    const isHidden = effectiveHidden.has(name);
    // Build the toggled hidden set for this chip's link.
    const next = new Set(effectiveHidden);
    if (isHidden) next.delete(name); else next.add(name);
    const wh = [...next].join(',');
    // Always emit ?wh=... (even empty) so the URL is authoritative — without
    // this, revealing the only default-hidden field would produce a bare ?
    // that falls back to defaults, locking the field hidden forever.
    const href = `?wh=${encodeURIComponent(wh)}`;
    const cls = isHidden ? 'badge badge--muted' : 'badge';
    const symbol = isHidden ? '○' : '●';
    return html`<a href="${href}" class="${cls}" style="cursor: pointer; text-decoration: none;" data-widget-control="field-toggle" data-field="${name}" data-hidden="${isHidden ? '1' : '0'}">${symbol} ${labelByName.get(name) ?? name}</a>`;
  });
  return html`
    <div style="display: inline-flex; gap: var(--space-2); align-items: center;">
      <span class="dim" style="font-size: var(--font-size-xs);">${c.label}:</span>
      ${chips as unknown as SafeHtml[]}
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
): SafeHtml {
  if (!schema.template) {
    return html`<p class="dim">No template stored. Click "Generate" in the agent's Output Widget settings to build one.</p>`;
  }

  // Build a unified outputs map. Start with the parsed JSON's top-level
  // keys (so arrays/objects are accessible to {{#each}} and {{{var}}}),
  // then layer declared scalar fields on top so explicit field config wins.
  const outputsForSub: Record<string, unknown> = {};
  let parsed: unknown = null;
  try { parsed = JSON.parse(output); } catch { /* output isn't JSON; that's fine */ }
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

  const substituted = substitutePlaceholders(schema.template, { outputs: outputsForSub, result: output });
  const safe = sanitizeHtml(substituted);
  return unsafeHtml(`<div class="ai-template-widget">${safe}</div>`);
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
