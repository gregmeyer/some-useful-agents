/**
 * Zod schema for OutputWidgetSchema validation.
 */

import { z } from 'zod';

export const widgetFieldSchema = z.object({
  name: z.string().min(1),
  label: z.string().optional(),
  type: z.enum(['text', 'code', 'badge', 'action', 'metric', 'stat', 'preview']),
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
  }
});

export type OutputWidgetSchemaInput = z.input<typeof outputWidgetSchema>;
export type OutputWidgetSchemaParsed = z.output<typeof outputWidgetSchema>;
