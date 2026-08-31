/**
 * The "Call another agent" quick-start pattern.
 *
 * The route-level test covers the case where peers exist. The absence case
 * needs a store with nothing to call, which the shared fixture store cannot
 * provide — so it is asserted here against a stub.
 */

import { describe, it, expect } from 'vitest';
import type { Agent, AgentStore } from '@some-useful-agents/core';
import { renderAgentAddNode } from './agent-add-node.js';

function agent(id: string, status: Agent['status'] = 'active'): Agent {
  return {
    id, name: id, status, source: 'local', mcp: false, version: 1,
    nodes: [{ id: 'go', type: 'shell', command: 'echo hi' }],
  } as unknown as Agent;
}

const storeOf = (agents: Agent[]) =>
  ({ listAgents: () => agents }) as unknown as AgentStore;

describe('add-node quick-start patterns', () => {
  it('offers agent composition when there is another agent to call', () => {
    const me = agent('me');
    const html = renderAgentAddNode({ agent: me, agentStore: storeOf([me, agent('peer')]) });
    expect(html).toContain('Call another agent');
  });

  it('hides it when this is the only agent', () => {
    // A fresh install should not be shown a button that cannot do anything.
    const me = agent('me');
    const html = renderAgentAddNode({ agent: me, agentStore: storeOf([me]) });
    expect(html).not.toContain('Call another agent');
    // The other patterns still render.
    expect(html).toContain('Fetch URL');
  });

  it('hides it when the only other agent is not active', () => {
    // Matches the tool picker's own rule — it lists active agents only, so a
    // paused peer would leave the pattern resolving to nothing.
    const me = agent('me');
    const html = renderAgentAddNode({ agent: me, agentStore: storeOf([me, agent('peer', 'paused')]) });
    expect(html).not.toContain('Call another agent');
  });

  it('hides it when there is no agent store at all', () => {
    const html = renderAgentAddNode({ agent: agent('me') });
    expect(html).not.toContain('Call another agent');
  });
});
