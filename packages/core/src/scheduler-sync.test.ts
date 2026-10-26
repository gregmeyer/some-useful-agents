import { describe, it, expect, vi } from 'vitest';
import type { Agent } from './agent-v2-types.js';

// What each fire ran with, instead of running a DAG.
const ran: Array<{ id: string; command: unknown }> = [];
vi.mock('./agent-loop/runner.js', () => ({
  executeAgentLoop: vi.fn(async (agent: Agent) => {
    ran.push({ id: agent.id, command: (agent.nodes[0] as { command?: unknown }).command });
    return { id: 'r1', status: 'completed' };
  }),
}));

const { LocalScheduler } = await import('./scheduler.js');

const make = (id: string, schedule: string | undefined, command = 'true', extra: Partial<Agent> = {}): Agent => ({
  id, name: id, status: 'active', source: 'local', version: 1, ...(schedule ? { schedule } : {}),
  nodes: [{ id: 'a', type: 'shell', command }], ...extra,
}) as Agent;

// A schedule changed in the dashboard or by sua (or an agent edited) took
// effect only when the scheduler restarted: it read the agents once.
describe('the scheduler picks up changes while it runs', () => {
  it('adds new schedules, drops unscheduled, paused and gone agents, and fires an edited one as it is now', async () => {
    const scheduler = new LocalScheduler({
      provider: { submitRun: vi.fn() } as never,
      agents: new Map(),
      v2Agents: [make('nightly', '0 9 * * *'), make('weekly', '0 9 * * 1'), make('hourly', '0 * * * *')],
      v2Deps: { runStore: undefined as never },
    });
    await scheduler.start();
    const ids = () => scheduler.getScheduledV2Agents().map((e) => `${e.agent.id}@${e.schedule}`).sort();
    expect(ids()).toEqual(['hourly@0 * * * *', 'nightly@0 9 * * *', 'weekly@0 9 * * 1']);

    // Unchanged: nothing to do.
    expect(scheduler.syncV2Agents([make('nightly', '0 9 * * *'), make('weekly', '0 9 * * 1'), make('hourly', '0 * * * *')])).toEqual({ added: [], removed: [], changed: [] });

    const out = scheduler.syncV2Agents([
      make('nightly', '30 6 * * *'), // moved earlier
      make('hourly', '0 * * * *', 'echo new'), // edited, same schedule
      make('weekly', undefined), // unscheduled
      make('paused', '0 9 * * *', 'true', { status: 'paused' }),
      make('fresh', '0 12 * * *'), // newly scheduled
      make('broken', 'not a schedule'), // not a schedule: skipped, not fatal
    ]);
    expect(out).toEqual({ added: ['fresh'], removed: ['weekly'], changed: ['nightly', 'hourly'] });
    expect(ids()).toEqual(['fresh@0 12 * * *', 'hourly@0 * * * *', 'nightly@30 6 * * *']);

    // The edited one fires with its new command.
    const fire = (scheduler as unknown as { fireV2Agent(a: Agent, s: string): Promise<void> }).fireV2Agent.bind(scheduler);
    const hourly = scheduler.getScheduledV2Agents().find((e) => e.agent.id === 'hourly')!;
    await fire(hourly.agent, hourly.schedule);
    await vi.waitFor(() => expect(ran.at(-1)).toEqual({ id: 'hourly', command: 'echo new' }));

    scheduler.stop();
  });
});
