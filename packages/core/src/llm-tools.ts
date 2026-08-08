/**
 * LLM tool-calling support: expose builtin tools to an OpenAI-compatible model
 * as function schemas, and execute the model's tool calls in-process.
 *
 * Used by the `invokeOpenAiChat` tool loop (openai-http-invoker.ts) so local /
 * OpenAI-compatible models (Qwen, etc.) can actually call `web-scrape`,
 * `web-fetch`, `http-get`, … mid-generation — instead of being *told* to call a
 * tool they have no way to invoke. Builtins only for v1 (their ids are valid
 * OpenAI function names; generated-tool ids contain dots — a follow-up).
 */
import { getBuiltinTool, isBuiltinTool } from './builtin-tools.js';
import { evaluatePolicy, DEFAULT_POLICY_DOCUMENT, PolicyDeniedError, type PolicyDocument } from './policy-store.js';
import type { ToolDefinition, ToolFieldType, BuiltinToolContext } from './tool-types.js';
import type { SecretsStore } from './secrets-store.js';

/** OpenAI `tools[]` entry (function-calling). */
export interface OpenAiTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: boolean;
    };
  };
}

/** Result of running one model-requested tool call. */
export interface ToolCallResult {
  content: string;
  isError?: boolean;
}

/** (name, JSON-encoded args) → result content the loop feeds back to the model. */
export type ToolCallExecutor = (name: string, argsJson: string) => Promise<ToolCallResult>;

/** Map a builtin `ToolFieldType` to a JSON-Schema property. `json` stays open. */
function fieldToSchema(type: ToolFieldType): Record<string, unknown> {
  switch (type) {
    case 'string': return { type: 'string' };
    case 'number': return { type: 'number' };
    case 'boolean': return { type: 'boolean' };
    case 'object': return { type: 'object' };
    case 'array': return { type: 'array' };
    case 'json': return {}; // any JSON
    default: return {};
  }
}

/** Convert a builtin tool's definition into an OpenAI function schema. */
export function toOpenAiFunctionSchema(def: ToolDefinition): OpenAiTool {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, field] of Object.entries(def.inputs)) {
    const prop = fieldToSchema(field.type);
    if (field.description) prop.description = field.description;
    if (field.default !== undefined) prop.default = field.default;
    properties[name] = prop;
    if (field.required) required.push(name);
  }
  return {
    type: 'function',
    function: {
      name: def.id,
      description: def.description,
      parameters: { type: 'object', properties, required, additionalProperties: false },
    },
  };
}

/**
 * The subset of builtin tool ids from `candidates` that actually exist — the set
 * exposed to the model. Order-preserving + de-duplicated.
 */
export function resolveExposedTools(candidates: readonly string[] | undefined): OpenAiTool[] {
  if (!candidates || candidates.length === 0) return [];
  const seen = new Set<string>();
  const out: OpenAiTool[] = [];
  for (const id of candidates) {
    if (seen.has(id) || !isBuiltinTool(id)) continue;
    seen.add(id);
    const entry = getBuiltinTool(id);
    if (entry) out.push(toOpenAiFunctionSchema(entry.definition));
  }
  return out;
}

/** Runtime sibling of dag-executor's extractPrimaryResource, over model args. */
function resourceFromArgs(toolId: string, args: Record<string, unknown>): string {
  if (toolId === 'http-get' || toolId === 'http-post' || toolId === 'web-fetch' || toolId === 'web-scrape') {
    const v = args.url ?? args.endpoint;
    return typeof v === 'string' ? v : '';
  }
  if (toolId === 'file-read' || toolId === 'file-write') {
    return typeof args.path === 'string' ? args.path : '';
  }
  if (toolId === 'shell-exec') {
    return typeof args.command === 'string' ? args.command : '';
  }
  return '';
}

export interface ToolExecutorOptions {
  /** The tool ids the model is allowed to call (already validated to exist). */
  exposedToolIds: readonly string[];
  agentId: string;
  agentSource: string;
  policyDocument?: PolicyDocument;
  /** Threaded into BuiltinToolContext for the tool's execute(). */
  env?: Record<string, string>;
  workingDirectory?: string;
  timeoutSec?: number;
  secretsStore?: SecretsStore;
}

/**
 * Build the executor the OpenAI tool loop calls for each model tool_call.
 * Never throws — every failure (unknown tool, bad args, policy deny, tool
 * error) becomes an `isError` result string the model can read and recover
 * from, keeping the loop alive.
 */
export function buildBuiltinToolExecutor(opts: ToolExecutorOptions): ToolCallExecutor {
  const allowed = new Set(opts.exposedToolIds);
  return async (name, argsJson) => {
    if (!allowed.has(name)) {
      return { content: `Tool "${name}" is not available. Available: ${[...allowed].join(', ') || '(none)'}.`, isError: true };
    }
    const entry = getBuiltinTool(name);
    if (!entry) return { content: `Unknown tool "${name}".`, isError: true };

    let args: Record<string, unknown>;
    try {
      const parsed = argsJson && argsJson.trim() ? JSON.parse(argsJson) : {};
      args = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return { content: `Invalid JSON arguments for "${name}": ${argsJson.slice(0, 200)}`, isError: true };
    }

    // Policy seam — same gate as the DAG executor (stub allows today; PR C enforces).
    try {
      const decision = evaluatePolicy(opts.policyDocument ?? DEFAULT_POLICY_DOCUMENT, {
        toolId: name,
        resource: resourceFromArgs(name, args),
        agentSource: opts.agentSource as 'examples' | 'local' | 'community',
        agentId: opts.agentId,
      });
      if (decision.effect === 'deny') {
        throw new PolicyDeniedError(
          decision.reason ?? `Policy denied tool "${name}".`,
          name, resourceFromArgs(name, args), decision.matchedRuleIndex,
        );
      }
    } catch (err) {
      if (err instanceof PolicyDeniedError) return { content: `Blocked by policy: ${err.message}`, isError: true };
      throw err;
    }

    const ctx: BuiltinToolContext = {
      workingDirectory: opts.workingDirectory,
      env: opts.env,
      timeout: opts.timeoutSec,
      secretsStore: opts.secretsStore,
    };
    try {
      const out = await entry.execute(args, ctx);
      const content = typeof out.result === 'string' && out.result.length > 0 ? out.result : JSON.stringify(out);
      return { content };
    } catch (err) {
      return { content: `Tool "${name}" failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  };
}
