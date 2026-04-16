import { z } from 'zod';

const TOOL_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

const toolFieldTypeSchema = z.enum([
  'string', 'number', 'boolean', 'json', 'object', 'array',
]);

const toolInputFieldSchema = z.object({
  type: toolFieldTypeSchema,
  description: z.string().optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  required: z.boolean().optional(),
});

const toolOutputFieldSchema = z.object({
  type: toolFieldTypeSchema,
  description: z.string().optional(),
});

const toolImplementationSchema = z.object({
  type: z.enum(['shell', 'claude-code', 'builtin']),
  command: z.string().optional(),
  prompt: z.string().optional(),
  builtinName: z.string().optional(),
}).refine(
  (data) => {
    if (data.type === 'shell') return !!data.command;
    if (data.type === 'claude-code') return !!data.prompt;
    if (data.type === 'builtin') return !!data.builtinName;
    return false;
  },
  { message: 'Shell tools need command, claude-code need prompt, builtin need builtinName' },
);

const toolActionSchema = z.object({
  description: z.string().optional(),
  inputs: z.record(z.string(), toolInputFieldSchema).default({}),
  outputs: z.record(z.string(), toolOutputFieldSchema).default({}),
});

export const toolDefinitionSchema = z.object({
  id: z.string().regex(TOOL_ID_RE, 'Tool id must be lowercase with hyphens only'),
  name: z.string().min(1),
  description: z.string().optional(),
  source: z.enum(['local', 'examples', 'community', 'builtin']).default('local'),

  config: z.record(z.unknown()).optional(),
  inputs: z.record(z.string(), toolInputFieldSchema).default({}),
  outputs: z.record(z.string(), toolOutputFieldSchema).default({}),
  actions: z.record(z.string(), toolActionSchema).optional(),

  implementation: toolImplementationSchema,
});

export type ToolDefinitionInput = z.input<typeof toolDefinitionSchema>;
export type ToolDefinitionParsed = z.output<typeof toolDefinitionSchema>;
