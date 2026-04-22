/**
 * Zod schema for OutputWidgetSchema validation.
 */

import { z } from 'zod';

export const widgetFieldSchema = z.object({
  name: z.string().min(1),
  label: z.string().optional(),
  type: z.enum(['text', 'code', 'badge', 'action', 'metric', 'stat']),
});

export const widgetActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  method: z.literal('POST'),
  endpoint: z.string().min(1),
  payloadField: z.string().optional(),
});

export const outputWidgetSchema = z.object({
  type: z.enum(['diff-apply', 'key-value', 'raw', 'dashboard']),
  fields: z.array(widgetFieldSchema).min(1),
  actions: z.array(widgetActionSchema).optional(),
});

export type OutputWidgetSchemaInput = z.input<typeof outputWidgetSchema>;
export type OutputWidgetSchemaParsed = z.output<typeof outputWidgetSchema>;
