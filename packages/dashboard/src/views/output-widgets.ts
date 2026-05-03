/**
 * Output widget SSR renderers. Each widget type gets a renderer that takes
 * the agent's OutputWidgetSchema + run output text and returns SafeHtml.
 *
 * Widget types:
 *   - diff-apply: classification badge, side-by-side diff, action buttons
 *   - key-value: labeled stats grid
 *   - raw: pre-formatted output with field extraction
 */

import type { OutputWidgetSchema } from '@some-useful-agents/core';
import { sanitizeHtml, substitutePlaceholders } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from './html.js';

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
 * Render a widget from an agent's outputWidget schema and run output.
 * Returns undefined if the schema type is unknown.
 */
export function renderOutputWidget(
  schema: OutputWidgetSchema,
  output: string,
  agentId: string,
): SafeHtml | undefined {
  const fields = extractFields(output, schema);

  switch (schema.type) {
    case 'diff-apply':
      return renderDiffApply(schema, fields, agentId);
    case 'key-value':
      return renderKeyValue(schema, fields);
    case 'raw':
      return renderRaw(schema, fields);
    case 'dashboard':
      return renderDashboard(schema, fields);
    case 'ai-template':
      return renderAiTemplate(schema, output, fields);
    default:
      return undefined;
  }
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
