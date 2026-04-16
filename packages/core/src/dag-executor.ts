/**
 * DAG executor. Walks an `Agent`'s nodes topologically, writes one
 * `node_executions` row per node, propagates `{{upstream.<id>.result}}`
 * and `{{inputs.X}}` templates, categorises every failure via
 * `NodeErrorCategory`, and skips downstream nodes when an upstream fails.
 *
 * The v1 `chain-executor.ts` is still in the tree (it's what LocalProvider
 * dispatches to today). This executor does not replace it yet — PR 4 wires
 * LocalProvider.submitRun to dispatch to us for DAG-mode agents. Until
 * then, single-node v1 runs keep using the old path.
 *
 * Trust-source propagation is simpler than v1: in v2 every node in a DAG
 * shares the parent agent's `source`, so the "untrusted upstream fed a
 * trusted downstream" class of concern (which drove the v1 chain-executor
 * delimiter wrapping) can't happen within a single agent. The community-
 * shell gate still applies — a shell node in a `source: community` agent
 * is refused unless the agent is allow-listed. Adapter hands `agent.id`
 * (the DAG's id, not the node id) to the existing per-node executor so
 * `--allow-untrusted-shell <agent-id>` stays the right granularity.
 */

import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import type { Agent, AgentNode, NodeErrorCategory, NodeOutput, NodeStructuredOutput, OnlyIfCondition } from './agent-v2-types.js';
import type { Run, RunStatus } from './types.js';
import type { RunStore } from './run-store.js';
import type { AgentStore } from './agent-store.js';
import type { SecretsStore } from './secrets-store.js';
import type { ToolStore } from './tool-store.js';
import type { ToolOutput, BuiltinToolContext } from './tool-types.js';
import { getBuiltinTool } from './builtin-tools.js';
import { buildToolOutput } from './output-framing.js';
import {
  UntrustedCommunityShellError,
  type ExecutionResult,
} from './agent-executor.js';
import { substituteInputs, SENSITIVE_ENV_NAMES } from './input-resolver.js';
import { extractUpstreamReferences } from './agent-v2-schema.js';

export interface DagExecutorDeps {
  runStore: RunStore;
  /**
   * Optional. Required iff any node in the agent declares `secrets:`. If
   * a node needs a secret and the store is unavailable / locked, the node
   * fails with category `setup`.
   */
  secretsStore?: SecretsStore;
  /**
   * v0.16+: tool store for user-defined tools. Built-in tools are resolved
   * from the in-memory registry; user tools come from this store. Optional
   * — if absent, only built-in tools are available.
   */
  toolStore?: ToolStore;
  /**
   * v0.16+: agent store for resolving sub-agents in `agent-invoke` nodes.
   * Required iff any node has `type: 'agent-invoke'`.
   */
  agentStore?: AgentStore;
  /**
   * Agent ids the operator has pre-audited for community shell execution.
   * Propagated into each node's spawn; a shell node inside a `source:
   * community` agent that isn't in this set fails with category `setup`.
   */
  allowUntrustedShell?: ReadonlySet<string>;
  /**
   * Injection point for tests — returns the canned result without spawning.
   * Production uses the default (real spawn via `executeNodeReal`).
   */
  spawnNode?: SpawnNodeFn;
}

export interface DagExecuteOptions {
  /**
   * Source of the run (same enum as the rest of the system). Written onto
   * the parent `runs` row.
   */
  triggeredBy: Run['triggeredBy'];
  /**
   * Caller-supplied `--input KEY=value` pairs. Merged with agent-level
   * input defaults; missing required inputs fail the node with category
   * `setup`.
   */
  inputs?: Record<string, string>;
  /**
   * Replay mode. When set, nodes BEFORE `fromNodeId` in topological order
   * are not re-executed — their `node_executions` rows are copied from
   * `priorRunId` with their stored `result` intact. The executor picks up
   * at `fromNodeId` using the copied upstream outputs.
   *
   * Guarantees:
   *   - The `runs` row records `replayedFromRunId` + `replayedFromNodeId`
   *     so the dashboard can render a "replayed from …" breadcrumb.
   *   - Copied `node_executions` keep their original `started_at` +
   *     `result`; they are NOT re-timestamped. This preserves the audit
   *     trail of "these are historical outputs, not fresh work."
   *   - If any copied node is missing a stored result (the original run
   *     didn't complete that far, or was itself a replay with gaps), the
   *     replay fails early with category `setup` rather than executing
   *     the pivot with a missing upstream.
   */
  replayFrom?: { priorRunId: string; fromNodeId: string };
  /** Flow control: set when this execution is a nested sub-flow invoked
   *  by an `agent-invoke` or `loop` node in a parent run. */
  parentRunId?: string;
  parentNodeId?: string;
}

/**
 * Returned by the real spawner; also the shape test doubles return.
 * Matches `ExecutionResult` from agent-executor.ts (duplicated here to
 * keep the DAG executor decoupled from the v1 agent-level shape).
 */
type SpawnResult = ExecutionResult & { category?: NodeErrorCategory };

type SpawnNodeFn = (
  node: AgentNode,
  env: Record<string, string>,
  opts: { agentId: string; agentSource: Agent['source']; allowUntrustedShell?: ReadonlySet<string> },
) => Promise<SpawnResult>;

/**
 * Execute an agent's DAG end-to-end. Creates the parent `runs` row,
 * walks nodes in topological order, writes per-node records, and rolls
 * up a final status onto the run. Returns the completed `Run`.
 *
 * Fail-fast: when a node fails, every not-yet-started downstream node is
 * written with status 'skipped' and category 'upstream_failed' so the
 * log tells a coherent top-to-bottom story without silent rows.
 */
export async function executeAgentDag(
  agent: Agent,
  options: DagExecuteOptions,
  deps: DagExecutorDeps,
): Promise<Run> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();

  // Parent run row created up-front in 'running' state. Lets anyone polling
  // the DB see the run exists + links to per-node rows as they land.
  deps.runStore.createRun({
    id: runId,
    agentName: agent.id,
    status: 'running',
    startedAt,
    triggeredBy: options.triggeredBy,
    workflowId: agent.id,
    workflowVersion: agent.version,
    replayedFromRunId: options.replayFrom?.priorRunId,
    replayedFromNodeId: options.replayFrom?.fromNodeId,
    parentRunId: options.parentRunId,
    parentNodeId: options.parentNodeId,
  });

  const outputs = new Map<string, NodeOutput>();
  const order = topologicalSort(agent.nodes);
  let firstFailure: { nodeId: string; category: NodeErrorCategory } | undefined;
  const skippedNodes = new Set<string>();

  // Replay pre-load: copy prior node_executions for nodes before the pivot.
  // Their stored `result` feeds downstream outputs so re-execution starts
  // at `fromNodeId` with the exact snapshot the original run produced.
  let replaySkipIds = new Set<string>();
  if (options.replayFrom) {
    const { priorRunId, fromNodeId } = options.replayFrom;
    const pivotIndex = order.findIndex((n) => n.id === fromNodeId);
    if (pivotIndex < 0) {
      deps.runStore.updateRun(runId, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: `Replay failed: node "${fromNodeId}" not in agent "${agent.id}"`,
      });
      const r = deps.runStore.getRun(runId);
      if (!r) throw new Error(`Run ${runId} vanished from store after write`);
      return r;
    }
    const priorExecs = deps.runStore.listNodeExecutions(priorRunId);
    const priorByNodeId = new Map(priorExecs.map((e) => [e.nodeId, e]));

    const priorIds = order.slice(0, pivotIndex).map((n) => n.id);
    const missing: string[] = [];
    for (const id of priorIds) {
      const prior = priorByNodeId.get(id);
      if (!prior || prior.status !== 'completed' || prior.result === undefined) {
        missing.push(id);
      }
    }
    if (missing.length > 0) {
      deps.runStore.updateRun(runId, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        error:
          `Replay failed: prior run "${priorRunId}" is missing completed outputs for: ` +
          `${missing.join(', ')}. Cannot reconstruct upstream snapshot.`,
      });
      const r = deps.runStore.getRun(runId);
      if (!r) throw new Error(`Run ${runId} vanished from store after write`);
      return r;
    }

    // Copy each prior exec into this run; seed outputs map.
    for (const id of priorIds) {
      const prior = priorByNodeId.get(id)!;
      deps.runStore.createNodeExecution({
        ...prior,
        runId,                  // new run
        workflowVersion: agent.version,
        // Keep the original startedAt/completedAt so the audit trail is clear.
      });
      outputs.set(id, { result: prior.result!, exitCode: 0, source: agent.source });
    }
    replaySkipIds = new Set(priorIds);
  }

  for (const node of order) {
    if (replaySkipIds.has(node.id)) continue;
    const nodeStartedAt = new Date().toISOString();

    // onlyIf: conditional edge evaluation. If the predicate fails, skip
    // with condition_not_met — NOT upstream_failed. Downstream nodes that
    // depend on a condition-skipped node also get condition_not_met (cascading
    // skip, not cascading failure).
    if (node.onlyIf) {
      const upOutput = outputs.get(node.onlyIf.upstream);
      if (!evaluateOnlyIf(node.onlyIf, upOutput)) {
        deps.runStore.createNodeExecution({
          runId,
          nodeId: node.id,
          workflowVersion: agent.version,
          status: 'skipped',
          errorCategory: 'condition_not_met',
          startedAt: nodeStartedAt,
          completedAt: nodeStartedAt,
          error: `Condition not met: ${node.onlyIf.field} on upstream "${node.onlyIf.upstream}"`,
        });
        // Mark as skipped in outputs so downstream nodes that depend on
        // this node can detect the skip. We set a sentinel — downstream
        // nodes with their own onlyIf evaluate independently; those
        // without onlyIf cascade to condition_not_met.
        skippedNodes.add(node.id);
        continue;
      }
    }

    // Check if any required upstream was condition-skipped. If a node
    // depends on a condition-skipped node and doesn't have its own onlyIf
    // (which would let it evaluate independently), it cascades.
    if (!node.onlyIf) {
      const skippedDep = (node.dependsOn ?? []).find((d) => skippedNodes.has(d));
      if (skippedDep) {
        deps.runStore.createNodeExecution({
          runId,
          nodeId: node.id,
          workflowVersion: agent.version,
          status: 'skipped',
          errorCategory: 'condition_not_met',
          startedAt: nodeStartedAt,
          completedAt: nodeStartedAt,
          error: `Skipped: upstream "${skippedDep}" was condition-skipped`,
        });
        skippedNodes.add(node.id);
        continue;
      }
    }

    // Short-circuit: an earlier node already failed. Write a skipped row
    // whose error field names the failing upstream — keeps the run log
    // self-explanatory.
    if (firstFailure) {
      deps.runStore.createNodeExecution({
        runId,
        nodeId: node.id,
        workflowVersion: agent.version,
        status: 'skipped',
        errorCategory: 'upstream_failed',
        startedAt: nodeStartedAt,
        completedAt: nodeStartedAt,
        error: `Skipped: upstream node "${firstFailure.nodeId}" failed (${firstFailure.category})`,
      });
      continue;
    }

    // Control-flow node dispatch. These run in-process (no spawn, no env
    // resolution needed) and produce structured outputs that downstream
    // nodes consume via onlyIf predicates or template refs.
    if (node.type === 'loop') {
      const loopResult = await executeLoopNode(node, outputs, runId, options, deps, agent);
      const completedAt = new Date().toISOString();
      if (loopResult.ok) {
        const outputsJson = JSON.stringify(loopResult.output);
        outputs.set(node.id, {
          result: JSON.stringify(loopResult.output),
          exitCode: 0,
          source: agent.source,
          outputs: loopResult.output,
        });
        deps.runStore.createNodeExecution({
          runId,
          nodeId: node.id,
          workflowVersion: agent.version,
          status: 'completed',
          startedAt: nodeStartedAt,
          completedAt,
          result: JSON.stringify(loopResult.output),
          exitCode: 0,
          outputsJson,
        });
      } else {
        deps.runStore.createNodeExecution({
          runId,
          nodeId: node.id,
          workflowVersion: agent.version,
          status: 'failed',
          errorCategory: 'setup',
          startedAt: nodeStartedAt,
          completedAt,
          error: loopResult.error,
        });
        firstFailure = { nodeId: node.id, category: 'setup' };
      }
      continue;
    }

    if (node.type === 'agent-invoke') {
      const invokeResult = await executeAgentInvokeNode(node, outputs, runId, options, deps, agent);
      const completedAt = new Date().toISOString();
      if (invokeResult.ok) {
        const outputsJson = invokeResult.output ? JSON.stringify(invokeResult.output) : undefined;
        outputs.set(node.id, {
          result: invokeResult.result ?? '',
          exitCode: 0,
          source: agent.source,
          outputs: invokeResult.output,
        });
        deps.runStore.createNodeExecution({
          runId,
          nodeId: node.id,
          workflowVersion: agent.version,
          status: 'completed',
          startedAt: nodeStartedAt,
          completedAt,
          result: invokeResult.result,
          exitCode: 0,
          outputsJson,
        });
      } else {
        deps.runStore.createNodeExecution({
          runId,
          nodeId: node.id,
          workflowVersion: agent.version,
          status: 'failed',
          errorCategory: 'setup',
          startedAt: nodeStartedAt,
          completedAt,
          error: invokeResult.error,
        });
        firstFailure = { nodeId: node.id, category: 'setup' };
      }
      continue;
    }

    if (node.type === 'conditional' || node.type === 'switch') {
      const cfResult = executeControlFlowNode(node, outputs);
      const completedAt = new Date().toISOString();
      const outputsJson = JSON.stringify(cfResult.output);
      if (cfResult.ok) {
        outputs.set(node.id, {
          result: JSON.stringify(cfResult.output),
          exitCode: 0,
          source: agent.source,
          outputs: cfResult.output,
        });
        deps.runStore.createNodeExecution({
          runId,
          nodeId: node.id,
          workflowVersion: agent.version,
          status: 'completed',
          startedAt: nodeStartedAt,
          completedAt,
          result: JSON.stringify(cfResult.output),
          exitCode: 0,
          outputsJson,
        });
      } else {
        deps.runStore.createNodeExecution({
          runId,
          nodeId: node.id,
          workflowVersion: agent.version,
          status: 'failed',
          errorCategory: 'setup',
          startedAt: nodeStartedAt,
          completedAt,
          error: cfResult.error,
        });
        firstFailure = { nodeId: node.id, category: 'setup' };
      }
      continue;
    }

    // Resolve inputs + upstream snapshot before spawning. Input-resolution
    // failures (e.g. secrets store locked, missing required input) count
    // as 'setup' category, not 'exit_nonzero'.
    let env: Record<string, string>;
    let upstreamSnapshot: Record<string, string>;
    try {
      upstreamSnapshot = buildUpstreamSnapshot(node, outputs);
      env = await buildNodeEnv(agent, node, options.inputs ?? {}, upstreamSnapshot, deps);
    } catch (err) {
      const message = (err as Error).message;
      deps.runStore.createNodeExecution({
        runId,
        nodeId: node.id,
        workflowVersion: agent.version,
        status: 'failed',
        errorCategory: 'setup',
        startedAt: nodeStartedAt,
        completedAt: new Date().toISOString(),
        error: message,
      });
      firstFailure = { nodeId: node.id, category: 'setup' };
      continue;
    }

    // Pre-audit the community-shell gate. Failing here is 'setup', not a
    // spawn_failure, because we refused before ever reaching spawn().
    if (node.type === 'shell' && agent.source === 'community' && !(deps.allowUntrustedShell?.has(agent.id))) {
      const err = new UntrustedCommunityShellError(agent.id);
      deps.runStore.createNodeExecution({
        runId,
        nodeId: node.id,
        workflowVersion: agent.version,
        status: 'failed',
        errorCategory: 'setup',
        startedAt: nodeStartedAt,
        completedAt: new Date().toISOString(),
        error: err.message,
      });
      firstFailure = { nodeId: node.id, category: 'setup' };
      continue;
    }

    // Node-execution row in 'running' state so observers see progress.
    deps.runStore.createNodeExecution({
      runId,
      nodeId: node.id,
      workflowVersion: agent.version,
      status: 'running',
      startedAt: nodeStartedAt,
      inputsJson: JSON.stringify(filterEnvForLog(env, node)),
      upstreamInputsJson: JSON.stringify(upstreamSnapshot),
    });

    // v0.16 tool dispatch: if the node references a tool, resolve it and
    // call its execute() function. Built-in tools run in-process; user
    // tools that use shell/claude-code implementation types go through the
    // same spawn path as v0.15 nodes. Nodes without a tool field fall
    // through to the legacy spawn path directly (backcompat).
    const toolId = resolveToolId(node);
    const builtinEntry = toolId ? getBuiltinTool(toolId) : undefined;

    let result: SpawnResult;
    let structuredOutput: ToolOutput | undefined;

    try {
      if (builtinEntry) {
        // Built-in tool: call execute() directly, no child process.
        // Merge tool-level config (project defaults) with per-invocation
        // inputs so the user doesn't repeat common values every node.
        const toolInputs = {
          ...(builtinEntry.definition.config ?? {}),
          ...resolveToolInputs(node, upstreamSnapshot),
          ...(node.action ? { _action: node.action } : {}),
        };
        const ctx: BuiltinToolContext = {
          workingDirectory: node.workingDirectory,
          env,
          timeout: node.timeout,
        };
        structuredOutput = await builtinEntry.execute(toolInputs, ctx);
        const stdout = structuredOutput.result ?? '';
        result = { result: stdout, exitCode: (structuredOutput as Record<string, unknown>).exit_code as number ?? 0 };
      } else if (toolId && deps.toolStore) {
        // User-defined tool from the store — resolve its implementation and
        // spawn via the same shell/claude-code path the v0.15 nodes use.
        // The tool's implementation.command/prompt becomes the spawned body.
        const userTool = deps.toolStore.getTool(toolId);
        if (!userTool) {
          throw new Error(`Tool "${toolId}" not found in registry or store.`);
        }
        const spawnFn = deps.spawnNode ?? spawnNodeReal;
        // Build a synthetic node shape matching the tool's implementation
        // so the existing spawner doesn't need to change.
        const synthNode: AgentNode = {
          ...node,
          type: userTool.implementation.type === 'claude-code' ? 'claude-code' : 'shell',
          command: userTool.implementation.command,
          prompt: userTool.implementation.prompt,
        };
        const spawnResult = await spawnFn(synthNode, env, {
          agentId: agent.id,
          agentSource: agent.source,
          allowUntrustedShell: deps.allowUntrustedShell,
        });
        result = spawnResult;
        structuredOutput = buildToolOutput(spawnResult.result);
      } else {
        // v0.15 legacy path: no tool field, dispatch by type directly.
        const spawnFn = deps.spawnNode ?? spawnNodeReal;
        const spawnResult = await spawnFn(node, env, {
          agentId: agent.id,
          agentSource: agent.source,
          allowUntrustedShell: deps.allowUntrustedShell,
        });
        result = spawnResult;
        // Try to extract framed output from stdout even for legacy nodes,
        // so users who upgrade their shell scripts to emit framed JSON get
        // structured outputs without changing the node YAML.
        structuredOutput = buildToolOutput(spawnResult.result);
      }
    } catch (err) {
      const message = (err as Error).message;
      deps.runStore.updateNodeExecution(runId, node.id, {
        status: 'failed',
        errorCategory: 'setup',
        completedAt: new Date().toISOString(),
        error: message,
      });
      firstFailure = { nodeId: node.id, category: 'setup' };
      continue;
    }

    const completedAt = new Date().toISOString();
    const outputsJson = structuredOutput ? JSON.stringify(structuredOutput) : undefined;

    if (result.exitCode === 0) {
      outputs.set(node.id, {
        result: result.result,
        exitCode: 0,
        source: agent.source,
        outputs: structuredOutput as NodeStructuredOutput | undefined,
      });
      deps.runStore.updateNodeExecution(runId, node.id, {
        status: 'completed',
        completedAt,
        result: result.result,
        exitCode: 0,
        outputsJson,
      });
    } else {
      const category: NodeErrorCategory =
        result.category ??
        (result.exitCode === 124 ? 'timeout' :
         result.exitCode === 127 ? 'spawn_failure' :
         'exit_nonzero');
      deps.runStore.updateNodeExecution(runId, node.id, {
        status: 'failed',
        errorCategory: category,
        completedAt,
        result: result.result,
        exitCode: result.exitCode,
        error: result.error ?? `Process exited with code ${result.exitCode}`,
        outputsJson,
      });
      firstFailure = { nodeId: node.id, category };
    }
  }

  const finalStatus: RunStatus = firstFailure ? 'failed' : 'completed';
  // Final result = last completed node's output. Keeps `sua agent status`
  // readable for single-node agents where "the run's result" is obvious,
  // and gives multi-node agents a meaningful summary string.
  const lastCompleted = [...outputs.values()].pop();
  const finalError = firstFailure
    ? `Failed at node "${firstFailure.nodeId}" (${firstFailure.category})`
    : undefined;
  deps.runStore.updateRun(runId, {
    status: finalStatus,
    completedAt: new Date().toISOString(),
    result: lastCompleted?.result,
    error: finalError,
  });

  const run = deps.runStore.getRun(runId);
  if (!run) throw new Error(`Run ${runId} vanished from store after write`);
  return run;
}

// -- Topological sort --

/**
 * Kahn's algorithm with a deterministic tiebreaker: when multiple nodes
 * are simultaneously ready, emit them in declared order. Tests and git
 * diffs stay stable.
 *
 * Defensive: schema validation already rejects cycles, but if a caller
 * passes an Agent constructed outside the schema, throw rather than
 * silently dropping nodes from the output.
 */
export function topologicalSort(nodes: AgentNode[]): AgentNode[] {
  const byId = new Map<string, AgentNode>();
  const remainingDeps = new Map<string, Set<string>>();
  const declarationOrder = new Map<string, number>();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    byId.set(n.id, n);
    remainingDeps.set(n.id, new Set(n.dependsOn ?? []));
    declarationOrder.set(n.id, i);
  }

  const downstream = new Map<string, Set<string>>();
  for (const n of nodes) {
    for (const dep of n.dependsOn ?? []) {
      if (!downstream.has(dep)) downstream.set(dep, new Set());
      downstream.get(dep)!.add(n.id);
    }
  }

  const ready: AgentNode[] = nodes
    .filter((n) => (n.dependsOn ?? []).length === 0)
    .sort((a, b) => declarationOrder.get(a.id)! - declarationOrder.get(b.id)!);

  const order: AgentNode[] = [];
  while (ready.length > 0) {
    const n = ready.shift()!;
    order.push(n);
    const children = [...(downstream.get(n.id) ?? [])]
      .sort((a, b) => declarationOrder.get(a)! - declarationOrder.get(b)!);
    for (const childId of children) {
      const pending = remainingDeps.get(childId)!;
      pending.delete(n.id);
      if (pending.size === 0) {
        ready.push(byId.get(childId)!);
      }
    }
  }

  if (order.length !== nodes.length) {
    throw new Error(`Cycle detected in DAG (schema should have rejected this)`);
  }
  return order;
}

// -- Environment build --

/**
 * Build the env map a node will spawn with. Layers, in order of precedence:
 *
 *   1. MINIMAL_ALLOWLIST / LOCAL_ALLOWLIST from current process.env
 *      (same as v1 per-trust env filter; community agents get MINIMAL)
 *   2. Node's `envAllowlist` adds
 *   3. Node's `env:` YAML field (values with {{inputs.X}} substituted)
 *   4. Node's declared `secrets:` from secretsStore
 *   5. Resolved agent inputs as env vars (scrubbed of sensitive names)
 *   6. `UPSTREAM_<NODEID>_RESULT` for each declared upstream
 *
 * Later layers win on key collisions. Sensitive names (PATH, NODE_OPTIONS,
 * LD_PRELOAD, etc.) coming from user-supplied inputs are blocked — the
 * schema rejects these at load time but we defense-in-depth here too.
 */
async function buildNodeEnv(
  agent: Agent,
  node: AgentNode,
  callerInputs: Record<string, string>,
  upstreamSnapshot: Record<string, string>,
  deps: DagExecutorDeps,
): Promise<Record<string, string>> {
  const trustLevel = agent.source === 'community' ? 'community' : 'local';
  const baseAllowlist = trustLevel === 'community' ? MINIMAL_ALLOWLIST : LOCAL_ALLOWLIST;
  const allowed = new Set<string>([...baseAllowlist, ...(node.envAllowlist ?? [])]);
  const env: Record<string, string> = {};

  // 1 + 2: process.env filtered by allowlist.
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (allowed.has(k)) env[k] = v;
    else if (trustLevel === 'local' && LOCAL_PATTERNS.some((re) => re.test(k))) env[k] = v;
  }

  // 3: node's YAML env: — templates substituted.
  if (node.env) {
    for (const [k, v] of Object.entries(node.env)) {
      env[k] = substituteInputs(resolveUpstreamTemplate(v, upstreamSnapshot), mergedInputs(agent, callerInputs));
    }
  }

  // 4: secrets. Each node only gets what it declares; never shares across nodes.
  if (node.secrets && node.secrets.length > 0) {
    if (!deps.secretsStore) {
      throw new Error(
        `Node "${node.id}" declares secrets but no secrets store is available. ` +
        `Pass one via DagExecutorDeps.secretsStore.`,
      );
    }
    const all = await deps.secretsStore.getAll();
    const missing: string[] = [];
    for (const name of node.secrets) {
      if (name in all) env[name] = all[name];
      else missing.push(name);
    }
    if (missing.length > 0) {
      throw new Error(`Missing secrets for node "${node.id}": ${missing.join(', ')}. Run 'sua secrets set <name>'.`);
    }
  }

  // 5: caller-supplied inputs. Drop sensitive names as a belt-and-suspenders
  // on the schema check. Merge agent-level defaults for missing values.
  for (const [k, v] of Object.entries(mergedInputs(agent, callerInputs))) {
    if (SENSITIVE_ENV_NAMES.has(k)) continue;
    env[k] = v;
  }

  // 6: upstream results as UPSTREAM_<NODEID>_RESULT.
  for (const [upstreamId, value] of Object.entries(upstreamSnapshot)) {
    const key = `UPSTREAM_${upstreamId.toUpperCase().replace(/-/g, '_')}_RESULT`;
    env[key] = value;
  }

  return env;
}

/**
 * Compose caller-supplied inputs with agent-level defaults. Uses the
 * existing typed-input machinery via a narrow helper — missing required
 * inputs throw, bad types throw, unknown keys are dropped (the agent
 * declared what it wants; extras are the caller's problem, not the node's).
 */
function mergedInputs(agent: Agent, callerInputs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const specs = agent.inputs ?? {};
  const declared = new Set(Object.keys(specs));

  for (const [name, spec] of Object.entries(specs)) {
    if (name in callerInputs) {
      out[name] = callerInputs[name];
    } else if (spec.default !== undefined) {
      out[name] = String(spec.default);
    } else if (spec.required !== false) {
      throw new Error(`Missing required input "${name}" for agent "${agent.id}"`);
    }
  }

  // Undeclared caller inputs are dropped — they can't reach a node. Schema
  // enforced this at load time for run.ts; the executor is lenient here
  // because scheduled / MCP invocations pass caller-wide input bags.
  for (const [k, v] of Object.entries(callerInputs)) {
    if (!declared.has(k)) continue;
    if (!(k in out)) out[k] = v;
  }

  return out;
}

/**
 * Snapshot of upstream node results that feed this node. Built from the
 * `outputs` map after execution of earlier nodes.
 */
function buildUpstreamSnapshot(node: AgentNode, outputs: Map<string, NodeOutput>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dep of node.dependsOn ?? []) {
    const o = outputs.get(dep);
    if (o) out[dep] = o.result;
  }
  return out;
}

/**
 * Substitute `{{upstream.<id>.result}}` tokens in a text blob. Deliberately
 * kept tiny and greedy — we rely on schema-time validation to guarantee
 * every reference resolves.
 */
export function resolveUpstreamTemplate(text: string, snapshot: Record<string, string>): string {
  if (!text.includes('{{upstream.')) return text;
  const refs = extractUpstreamReferences(text);
  let out = text;
  for (const id of refs) {
    const value = snapshot[id] ?? '';
    // Escape {{ in the substituted value so the inputs resolver that runs
    // afterwards can't re-expand it as a second template layer. Same
    // defense the v1 chain-resolver ships (chain-resolver.ts:120-125).
    const safe = value.replace(/\{\{/g, '{ {');
    // Use a simple literal replace; the ref format is fixed.
    out = out.split(`{{upstream.${id}.result}}`).join(safe);
  }
  return out;
}

/**
 * Redact secret values from the env map before we serialise it to
 * `inputs_json` for the node_executions row. Any env key that the node
 * declared as a secret is stored as a placeholder instead of its value,
 * so reading run logs doesn't leak the secret.
 */
function filterEnvForLog(env: Record<string, string>, node: AgentNode): Record<string, string> {
  const out: Record<string, string> = {};
  const secrets = new Set(node.secrets ?? []);
  for (const [k, v] of Object.entries(env)) {
    if (secrets.has(k)) out[k] = '<redacted>';
    else out[k] = v;
  }
  return out;
}

// -- Real spawner (production path) --

/**
 * Copy of the spawn machinery from agent-executor.ts, adapted for an
 * `AgentNode`. We don't go through `executeAgent` because it expects a v1
 * `AgentDefinition` and requires an adapter at the boundary; duplicating
 * ~40 lines of spawn plumbing is cheaper and keeps the DAG executor
 * decoupled from the v1 flow while v1 still exists.
 *
 * Categorisation notes:
 *   - exit code 124 = timeout we set (matches SIGTERM by convention)
 *   - exit code 127 = spawn failure (ENOENT / EACCES)
 *   - any other non-zero = exit_nonzero (returned as-is, executor categorises)
 */
async function spawnNodeReal(
  node: AgentNode,
  env: Record<string, string>,
  opts: { agentId: string; agentSource: Agent['source']; allowUntrustedShell?: ReadonlySet<string> },
): Promise<SpawnResult> {
  if (node.type === 'shell') {
    if (!node.command) {
      return { result: '', exitCode: 1, error: `Shell node "${node.id}" has no command`, category: 'setup' };
    }
    return spawnProcess('bash', ['-c', node.command], {
      cwd: node.workingDirectory,
      env,
      timeoutSec: node.timeout ?? 300,
    });
  }

  // claude-code
  if (!node.prompt) {
    return { result: '', exitCode: 1, error: `Claude-code node "${node.id}" has no prompt`, category: 'setup' };
  }
  const args = ['--print', node.prompt];
  if (node.model) { args.push('--model', node.model); }
  if (node.maxTurns) { args.push('--max-turns', String(node.maxTurns)); }
  if (node.allowedTools?.length) { args.push('--allowedTools', node.allowedTools.join(',')); }
  return spawnProcess('claude', args, {
    cwd: node.workingDirectory,
    env,
    timeoutSec: node.timeout ?? 300,
  });
}

async function spawnProcess(
  bin: string,
  args: string[],
  opts: { cwd?: string; env: Record<string, string>; timeoutSec: number },
): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolve) => {
    let child: ChildProcess;
    let killed = false;
    try {
      child = spawn(bin, args, {
        cwd: opts.cwd,
        env: opts.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ result: '', exitCode: 127, error: (err as Error).message, category: 'spawn_failure' });
      return;
    }

    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr!.on('data', (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 5000);
    }, opts.timeoutSec * 1000);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) {
        resolve({ result: stdout, exitCode: 124, error: `Timed out after ${opts.timeoutSec}s`, category: 'timeout' });
      } else if (code === 0) {
        resolve({ result: stdout, exitCode: 0 });
      } else {
        resolve({
          result: stdout,
          exitCode: code ?? 1,
          error: stderr || `Process exited with code ${code}`,
          category: 'exit_nonzero',
        });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ result: '', exitCode: 127, error: err.message, category: 'spawn_failure' });
    });
  });
}

// -- Env allowlists (duplicate of env-builder constants; keeping here lets
//    the DAG executor build env without the v1 AgentDefinition intermediary.
//    Extract to a shared module in a follow-up if this duplicates further.) --

// -- Control-flow node dispatch --

interface ControlFlowResult {
  ok: boolean;
  output: Record<string, unknown>;
  error?: string;
}

/**
 * Execute a `conditional` or `switch` node. Pure in-process evaluation —
 * no child process, no env, no secrets. Reads the upstream structured
 * output and produces a result downstream nodes consume.
 */
function executeControlFlowNode(
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
  const config = node.conditionalConfig;
  if (!config) {
    return { ok: false, output: {}, error: 'Conditional node missing conditionalConfig' };
  }
  // The conditional evaluates against its first upstream's output.
  const upstreamId = (node.dependsOn ?? [])[0];
  if (!upstreamId) {
    return { ok: false, output: {}, error: 'Conditional node has no dependsOn' };
  }
  const upOutput = outputs.get(upstreamId);
  if (!upOutput) {
    return { ok: false, output: {}, error: `Upstream "${upstreamId}" has no output` };
  }

  // Resolve the field value from structured output or parsed JSON result.
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

  // Find matching case. Cases are keyed by name; the value stored is what
  // the field should match. If none match, case = 'default' (always present
  // implicitly).
  let matchedCase = 'default';
  for (const [caseName, caseValue] of Object.entries(config.cases)) {
    if (value == caseValue) {
      matchedCase = caseName;
      break;
    }
  }

  return { ok: true, output: { case: matchedCase, value } };
}

// -- agent-invoke dispatch --

interface AgentInvokeResult {
  ok: boolean;
  result?: string;
  output?: Record<string, unknown>;
  error?: string;
}

/**
 * Execute an `agent-invoke` node. Resolves the sub-agent from the
 * AgentStore, maps inputs from upstream outputs, then recursively calls
 * `executeAgentDag`. The sub-agent gets its own `runs` row linked to
 * the parent via `parentRunId` + `parentNodeId`.
 */
async function executeAgentInvokeNode(
  node: AgentNode,
  outputs: Map<string, NodeOutput>,
  parentRunId: string,
  parentOptions: DagExecuteOptions,
  deps: DagExecutorDeps,
  parentAgent: Agent,
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

  // Map inputs from upstream outputs or the parent's caller inputs.
  const subInputs: Record<string, string> = {};
  if (config.inputMapping) {
    for (const [subKey, sourceExpr] of Object.entries(config.inputMapping)) {
      // sourceExpr can be a literal or an upstream path like "upstream.fetch.result".
      if (sourceExpr.startsWith('upstream.')) {
        const parts = sourceExpr.split('.');
        const upId = parts[1];
        const field = parts.slice(2).join('.');
        const upOutput = outputs.get(upId);
        if (upOutput?.outputs) {
          const val = walkPath(upOutput.outputs, field);
          subInputs[subKey] = val !== undefined ? String(val) : '';
        } else if (upOutput) {
          subInputs[subKey] = upOutput.result;
        }
      } else {
        // Literal value or parent input ref.
        subInputs[subKey] = sourceExpr;
      }
    }
  }

  // Recursive execution with nested-run linking.
  const subRun = await executeAgentDag(
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
    // Parse the sub-run's result as structured output if possible.
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

// -- loop dispatch --

/**
 * Execute a `loop` node. Iterates over an array extracted from upstream
 * structured output, invoking a sub-agent per item. Each iteration is
 * a nested run linked to the parent. Results are collected into an
 * `{ items: result[], count: number }` output.
 *
 * If any iteration fails, the loop continues (best-effort) and the
 * failed item is recorded as `null` in the items array. The loop node
 * itself only fails if the config is invalid or the sub-agent can't
 * be found.
 */
async function executeLoopNode(
  node: AgentNode,
  outputs: Map<string, NodeOutput>,
  parentRunId: string,
  parentOptions: DagExecuteOptions,
  deps: DagExecutorDeps,
  parentAgent: Agent,
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

  // Extract the array to iterate over from the first upstream's output.
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
  const results: (string | null)[] = [];

  for (let i = 0; i < limited.length; i++) {
    const item = limited[i];
    // Each iteration passes the current item as the ITEM input to the sub-agent.
    const subInputs: Record<string, string> = {
      ITEM: typeof item === 'string' ? item : JSON.stringify(item),
      ITEM_INDEX: String(i),
    };

    const subRun = await executeAgentDag(
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
      results.push(subRun.result ?? null);
    } else {
      results.push(null);
    }
  }

  return {
    ok: true,
    result: JSON.stringify({ items: results, count: results.length }),
    output: { items: results, count: results.length },
  };
}

// -- onlyIf evaluation --

/**
 * Evaluate an `onlyIf` predicate against an upstream node's output.
 * Returns true if the condition is met (node should execute), false
 * if not (node should be skipped with condition_not_met).
 *
 * The `field` is a dot-separated path into the upstream's structured
 * output (or the flat `result` string for v0.15 nodes).
 */
function evaluateOnlyIf(condition: OnlyIfCondition, upOutput: NodeOutput | undefined): boolean {
  if (!upOutput) return false;

  // Walk the field path into the structured output if available,
  // falling back to the flat result string.
  let value: unknown;
  if (upOutput.outputs) {
    value = walkPath(upOutput.outputs, condition.field);
  } else {
    // v0.15 node — only "result" is available as a field.
    if (condition.field === 'result') {
      value = upOutput.result;
    } else {
      // Try parsing result as JSON and walking the path.
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
    return value == condition.equals; // loose equality for string/number coercion
  }
  if (condition.notEquals !== undefined) {
    return value != condition.notEquals;
  }
  // No predicate specified — just check the field exists.
  return value !== undefined && value !== null;
}

/** Walk a dot-separated path into a nested object. */
function walkPath(obj: unknown, path: string): unknown {
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

const MINIMAL_ALLOWLIST = ['PATH', 'HOME', 'LANG', 'TERM', 'TMPDIR'];
const LOCAL_ALLOWLIST = [...MINIMAL_ALLOWLIST, 'USER', 'SHELL', 'NODE_ENV', 'TZ'];
const LOCAL_PATTERNS = [/^LC_/];

// -- Tool dispatch helpers --

/**
 * Derive the tool id for a node. Only nodes that explicitly set `tool:`
 * go through the tool dispatch path. v0.15 nodes without `tool:` use
 * the existing spawn path directly — desugaring to `shell-exec` /
 * `claude-code` built-ins happens at a higher layer (YAML parser /
 * import) when the user opts in, not silently at exec time.
 */
function resolveToolId(node: AgentNode): string | undefined {
  return node.tool;
}

/**
 * Build the inputs map for a tool invocation. For v0.16 nodes with
 * `toolInputs:`, use those directly. For v0.15 nodes, fold the inline
 * `command` / `prompt` into the shape the built-in tool expects.
 */
function resolveToolInputs(
  node: AgentNode,
  upstreamSnapshot: Record<string, string>,
): Record<string, unknown> {
  if (node.toolInputs) return { ...node.toolInputs };
  // Backcompat: v0.15 inline fields → built-in tool input shape.
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
  return {};
}
