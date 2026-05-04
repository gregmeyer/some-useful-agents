/**
 * Derived agent capabilities — a parse-time, best-effort static analysis
 * of what an agent uses and what it does. Computed at the parse boundary
 * (parseAgent + agent-store rowToAgent) and attached to the Agent record.
 * Not persisted; recomputed every read.
 *
 * Used by:
 *   - the planner-fronted agent-builder (PR A): "what existing agents
 *     can I compose? what tools are needed? what side effects are
 *     incurred?"
 *   - the future "test this agent" preflight: "does this agent need MCP
 *     servers I haven't installed?"
 *
 * This is heuristic and intentionally conservative — an empty array
 * means "I couldn't statically prove this," NOT "the agent doesn't do X."
 * Don't treat the output as a security boundary.
 */

import type { Agent, AgentNode } from './agent-v2-types.js';

export interface AgentCapabilities {
  /**
   * Every tool this agent invokes. Includes `shell-exec` for plain shell
   * nodes and `claude-code` for plain claude-code nodes (the desugared
   * defaults), every explicit `node.tool`, and every entry in any
   * `node.allowedTools`. Sorted, deduped.
   */
  tools_used: string[];

  /**
   * MCP servers this agent references. Detected via the
   * `mcp__<server>__<tool>` naming convention. Empty when no MCP-prefixed
   * tools are referenced (sua's tool-store ids are flat, so this is
   * usually empty until/unless the prefix convention is adopted).
   */
  mcp_servers_used: string[];

  /**
   * What the agent does to the outside world. A non-exhaustive set:
   *   - 'sends_notifications' — has a `notify:` block
   *   - 'writes_files' — uses file-writing tools or shell redirects
   *   - 'posts_http' — uses http-post or webhook handlers
   * Sorted.
   */
  side_effects: SideEffect[];

  /**
   * External URLs the agent statically references. Sourced from
   * `toolInputs.url` / `toolInputs.endpoint`, plus regex hits in
   * shell commands and claude-code prompts. Sorted, deduped.
   */
  reads_external: string[];
}

export type SideEffect =
  | 'sends_notifications'
  | 'writes_files'
  | 'posts_http';

/** Tool names that imply 'writes_files' when present in tool: or allowedTools. */
const FILE_WRITING_TOOLS = new Set([
  'file-write',
  'file-append',
  'Write',  // claude-code built-in
  'Edit',   // claude-code built-in
  'NotebookEdit',
]);

/**
 * Tool names that imply 'posts_http' when used as `tool:` on a node.
 * `webhook` notify handlers are caught separately by inspecting `notify:`.
 */
const HTTP_POSTING_TOOLS = new Set(['http-post']);

/** Heuristic regex for file-writing shell patterns. Catches the common cases. */
const SHELL_WRITES_RE = /(?:>>?|\btee\b|\bmkdir\b|\bmv\b|\bcp\b|\brm\b)/;

/** Extract URLs from arbitrary text. Conservative — only http(s)://. */
const URL_RE = /https?:\/\/[^\s'"`<>{}|\\^]+/g;

const MCP_TOOL_RE = /^mcp__([a-zA-Z0-9_-]+)__/;

export function deriveCapabilities(agent: Agent): AgentCapabilities {
  const tools = new Set<string>();
  const mcpServers = new Set<string>();
  const sideEffects = new Set<SideEffect>();
  const urls = new Set<string>();

  if (agent.notify) sideEffects.add('sends_notifications');
  for (const handler of agent.notify?.handlers ?? []) {
    if (handler.type === 'webhook') sideEffects.add('posts_http');
  }

  for (const node of agent.nodes ?? []) {
    collectFromNode(node, tools, mcpServers, sideEffects, urls);
  }

  return {
    tools_used: [...tools].sort(),
    mcp_servers_used: [...mcpServers].sort(),
    side_effects: [...sideEffects].sort(),
    reads_external: [...urls].sort(),
  };
}

function collectFromNode(
  node: AgentNode,
  tools: Set<string>,
  mcpServers: Set<string>,
  sideEffects: Set<SideEffect>,
  urls: Set<string>,
): void {
  // Tool resolution: prefer explicit `tool:`, else fall back to type-based
  // desugaring. Flow-control node types (conditional/branch/end/...) have
  // no tool; skip them silently.
  const explicitTool = typeof node.tool === 'string' && node.tool ? node.tool : undefined;
  const desugaredTool = node.type === 'shell' ? 'shell-exec'
    : node.type === 'claude-code' ? 'claude-code'
    : undefined;
  const primaryTool = explicitTool ?? desugaredTool;
  if (primaryTool) {
    tools.add(primaryTool);
    classifyTool(primaryTool, sideEffects);
    const mcp = primaryTool.match(MCP_TOOL_RE);
    if (mcp) mcpServers.add(mcp[1]);
  }

  for (const allowed of node.allowedTools ?? []) {
    if (typeof allowed !== 'string' || allowed.length === 0) continue;
    tools.add(allowed);
    classifyTool(allowed, sideEffects);
    const mcp = allowed.match(MCP_TOOL_RE);
    if (mcp) mcpServers.add(mcp[1]);
  }

  // Shell command heuristics for file-writing.
  if (typeof node.command === 'string' && SHELL_WRITES_RE.test(node.command)) {
    sideEffects.add('writes_files');
  }

  // URLs from toolInputs (canonical key names: url, endpoint).
  const ti = node.toolInputs ?? {};
  for (const key of ['url', 'endpoint']) {
    const v = ti[key];
    if (typeof v === 'string' && /^https?:\/\//.test(v)) urls.add(v);
  }

  // URLs from free text in command + prompt.
  for (const text of [node.command, node.prompt] as Array<string | undefined>) {
    if (!text) continue;
    const matches = text.match(URL_RE);
    if (matches) for (const u of matches) urls.add(stripTrailingPunct(u));
  }
}

function classifyTool(tool: string, sideEffects: Set<SideEffect>): void {
  if (FILE_WRITING_TOOLS.has(tool)) sideEffects.add('writes_files');
  if (HTTP_POSTING_TOOLS.has(tool)) sideEffects.add('posts_http');
}

/** Trailing `.`, `,`, `)` are common in prose URLs and aren't part of the URL. */
function stripTrailingPunct(u: string): string {
  return u.replace(/[.,;:!?)\]}]+$/, '');
}
