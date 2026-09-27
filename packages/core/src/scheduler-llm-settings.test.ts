import { describe, it, expect, vi } from 'vitest';
import type { Agent } from './agent-v2-types.js';

// Capture what the scheduler hands the executor instead of running a DAG.
const calls: Array<{ deps: Record<string, unknown> }> = [];
vi.mock('./agent-loop/runner.js', () => ({
  executeAgentLoop: vi.fn(async (_agent: unknown, _opts: unknown, deps: Record<string, unknown>) => {
    calls.push({ deps });
    return { id: 'r1', status: 'completed' };
  }),
}));

const { LocalScheduler } = await import('./scheduler.js');

const agent: Agent = {
  id: 'nightly', name: 'nightly', status: 'active', source: 'local', version: 1,
  schedule: '0 9 * * *', nodes: [{ id: 'a', type: 'shell', command: 'true' }],
} as Agent;

// Regression: scheduled runs got no llmSettings, so they ignored the
// operator's provider chain (and custom providers) and used claude alone.
describe('scheduled v2 runs use the operator\'s LLM settings', () => {
  it('reads llmSettings at each fire and passes it to the executor', async () => {
    let providers = ['codex', 'claude'];
    const scheduler = new LocalScheduler({
      provider: { submitRun: vi.fn() } as never,
      agents: new Map(),
      v2Agents: [agent],
      v2Deps: { runStore: undefined as never, llmSettings: () => ({ providers }) },
    });
    const fire = (scheduler as unknown as { fireV2Agent(a: Agent, s: string): Promise<void> }).fireV2Agent.bind(scheduler);

    await fire(agent, agent.schedule!);
    providers = ['local-qwen-8b', 'claude']; // operator edits Settings → LLM
    await fire(agent, agent.schedule!);
    await vi.waitFor(() => expect(calls).toHaveLength(2));

    expect(calls[0].deps.llmSettings).toEqual({ providers: ['codex', 'claude'] });
    expect(calls[1].deps.llmSettings).toEqual({ providers: ['local-qwen-8b', 'claude'] });
  });
});
