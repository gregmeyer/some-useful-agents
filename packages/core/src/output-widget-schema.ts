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
