import { z } from 'zod';

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
);

export type AgentDefinitionInput = z.input<typeof agentDefinitionSchema>;
