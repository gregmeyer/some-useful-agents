/**
 * Schema-aware save-time validation for upstream template references.
 *
 * Catches typos like `{{upstream.fetch-rows.rows.0.emial}}` at agent-import
 * time, when the upstream node's tool declares enough output schema to
 * disprove the field path. Strictly opt-in for now: callers (today only
 * the dashboard's YAML save path) pass a `resolveTool` callback so the
 * CLI's `parseAgent` keeps its zero-dependency signature.
 *
 * Lenient by design: if the upstream tool's output schema doesn't declare
 * `items` or `properties` for the part of the path being walked, the
 * validator stops without reporting an issue. We only fail when the
 * schema is rich enough to know the field is wrong. This keeps user-tools
 * and partially-typed built-ins from producing false positives.
 *
 * The synthetic `{{upstream.<id>.result}}` reference is always accepted —
 * every tool produces a `result` field for v0.15 backcompat.
 */

import type { Agent, AgentNode } from './agent-v2-types.js';
import type { ToolDefinition, ToolOutputField } from './tool-types.js';

export interface TemplatePathIssue {
  /** Node whose template contains the bad reference. */
  nodeId: string;
  /** Which field on the node was being validated (`prompt`, `command`, `content`, `path`, `env.X`, `toolInputs.X`). */
  field: string;
  /** The whole `{{upstream.…}}` token text, for the error message. */
  template: string;
  /** Upstream node id referenced. */
  upstreamNodeId: string;
  /** Dot path that failed (e.g. `rows.0.emial`). */
  fieldPath: string;
  /** Human-readable reason — used directly in error surfaces. */
  reason: string;
}

export interface TemplateValidatorDeps {
  /** Resolve a tool definition by id. Returns undefined when unknown. */
  resolveTool: (toolId: string) => ToolDefinition | undefined;
}

/** Matches `{{upstream.<id>.<path>}}`. Same regex as agent-v2-schema. */
const UPSTREAM_REF_RE = /\{\{upstream\.([a-z0-9][a-z0-9_-]*)\.([a-zA-Z0-9_.]+)\}\}/g;

/**
 * Walk every templated string in `agent` and return a list of issues for
 * field paths that don't match the upstream node's declared output schema.
 * Empty array means "no issues" — including the case where no schemas
 * were available to check against.
 */
export function validateAgentTemplatePaths(
  agent: Agent,
  deps: TemplateValidatorDeps,
): TemplatePathIssue[] {
  const issues: TemplatePathIssue[] = [];
  const nodesById = new Map<string, AgentNode>(agent.nodes.map((n) => [n.id, n]));

  for (const node of agent.nodes) {
    const visit = (text: string | undefined, field: string) => {
      if (!text) return;
      for (const m of text.matchAll(UPSTREAM_REF_RE)) {
        const [token, upstreamId, fieldPath] = m;
        if (fieldPath === 'result') continue;

        const upstream = nodesById.get(upstreamId);
        if (!upstream) continue; // schema validator already catches this
        const toolDef = resolveNodeTool(upstream, deps);
        if (!toolDef) continue; // upstream is a legacy shell/claude-code node, or unknown tool
        const outputs = resolveActionOutputs(toolDef, upstream.action);
        if (!outputs) continue;

        const reason = walkPath(outputs, fieldPath);
        if (reason) {
          issues.push({
            nodeId: node.id,
            field,
            template: token,
            upstreamNodeId: upstreamId,
            fieldPath,
            reason,
          });
        }
      }
    };

    visit(node.prompt, 'prompt');
    visit(node.command, 'command');
    visit(node.content, 'content');
    visit(node.path, 'path');
    if (node.env) {
      for (const [k, v] of Object.entries(node.env)) visit(v, `env.${k}`);
    }
    if (node.toolInputs) {
      for (const [k, v] of Object.entries(node.toolInputs)) {
        if (typeof v === 'string') visit(v, `toolInputs.${k}`);
      }
    }
  }

  return issues;
}

function resolveNodeTool(node: AgentNode, deps: TemplateValidatorDeps): ToolDefinition | undefined {
  if (!node.tool) return undefined;
  return deps.resolveTool(node.tool);
}

function resolveActionOutputs(
  tool: ToolDefinition,
  action: string | undefined,
): Record<string, ToolOutputField> | undefined {
  if (action && tool.actions && tool.actions[action]) {
    return tool.actions[action].outputs;
  }
  return tool.outputs;
}

/**
 * Walk a dot-path against an outputs map. Returns an error string if the
 * path is provably invalid; returns undefined if the path is valid OR if
 * the schema lacks the detail to disprove it (lenient mode).
 */
function walkPath(
  rootOutputs: Record<string, ToolOutputField>,
  fieldPath: string,
): string | undefined {
  const parts = fieldPath.split('.');
  const first = parts[0];
  const head = rootOutputs[first];
  if (!head) {
    const available = Object.keys(rootOutputs);
    return `Output "${first}" is not declared by the upstream tool. Available: ${available.join(', ') || '(none)'}.`;
  }

  let current: ToolOutputField = head;
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    const next = step(current, seg, parts.slice(0, i).join('.') || '(root)');
    if (typeof next === 'string') return next; // error
    if (next === undefined) return undefined;  // lenient stop
    current = next;
  }
  return undefined;
}

/**
 * Take one step into `current` for segment `seg`. Returns the next
 * ToolOutputField, undefined for "lenient stop" (schema unknown), or an
 * error string when we can prove the segment is wrong.
 */
function step(
  current: ToolOutputField,
  seg: string,
  pathSoFar: string,
): ToolOutputField | string | undefined {
  if (current.type === 'array') {
    if (!/^\d+$/.test(seg)) {
      return `"${pathSoFar}" is an array — index it with a number (e.g. \`${pathSoFar}.0\`), not "${seg}".`;
    }
    if (!current.items) return undefined; // lenient: array element schema not declared
    return current.items;
  }
  if (current.type === 'object') {
    if (!current.properties) return undefined; // lenient: properties not declared
    const next = current.properties[seg];
    if (!next) {
      const available = Object.keys(current.properties);
      const suggestion = suggest(seg, available);
      const suggestText = suggestion ? ` Did you mean "${suggestion}"?` : '';
      return `Property "${seg}" not found on "${pathSoFar}". Available: ${available.join(', ') || '(none)'}.${suggestText}`;
    }
    return next;
  }
  // Primitive: trying to descend further is wrong.
  return `"${pathSoFar}" is a ${current.type}; cannot index into it with ".${seg}".`;
}

/** Simple typo suggestion via Levenshtein. Returns the closest candidate within distance 2. */
function suggest(input: string, candidates: string[]): string | undefined {
  let best: { name: string; dist: number } | undefined;
  for (const c of candidates) {
    const d = levenshtein(input, c);
    if (d <= 2 && (!best || d < best.dist)) best = { name: c, dist: d };
  }
  return best?.name;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, row[j], row[j - 1]);
      prev = tmp;
    }
  }
  return row[n];
}

/**
 * Format a list of issues into a single human-readable error string —
 * suitable for surfacing in route flash messages or thrown errors.
 */
export function formatTemplatePathIssues(issues: TemplatePathIssue[]): string {
  return issues
    .map((i) => `${i.nodeId}.${i.field}: ${i.reason} (in ${i.template})`)
    .join('; ');
}
