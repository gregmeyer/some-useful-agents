import { describe, it, expect } from 'vitest';
import type { Agent } from '@some-useful-agents/core';
import { dagPayload, renderDagView } from './dag-view.js';

const agent = { id: 'a', name: 'a', nodes: [{ id: 'one', type: 'shell' }, { id: 'two', type: 'shell', dependsOn: ['one'] }] } as unknown as Agent;
const statusOf = (payload: string, id: string) =>
  (JSON.parse(payload).elements as Array<{ data: { id: string; status?: string } }>).find((e) => e.data.id === id)!.data.status;

describe('steps that have not started', () => {
  it('are not-started in a run, and uncoloured by status on the agent\'s own diagram', () => {
    const live = dagPayload(agent, [{ runId: 'r', nodeId: 'one', status: 'running' } as never]);
    expect(statusOf(live, 'one')).toBe('running');
    expect(statusOf(live, 'two')).toBe('not-started');
    expect(String(renderDagView({ agent, nodeExecs: [] }))).toContain('"status":"not-started"');
    expect(String(renderDagView({ agent }))).not.toContain('not-started');
  });
});
