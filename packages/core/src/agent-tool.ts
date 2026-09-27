/**
 * Agents as tools: a model with `agent:<id>` in its node's `tools:` can call
 * that agent like any other tool. The call runs the agent as a sub-run
 * (parentRunId / parentNodeId on its run row) and hands its result back.
 *
 * This module only knows WHETHER an agent may be called and how to describe
 * it; HOW a sub-run executes is injected by the executor (`run`), so the tool
 * layer never imports dag-executor (see llm-tool-dispatch.ts). Guards:
 *
 * - the callee must exist and be `active`;
 * - no cycles: an agent already on the call stack can't be called again;
 * - depth: at most MAX_AGENT_CALL_DEPTH nested agent calls;
 * - a caller that declares `allowedSubAgents` may only call agents on it.
 *
 * Tool policies still apply on top (rules can match `agent:*` or
 * `agent:<id>`), and every call lands in the tool-call trace.
 */
import type { Agent } from './agent-v2-types.js';
import type { ToolDefinition, ToolInputField } from './tool-types.js';

export const AGENT_TOOL_PREFIX = 'agent:';
export const MAX_AGENT_CALL_DEPTH = 3;

export function isAgentToolId(id: string): boolean {
  return id.startsWith(AGENT_TOOL_PREFIX) && id.length > AGENT_TOOL_PREFIX.length;
}

export interface AgentCallResult {
  runId: string;
  status: string;
  result: string;
  error?: string;
}

/**
 * A node's place in an agent call chain, as plain data: enough to rebuild the
 * call context wherever the node runs (e.g. a Temporal worker).
 */
export interface AgentCallInfo {
  /** The run this node belongs to; sub-runs record it as parentRunId. */
  runId: string;
  nodeId: string;
  /** Nested-call depth of this run (0 = top level). */
  depth: number;
  /** Agent ids on the chain, outermost first, ending with this run's agent. */
  stack: string[];
  triggeredBy: string;
}

export interface AgentCallContext {
  /** The tool for `agentId`, or undefined when it may not be called from here. */
  describe(agentId: string): ToolDefinition | undefined;
  /** Why `describe` refused (for logs / docs); undefined when callable. */
  refusal(agentId: string): string | undefined;
  call(agentId: string, inputs: Record<string, unknown>, signal?: AbortSignal): Promise<AgentCallResult>;
}

/** The tool a model sees for an agent: its description, when to use it, and its inputs. */
export function agentToolDefinition(agent: Agent): ToolDefinition {
  const inputs: Record<string, ToolInputField> = {};
  for (const [name, spec] of Object.entries(agent.inputs ?? {})) {
    const values = spec.type === 'enum' && spec.values?.length ? ` One of: ${spec.values.join(', ')}.` : '';
    inputs[name] = {
      type: spec.type === 'number' ? 'number' : spec.type === 'boolean' ? 'boolean' : 'string',
      description: `${spec.description ?? ''}${values}`.trim() || undefined,
      ...(spec.default !== undefined && { default: spec.default }),
      // Required only when there is no default to fall back on.
      ...(spec.required && spec.default === undefined && { required: true }),
    };
  }
  const when = [
    ...(agent.entryConditions?.length ? [`Use when: ${agent.entryConditions.join('; ')}.`] : []),
    ...(agent.nonEntryConditions?.length ? [`Not for: ${agent.nonEntryConditions.join('; ')}.`] : []),
    ...(agent.sampleQuestions?.length ? [`Example asks: ${agent.sampleQuestions.slice(0, 3).join(' | ')}`] : []),
  ];
  return {
    id: `${AGENT_TOOL_PREFIX}${agent.id}`,
    name: agent.name,
    description: [`Runs the "${agent.name}" agent and returns its result.`, agent.description ?? '', ...when].filter(Boolean).join(' '),
    source: agent.source === 'community' ? 'community' : agent.source === 'examples' ? 'examples' : 'local',
    inputs,
    outputs: { result: { type: 'string', description: "The agent's result." } },
    implementation: { type: 'builtin', builtinName: 'agent-call' },
  };
}

export interface AgentCallContextOptions {
  caller: Pick<Agent, 'id' | 'allowedSubAgents'>;
  getAgent: (id: string) => Agent | null | undefined;
  /** Agent ids already on the call stack, outermost first (the caller last). */
  stack: readonly string[];
  /** Nested-call depth of the caller (0 for a top-level run). */
  depth: number;
  /** Runs `callee` as a sub-run one level deeper. Injected by the executor. */
  run: (callee: Agent, inputs: Record<string, string>, ctx: { depth: number; stack: string[]; signal?: AbortSignal }) => Promise<AgentCallResult>;
}

export function createAgentCallContext(opts: AgentCallContextOptions): AgentCallContext {
  const refusal = (agentId: string): string | undefined => {
    const callee = opts.getAgent(agentId);
    if (!callee) return `Agent "${agentId}" does not exist.`;
    if (callee.status !== 'active') return `Agent "${agentId}" is ${callee.status}, not active.`;
    if (opts.stack.includes(agentId)) return `Agent "${agentId}" is already running in this call chain (${[...opts.stack, agentId].join(' → ')}).`;
    if (opts.depth + 1 > MAX_AGENT_CALL_DEPTH) return `Agent calls are limited to ${MAX_AGENT_CALL_DEPTH} levels deep.`;
    const allowed = opts.caller.allowedSubAgents;
    if (allowed && allowed.length > 0 && !allowed.includes(agentId)) {
      return `"${opts.caller.id}" may only call ${allowed.join(', ')} (allowedSubAgents).`;
    }
    return undefined;
  };

  return {
    refusal,
    describe(agentId) {
      if (refusal(agentId)) return undefined;
      return agentToolDefinition(opts.getAgent(agentId)!);
    },
    async call(agentId, inputs, signal) {
      const why = refusal(agentId);
      if (why) throw new Error(why);
      // Agent inputs are strings on every other entry point (CLI --input,
      // MCP run-agent); the executor validates and coerces them per spec.
      const asStrings: Record<string, string> = {};
      for (const [k, v] of Object.entries(inputs)) {
        if (v === undefined || v === null) continue;
        asStrings[k] = typeof v === 'string' ? v : JSON.stringify(v);
      }
      return opts.run(opts.getAgent(agentId)!, asStrings, {
        depth: opts.depth + 1,
        stack: [...opts.stack, agentId],
        signal,
      });
    },
  };
}
