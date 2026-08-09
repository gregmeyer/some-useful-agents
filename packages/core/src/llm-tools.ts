/**
 * LLM tool-calling schema layer: convert tool definitions into OpenAI function
 * schemas and name them safely for the model. This module is intentionally
 * dependency-light (builtin-tools + tool-types only) so it can be imported widely.
 *
 * The store-touching dispatch half — resolving + executing builtin / generated /
 * MCP tools the model calls — lives in `llm-tool-dispatch.ts`, which imports from
 * here (never the reverse), keeping this file free of executor/store dependencies.
 */
import { getBuiltinTool, isBuiltinTool } from './builtin-tools.js';
import type { ToolDefinition, ToolFieldType } from './tool-types.js';

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

/**
 * OpenAI function names must match `^[a-zA-Z0-9_-]+$`. Builtin ids already do, but
 * generated-tool ids (`csv.read.<slug>`) and MCP-tool ids contain dots. Replace every
 * disallowed char with `_`. This is NOT guaranteed injective — callers that expose a
 * SET of tools must disambiguate collisions and keep a functionName→id map as the
 * source of truth (see resolveExposedToolDefs); never invert this transform.
 */
export function mangleToolName(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, '_');
  // OpenAI rejects empty names; fall back to a stable placeholder.
  return safe.length > 0 ? safe : 'tool';
}

/**
 * Convert a tool definition into an OpenAI function schema. `functionName` overrides
 * the exposed name (defaults to `def.id`); pass a mangled name for non-builtin ids.
 */
export function toOpenAiFunctionSchema(def: ToolDefinition, functionName?: string): OpenAiTool {
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
      name: functionName ?? def.id,
      description: def.description,
      parameters: { type: 'object', properties, required, additionalProperties: false },
    },
  };
}

/**
 * The subset of builtin tool ids from `candidates` that actually exist, as OpenAI
 * schemas. Builtin-only; back-compat for callers that don't need generated/MCP
 * exposure. `resolveExposedToolDefs` (llm-tool-dispatch.ts) is the superset.
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
