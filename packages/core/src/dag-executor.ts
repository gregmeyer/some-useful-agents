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
import type { Agent, AgentNode, NodeErrorCategory, NodeOutput, NodeStructuredOutput, NodeExecutionRecord } from './agent-v2-types.js';
import type { Run, RunStatus } from './types.js';
import type { RunStore } from './run-store.js';
import type { AgentStore } from './agent-store.js';
import type { SecretsStore } from './secrets-store.js';
import type { ToolStore } from './tool-store.js';
import type { VariablesStore } from './variables-store.js';
import type { IntegrationsStore } from './integrations-store.js';
import type { ToolOutput, BuiltinToolContext } from './tool-types.js';
import { getBuiltinTool } from './builtin-tools.js';
import { getGeneratedTool } from './integrations/generated-tools.js';
import { evaluatePolicy, DEFAULT_POLICY_DOCUMENT, PolicyDeniedError, type PolicyDocument, type PolicyEvaluationRequest } from './policy-store.js';
import { buildToolOutput } from './output-framing.js';
import { callMcpTool } from './mcp-client.js';
import { resolveUpstreamTemplate, resolveVarsTemplate, resolveStateTemplate } from './node-templates.js';
import { substituteInputs } from './input-resolver.js';
import { stateDirFor, stateDirSize, formatBytes, DEFAULT_STATE_MAX_BYTES } from './agent-state.js';
import { UntrustedCommunityShellError } from './agent-executor.js';
import { buildNodeEnv, buildUpstreamSnapshot, filterEnvForLog } from './node-env.js';
import { unallowedWidgetImageHosts, formatBlockedImageError } from './widget-image-hosts.js';
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
   * Resolves named integrations referenced by `notify.handlers[i].integration`.
   * Optional — if absent, integration-ref handlers log + skip; inline-form
   * handlers keep working unchanged.
   */
  integrationsStore?: IntegrationsStore;
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
   * Optional LLM fallback policy. When the primary provider fails
   * with a fallback-worthy error category (credit/quota/binary/timeout),
   * node-spawner retries the same prompt under the fallback provider
   * and invokes `onFallback` for telemetry. Configured in
   * `/settings/llm` and threaded through here by the dashboard
   * context. Tests can pass undefined to skip the fallback path.
   */
  llmSettings?: import('./node-spawner.js').LlmSettingsSnapshot;
  /**
   * Optional per-event forwarder used by the dashboard's inbox SSE
   * stream. Fires once per `SpawnProgress` event with the agent +
   * node context. Decoupled from core: dag-executor doesn't know
   * about the inbox event bus; the dashboard registers an adapter
   * that filters by node and republishes to the bus as
   * `triage:token` / `tool_use` etc. Errors are swallowed by the
   * adapter so a misbehaving subscriber can't break a run.
   */
  inboxOnProgress?: (event: { nodeId: string; progress: import('./node-spawner.js').SpawnProgress }) => void;
  /**
   * Optional hook fired once when a run finalizes as `failed` (not on
   * `cancelled`, and suppressed mid-retry-chain like notify). Decoupled from
   * core: the dashboard wires this to raise an inbox conversation so a failure
   * on a remote Temporal worker doesn't die silently. Errors are swallowed by
   * the caller — a misbehaving hook can't break the run path.
   */
  onRunFailure?: (info: { run: Run; failedNodeId?: string; errorCategory?: NodeErrorCategory }) => void;
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
  /**
   * Tool-policy document loaded from `.sua/policies.json` (or built
   * inline by tests). When absent, the executor evaluates against the
   * default allow-all document — same effective behaviour as projects
   * that haven't authored a policy. PR B ships this as a no-op seam
   * so PR C can drop in real allow/deny logic without changing dispatch.
   */
  policyDocument?: PolicyDocument;
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
  /**
   * Set by `executeAgentWithRetry` on every internal attempt. When true,
   * the executor skips the post-run `dispatchNotify` call so the wrapper
   * can fire notify EXACTLY ONCE after the retry chain settles. Without
   * this flag, a 3-attempt run that fails 3× would page 3 times — the
   * whole point of R3 is one page on the final outcome.
   *
   * Direct callers (replay route, agents without a retry policy) leave it
   * unset and get per-call notify dispatch as before.
   */
  suppressNotify?: boolean;
  /**
   * Pre-generated run id. When set, the executor uses this instead of
   * generating a fresh UUID. Lets callers know the run-id BEFORE the
   * promise resolves — eliminates the race in patterns that try to
   * "look up the run by agent name + most-recent" right after kickoff
   * (multiple parallel kickoffs targeting the same agent would
   * otherwise collide on the same most-recent row).
   */
  runId?: string;
  /**
   * Resume an interrupted run in place. Requires `runId` to point at an
   * existing run. The executor does NOT create a new run row; instead it skips
   * nodes already `completed` in that run (reloading their stored outputs),
   * clears any incomplete node rows so they re-run cleanly, and continues from
   * the first not-completed node. Used by the durable Temporal path (B2): on a
   * worker/activity retry the run picks up where it crashed rather than
   * restarting. No-op-safe: a fully-completed run resumes to its terminal state.
   */
  resume?: boolean;
}


/**
 * Seed the in-memory `outputs` map from a stored completed node execution, so
 * downstream nodes see the same upstream snapshot the original run produced.
 * Reused by both replay (copy prior run's nodes) and resume (this run's nodes).
 * Prefers the structured `outputsJson` when present, falling back to `result`.
 */
function seedOutputFromExec(
  outputs: Map<string, NodeOutput>,
  exec: NodeExecutionRecord,
  source: Agent['source'],
): void {
  let structured: NodeStructuredOutput | undefined;
  if (exec.outputsJson) {
    try { structured = JSON.parse(exec.outputsJson) as NodeStructuredOutput; } catch { /* fall back to result */ }
  }
  outputs.set(exec.nodeId, {
    result: exec.result ?? '',
    exitCode: 0,
    source,
    outputs: structured,
  });
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
  const runId = options.runId ?? randomUUID();
  const startedAt = new Date().toISOString();

  // Resume mode (B2): when asked to resume an existing run, reuse its row +
  // completed node executions instead of creating a fresh run. Falls back to a
  // normal fresh run if the row doesn't actually exist (e.g. first attempt).
  const resumingRun = options.resume && options.runId ? deps.runStore.getRun(options.runId) : null;

  if (resumingRun) {
    // Flip the row back to running (a crash/reaper may have marked it failed)
    // and drop any incomplete node rows so they re-run without a PK conflict.
    deps.runStore.updateRun(runId, { status: 'running' });
    deps.runStore.clearIncompleteNodeExecutions(runId);
  } else {
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
      // v2 DAGs execute in-process today. B1b will set this to 'temporal' per
      // node when spawns route through a Temporal activity.
      usedWorkflowProvider: 'local',
    });
  }

  const outputs = new Map<string, NodeOutput>();
  const order = topologicalSort(agent.nodes);
  let firstFailure: { nodeId: string; category: NodeErrorCategory } | undefined;
  // Roll-up of the per-node execution backend: if any node ran on Temporal,
  // the run-level usedWorkflowProvider is promoted from its created 'local'.
  let ranOnTemporal = false;
  let flowEnded = false;
  const skippedNodes = new Set<string>();

  // ── Agent wall-clock ceiling (Agent.timeoutSec) ──────────────────────
  // Per-node timeouts protect against ONE node hanging, but a 10-node DAG
  // at 60s each can legitimately burn 10 minutes on tokens before any
  // single node trips. agent.timeoutSec is the umbrella that catches that
  // case. Implementation: combine the caller's abort signal with an
  // internal controller that fires on either the caller-abort OR the
  // timeout, then pass the combined signal everywhere this loop previously
  // passed `options.signal`. When the timeout itself fires we record
  // `agentTimedOut=true` so the final run.error names the cap directly
  // instead of looking like a generic cancel.
  const internalAbort = new AbortController();
  let agentTimedOut = false;
  let agentTimeoutTimer: NodeJS.Timeout | undefined;
  const forwardCallerAbort = () => internalAbort.abort();
  if (options.signal) {
    if (options.signal.aborted) internalAbort.abort();
    else options.signal.addEventListener('abort', forwardCallerAbort, { once: true });
  }
  if (agent.timeoutSec && agent.timeoutSec > 0) {
    agentTimeoutTimer = setTimeout(() => {
      agentTimedOut = true;
      internalAbort.abort();
    }, agent.timeoutSec * 1000);
  }
  // Single point of cleanup for the wall-clock timer + caller-abort listener.
  // Called once on every return path from this function (terminal status,
  // replay early-exit, exception).
  const cleanupAgentTimeout = () => {
    if (agentTimeoutTimer) {
      clearTimeout(agentTimeoutTimer);
      agentTimeoutTimer = undefined;
    }
    if (options.signal) options.signal.removeEventListener('abort', forwardCallerAbort);
  };
  const effectiveSignal = internalAbort.signal;

  // Replay pre-load: copy prior node_executions for nodes before the pivot.
  // Their stored `result` feeds downstream outputs so re-execution starts
  // at `fromNodeId` with the exact snapshot the original run produced.
  let replaySkipIds = new Set<string>();
  if (options.replayFrom) {
    const { priorRunId, fromNodeId } = options.replayFrom;
    const pivotIndex = order.findIndex((n) => n.id === fromNodeId);
    if (pivotIndex < 0) {
      cleanupAgentTimeout();
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
      cleanupAgentTimeout();
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
      seedOutputFromExec(outputs, prior, agent.source);
    }
    replaySkipIds = new Set(priorIds);
  }

  // Resume pre-load (B2): the completed node rows already live in THIS run, so
  // we don't copy them — just seed their outputs and skip them. Incomplete rows
  // were cleared above, so the executor re-runs from the first unfinished node.
  if (resumingRun) {
    for (const exec of deps.runStore.listNodeExecutions(runId)) {
      if (exec.status === 'completed') {
        seedOutputFromExec(outputs, exec, agent.source);
        replaySkipIds.add(exec.nodeId);
      }
    }
  }

  for (const node of order) {
    if (replaySkipIds.has(node.id)) continue;
    const nodeStartedAt = new Date().toISOString();

    // Cancellation: abort signal was fired. Mark all remaining nodes
    // as cancelled and break out of the loop.
    if (effectiveSignal.aborted) {
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
      // Create the running row up-front so the dashboard can render
      // per-iteration progress while sub-runs are in flight, instead of
      // showing a black hole until the loop finishes.
      deps.runStore.createNodeExecution({
        runId,
        nodeId: node.id,
        workflowVersion: agent.version,
        status: 'running',
        startedAt: nodeStartedAt,
      });
      const loopProgress: SpawnProgress[] = [];
      const onLoopProgress = (event: SpawnProgress) => {
        loopProgress.push(event);
        deps.runStore.updateNodeExecution(runId, node.id, {
          progressJson: JSON.stringify(loopProgress),
        });
      };
      const loopResult = await executeLoopNode(node, outputs, runId, options, deps, agent, executeAgentDag, onLoopProgress);
      const completedAt = new Date().toISOString();
      if (loopResult.ok) {
        const outputsJson = JSON.stringify(loopResult.output);
        outputs.set(node.id, {
          result: JSON.stringify(loopResult.output),
          exitCode: 0,
          source: agent.source,
          outputs: loopResult.output,
        });
        deps.runStore.updateNodeExecution(runId, node.id, {
          status: 'completed',
          completedAt,
          result: JSON.stringify(loopResult.output),
          exitCode: 0,
          outputsJson,
        });
      } else {
        deps.runStore.updateNodeExecution(runId, node.id, {
          status: 'failed',
          errorCategory: 'setup',
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
      env = await buildNodeEnv(agent, node, options.inputs ?? {}, upstreamSnapshot, deps, runId);
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
    // Additionally forwards each event to the optional inbox SSE
    // adapter (`deps.inboxOnProgress`) — that's what the dashboard
    // hangs per-token triage:token events off of, for the typewriter
    // reveal in PR 4. The adapter is responsible for filtering by
    // node and swallowing its own errors.
    const progressEvents: SpawnProgress[] = [];
    const onProgress = (event: SpawnProgress) => {
      progressEvents.push(event);
      // Write to DB on each event so polling picks it up immediately.
      deps.runStore.updateNodeExecution(runId, node.id, {
        progressJson: JSON.stringify(progressEvents),
      });
      // Best-effort fan-out to the inbox SSE bus. Never let an
      // adapter exception break a live run.
      if (deps.inboxOnProgress) {
        try { deps.inboxOnProgress({ nodeId: node.id, progress: event }); }
        catch { /* swallow */ }
      }
    };

    // PR C (orphan-kill): persist the child's pid + wall-clock start time
    // onto the in-flight node row the moment spawn() returns. A dashboard
    // restart mid-run can then read these back, ps-cross-check, and SIGKILL
    // the orphan instead of letting it burn tokens until the API call
    // finishes naturally.
    const onSpawn = (pid: number, startedAtMs: number) => {
      deps.runStore.updateNodeExecution(runId, node.id, {
        childPid: pid,
        childStartedAtMs: startedAtMs,
      });
    };

    // v0.16 tool dispatch: if the node references a tool, resolve it and
    // call its execute() function. Built-in tools run in-process; user
    // tools that use shell/claude-code implementation types go through the
    // same spawn path as v0.15 nodes. Nodes without a tool field fall
    // through to the legacy spawn path directly (backcompat).
    const toolId = resolveToolId(node);
    // Tool lookup order: hard-coded built-ins → connector-generated
    // (csv + postgres per-integration tools) → user tools from the
    // store. Generated tools share the BuiltinToolEntry shape so the
    // existing builtin dispatch path handles them with zero new
    // branches. Postgres tools resolve their DSN from secretsStore at
    // execute time; CSV ignores it.
    const builtinEntry = toolId
      ? (getBuiltinTool(toolId)
        ?? (deps.integrationsStore
          ? getGeneratedTool(deps.integrationsStore, toolId, { secretsStore: deps.secretsStore })
          : undefined))
      : undefined;

    // PR B (tool policies): single seam that every tool-execute path
    // crosses. The stub always allows; PR C wires real allow/deny logic
    // here without touching downstream dispatch. The throw is caught by
    // the existing tool-dispatch catch (~30 lines below) and re-mapped
    // to errorCategory='policy_denied' via the instanceof check.
    if (toolId) {
      const policyRequest: PolicyEvaluationRequest = {
        toolId,
        resource: extractPrimaryResource(node, toolId),
        agentSource: agent.source,
        agentId: agent.id,
      };
      const decision = evaluatePolicy(deps.policyDocument ?? DEFAULT_POLICY_DOCUMENT, policyRequest);
      if (decision.effect === 'deny') {
        throw new PolicyDeniedError(
          decision.reason ?? `Policy denied tool "${toolId}" on resource "${policyRequest.resource}".`,
          toolId,
          policyRequest.resource,
          decision.matchedRuleIndex,
        );
      }
    }

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

          structuredOutput = await callMcpTool(resolvedImpl, toolInputs, effectiveSignal);
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
            type: (userTool.implementation.type === 'claude-code' || userTool.implementation.type === 'llm-prompt') ? 'claude-code' : 'shell',
            command: userTool.implementation.command,
            prompt: userTool.implementation.prompt,
            provider: node.provider ?? agent.provider,
            model: node.model ?? agent.model,
          };
          const spawnOpts = { agentId: agent.id, agentSource: agent.source, allowUntrustedShell: deps.allowUntrustedShell, llmSettings: deps.llmSettings };
          const spawnResult = await spawnFn(synthNode, env, spawnOpts, onProgress, effectiveSignal, onSpawn);
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
        const spawnOpts = { agentId: agent.id, agentSource: agent.source, allowUntrustedShell: deps.allowUntrustedShell, llmSettings: deps.llmSettings };
        const spawnResult = await spawnFn(nodeWithDefaults, env, spawnOpts, onProgress, effectiveSignal, onSpawn);
        result = spawnResult;
        // Try to extract framed output from stdout even for legacy nodes,
        // so users who upgrade their shell scripts to emit framed JSON get
        // structured outputs without changing the node YAML.
        structuredOutput = buildToolOutput(spawnResult.result);
      }
    } catch (err) {
      const message = (err as Error).message;
      const stateBytesAfter = deps.dataRoot ? stateDirSize(agent.id, deps.dataRoot) : undefined;
      // PolicyDeniedError comes from the policy-eval seam above. Map it
      // to its own category so dashboards + retry-policy filters can
      // distinguish "policy refused this" from generic setup failures.
      // Policy denials are deliberately NOT in the default retry-categories
      // list — denying is a stable signal, not a transient one.
      const errorCategory: NodeErrorCategory = err instanceof PolicyDeniedError ? 'policy_denied' : 'setup';
      deps.runStore.updateNodeExecution(runId, node.id, {
        status: 'failed',
        errorCategory,
        completedAt: new Date().toISOString(),
        error: message,
        stateBytesAfter,
      });
      firstFailure = { nodeId: node.id, category: errorCategory };
      continue;
    }

    const completedAt = new Date().toISOString();
    const outputsJson = structuredOutput ? JSON.stringify(structuredOutput) : undefined;
    const stateBytesAfter = deps.dataRoot ? stateDirSize(agent.id, deps.dataRoot) : undefined;

    if (result.usedWorkflowProvider === 'temporal') ranOnTemporal = true;

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
        usedLLMProvider: result.usedLLMProvider,
        attemptedProviders: result.attemptedProviders ? result.attemptedProviders.join(',') : undefined,
        providerFailures: result.providerFailures ? JSON.stringify(result.providerFailures) : undefined,
        usedWorkflowProvider: result.usedWorkflowProvider,
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
        usedLLMProvider: result.usedLLMProvider,
        attemptedProviders: result.attemptedProviders ? result.attemptedProviders.join(',') : undefined,
        providerFailures: result.providerFailures ? JSON.stringify(result.providerFailures) : undefined,
        usedWorkflowProvider: result.usedWorkflowProvider,
        stateBytesAfter,
      });
      firstFailure = { nodeId: node.id, category };
    }
  }

  let finalStatus: RunStatus = firstFailure ? 'failed' : 'completed';
  // Final result = last completed node's output. Keeps `sua agent status`
  // readable for single-node agents where "the run's result" is obvious,
  // and gives multi-node agents a meaningful summary string.
  const lastCompleted = [...outputs.values()].pop();
  let finalError = firstFailure
    ? `Failed at node "${firstFailure.nodeId}" (${firstFailure.category})`
    : undefined;

  // Root-cause guard for CSP-blocked widget images: an agent whose ai-template
  // widget renders an image from a host not in permissions.imgSrc produces
  // output the browser will refuse to render (and the run-detail poll re-fires
  // the violation on every refresh). Fail the run here with an actionable
  // error instead of shipping un-renderable output. Result is still persisted
  // so the dashboard can name the blocked host(s) and offer one-click "Allow".
  if (finalStatus === 'completed') {
    const blockedHosts = unallowedWidgetImageHosts({
      outputWidget: agent.outputWidget,
      permissions: agent.permissions,
      result: lastCompleted?.result,
    });
    if (blockedHosts.length > 0) {
      finalStatus = 'failed';
      finalError = formatBlockedImageError(blockedHosts);
    }
  }

  // Wall-clock ceiling tripped → name the cap directly in the run error so
  // the dashboard shows "Agent wall-clock timeout (60s) exceeded" instead of
  // a generic "Cancelled by user" that the abort plumbing would otherwise
  // produce. The per-node row remains tagged with whatever category the
  // spawn produced (typically 'timeout' on the in-flight node, 'cancelled'
  // on the remaining ones).
  if (agentTimedOut) {
    finalStatus = 'failed';
    finalError = `Agent wall-clock timeout (${agent.timeoutSec}s) exceeded.`;
  }

  cleanupAgentTimeout();
  deps.runStore.updateRun(runId, {
    status: finalStatus,
    completedAt: new Date().toISOString(),
    result: lastCompleted?.result,
    error: finalError,
    // Promote the run-level backend to 'temporal' if any node ran there;
    // otherwise leave the 'local' stamped at creation (undefined = no change).
    usedWorkflowProvider: ranOnTemporal ? 'temporal' : undefined,
  });

  const run = deps.runStore.getRun(runId);
  if (!run) throw new Error(`Run ${runId} vanished from store after write`);

  // Failure hook: fire once when the run ends `failed` (not cancelled), on the
  // final attempt only (suppressNotify mirrors the retry wrapper's once-on-last
  // semantics). The dashboard raises an inbox conversation from here. Wrapped so
  // a misbehaving hook can't bubble into the run path.
  if (deps.onRunFailure && finalStatus === 'failed' && !options.suppressNotify) {
    try {
      deps.onRunFailure({ run, failedNodeId: firstFailure?.nodeId, errorCategory: firstFailure?.category });
    } catch {
      // Hook errors are non-fatal — the run result is already committed.
    }
  }

  // Notify dispatch fires AFTER the run row is committed. Wrapped so any
  // dispatcher exception can never bubble into the run path — the run
  // result is final by this point. Suppressed when the caller is
  // `executeAgentWithRetry` mid-chain (R3): the wrapper fires once on
  // the final attempt to avoid paging on every transient failure.
  if (agent.notify && !options.suppressNotify) {
    try {
      await dispatchNotify(agent.notify, {
        agent,
        run,
        secretsStore: deps.secretsStore,
        variablesStore: deps.variablesStore,
        integrationsStore: deps.integrationsStore,
        toolStore: deps.toolStore,
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
/**
 * Extract the "primary resource" from a node for policy evaluation —
 * the URL for http tools, the path for file tools, the command for
 * shell-exec, etc. Returns empty string when no obvious resource is
 * present (templated values that haven't been resolved yet, MCP tools
 * with no canonical primary input). PR C's matcher treats `''` as
 * "unknown resource" and uses `'*'` resource patterns to match it.
 *
 * Templated values (`{{inputs.X}}`, `{{upstream.Y.z}}`) are returned
 * as-is — the eval seam runs *before* substitution so authors can write
 * deny rules against the literal template strings if they want.
 */
function extractPrimaryResource(node: AgentNode, toolId: string): string {
  // Tools whose primary resource is a URL.
  if (toolId === 'http-get' || toolId === 'http-post') {
    const ti = node.toolInputs ?? {};
    const url = ti.url ?? ti.endpoint;
    if (typeof url === 'string') return url;
    return '';
  }
  // Tools whose primary resource is a filesystem path.
  if (toolId === 'file-read' || toolId === 'file-write') {
    const ti = node.toolInputs ?? {};
    const path = (typeof ti.path === 'string' ? ti.path : undefined) ?? node.path;
    if (typeof path === 'string') return path;
    return '';
  }
  // shell-exec: the command itself is the resource. Same for un-tooled
  // shell nodes that desugar to shell-exec.
  if (toolId === 'shell-exec') {
    return node.command ?? '';
  }
  // claude-code: prompt isn't really a resource; PR C may grow this to
  // inspect node.allowedTools instead. For now, return empty.
  return '';
}

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
