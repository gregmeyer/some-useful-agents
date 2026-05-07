/**
 * Control-flow node execution: conditional, switch, agent-invoke, loop,
 * onlyIf evaluation, and JSON path walking. Extracted from dag-executor.ts.
 *
 * Agent-invoke and loop call back into the DAG executor recursively via
 * an injected `executeDag` function to avoid circular imports.
 */

import type { Agent, AgentNode, NodeOutput, OnlyIfCondition } from './agent-v2-types.js';
import type { Run } from './types.js';
import type { DagExecutorDeps, DagExecuteOptions } from './dag-executor.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface ControlFlowResult {
  ok: boolean;
  output: Record<string, unknown>;
  error?: string;
}

export interface AgentInvokeResult {
  ok: boolean;
  result?: string;
  output?: Record<string, unknown>;
  error?: string;
}

/** Callback type for recursive DAG execution (avoids circular import). */
export type ExecuteDagFn = (
  agent: Agent,
  options: DagExecuteOptions,
  deps: DagExecutorDeps,
) => Promise<Run>;

// ── Conditional + Switch ───────────────────────────────────────────────

export function executeControlFlowNode(
  node: AgentNode,
  outputs: Map<string, NodeOutput>,
): ControlFlowResult {
  if (node.type === 'conditional') {
    return executeConditionalNode(node, outputs);
  }
  if (node.type === 'switch') {
    return executeSwitchNode(node, outputs);
  }
  return { ok: false, output: {}, error: `Unknown control-flow type: ${node.type}` };
}

function executeConditionalNode(
  node: AgentNode,
  outputs: Map<string, NodeOutput>,
): ControlFlowResult {
  const upstreamId = (node.dependsOn ?? [])[0];
  if (!upstreamId) {
    return { ok: false, output: {}, error: 'Conditional node has no dependsOn' };
  }
  const upOutput = outputs.get(upstreamId);
  if (!upOutput) {
    return { ok: false, output: {}, error: `Upstream "${upstreamId}" has no output` };
  }

  // Use explicit config or auto-infer from upstream output.
  const config = node.conditionalConfig ?? inferConditionalConfig(upOutput);

  let value: unknown;
  if (upOutput.outputs) {
    value = walkPath(upOutput.outputs, config.predicate.field);
  } else {
    try {
      const parsed = JSON.parse(upOutput.result);
      value = walkPath(parsed, config.predicate.field);
    } catch {
      value = config.predicate.field === 'result' ? upOutput.result : undefined;
    }
  }

  let matched = false;
  if (config.predicate.exists !== undefined) {
    matched = config.predicate.exists
      ? (value !== undefined && value !== null)
      : (value === undefined || value === null);
  } else if (config.predicate.equals !== undefined) {
    matched = value == config.predicate.equals;
  } else if (config.predicate.notEquals !== undefined) {
    matched = value != config.predicate.notEquals;
  } else {
    matched = value !== undefined && value !== null;
  }

  return { ok: true, output: { matched, value } };
}

/**
 * Auto-infer a conditionalConfig from the upstream output shape.
 * Checks common patterns: error field, status field, valid field.
 * Fallback: check if output is truthy.
 */
function inferConditionalConfig(upOutput: NodeOutput): NonNullable<AgentNode['conditionalConfig']> {
  // Try to parse upstream output as JSON to inspect field names.
  let parsed: Record<string, unknown> | undefined;
  try {
    const p = JSON.parse(upOutput.result);
    if (typeof p === 'object' && p !== null) parsed = p as Record<string, unknown>;
  } catch { /* not JSON */ }

  if (parsed) {
    // If upstream has an "error" field, check if it's absent (success = no error).
    if ('error' in parsed) {
      return { predicate: { field: 'error', exists: false } };
    }
    // If upstream has a "status" field, check for success.
    if ('status' in parsed) {
      const status = String(parsed.status).toLowerCase();
      if (status === 'success' || status === 'ok' || status === 'healthy') {
        return { predicate: { field: 'status', equals: parsed.status } };
      }
      // Check for failure states.
      if (status === 'failed' || status === 'error' || status === 'down') {
        return { predicate: { field: 'status', notEquals: parsed.status } };
      }
      return { predicate: { field: 'status', equals: 'success' } };
    }
    // If upstream has a "valid" field, check if true.
    if ('valid' in parsed) {
      return { predicate: { field: 'valid', equals: true } };
    }
    // If upstream has a "matched" field, pass it through.
    if ('matched' in parsed) {
      return { predicate: { field: 'matched', equals: true } };
    }
  }

  // Fallback: check if the raw output is truthy (non-empty).
  return { predicate: { field: 'result' } };
}

function executeSwitchNode(
  node: AgentNode,
  outputs: Map<string, NodeOutput>,
): ControlFlowResult {
  const config = node.switchConfig;
  if (!config) {
    return { ok: false, output: {}, error: 'Switch node missing switchConfig' };
  }
  const upstreamId = (node.dependsOn ?? [])[0];
  if (!upstreamId) {
    return { ok: false, output: {}, error: 'Switch node has no dependsOn' };
  }
  const upOutput = outputs.get(upstreamId);
  if (!upOutput) {
    return { ok: false, output: {}, error: `Upstream "${upstreamId}" has no output` };
  }

  let value: unknown;
  if (upOutput.outputs) {
    value = walkPath(upOutput.outputs, config.field);
  } else {
    try {
      const parsed = JSON.parse(upOutput.result);
      value = walkPath(parsed, config.field);
    } catch {
      value = config.field === 'result' ? upOutput.result : undefined;
    }
  }

  let matchedCase = 'default';
  for (const [caseName, caseValue] of Object.entries(config.cases)) {
    if (value == caseValue) {
      matchedCase = caseName;
      break;
    }
  }

  return { ok: true, output: { case: matchedCase, value } };
}

// ── Agent-invoke ───────────────────────────────────────────────────────

export async function executeAgentInvokeNode(
  node: AgentNode,
  outputs: Map<string, NodeOutput>,
  parentRunId: string,
  parentOptions: DagExecuteOptions,
  deps: DagExecutorDeps,
  _parentAgent: Agent,
  executeDag: ExecuteDagFn,
): Promise<AgentInvokeResult> {
  const config = node.agentInvokeConfig;
  if (!config) {
    return { ok: false, error: 'agent-invoke node missing agentInvokeConfig' };
  }
  if (!deps.agentStore) {
    return { ok: false, error: 'agent-invoke requires agentStore on DagExecutorDeps' };
  }

  const subAgent = deps.agentStore.getAgent(config.agentId);
  if (!subAgent) {
    return { ok: false, error: `Sub-agent "${config.agentId}" not found in store` };
  }

  const subInputs: Record<string, string> = {};
  if (config.inputMapping) {
    for (const [subKey, sourceExpr] of Object.entries(config.inputMapping)) {
      subInputs[subKey] = resolveSourceExpr(sourceExpr, undefined, outputs, parentOptions.inputs ?? {});
    }
  }

  const subRun = await executeDag(
    subAgent,
    {
      triggeredBy: parentOptions.triggeredBy,
      inputs: subInputs,
      parentRunId,
      parentNodeId: node.id,
    },
    deps,
  );

  if (subRun.status === 'completed') {
    let output: Record<string, unknown> = { result: subRun.result ?? '' };
    if (subRun.result) {
      try {
        const parsed = JSON.parse(subRun.result);
        if (typeof parsed === 'object' && parsed !== null) {
          output = { ...parsed, result: subRun.result };
        }
      } catch { /* plain string result */ }
    }
    return { ok: true, result: subRun.result ?? '', output };
  }

  return {
    ok: false,
    error: `Sub-agent "${config.agentId}" failed: ${subRun.error ?? subRun.status}`,
  };
}

// ── Loop ───────────────────────────────────────────────────────────────

export async function executeLoopNode(
  node: AgentNode,
  outputs: Map<string, NodeOutput>,
  parentRunId: string,
  parentOptions: DagExecuteOptions,
  deps: DagExecutorDeps,
  _parentAgent: Agent,
  executeDag: ExecuteDagFn,
): Promise<AgentInvokeResult> {
  const config = node.loopConfig;
  if (!config) {
    return { ok: false, error: 'Loop node missing loopConfig' };
  }
  if (!deps.agentStore) {
    return { ok: false, error: 'Loop node requires agentStore on DagExecutorDeps' };
  }

  const subAgent = deps.agentStore.getAgent(config.agentId);
  if (!subAgent) {
    return { ok: false, error: `Loop sub-agent "${config.agentId}" not found in store` };
  }

  const upstreamId = (node.dependsOn ?? [])[0];
  if (!upstreamId) {
    return { ok: false, error: 'Loop node has no dependsOn' };
  }
  const upOutput = outputs.get(upstreamId);
  if (!upOutput) {
    return { ok: false, error: `Upstream "${upstreamId}" has no output` };
  }

  let items: unknown[];
  if (upOutput.outputs) {
    const arr = walkPath(upOutput.outputs, config.over);
    if (!Array.isArray(arr)) {
      return { ok: false, error: `Loop field "${config.over}" on upstream "${upstreamId}" is not an array` };
    }
    items = arr;
  } else {
    try {
      const parsed = JSON.parse(upOutput.result);
      const arr = walkPath(parsed, config.over);
      if (!Array.isArray(arr)) {
        return { ok: false, error: `Loop field "${config.over}" on upstream "${upstreamId}" is not an array` };
      }
      items = arr;
    } catch {
      return { ok: false, error: `Cannot parse upstream "${upstreamId}" result as JSON for loop` };
    }
  }

  const maxIter = config.maxIterations ?? 1000;
  const limited = items.slice(0, maxIter);
  // Per-iteration items: parsed JSON when the sub-agent's result was a JSON object,
  // raw string when it wasn't, null when the sub-run failed. This lets downstream
  // prompts read structured fields with `{{upstream.<id>.items.0.<field>}}` instead
  // of having to parse JSON-encoded strings out of an array of strings.
  const results: (unknown | null)[] = [];

  for (let i = 0; i < limited.length; i++) {
    const item = limited[i];
    const subInputs: Record<string, string> = {
      ITEM: typeof item === 'string' ? item : JSON.stringify(item),
      ITEM_INDEX: String(i),
    };

    if (config.inputMapping) {
      for (const [subKey, sourceExpr] of Object.entries(config.inputMapping)) {
        subInputs[subKey] = resolveSourceExpr(sourceExpr, item, outputs, parentOptions.inputs ?? {});
      }
    }

    const subRun = await executeDag(
      subAgent,
      {
        triggeredBy: parentOptions.triggeredBy,
        inputs: subInputs,
        parentRunId,
        parentNodeId: node.id,
      },
      deps,
    );

    if (subRun.status !== 'completed' || subRun.result == null) {
      results.push(null);
    } else {
      let parsed: unknown = subRun.result;
      try {
        const candidate = JSON.parse(subRun.result);
        if (typeof candidate === 'object' && candidate !== null) parsed = candidate;
      } catch { /* not JSON — keep raw string */ }
      results.push(parsed);
    }
  }

  return {
    ok: true,
    result: JSON.stringify({ items: results, count: results.length }),
    output: { items: results, count: results.length },
  };
}

// ── onlyIf evaluation ──────────────────────────────────────────────────

export function evaluateOnlyIf(condition: OnlyIfCondition, upOutput: NodeOutput | undefined): boolean {
  if (!upOutput) return false;

  let value: unknown;
  if (upOutput.outputs) {
    value = walkPath(upOutput.outputs, condition.field);
  } else {
    if (condition.field === 'result') {
      value = upOutput.result;
    } else {
      try {
        const parsed = JSON.parse(upOutput.result);
        value = walkPath(parsed, condition.field);
      } catch {
        return false;
      }
    }
  }

  if (condition.exists !== undefined) {
    return condition.exists ? value !== undefined && value !== null : value === undefined || value === null;
  }
  if (condition.equals !== undefined) {
    return value == condition.equals;
  }
  if (condition.notEquals !== undefined) {
    return value != condition.notEquals;
  }
  return value !== undefined && value !== null;
}

/**
 * Resolve an inputMapping source expression for both `loop` and `agent-invoke`.
 * Supported source forms:
 *   `$item.<path>`            → walkPath into the current item (loop only — agent-invoke
 *                                passes `item: undefined`, in which case `$item` resolves
 *                                to empty string)
 *   `$upstream.<id>.<field>`  → field of an upstream node's structured output (or its
 *                                raw `result` when no field is supplied)
 *   `upstream.<id>.<field>`   → backward-compat alias for the above (no `$` prefix)
 *   `{{inputs.X}}`            → parent agent's input X (in-place substitution; multiple
 *                                {{inputs.X}} tokens may appear in a single expression)
 * Anything else (including a plain literal with no recognized prefix) is treated as a
 * literal string after `{{inputs.X}}` substitution.
 */
function resolveSourceExpr(
  expr: string,
  item: unknown | undefined,
  outputs: Map<string, NodeOutput>,
  parentInputs: Record<string, string>,
): string {
  if (expr.startsWith('$item')) {
    if (item === undefined) return '';
    const path = expr.slice('$item'.length).replace(/^\./, '');
    const val = path ? walkPath(item, path) : item;
    if (val === undefined || val === null) return '';
    return typeof val === 'string' ? val : JSON.stringify(val);
  }
  const upstreamPrefix = expr.startsWith('$upstream.') ? '$upstream.'
    : expr.startsWith('upstream.') ? 'upstream.'
    : null;
  if (upstreamPrefix) {
    const parts = expr.slice(upstreamPrefix.length).split('.');
    const upId = parts[0];
    const field = parts.slice(1).join('.');
    const upOutput = outputs.get(upId);
    if (!upOutput) return '';
    if (upOutput.outputs && field) {
      const val = walkPath(upOutput.outputs, field);
      return val !== undefined && val !== null ? String(val) : '';
    }
    return upOutput.result ?? '';
  }
  return expr.replace(/\{\{\s*inputs\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_m, name) => parentInputs[name] ?? '');
}

// ── Utility ────────────────────────────────────────────────────────────

/** Walk a dot-separated path into a nested object. */
export function walkPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const segment of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}
