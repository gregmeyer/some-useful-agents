import { z } from 'zod';
import { validateScheduleInterval, CronInvalidError, CronTooFrequentError } from './cron-validator.js';

export const agentDefinitionSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9-]+$/, 'Must be lowercase with hyphens only'),
  description: z.string().optional(),
  type: z.enum(['claude-code', 'shell']),

  // Shell agents
  command: z.string().optional(),

  // Claude-code agents
  prompt: z.string().optional(),
  model: z.string().optional(),
  maxTurns: z.number().int().positive().optional(),
  allowedTools: z.array(z.string()).optional(),

  // Common
  timeout: z.number().positive().default(300),
  env: z.record(z.string()).optional(),
  schedule: z.string().optional(),
  /**
   * Bypass the default cron frequency cap (60s minimum interval, 5-field only).
   * Required to use 6-field "with-seconds" expressions. Logged loudly on every
   * fire so the operator notices the unbounded cost surface.
   */
  allowHighFrequency: z.boolean().optional(),
  workingDirectory: z.string().optional(),

  // Chaining
  dependsOn: z.array(z.string()).optional(),
  input: z.string().optional(),

  // Secrets and env control
  secrets: z.array(z.string().regex(/^[A-Z_][A-Z0-9_]*$/, 'Must be a valid env var name (e.g. MY_API_KEY)')).optional(),
  envAllowlist: z.array(z.string()).optional(),

  // Metadata
  author: z.string().optional(),
  version: z.string().optional(),
  tags: z.array(z.string()).optional(),
}).refine(
  (data) => {
    if (data.type === 'shell') return !!data.command;
    if (data.type === 'claude-code') return !!data.prompt;
    return false;
  },
  { message: 'Shell agents require "command", claude-code agents require "prompt"' }
).superRefine((data, ctx) => {
  if (!data.schedule) return;
  try {
    validateScheduleInterval(data.schedule, { allowHighFrequency: data.allowHighFrequency });
  } catch (err) {
    if (err instanceof CronInvalidError || err instanceof CronTooFrequentError) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['schedule'],
        message: err.message,
      });
      return;
    }
    throw err;
  }
});

export type AgentDefinitionInput = z.input<typeof agentDefinitionSchema>;
