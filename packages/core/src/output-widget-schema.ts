/**
 * Zod schema for OutputWidgetSchema validation.
 */

import { z } from 'zod';

export const tableColumnSchema = z.object({
  name: z.string().min(1),
  label: z.string().optional(),
  format: z.enum(['text', 'link']).optional(),
  /** For format=link: the per-row JSON key holding the URL. */
  href: z.string().min(1).optional(),
  /** For format=link: per-row key for the displayed text, OR a literal string
   *  fallback (when no row has a matching key). */
  text: z.string().min(1).optional(),
});

export const widgetFieldSchema = z.object({
  name: z.string().min(1),
  label: z.string().optional(),
  type: z.enum(['text', 'code', 'badge', 'action', 'metric', 'stat', 'preview', 'table']),
  columns: z.array(tableColumnSchema).min(1, 'table.columns must list at least one column.').optional(),
}).superRefine((field, ctx) => {
  if (field.type === 'table') {
    if (!field.columns || field.columns.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['columns'], message: 'table fields require `columns` (at least one).' });
      return;
    }
    for (let i = 0; i < field.columns.length; i++) {
      const col = field.columns[i];
      if (col.format === 'link' && !col.href) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['columns', i, 'href'],
          message: `column "${col.name}" has format=link but no \`href\` — name the per-row JSON key holding the URL.`,
        });
      }
      if (col.format !== 'link' && (col.href || col.text)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['columns', i, 'format'],
          message: `column "${col.name}" sets \`href\`/\`text\` but format is not "link".`,
        });
      }
    }
  } else if (field.columns) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['columns'],
      message: '`columns` is only valid on `type: table` fields.',
    });
  }
});

export const widgetActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  method: z.literal('POST'),
  endpoint: z.string().min(1),
  payloadField: z.string().optional(),
});

export const widgetViewSchema = z.object({
  id: z.string().min(1),
  fields: z.array(z.string().min(1)).min(1, 'view.fields must list at least one field'),
});

export const widgetControlSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('replay'),
    label: z.string().optional(),
    /**
     * Subset of `agent.inputs` names to expose as inline form fields on the
     * replay button. Empty array (or omitted) = same-inputs replay using the
     * agent's defaults.
     */
    inputs: z.array(z.string().min(1)).optional(),
  }),
  z.object({
    type: z.literal('field-toggle'),
    label: z.string().min(1),
    fields: z.array(z.string().min(1)).min(1, 'field-toggle.fields must list at least one field'),
    default: z.enum(['shown', 'hidden']),
  }),
  z.object({
    type: z.literal('view-switch'),
    label: z.string().min(1),
    views: z.array(widgetViewSchema).min(1, 'view-switch needs at least one view'),
    default: z.string().min(1),
  }),
  /**
   * `sort` — renders a column-picker + asc/desc toggle above the widget.
   * Operates on a top-level array in the agent's JSON output (e.g.
   * `outputs.rows`, `outputs.daily`). State is URL-driven via `?ws=<col>-<dir>`.
   * The renderer stable-sorts the array IN PLACE before substituting into
   * `{{#each}}` blocks — works for any widget that surfaces array data.
   */
  z.object({
    type: z.literal('sort'),
    label: z.string().min(1).optional(),
    /** Top-level array name in the parsed JSON (no `outputs.` prefix). */
    field: z.string().min(1, 'sort.field is required (e.g. "rows" or "daily").'),
    /** Sortable column names (object keys on each row). */
    columns: z.array(z.string().min(1)).min(1, 'sort.columns must list at least one column.'),
    /** Initial sort, e.g. `"cost"` or `"cost desc"`. Omitted = unsorted. */
    default: z.string().optional(),
  }),
  /**
   * `filter` — renders a text input above the widget that performs
   * case-insensitive substring matching across the specified columns.
   * Rows where ANY listed column's stringified value contains the query
   * survive. State via `?wf=<query>`.
   */
  z.object({
    type: z.literal('filter'),
    label: z.string().min(1).optional(),
    field: z.string().min(1, 'filter.field is required (e.g. "rows" or "daily").'),
    columns: z.array(z.string().min(1)).min(1, 'filter.columns must list at least one column.'),
    placeholder: z.string().optional(),
  }),
  /**
   * `paginate` — slices the array into pages and renders prev/next + page
   * indicator. Applied AFTER filter and sort. State via `?wp=<n>` (1-based).
   * `pageSize` is the schema-fixed page length.
   */
  z.object({
    type: z.literal('paginate'),
    field: z.string().min(1, 'paginate.field is required (e.g. "rows" or "daily").'),
    pageSize: z.number().int().positive().max(1000, 'paginate.pageSize is capped at 1000 — use sort/filter to narrow before paginating.'),
  }),
  /**
   * `copy` — renders a copy-to-clipboard button. No config beyond an
   * optional label; copies the rendered widget text client-side.
   */
  z.object({
    type: z.literal('copy'),
    label: z.string().min(1).optional(),
  }),
  /**
   * `capture-image` — renders a "save as PNG" button. Client-side capture
   * via html2canvas. Optional `filename` stem (defaults to the agent id).
   */
  z.object({
    type: z.literal('capture-image'),
    label: z.string().min(1).optional(),
    filename: z.string().min(1).max(120).optional(),
  }),
]);

export const outputWidgetSchema = z.object({
  type: z.enum(['diff-apply', 'key-value', 'raw', 'dashboard', 'ai-template']),
  fields: z.array(widgetFieldSchema).optional(),
  actions: z.array(widgetActionSchema).optional(),
  /** ai-template: prompt the user wrote to generate the template (kept so they can iterate). */
  prompt: z.string().optional(),
  /** ai-template: sanitized HTML template with {{outputs.X}} / {{result}} placeholders. */
  template: z.string().optional(),
  /**
   * Interactive widget mode — when true, the widget renders with an inline
   * inputs form + Run button so users can trigger a fresh run from the tile
   * without navigating to the agent detail page. Result polls into place
   * via /runs/:id/widget-status. Default false; existing widgets unchanged.
   */
  interactive: z.boolean().optional(),
  /**
   * When `interactive` is set, the names of `agent.inputs` to expose as
   * fields in the tile. Subset semantics: omitted keys are not shown.
   * If not set but `interactive` is true, every declared input is shown.
   */
  runInputs: z.array(z.string().min(1)).optional(),
  /** Custom label for the initial Run button (default "Run"). */
  askLabel: z.string().optional(),
  /** Custom label for the post-result replay button (default "Run again"). */
  replayLabel: z.string().optional(),
  /**
   * Inline interactive controls rendered above the widget body. Allow the
   * viewer to re-run the agent, hide/show optional fields, or switch between
   * named views. State is URL-driven (no client JS) so refresh = default view.
   */
  controls: z.array(widgetControlSchema).optional(),
  /**
   * Tile HEIGHT behavior when the widget is taller than its Pulse/dashboard
   * slot (width is always the dashboard-defined column). Tiles only — the full
   * run/agent view always renders at natural height. `grow` (default) grows the
   * tile vertically; `scroll` caps + scrolls. Unset = grow.
   */
  tileFit: z.enum(['grow', 'scroll']).optional(),
}).superRefine((schema, ctx) => {
  if (schema.type === 'ai-template') {
    if (!schema.template || schema.template.trim() === '') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['template'], message: 'ai-template widgets need a non-empty template.' });
    }
  } else {
    if (!Array.isArray(schema.fields) || schema.fields.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fields'], message: 'Non-ai widgets need at least one field.' });
    }
  }

  // `table` fields only render on `dashboard` widgets — other typed widgets
  // (key-value/raw/diff-apply) use a scalar-per-field layout that doesn't
  // know how to surface array data, and ai-template widgets render via the
  // template so a typed `table` field would be meaningless.
  for (let i = 0; i < (schema.fields?.length ?? 0); i++) {
    const f = schema.fields![i];
    if (f.type === 'table' && schema.type !== 'dashboard') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fields', i, 'type'],
        message: `table fields are only supported on dashboard widgets (this widget is type "${schema.type}").`,
      });
    }
  }

  if (!schema.controls?.length) return;

  const declaredFieldNames = new Set((schema.fields ?? []).map((f) => f.name));

  for (let i = 0; i < schema.controls.length; i++) {
    const c = schema.controls[i];

    if (c.type === 'field-toggle' || c.type === 'view-switch') {
      // ai-template widgets don't have a declared `fields[]` for layout
      // (the template author owns visibility), so toggle/switch controls
      // have nothing to operate on. Reject early instead of rendering a
      // broken control row.
      if (schema.type === 'ai-template') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['controls', i, 'type'],
          message: `${c.type} controls aren't supported on ai-template widgets — the template controls layout directly.`,
        });
        continue;
      }
    }

    if (c.type === 'field-toggle') {
      for (let j = 0; j < c.fields.length; j++) {
        if (!declaredFieldNames.has(c.fields[j])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['controls', i, 'fields', j],
            message: `field-toggle references "${c.fields[j]}" which isn't declared in outputWidget.fields.`,
          });
        }
      }
    } else if (c.type === 'view-switch') {
      const viewIds = new Set<string>();
      for (let j = 0; j < c.views.length; j++) {
        const view = c.views[j];
        if (viewIds.has(view.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['controls', i, 'views', j, 'id'],
            message: `Duplicate view id "${view.id}".`,
          });
        }
        viewIds.add(view.id);
        for (let k = 0; k < view.fields.length; k++) {
          if (!declaredFieldNames.has(view.fields[k])) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['controls', i, 'views', j, 'fields', k],
              message: `view "${view.id}" references field "${view.fields[k]}" which isn't declared in outputWidget.fields.`,
            });
          }
        }
      }
      if (!viewIds.has(c.default)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['controls', i, 'default'],
          message: `view-switch default "${c.default}" doesn't match any declared view id.`,
        });
      }
    }
    // replay.inputs[] is cross-checked against agent.inputs at the agent
    // schema level, since outputWidgetSchema doesn't see the agent shape.

    if (c.type === 'sort' && c.default) {
      // `default` accepts "col" or "col asc" / "col desc"; case-insensitive.
      const m = /^([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(asc|desc))?$/i.exec(c.default.trim());
      if (!m) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['controls', i, 'default'],
          message: `sort.default "${c.default}" must be "<column>" or "<column> ASC|DESC".`,
        });
      } else if (!c.columns.includes(m[1])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['controls', i, 'default'],
          message: `sort.default references column "${m[1]}" which isn't in sort.columns.`,
        });
      }
    }
  }
});

export type OutputWidgetSchemaInput = z.input<typeof outputWidgetSchema>;
export type OutputWidgetSchemaParsed = z.output<typeof outputWidgetSchema>;
