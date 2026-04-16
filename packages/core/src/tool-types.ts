/**
 * Tool types. A tool is a named, reusable unit of work that a node invokes
 * by reference. It declares typed inputs + structured outputs; the executor
 * validates both at save time (template paths) and run time (output framing).
 *
 * v0.16 introduces the abstraction; v0.15's inline `type: shell` /
 * `type: claude-code` desugar into `tool: shell-exec` / `tool: claude-code`
 * at load time for backwards compatibility.
 */

export type ToolSource = 'local' | 'examples' | 'community' | 'builtin';

export type ToolFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'json'
  | 'object'
  | 'array';

export interface ToolInputField {
  type: ToolFieldType;
  description?: string;
  default?: string | number | boolean;
  required?: boolean;
}

export interface ToolOutputField {
  type: ToolFieldType;
  description?: string;
}

export type ToolImplementationType = 'shell' | 'claude-code' | 'builtin';

export interface ToolImplementation {
  type: ToolImplementationType;
  command?: string;
  prompt?: string;
  /** For builtin tools: the registered function name in the built-in registry. */
  builtinName?: string;
}

/**
 * The full definition of a tool as stored in `tools/` YAML or the DB.
 * Analogous to `Agent` for agents.
 */
export interface ToolDefinition {
  id: string;
  name: string;
  description?: string;
  source: ToolSource;

  inputs: Record<string, ToolInputField>;
  outputs: Record<string, ToolOutputField>;

  implementation: ToolImplementation;

  createdAt?: string;
  updatedAt?: string;
}

/**
 * The structured output a tool produces at run time. Keys match the
 * tool's declared `outputs`. The executor validates the shape against
 * the declaration; extra fields are dropped, missing required fields
 * fail the node.
 *
 * Every tool also produces a synthetic `result` field (full stdout for
 * shell, assistant text for claude-code) for v0.15 backcompat. User
 * tools may declare `result` explicitly in their outputs if they want
 * to control its value.
 */
export interface ToolOutput {
  [key: string]: unknown;
  result?: string;
}

/**
 * A registered built-in tool. The executor calls `execute()` directly
 * instead of spawning a child process. Built-in tools are always
 * trusted (source: 'builtin') and don't go through the shell gate.
 */
export interface BuiltinToolEntry {
  definition: ToolDefinition;
  execute: (inputs: Record<string, unknown>, context: BuiltinToolContext) => Promise<ToolOutput>;
}

export interface BuiltinToolContext {
  workingDirectory?: string;
  env?: Record<string, string>;
  timeout?: number;
}
