import { describe, it, expect } from 'vitest';
import { buildAgentGraph, orchestrators, type AgentEdge } from './agent-graph.js';
import type { Agent } from '@some-useful-agents/core';

function agent(id: string, nodes: unknown[] = []): Agent {
  return { id, name: id, status: 'active', source: 'local', mcp: false, version: 1, nodes } as unknown as Agent;
}
const invoke = (nodeId: string, agentId: string) =>
  ({ id: nodeId, type: 'agent-invoke', agentInvokeConfig: { agentId } });
const loopOver = (nodeId: string, agentId: string) =>
  ({ id: nodeId, type: 'loop', loopConfig: { over: 'x', agentId } });

const to = (es: AgentEdge[] | undefined) => (es ?? []).map((e) => e.to).sort();

describe('buildAgentGraph', () => {
  it('records both directions of a call', () => {
    const g = buildAgentGraph([
      agent('caller', [invoke('n1', 'callee')]),
      agent('callee'),
    ]);
    expect(to(g.invokes.get('caller'))).toEqual(['callee']);
    expect((g.invokedBy.get('callee') ?? []).map((e) => e.from)).toEqual(['caller']);
    expect(g.invokes.has('callee')).toBe(false);
  });

  it('counts a loop over an agent as a call', () => {
    const g = buildAgentGraph([
      agent('digest', [loopOver('each', 'two-step-digest')]),
      agent('two-step-digest'),
    ]);
    const edge = g.invokes.get('digest')![0];
    expect(edge.via).toBe('loop');
    expect(edge.resolved).toBe(true);
  });

  it('handles one agent orchestrating several', () => {
    // ashby-pm-role-hunter, from the real store.
    const g = buildAgentGraph([
      agent('hunter', [invoke('a', 'discover'), invoke('b', 'jobs'), invoke('c', 'research')]),
      agent('discover'), agent('jobs'), agent('research'),
    ]);
    expect(to(g.invokes.get('hunter'))).toEqual(['discover', 'jobs', 'research']);
    expect([...orchestrators(g)]).toEqual(['hunter']);
  });

  // Real: pre-resolve-adr-checker invokes `{{inputs.LOGGER_AGENT_ID}}`.
  // Treating that as an agent id would invent a link to something that does
  // not exist and cannot be clicked.
  it('marks a template target as dynamic and never links it', () => {
    const g = buildAgentGraph([agent('checker', [invoke('log', '{{inputs.LOGGER_AGENT_ID}}')])]);
    const edge = g.invokes.get('checker')![0];
    expect(edge.dynamic).toBe(true);
    expect(edge.resolved).toBe(false);
    // No reverse edge — there is no real agent on the other end.
    expect(g.invokedBy.size).toBe(0);
  });

  it('marks a target that no longer exists as unresolved', () => {
    const g = buildAgentGraph([agent('caller', [invoke('n1', 'deleted-agent')])]);
    const edge = g.invokes.get('caller')![0];
    expect(edge.dynamic).toBe(false);
    expect(edge.resolved).toBe(false);
    expect(g.invokedBy.size).toBe(0);
  });

  it('keeps a self-invocation as an edge in both directions', () => {
    // Legal and occasionally deliberate (a recursive refine step), so it is
    // reported rather than filtered — the reader should see it.
    const g = buildAgentGraph([agent('recurse', [invoke('again', 'recurse')])]);
    expect(to(g.invokes.get('recurse'))).toEqual(['recurse']);
    expect((g.invokedBy.get('recurse') ?? []).length).toBe(1);
  });

  it('ignores nodes that are not calls', () => {
    const g = buildAgentGraph([
      agent('plain', [{ id: 'a', type: 'shell', command: 'echo hi' }, { id: 'b', type: 'llm-prompt', prompt: 'hi' }]),
    ]);
    expect(g.edges).toEqual([]);
    expect(orchestrators(g).size).toBe(0);
  });

  it('records every call from one agent, including duplicates to the same target', () => {
    const g = buildAgentGraph([
      agent('caller', [invoke('first', 'worker'), invoke('second', 'worker')]),
      agent('worker'),
    ]);
    expect(g.invokes.get('caller')!.map((e) => e.nodeId)).toEqual(['first', 'second']);
    expect(g.invokedBy.get('worker')!.length).toBe(2);
  });

  it('is a single pass over the agents', () => {
    // The reason this exists: /agents previously called getAgentInvokers once
    // per agent, each of which rescanned every agent.
    let reads = 0;
    const agents = Array.from({ length: 50 }, (_, i) => {
      const a = agent(`a${String(i)}`, [invoke('n', `a${String((i + 1) % 50)}`)]);
      return new Proxy(a, { get(t, p) { if (p === 'nodes') reads++; return Reflect.get(t, p); } });
    });
    buildAgentGraph(agents);
    expect(reads).toBe(50);
  });
});
