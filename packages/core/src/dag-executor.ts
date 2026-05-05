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
import type { Agent, AgentNode, NodeErrorCategory, NodeOutput, NodeStructuredOutput } from './agent-v2-types.js';
import type { Run, RunStatus } from './types.js';
import type { RunStore } from './run-store.js';
import type { AgentStore } from './agent-store.js';
import type { SecretsStore } from './secrets-store.js';
import type { ToolStore } from './tool-store.js';
import type { VariablesStore } from './variables-store.js';
import type { ToolOutput, BuiltinToolContext } from './tool-types.js';
import { getBuiltinTool } from './builtin-tools.js';
import { buildToolOutput } from './output-framing.js';
import { callMcpTool } from './mcp-client.js';
import { resolveUpstreamTemplate, resolveVarsTemplate, resolveStateTemplate } from './node-templates.js';
import { substituteInputs } from './input-resolver.js';
import { stateDirFor, stateDirSize, formatBytes, DEFAULT_STATE_MAX_BYTES } from './agent-state.js';
import { UntrustedCommunityShellError } from './agent-executor.js';
import { buildNodeEnv, buildUpstreamSnapshot, filterEnvForLog } from './node-env.js';
import { type SpawnResult, type SpawnNodeFn, type SpawnProgress, spawnNodeReal } from './node-spawner.js';
import { resolveToolId, resolveToolInputs } from './tool-dispatch.js';
import { dispatchNotify, type NotifyLogger } from './notify-dispatcher.js';
import {
  executeControlFlowNode,
  executeAgentInvokeNode,
  executeLoopNode,
  evaluateOnlyIf,
} from './flow-control.js';

// Re-export for consumers that import from dag-executor.
export { resolveUpstreamTemplate, resolveVarsTemplate } from './node-templates.js';
export type { SpawnResult, SpawnNodeFn } from './node-spawner.js';

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
   * Global variables store. When present, variables are injected into
   * every node's env as `$NAME` (shell) and available via `{{vars.NAME}}`
   * (claude-code). Precedence: --input > agent default > variable > secret.
   */
  variablesStore?: VariablesStore;
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
  /**
   * Optional dashboard URL prefix used by the notify dispatcher to embed
   * a "view run in dashboard" link in Slack messages. When absent, the
   * link is omitted; the notify still fires.
   */
  dashboardBaseUrl?: string;
  /**
   * Optional fetch override used by the notify dispatcher's slack/webhook
   * handlers. Tests inject a mock; production uses global fetch.
   */
  notifyFetch?: typeof fetch;
  /** Logger for notify handler failures. Defaults to console.warn. */
  notifyLogger?: NotifyLogger;
  /**
   * Base directory for sua's persistent data (usually `dirname(dbPath)`).
   * When set, the executor:
   *   - creates `<dataRoot>/agent-state/<agent-id>/` lazily on first use
   *   - exposes its path as `$STATE_DIR` (shell) and `{{state}}` (templates)
   *     so agents can persist data across runs (e.g. diff-over-time, caches).
   * When absent, the state-dir features are simply unavailable —
   * `$STATE_DIR` is unset and `{{state}}` resolves to empty string. Tests
   * and one-shot CLI runs typically omit it.
   */
  dataRoot?: string;
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
   * Cancellation signal. When aborted, the executor SIGTERMs the running
   * child process, marks remaining nodes as cancelled, and updates the
   * run to status 'cancelled'.
   */
  signal?: AbortSignal;
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
  /**
   * Retry chain metadata. Set when this execution is a manual retry of a
   * prior failed run. `originalRunId` always points at the head of the
   * chain (never an intermediate retry); `attempt` is 1-indexed and
   * already incremented for the new run (i.e. attempt=2 for the first
   * retry).
   */
  retryOf?: { originalRunId: string; attempt: number };
}


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
    retryOfRunId: options.retryOf?.originalRunId,
    attempt: options.retryOf?.attempt,
  });

  const outputs = new Map<string, NodeOutput>();
  const order = topologicalSort(agent.nodes);
  let firstFailure: { nodeId: string; category: NodeErrorCategory } | undefined;
  let flowEnded = false;
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

    // Cancellation: abort signal was fired. Mark all remaining nodes
    // as cancelled and break out of the loop.
    if (options.signal?.aborted) {
      deps.runStore.createNodeExecution({
        runId,
        nodeId: node.id,
        workflowVersion: agent.version,
        status: 'cancelled',
        errorCategory: 'cancelled',
        startedAt: nodeStartedAt,
        completedAt: nodeStartedAt,
        error: 'Cancelled by user.',
      });
      skippedNodes.add(node.id);
      if (!firstFailure) firstFailure = { nodeId: node.id, category: 'cancelled' };
      continue;
    }

    // flow_ended: an `end` or `break` node was reached. All remaining
    // nodes are skipped cleanly — not a failure, just early termination.
    if (flowEnded) {
      deps.runStore.createNodeExecution({
        runId,
        nodeId: node.id,
        workflowVersion: agent.version,
        status: 'skipped',
        errorCategory: 'flow_ended',
        startedAt: nodeStartedAt,
        completedAt: nodeStartedAt,
        error: 'Skipped: flow ended early (end or break node reached).',
      });
      continue;
    }

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
    // Exception: branch (merge) nodes handle missing upstreams gracefully
    // by excluding them from the merged result — they should always run.
    if (!node.onlyIf && node.type !== 'branch') {
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
    if (node.type === 'branch') {
      // Branch (merge) node: collects all upstream outputs into a merged
      // result. Acts as an explicit fan-in point — waits for all dependsOn
      // to complete (the topo sort already guarantees this), then produces
      // a { merged: Record<string, unknown> } where each key is an upstream
      // node id and the value is its structured output or result string.
      const merged: Record<string, unknown> = {};
      for (const dep of node.dependsOn ?? []) {
        const upOutput = outputs.get(dep);
        if (upOutput) {
          merged[dep] = upOutput.outputs ?? upOutput.result;
        }
        // Condition-skipped upstreams are absent from `outputs` — they
        // simply don't appear in the merged result, which is correct.
      }
      const output = { merged, count: Object.keys(merged).length };
      const outputsJson = JSON.stringify(output);
      outputs.set(node.id, {
        result: outputsJson,
        exitCode: 0,
        source: agent.source,
        outputs: output,
      });
      deps.runStore.createNodeExecution({
        runId,
        nodeId: node.id,
        workflowVersion: agent.version,
        status: 'completed',
        startedAt: nodeStartedAt,
        completedAt: new Date().toISOString(),
        result: outputsJson,
        exitCode: 0,
        outputsJson,
      });
      continue;
    }

    if (node.type === 'end') {
      // End node: terminate the entire flow cleanly. All remaining nodes
      // are skipped with flow_ended. The run completes as 'completed'
      // (not 'failed') — this is a deliberate early exit, not an error.
      const msg = node.endMessage ?? 'Flow ended early.';
      deps.runStore.createNodeExecution({
        runId,
        nodeId: node.id,
        workflowVersion: agent.version,
        status: 'completed',
        startedAt: nodeStartedAt,
        completedAt: new Date().toISOString(),
        result: msg,
        exitCode: 0,
      });
      outputs.set(node.id, { result: msg, exitCode: 0, source: agent.source });
      // Mark everything after as flow_ended.
      flowEnded = true;
      continue;
    }

    if (node.type === 'break') {
      // Break node: signal to the parent loop to stop iteration.
      // Within the current flow, it acts like an end — remaining nodes
      // are skipped. The executor returns a special marker so the loop
      // dispatcher can detect the break.
      const msg = node.endMessage ?? 'Break: exiting loop iteration.';
      deps.runStore.createNodeExecution({
        runId,
        nodeId: node.id,
        workflowVersion: agent.version,
        status: 'completed',
        startedAt: nodeStartedAt,
        completedAt: new Date().toISOString(),
        result: msg,
        exitCode: 0,
      });
      outputs.set(node.id, { result: msg, exitCode: 0, source: agent.source });
      flowEnded = true;
      continue;
    }

    if (node.type === 'loop') {
      const loopResult = await executeLoopNode(node, outputs, runId, options, deps, agent, executeAgentDag);
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
      const invokeResult = await executeAgentInvokeNode(node, outputs, runId, options, deps, agent, executeAgentDag);
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

    // PR D.1: pre-node state-dir size cap. Refuses to run when the agent's
    // state dir already exceeds its cap from a prior run (or from this
    // node's predecessors in the same DAG). The node that *exceeded* the
    // cap completes; the *next* node sees the over-size and fails. This
    // attributes the error to a fresh node rather than retroactively
    // failing a node that already finished.
    let stateBytesBefore: number | undefined;
    if (deps.dataRoot) {
      stateBytesBefore = stateDirSize(agent.id, deps.dataRoot);
      const cap = agent.stateMaxBytes ?? DEFAULT_STATE_MAX_BYTES;
      if (cap > 0 && stateBytesBefore > cap) {
        const msg = `State dir for "${agent.id}" is ${formatBytes(stateBytesBefore)}, cap is ${formatBytes(cap)}. ` +
          `Run \`sua state prune ${agent.id}\` to clean up or raise the cap with \`stateMaxBytes:\`.`;
        deps.runStore.createNodeExecution({
          runId,
          nodeId: node.id,
          workflowVersion: agent.version,
          status: 'failed',
          errorCategory: 'setup',
          startedAt: nodeStartedAt,
          completedAt: new Date().toISOString(),
          error: msg,
          stateBytesBefore,
        });
        firstFailure = { nodeId: node.id, category: 'setup' };
        continue;
      }
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
      stateBytesBefore,
    });

    // Progress collector: accumulates SpawnProgress events and writes
    // them to the DB so the dashboard can poll for turn status.
    const progressEvents: SpawnProgress[] = [];
    const onProgress = (event: SpawnProgress) => {
      progressEvents.push(event);
      // Write to DB on each event so polling picks it up immediately.
      deps.runStore.updateNodeExecution(runId, node.id, {
        progressJson: JSON.stringify(progressEvents),
      });
    };

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
        // Resolve {{upstream.X.field}}, {{vars.X}}, {{state}}, and
        // {{inputs.X}} in string-typed inputs so first-class node types
        // like file-write can template path/content from upstream
        // output, inputs, and the per-agent state directory.
        const vars = deps.variablesStore ? deps.variablesStore.getAll() : {};
        const resolvedInputs = options.inputs ?? {};
        const stateDir = deps.dataRoot ? stateDirFor(agent.id, deps.dataRoot) : undefined;
        const resolveStr = (s: string): string =>
          substituteInputs(
            resolveStateTemplate(
              resolveVarsTemplate(resolveUpstreamTemplate(s, upstreamSnapshot), vars),
              stateDir,
            ),
            resolvedInputs,
          );
        const rawInputs = {
          ...(builtinEntry.definition.config ?? {}),
          ...resolveToolInputs(node, upstreamSnapshot),
          ...(node.action ? { _action: node.action } : {}),
        };
        const toolInputs: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(rawInputs)) {
          toolInputs[k] = typeof v === 'string' ? resolveStr(v) : v;
        }
        const ctx: BuiltinToolContext = {
          workingDirectory: node.workingDirectory,
          env,
          timeout: node.timeout,
        };
        structuredOutput = await builtinEntry.execute(toolInputs, ctx);
        const stdout = structuredOutput.result ?? '';
        result = { result: stdout, exitCode: (structuredOutput as Record<string, unknown>).exit_code as number ?? 0 };
      } else if (toolId && deps.toolStore) {
        const userTool = deps.toolStore.getTool(toolId);
        if (!userTool) {
          throw new Error(`Tool "${toolId}" not found in registry or store.`);
        }

        if (userTool.implementation.type === 'mcp') {
          // Server-level enable gate: if the tool was imported from an MCP
          // server (has mcp_server_id) and that server is disabled, fail
          // with a clear message rather than trying to connect.
          const serverId = deps.toolStore.getToolServerId(toolId);
          if (serverId) {
            const server = deps.toolStore.getMcpServer(serverId);
            if (server && !server.enabled) {
              throw new Error(`MCP server "${serverId}" is disabled. Re-enable it under Settings \u2192 MCP Servers.`);
            }
          }

          // MCP tool: resolve templates in impl fields + inputs, then call
          // the remote server via the pooled client. Output is the MCP
          // structuredContent (if any) with text blocks joined into `result`.
          const vars = deps.variablesStore ? deps.variablesStore.getAll() : {};
          const resolveStr = (s: string | undefined): string | undefined =>
            s === undefined ? undefined : resolveVarsTemplate(resolveUpstreamTemplate(s, upstreamSnapshot), vars);
          const resolveValue = (v: unknown): unknown => {
            if (typeof v === 'string') return resolveStr(v);
            if (Array.isArray(v)) return v.map(resolveValue);
            if (v && typeof v === 'object') {
              const out: Record<string, unknown> = {};
              for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = resolveValue(val);
              return out;
            }
            return v;
          };

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

          const rawInputs = {
            ...(userTool.config ?? {}),
            ...resolveToolInputs(node, upstreamSnapshot),
          };
          const toolInputs = resolveValue(rawInputs) as Record<string, unknown>;

          structuredOutput = await callMcpTool(resolvedImpl, toolInputs, options.signal);
          const isError = Boolean(structuredOutput.isError);
          result = {
            result: structuredOutput.result ?? '',
            exitCode: isError ? 1 : 0,
            error: isError ? (structuredOutput.result ?? 'MCP tool reported error') : undefined,
          };
        } else {
          // Shell / claude-code: spawn via the same path v0.15 nodes use.
          // The tool's implementation.command/prompt becomes the spawned body.
          const spawnFn = deps.spawnNode ?? spawnNodeReal;
          const synthNode: AgentNode = {
            ...node,
            type: userTool.implementation.type === 'claude-code' ? 'claude-code' : 'shell',
            command: userTool.implementation.command,
            prompt: userTool.implementation.prompt,
            provider: node.provider ?? agent.provider,
            model: node.model ?? agent.model,
          };
          const spawnOpts = { agentId: agent.id, agentSource: agent.source, allowUntrustedShell: deps.allowUntrustedShell };
          const spawnResult = spawnFn === spawnNodeReal
            ? await spawnNodeReal(synthNode, env, spawnOpts, onProgress, options.signal)
            : await spawnFn(synthNode, env, spawnOpts);
          result = spawnResult;
          structuredOutput = buildToolOutput(spawnResult.result);
        }
      } else {
        // v0.15 legacy path: no tool field, dispatch by type directly.
        // Merge agent-level provider/model defaults (node overrides take precedence).
        const nodeWithDefaults: AgentNode = {
          ...node,
          provider: node.provider ?? agent.provider,
          model: node.model ?? agent.model,
        };
        const spawnFn = deps.spawnNode ?? spawnNodeReal;
        const spawnOpts = { agentId: agent.id, agentSource: agent.source, allowUntrustedShell: deps.allowUntrustedShell };
        const spawnResult = spawnFn === spawnNodeReal
          ? await spawnNodeReal(nodeWithDefaults, env, spawnOpts, onProgress, options.signal)
          : await spawnFn(nodeWithDefaults, env, spawnOpts);
        result = spawnResult;
        // Try to extract framed output from stdout even for legacy nodes,
        // so users who upgrade their shell scripts to emit framed JSON get
        // structured outputs without changing the node YAML.
        structuredOutput = buildToolOutput(spawnResult.result);
      }
    } catch (err) {
      const message = (err as Error).message;
      const stateBytesAfter = deps.dataRoot ? stateDirSize(agent.id, deps.dataRoot) : undefined;
      deps.runStore.updateNodeExecution(runId, node.id, {
        status: 'failed',
        errorCategory: 'setup',
        completedAt: new Date().toISOString(),
        error: message,
        stateBytesAfter,
      });
      firstFailure = { nodeId: node.id, category: 'setup' };
      continue;
    }

    const completedAt = new Date().toISOString();
    const outputsJson = structuredOutput ? JSON.stringify(structuredOutput) : undefined;
    const stateBytesAfter = deps.dataRoot ? stateDirSize(agent.id, deps.dataRoot) : undefined;

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
        stateBytesAfter,
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
        stateBytesAfter,
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

  // Notify dispatch fires AFTER the run row is committed. Wrapped so any
  // dispatcher exception can never bubble into the run path — the run
  // result is final by this point.
  if (agent.notify) {
    try {
      await dispatchNotify(agent.notify, {
        agent,
        run,
        secretsStore: deps.secretsStore,
        variablesStore: deps.variablesStore,
        dashboardBaseUrl: deps.dashboardBaseUrl,
        fetchImpl: deps.notifyFetch,
        logger: deps.notifyLogger,
      });
    } catch (err) {
      // Defense-in-depth: dispatchNotify catches handler errors itself.
      // This catches anything truly unexpected (e.g. secretsStore.getAll
      // rejecting in a way the dispatcher's try/catch missed).
      const logger = deps.notifyLogger ?? { warn: (m: string) => console.warn(`[notify] ${m}`) };
      logger.warn(`dispatch failed: ${(err as Error).message}`);
    }
  }

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
