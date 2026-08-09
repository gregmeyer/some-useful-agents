/**
 * LLM tool-calling dispatch layer: resolve and execute the builtin / generated /
 * MCP tools an OpenAI-compatible model calls mid-generation. This is the
 * store-touching half of the tool loop; the pure schema half is `llm-tools.ts`,
 * which this module imports (never the reverse).
 *
 * IMPORTANT: this file must NOT import `node-spawner.ts` or `dag-executor.ts`.
 * Those import *from* here (transitively), so an import back would create a cycle.
 * That constraint is why shell/claude-code user tools (which need `spawnNodeReal`)
 * are intentionally NOT callable from the model loop — only builtin, generated
 * integration, and MCP tools are.
 */
import { getBuiltinTool } from './builtin-tools.js';
import { getGeneratedTool } from './integrations/generated-tools.js';
import { callMcpTool } from './mcp-client.js';
import { resolveVarsTemplate } from './node-templates.js';
import { evaluatePolicy, DEFAULT_POLICY_DOCUMENT, PolicyDeniedError, type PolicyDocument } from './policy-store.js';
import type { ToolDefinition, ToolOutput, BuiltinToolContext } from './tool-types.js';
import type { SecretsStore } from './secrets-store.js';
import type { ToolStore } from './tool-store.js';
import type { IntegrationsStore } from './integrations-store.js';
import type { VariablesStore } from './variables-store.js';
import {
  type OpenAiTool,
  type ToolCallExecutor,
  toOpenAiFunctionSchema,
  mangleToolName,
} from './llm-tools.js';

/** Per-run execution deps needed to resolve + run a tool the model requested. */
export interface ToolResolutionDeps {
  toolStore?: ToolStore;
  integrationsStore?: IntegrationsStore;
  secretsStore?: SecretsStore;
  variablesStore?: VariablesStore;
  experimentalApple?: boolean;
}

/** Default cap on a single tool result fed back to the model (context/cost guard). */
export const DEFAULT_MAX_OUTPUT_CHARS = 24_000;

/**
 * Resolve a tool id to its definition IF it is callable from the model loop:
 * builtin, generated integration, or an MCP user tool. Shell/claude-code user
 * tools are spawn-based and excluded (returns undefined). Uses the SAME deps as
 * dispatch so exposure and execution can't disagree (e.g. apple.* gating).
 */
function resolveToolDefinition(id: string, deps: ToolResolutionDeps): ToolDefinition | undefined {
  const builtin = getBuiltinTool(id);
  if (builtin) return builtin.definition;
  if (deps.integrationsStore) {
    const gen = getGeneratedTool(deps.integrationsStore, id, {
      secretsStore: deps.secretsStore,
      experimentalApple: deps.experimentalApple,
    });
    if (gen) return gen.definition;
  }
  if (deps.toolStore) {
    const userTool = deps.toolStore.getTool(id);
    if (userTool && userTool.implementation.type === 'mcp') return userTool;
  }
  return undefined;
}

/**
 * Execute an already-resolved tool call with model-supplied args. Mirrors the
 * DAG executor's builtin/generated/MCP branches minus templating (the model
 * supplies args directly, so there is no upstream to interpolate). MCP impl
 * fields still resolve `{{vars.X}}`. Throws on unresolved/uncallable tools and
 * disabled servers; the caller (buildToolExecutor) converts throws to isError.
 */
export async function executeResolvedTool(
  toolId: string,
  inputs: Record<string, unknown>,
  ctx: BuiltinToolContext,
  deps: ToolResolutionDeps,
  signal?: AbortSignal,
): Promise<ToolOutput> {
  const builtin = getBuiltinTool(toolId);
  if (builtin) return builtin.execute(inputs, ctx);

  if (deps.integrationsStore) {
    const gen = getGeneratedTool(deps.integrationsStore, toolId, {
      secretsStore: deps.secretsStore,
      experimentalApple: deps.experimentalApple,
    });
    if (gen) return gen.execute(inputs, ctx);
  }

  if (deps.toolStore) {
    const userTool = deps.toolStore.getTool(toolId);
    if (!userTool) {
      throw new Error(`Tool "${toolId}" did not resolve (not a builtin, generated, or stored tool).`);
    }
    if (userTool.implementation.type !== 'mcp') {
      throw new Error(
        `Tool "${toolId}" (type ${userTool.implementation.type}) is not callable from the model loop; ` +
          `only builtin, integration, and MCP tools are.`,
      );
    }
    // Server-level enable gate (same as dag-executor).
    const serverId = deps.toolStore.getToolServerId(toolId);
    if (serverId) {
      const server = deps.toolStore.getMcpServer(serverId);
      if (server && !server.enabled) {
        throw new Error(`MCP server "${serverId}" is disabled. Re-enable it under Settings → MCP Servers.`);
      }
    }
    const vars = deps.variablesStore ? deps.variablesStore.getAll() : {};
    const resolveStr = (s: string | undefined): string | undefined =>
      s === undefined ? undefined : resolveVarsTemplate(s, vars);
    const resolvedImpl = {
      ...userTool.implementation,
      mcpUrl: resolveStr(userTool.implementation.mcpUrl),
      mcpCommand: resolveStr(userTool.implementation.mcpCommand),
      mcpArgs: userTool.implementation.mcpArgs?.map((a) => resolveStr(a) ?? a),
      mcpEnv: userTool.implementation.mcpEnv
        ? Object.fromEntries(
            Object.entries(userTool.implementation.mcpEnv).map(([k, v]) => [k, resolveStr(v) ?? v]),
          )
        : undefined,
    };
    // Merge the tool's stored config defaults under the model-supplied args.
    const merged = { ...(userTool.config ?? {}), ...inputs };
    return callMcpTool(resolvedImpl, merged, signal);
  }

  throw new Error(`Tool "${toolId}" did not resolve (no integration or tool store available).`);
}

/** Result of exposing a candidate set: schemas + the name→id map (source of truth). */
export interface ResolvedToolExposure {
  tools: OpenAiTool[];
  /** OpenAI function name → real tool id. Consulted at dispatch time. */
  idByFunctionName: Map<string, string>;
  /** Real ids actually exposed (order-preserving, de-duplicated). */
  exposedToolIds: string[];
}

/**
 * Resolve a candidate id list into OpenAI tool schemas + a name→id map. Ids that
 * aren't callable (unknown, or shell/claude-code user tools) are silently
 * dropped. Non-builtin ids (dots) are mangled to valid function names; collisions
 * within the set are disambiguated with a numeric suffix. The map — not the
 * mangle — is authoritative; never invert `mangleToolName`.
 */
export function resolveExposedToolDefs(
  candidates: readonly string[] | undefined,
  deps: ToolResolutionDeps,
): ResolvedToolExposure {
  const tools: OpenAiTool[] = [];
  const idByFunctionName = new Map<string, string>();
  const exposedToolIds: string[] = [];
  if (!candidates || candidates.length === 0) return { tools, idByFunctionName, exposedToolIds };

  const seenIds = new Set<string>();
  const usedNames = new Set<string>();
  for (const id of candidates) {
    if (seenIds.has(id)) continue;
    const def = resolveToolDefinition(id, deps);
    if (!def) continue;
    seenIds.add(id);

    let name = mangleToolName(id);
    if (usedNames.has(name)) {
      let n = 2;
      while (usedNames.has(`${name}_${n}`)) n++;
      name = `${name}_${n}`;
    }
    usedNames.add(name);
    idByFunctionName.set(name, id);
    exposedToolIds.push(id);
    tools.push(toOpenAiFunctionSchema(def, name));
  }
  return { tools, idByFunctionName, exposedToolIds };
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
  /** Real tool ids the model is allowed to call (already validated to exist). */
  exposedToolIds: readonly string[];
  /** OpenAI function name → real id. Omit for identity (builtin-only callers). */
  idByFunctionName?: Map<string, string>;
  agentId: string;
  agentSource: string;
  policyDocument?: PolicyDocument;
  /** Threaded into BuiltinToolContext for the tool's execute(). */
  env?: Record<string, string>;
  workingDirectory?: string;
  timeoutSec?: number;
  secretsStore?: SecretsStore;
  toolStore?: ToolStore;
  integrationsStore?: IntegrationsStore;
  variablesStore?: VariablesStore;
  experimentalApple?: boolean;
  /** Forwarded to MCP calls so they cancel with the run. */
  signal?: AbortSignal;
  /** Cap on a single result fed back to the model. Default DEFAULT_MAX_OUTPUT_CHARS. */
  maxOutputChars?: number;
}

/**
 * Build the executor the OpenAI tool loop calls for each model tool_call. Never
 * throws — every failure (unknown tool, bad args, policy deny, tool error)
 * becomes an `isError` result the model can read and recover from, keeping the
 * loop alive. Dispatches builtin + generated + MCP tools.
 */
export function buildToolExecutor(opts: ToolExecutorOptions): ToolCallExecutor {
  const allowed = new Set(opts.exposedToolIds);
  const map = opts.idByFunctionName;
  const maxOut = opts.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  const deps: ToolResolutionDeps = {
    toolStore: opts.toolStore,
    integrationsStore: opts.integrationsStore,
    secretsStore: opts.secretsStore,
    variablesStore: opts.variablesStore,
    experimentalApple: opts.experimentalApple,
  };

  return async (name, argsJson) => {
    // Translate the model's function name back to the real tool id (identity if
    // no map — builtin ids are already valid function names).
    const toolId = map?.get(name) ?? name;
    if (!allowed.has(toolId)) {
      return { content: `Tool "${name}" is not available. Available: ${[...allowed].join(', ') || '(none)'}.`, isError: true };
    }

    let args: Record<string, unknown>;
    try {
      const parsed = argsJson && argsJson.trim() ? JSON.parse(argsJson) : {};
      args = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return { content: `Invalid JSON arguments for "${name}": ${argsJson.slice(0, 200)}`, isError: true };
    }

    // Policy seam — same gate as the DAG executor, keyed on the REAL tool id.
    try {
      const decision = evaluatePolicy(opts.policyDocument ?? DEFAULT_POLICY_DOCUMENT, {
        toolId,
        resource: resourceFromArgs(toolId, args),
        agentSource: opts.agentSource as 'examples' | 'local' | 'community',
        agentId: opts.agentId,
      });
      if (decision.effect === 'deny') {
        throw new PolicyDeniedError(
          decision.reason ?? `Policy denied tool "${toolId}".`,
          toolId, resourceFromArgs(toolId, args), decision.matchedRuleIndex,
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
      const out = await executeResolvedTool(toolId, args, ctx, deps, opts.signal);
      let content = typeof out.result === 'string' && out.result.length > 0 ? out.result : JSON.stringify(out);
      if (content.length > maxOut) {
        content = content.slice(0, maxOut) + `\n\n[output truncated — ${content.length - maxOut} more chars]`;
      }
      return { content, isError: out.isError === true };
    } catch (err) {
      return { content: `Tool "${name}" failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  };
}

/**
 * Back-compat shim: builtin-only executor. Existing callers/tests pass no stores
 * and no name map, so dispatch degrades to `getBuiltinTool` with identity naming.
 */
export function buildBuiltinToolExecutor(opts: ToolExecutorOptions): ToolCallExecutor {
  return buildToolExecutor(opts);
}
