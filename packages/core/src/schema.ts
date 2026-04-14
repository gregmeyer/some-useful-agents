import { z } from 'zod';
import { validateScheduleInterval, CronInvalidError, CronTooFrequentError } from './cron-validator.js';
import { extractInputReferences } from './input-resolver.js';

/**
 * Per-input declaration. See docs/SECURITY.md and input-resolver.ts for the
 * full type/default/required semantics.
 */
export const inputSpecSchema = z.object({
  type: z.enum(['string', 'number', 'boolean', 'enum']),
  values: z.array(z.string()).optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  required: z.boolean().optional(),
  description: z.string().optional(),
}).refine(
  (data) => data.type !== 'enum' || (data.values && data.values.length > 0),
  { message: 'Enum inputs must declare a non-empty "values" array.', path: ['values'] },
);

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
  /**
   * Whether this agent is exposed via the MCP server's `list-agents` and
   * `run-agent` tools. Defaults to false — agents must explicitly opt in
   * to be callable from MCP clients (Claude Desktop, etc.). Shrinks the
   * blast radius of a compromised MCP client from "all loaded agents" to
   * "agents the user has explicitly marked safe for remote invocation".
   */
  mcp: z.boolean().default(false),
  /**
   * When true, known-prefix secrets (AWS access keys, GitHub PATs, OpenAI
   * keys, Slack tokens) are scrubbed from the agent's captured stdout and
   * stderr before they land in the run store. Useful for agents that call
   * third-party APIs and might echo a leaked token in their response.
   */
  redactSecrets: z.boolean().default(false),
  workingDirectory: z.string().optional(),

  // Chaining
  dependsOn: z.array(z.string()).optional(),
  input: z.string().optional(),

  // Secrets and env control
  secrets: z.array(z.string().regex(/^[A-Z_][A-Z0-9_]*$/, 'Must be a valid env var name (e.g. MY_API_KEY)')).optional(),
  envAllowlist: z.array(z.string()).optional(),

  /**
   * Runtime inputs declared by this agent. Callers supply values via
   * `--input KEY=value`; YAML defaults fill in the rest. Input names must
   * match env-var conventions (uppercase with underscores). See
   * `input-resolver.ts` for full semantics.
   */
  inputs: z.record(
    z.string().regex(/^[A-Z_][A-Z0-9_]*$/, 'Input names must be UPPERCASE_WITH_UNDERSCORES'),
    inputSpecSchema,
  ).optional(),

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
  if (data.schedule) {
    try {
      validateScheduleInterval(data.schedule, { allowHighFrequency: data.allowHighFrequency });
    } catch (err) {
      if (err instanceof CronInvalidError || err instanceof CronTooFrequentError) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['schedule'],
          message: err.message,
        });
      } else {
        throw err;
      }
    }
  }

  // Inputs: reject `{{inputs.*}}` in shell commands. Shell agents access
  // inputs via `$VAR` env vars; templating inside a command string would
  // force us to shell-escape substituted values, which is fraught. This
  // rule pushes authors into the idiomatic shell path.
  if (data.type === 'shell' && data.command) {
    const refs = extractInputReferences(data.command);
    if (refs.size > 0) {
      const first = [...refs][0];
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['command'],
        message:
          `Shell agents access inputs via environment variables, not templates. ` +
          `Replace {{inputs.${first}}} with $${first} in the command ` +
          `(declared inputs are injected into the process env automatically).`,
      });
    }
  }

  // Every `{{inputs.X}}` reference in prompt or env values must appear in
  // the agent's `inputs:` declaration. Catches typos at load time rather
  // than silent empty-string substitution at run time.
  const declared = new Set(Object.keys(data.inputs ?? {}));
  const checkRefs = (text: string | undefined, path: (string | number)[]): void => {
    if (!text) return;
    const refs = extractInputReferences(text);
    for (const name of refs) {
      if (!declared.has(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message:
            `Template references {{inputs.${name}}} but "${name}" is not declared ` +
            `in this agent's \`inputs:\` block.`,
        });
      }
    }
  };
  checkRefs(data.prompt, ['prompt']);
  if (data.env) {
    for (const [k, v] of Object.entries(data.env)) {
      checkRefs(v, ['env', k]);
    }
  }
});

export type AgentDefinitionInput = z.input<typeof agentDefinitionSchema>;
