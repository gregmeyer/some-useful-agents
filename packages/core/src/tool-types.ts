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

export type ToolImplementationType = 'shell' | 'claude-code' | 'builtin' | 'mcp';

export type McpTransport = 'stdio' | 'http';

export interface ToolImplementation {
  type: ToolImplementationType;
  command?: string;
  prompt?: string;
  /** For builtin tools: the registered function name in the built-in registry. */
  builtinName?: string;

  /**
   * MCP fields (type: 'mcp'). The executor opens a client to the configured
   * MCP server (pooled per server) and invokes `mcpToolName` with the node's
   * resolved inputs. String fields honor `{{secrets.NAME}}` / `{{vars.NAME}}`.
   */
  mcpTransport?: McpTransport;
  /** stdio transport: executable to spawn (e.g. "npx"). */
  mcpCommand?: string;
  /** stdio transport: args passed to mcpCommand. */
  mcpArgs?: string[];
  /** stdio transport: extra env vars (merged over process.env). */
  mcpEnv?: Record<string, string>;
  /** http transport: streamable HTTP endpoint URL. */
  mcpUrl?: string;
  /** Remote tool name to invoke on the MCP server. */
  mcpToolName?: string;
}

/**
 * Tool-level configuration. Set once per project (or per tool install),
 * persists across invocations. Merged with per-invocation `inputs` at
 * dispatch time — config values act as defaults that inputs can override.
 *
 * Example: an `http-get` tool with `config.baseUrl` set means nodes
 * only need to pass `inputs.path` instead of a full URL every time.
 * Config values can reference secrets via `{{secrets.NAME}}` and
 * global variables via `{{vars.NAME}}`.
 */
export interface ToolConfig {
  [key: string]: unknown;
}

/**
 * A named operation within a multi-action tool. Single-action tools
 * (the common case) omit `actions` and use top-level `inputs`/`outputs`
 * directly. Multi-action tools declare each operation with its own
 * typed I/O; the node specifies `action: "query"` alongside `tool:`.
 */
export interface ToolAction {
  description?: string;
  inputs: Record<string, ToolInputField>;
  outputs: Record<string, ToolOutputField>;
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

  /**
   * Project-level configuration. Merged with per-invocation inputs at
   * dispatch time. Stored in `.sua/tool-config/<id>.json` or inline in
   * the tool YAML for bundled defaults.
   */
  config?: ToolConfig;

  /** Per-invocation inputs for single-action tools. */
  inputs: Record<string, ToolInputField>;
  /** Declared outputs for single-action tools. */
  outputs: Record<string, ToolOutputField>;

  /**
   * Multi-action tools declare named operations here. When `actions` is
   * set, the top-level `inputs`/`outputs` serve as shared defaults that
   * every action inherits (actions can override per-field). Nodes
   * reference a specific action via `action: "query"` on the node YAML.
   */
  actions?: Record<string, ToolAction>;

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
