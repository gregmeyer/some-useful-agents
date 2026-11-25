import { describe, it, expect } from 'vitest';

describe('a node pinned to a model, in an experiment that swaps the model', () => {
  it('runs on the experiment’s model, not its pin (ADR-0104)', async () => {
    const { agentForCondition } = await import('./experiment-conditions.js');
    const agent = { id: 'a', name: 'A', status: 'active', source: 'local', nodes: [{ id: 'find', type: 'llm-prompt', prompt: 'x', model: 'sonnet' }] } as never;
    const swapped = agentForCondition(agent, [{ id: 'l1', name: 'Opus', model: 'opus' }]);
    expect((swapped.nodes[0] as { model?: string }).model).toBe('opus');
  });
});
