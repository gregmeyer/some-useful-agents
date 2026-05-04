/**
 * Tool dispatch helpers for the DAG executor. Resolves tool ids and
 * builds input maps for tool invocations. Extracted from dag-executor.ts.
 */

import type { AgentNode } from './agent-v2-types.js';

/**
 * Derive the tool id for a node. Nodes that explicitly set `tool:` use
 * that. Nodes with first-class types that have a built-in tool counterpart
 * (currently only `file-write`) auto-resolve. v0.15 nodes (`shell` /
 * `claude-code`) without `tool:` use the existing spawn path directly.
 */
export function resolveToolId(node: AgentNode): string | undefined {
  if (node.tool) return node.tool;
  if (node.type === 'file-write') return 'file-write';
  return undefined;
}

/**
 * Build the inputs map for a tool invocation. For v0.16 nodes with
 * `toolInputs:`, use those directly. For first-class nodes with their own
 * top-level fields (file-write's path/content/append), desugar those.
 * For v0.15 nodes, fold the inline `command` / `prompt` into the shape the
 * built-in tool expects.
 */
export function resolveToolInputs(
  node: AgentNode,
  _upstreamSnapshot: Record<string, string>,
): Record<string, unknown> {
  if (node.toolInputs) return { ...node.toolInputs };
  if (node.type === 'shell' && node.command) {
    return { command: node.command };
  }
  if (node.type === 'claude-code' && node.prompt) {
    return {
      prompt: node.prompt,
      model: node.model,
      maxTurns: node.maxTurns,
      allowedTools: node.allowedTools,
    };
  }
  if (node.type === 'file-write') {
    return {
      path: node.path,
      content: node.content,
      ...(node.append !== undefined ? { append: node.append } : {}),
    };
  }
  return {};
}
