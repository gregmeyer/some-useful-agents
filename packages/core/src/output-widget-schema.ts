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
});

export type OutputWidgetSchemaInput = z.input<typeof outputWidgetSchema>;
export type OutputWidgetSchemaParsed = z.output<typeof outputWidgetSchema>;
