import type { Agent } from '@some-useful-agents/core';

/** One agent calling another, and the node that does it. */
export interface AgentEdge {
  /** The calling agent. */
  from: string;
  /**
   * The called agent. For a dynamic target this is the raw template
   * (e.g. `{{inputs.LOGGER_AGENT_ID}}`) rather than an agent id.
   */
  to: string;
  nodeId: string;
  via: 'agent-invoke' | 'loop';
  /**
   * The target is chosen at run time from an input or an upstream result, so
   * there is no fixed agent to link to. Real: `pre-resolve-adr-checker` picks
   * its callee via `{{inputs.LOGGER_AGENT_ID}}`. Rendering these as ordinary
   * edges would invent a link to an agent that does not exist.
   */
  dynamic: boolean;
  /** False when `to` names an agent that is not in the store (or is dynamic). */
  resolved: boolean;
}

export interface AgentGraph {
  edges: AgentEdge[];
  /** Edges keyed by the CALLER. "What does this agent invoke?" */
  invokes: Map<string, AgentEdge[]>;
  /** Edges keyed by the CALLEE. "What invokes this agent?" */
  invokedBy: Map<string, AgentEdge[]>;
}

const TEMPLATE = /\{\{|\$\{|\$UPSTREAM_/;

/**
 * Build the whole agent-to-agent call graph in ONE pass.
 *
 * `AgentStore.getAgentInvokers()` answers only the reverse direction and
 * rescans every agent on each call, so the `/agents` list was doing an O(n²)
 * sweep — ~14k node visits for 120 agents — to render its "used by" badges.
 * One pass gives both directions and every consumer the same view.
 *
 * Pure so the interesting shapes (dynamic targets, dangling references,
 * self-invocation) are cheap to test.
 */
export function buildAgentGraph(agents: Agent[]): AgentGraph {
  const known = new Set(agents.map((a) => a.id));
  const edges: AgentEdge[] = [];

  for (const agent of agents) {
    for (const node of agent.nodes ?? []) {
      const target = node.type === 'agent-invoke'
        ? node.agentInvokeConfig?.agentId
        : node.type === 'loop'
          ? node.loopConfig?.agentId
          : undefined;
      if (!target) continue;

      const dynamic = TEMPLATE.test(target);
      edges.push({
        from: agent.id,
        to: target,
        nodeId: node.id,
        via: node.type === 'loop' ? 'loop' : 'agent-invoke',
        dynamic,
        resolved: !dynamic && known.has(target),
      });
    }
  }

  const invokes = new Map<string, AgentEdge[]>();
  const invokedBy = new Map<string, AgentEdge[]>();
  for (const e of edges) {
    const out = invokes.get(e.from) ?? [];
    out.push(e);
    invokes.set(e.from, out);
    // A dynamic or dangling target is not a real agent, so it gets no
    // reverse edge — nothing would ever look it up.
    if (e.resolved) {
      const back = invokedBy.get(e.to) ?? [];
      back.push(e);
      invokedBy.set(e.to, back);
    }
  }

  return { edges, invokes, invokedBy };
}

/** Agents that call at least one other agent. */
export function orchestrators(graph: AgentGraph): Set<string> {
  return new Set(graph.invokes.keys());
}
