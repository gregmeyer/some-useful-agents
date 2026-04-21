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
import { html, type SafeHtml } from './html.js';

/**
 * Extract a field value from run output text. Supports two extraction modes:
 *   1. XML tags: <fieldName>value</fieldName>
 *   2. JSON: parse as JSON and read the key
 */
function extractField(output: string, fieldName: string): string | undefined {
  // Try XML tag extraction first (used by agent-analyzer).
  const tagMatch = output.match(new RegExp(`<${fieldName}>([\\s\\S]*?)</${fieldName}>`, 'i'));
  if (tagMatch) return tagMatch[1].trim();

  // Try JSON.
  try {
    const parsed = JSON.parse(output);
    if (typeof parsed === 'object' && parsed !== null && fieldName in parsed) {
      const val = parsed[fieldName];
      return typeof val === 'string' ? val : JSON.stringify(val, null, 2);
    }
  } catch { /* not JSON */ }

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
  for (const field of schema.fields) {
    result[field.name] = extractField(output, field.name);
  }
  return result;
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
    default:
      return undefined;
  }
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
  const rows = schema.fields
    .filter((f) => fields[f.name] !== undefined)
    .map((f) => {
      const value = fields[f.name] ?? '';
      const label = f.label ?? f.name;
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
  const sections = schema.fields
    .filter((f) => fields[f.name] !== undefined)
    .map((f) => {
      const value = fields[f.name] ?? '';
      const label = f.label ?? f.name;
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
