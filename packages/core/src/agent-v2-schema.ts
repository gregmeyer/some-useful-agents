/**
 * Zod schema for YAML v2 agents. Validates the shape a user wrote or an
 * importer produced before it ever reaches the DB. Catches:
 *   - bad ids (agent or node)
 *   - node-type / command-or-prompt mismatches
 *   - dependsOn references that don't exist in this agent's node list
 *   - cycles in the DAG
 *   - template refs ({{inputs.X}}, {{upstream.X.result}}) to undeclared targets
 *   - shell-command templating (same rule as v1: shell uses env vars)
 *   - cron cap (reuses v1 cron validator)
 *   - sensitive-env-var input-name shadowing (reuses v1 check)
 *
 * Kept structurally close to `schema.ts` so anyone familiar with the v1
 * schema can read this without a context switch.
 */

import { z } from 'zod';
import { validateScheduleInterval, CronInvalidError, CronTooFrequentError } from './cron-validator.js';
import { extractInputReferences, SENSITIVE_ENV_NAMES } from './input-resolver.js';
import { inputSpecSchema } from './schema.js';

const AGENT_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const NODE_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;
const SECRET_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
const INPUT_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

/**
 * Match `{{upstream.<nodeId>.result}}` anywhere in a string. Captures the
 * node id so we can cross-check against the declared node set.
 */
const UPSTREAM_REF_RE = /\{\{upstream\.([a-z0-9][a-z0-9_-]*)\.result\}\}/g;

export function extractUpstreamReferences(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(UPSTREAM_REF_RE)) {
    out.add(m[1]);
  }
  return out;
}

const CONTROL_FLOW_TYPES = new Set([
  'conditional', 'switch', 'loop', 'agent-invoke', 'branch', 'end', 'break',
]);

const onlyIfSchema = z.object({
  upstream: z.string(),
  field: z.string(),
  equals: z.unknown().optional(),
  notEquals: z.unknown().optional(),
  exists: z.boolean().optional(),
});

const conditionalConfigSchema = z.object({
  predicate: z.object({
    field: z.string(),
    equals: z.unknown().optional(),
    notEquals: z.unknown().optional(),
    exists: z.boolean().optional(),
  }),
});

const switchConfigSchema = z.object({
  field: z.string(),
  cases: z.record(z.unknown()),
});

const loopConfigSchema = z.object({
  over: z.string(),
  agentId: z.string(),
  maxIterations: z.number().int().positive().optional(),
});

const agentInvokeConfigSchema = z.object({
  agentId: z.string(),
  inputMapping: z.record(z.string()).optional(),
});

export const agentNodeSchema = z.object({
  id: z.string().regex(NODE_ID_RE, 'Node ids must be lowercase with hyphens/underscores only'),
  type: z.enum([
    'shell', 'claude-code',
    'conditional', 'switch', 'loop', 'agent-invoke', 'branch', 'end', 'break',
  ]),

  tool: z.string().optional(),
  action: z.string().optional(),
  toolInputs: z.record(z.unknown()).optional(),

  command: z.string().optional(),
  prompt: z.string().optional(),
  model: z.string().optional(),
  maxTurns: z.number().int().positive().optional(),
  allowedTools: z.array(z.string()).optional(),
  provider: z.enum(['claude', 'codex']).optional(),

  timeout: z.number().positive().optional(),
  env: z.record(z.string()).optional(),
  envAllowlist: z.array(z.string()).optional(),
  secrets: z.array(z.string().regex(SECRET_NAME_RE, 'Secret names must be UPPERCASE_WITH_UNDERSCORES')).optional(),
  redactSecrets: z.boolean().optional(),
  workingDirectory: z.string().optional(),

  dependsOn: z.array(z.string()).optional(),

  // Flow control
  onlyIf: onlyIfSchema.optional(),
  conditionalConfig: conditionalConfigSchema.optional(),
  switchConfig: switchConfigSchema.optional(),
  loopConfig: loopConfigSchema.optional(),
  agentInvokeConfig: agentInvokeConfigSchema.optional(),
  endMessage: z.string().optional(),

  position: z.object({ x: z.number(), y: z.number() }).optional(),
}).refine(
  (data) => {
    // Control-flow node types don't need command/prompt/tool.
    if (CONTROL_FLOW_TYPES.has(data.type)) return true;
    // When a named tool is set, the tool provides the implementation.
    if (data.tool) return true;
    // v0.15 compat: shell needs command, claude-code needs prompt.
    if (data.type === 'shell') return !!data.command;
    if (data.type === 'claude-code') return !!data.prompt;
    return false;
  },
  { message: 'Execution nodes without a tool require command (shell) or prompt (claude-code)' },
);

export const agentV2Schema = z.object({
  id: z.string().regex(AGENT_ID_RE, 'Agent id must be lowercase with hyphens only'),
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(['active', 'paused', 'archived', 'draft']).default('draft'),
  schedule: z.string().optional(),
  allowHighFrequency: z.boolean().optional(),
  source: z.enum(['examples', 'local', 'community']).default('local'),
  mcp: z.boolean().default(false),
  version: z.number().int().positive().default(1),

  provider: z.enum(['claude', 'codex']).optional(),
  model: z.string().optional(),

  inputs: z.record(
    z.string().regex(INPUT_NAME_RE, 'Input names must be UPPERCASE_WITH_UNDERSCORES'),
    inputSpecSchema,
  ).optional(),

  nodes: z.array(agentNodeSchema).min(1, 'An agent must have at least one node'),

  signal: z.object({
    title: z.string().min(1),
    icon: z.string().optional(),
    // v2 template system
    template: z.enum(['metric', 'time-series', 'text-headline', 'text-image', 'image', 'table', 'status', 'media', 'widget', 'comparison', 'key-value', 'story', 'funnel']).optional(),
    mapping: z.record(z.string()).optional(),
    // v1 (deprecated, still accepted)
    format: z.enum(['text', 'number', 'table', 'json', 'chart']).optional(),
    field: z.string().optional(),
    refresh: z.string().optional(),
    size: z.enum(['1x1', '2x1', '1x2', '2x2']).optional(),
    accent: z.enum(['teal', 'blue', 'green', 'orange', 'red', 'purple']).optional(),
    hidden: z.boolean().optional(),
    thresholds: z.array(z.object({
      above: z.number().optional(),
      below: z.number().optional(),
      palette: z.string(),
    })).optional(),
  }).refine(
    (s) => s.format !== undefined || s.template !== undefined,
    { message: 'Signal must declare either "format" (v1) or "template" (v2).' },
  ).optional(),

  outputWidget: z.object({
    type: z.enum(['diff-apply', 'key-value', 'raw', 'dashboard']),
    fields: z.array(z.object({
      name: z.string().min(1),
      label: z.string().optional(),
      type: z.enum(['text', 'code', 'badge', 'action', 'metric', 'stat']),
    })).min(1),
    actions: z.array(z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      method: z.literal('POST'),
      endpoint: z.string().min(1),
      payloadField: z.string().optional(),
    })).optional(),
  }).optional(),

  author: z.string().optional(),
  tags: z.array(z.string()).optional(),
}).superRefine((data, ctx) => {
  // Unique node ids
  const seen = new Map<string, number>();
  for (let i = 0; i < data.nodes.length; i++) {
    const id = data.nodes[i].id;
    if (seen.has(id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nodes', i, 'id'],
        message: `Duplicate node id "${id}" (first seen at index ${seen.get(id)}).`,
      });
    }
    seen.set(id, i);
  }

  const nodeIds = new Set(data.nodes.map((n) => n.id));

  // dependsOn targets exist in this agent's node list
  for (let i = 0; i < data.nodes.length; i++) {
    const node = data.nodes[i];
    for (const dep of node.dependsOn ?? []) {
      if (!nodeIds.has(dep)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['nodes', i, 'dependsOn'],
          message: `Node "${node.id}" dependsOn "${dep}", which is not a node in this agent.`,
        });
      }
      if (dep === node.id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['nodes', i, 'dependsOn'],
          message: `Node "${node.id}" cannot depend on itself.`,
        });
      }
    }
  }

  // Cycle detection (depth-first with colour states). Only run if dependsOn
  // references have resolved cleanly; otherwise the error above already
  // surfaces the structural problem.
  const colour = new Map<string, 'white' | 'grey' | 'black'>();
  for (const node of data.nodes) colour.set(node.id, 'white');
  const adj = new Map<string, string[]>();
  for (const node of data.nodes) adj.set(node.id, node.dependsOn ?? []);

  function visit(nodeId: string, stack: string[]): string[] | undefined {
    const c = colour.get(nodeId);
    if (c === 'grey') return [...stack, nodeId];
    if (c === 'black') return undefined;
    colour.set(nodeId, 'grey');
    for (const dep of adj.get(nodeId) ?? []) {
      const cycle = visit(dep, [...stack, nodeId]);
      if (cycle) return cycle;
    }
    colour.set(nodeId, 'black');
    return undefined;
  }

  for (const node of data.nodes) {
    if (colour.get(node.id) === 'white') {
      const cycle = visit(node.id, []);
      if (cycle) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['nodes'],
          message: `Cycle detected in DAG: ${cycle.join(' → ')}.`,
        });
        break; // one cycle report is enough
      }
    }
  }

  // Cron cap (same rule as v1)
  if (data.schedule) {
    try {
      validateScheduleInterval(data.schedule, { allowHighFrequency: data.allowHighFrequency });
    } catch (err) {
      if (err instanceof CronInvalidError || err instanceof CronTooFrequentError) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['schedule'], message: err.message });
      } else throw err;
    }
  }

  // Sensitive-env input-name shadowing
  if (data.inputs) {
    for (const name of Object.keys(data.inputs)) {
      if (SENSITIVE_ENV_NAMES.has(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['inputs', name],
          message:
            `Input name "${name}" is reserved. It would override a sensitive ` +
            `process environment variable. Pick a different name.`,
        });
      }
    }
  }

  // Per-node template checks:
  //   - {{inputs.X}} refs must map to a declared agent-level input
  //   - {{upstream.Y.result}} refs must be declared in this node's dependsOn
  //   - shell `command:` can't use either template style (env-var convention)
  const declaredInputs = new Set(Object.keys(data.inputs ?? {}));
  for (let i = 0; i < data.nodes.length; i++) {
    const node = data.nodes[i];
    const deps = new Set(node.dependsOn ?? []);

    const checkText = (text: string | undefined, pathSuffix: (string | number)[]) => {
      if (!text) return;
      const basePath = ['nodes', i, ...pathSuffix] as (string | number)[];
      const inputRefs = extractInputReferences(text);
      for (const ref of inputRefs) {
        if (!declaredInputs.has(ref)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: basePath,
            message: `Template references {{inputs.${ref}}} but "${ref}" is not declared in this agent's inputs block.`,
          });
        }
      }
      const upstreamRefs = extractUpstreamReferences(text);
      for (const ref of upstreamRefs) {
        if (!nodeIds.has(ref)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: basePath,
            message: `Template references {{upstream.${ref}.result}} but "${ref}" is not a node in this agent.`,
          });
        } else if (!deps.has(ref)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: basePath,
            message:
              `Template references {{upstream.${ref}.result}} but "${node.id}" does not declare ` +
              `"${ref}" in its dependsOn list. Add "${ref}" to dependsOn so the executor knows the order.`,
          });
        }
      }
    };

    if (node.type === 'shell' && node.command) {
      // Shell nodes use env-var convention for both inputs and upstream
      // outputs. Templates in the command string would force us to shell-
      // escape substituted values, which is fraught.
      const inputRefs = extractInputReferences(node.command);
      if (inputRefs.size > 0) {
        const first = [...inputRefs][0];
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['nodes', i, 'command'],
          message:
            `Shell nodes access inputs via environment variables, not templates. ` +
            `Replace {{inputs.${first}}} with $${first} in the command.`,
        });
      }
      const upstreamRefs = extractUpstreamReferences(node.command);
      if (upstreamRefs.size > 0) {
        const first = [...upstreamRefs][0];
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['nodes', i, 'command'],
          message:
            `Shell nodes access upstream outputs via environment variables, not templates. ` +
            `Replace {{upstream.${first}.result}} with $UPSTREAM_${first.toUpperCase().replace(/-/g, '_')}_RESULT in the command.`,
        });
      }
    }

    if (node.type === 'claude-code') {
      checkText(node.prompt, ['prompt']);
    }

    // env values (both shell and claude-code) may reference inputs + upstream
    if (node.env) {
      for (const [k, v] of Object.entries(node.env)) {
        checkText(v, ['env', k]);
      }
    }
  }
});

export type AgentV2Input = z.input<typeof agentV2Schema>;
export type AgentV2Parsed = z.output<typeof agentV2Schema>;
