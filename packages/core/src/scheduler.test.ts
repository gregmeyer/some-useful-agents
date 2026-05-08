import { describe, it, expect, vi } from 'vitest';
import { LocalScheduler } from './scheduler.js';
import type { AgentDefinition, Provider, Run } from './types.js';
import type { Agent } from './agent-v2-types.js';

function makeAgent(name: string, schedule?: string, overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return { name, type: 'shell', command: `echo ${name}`, schedule, ...overrides };
}

function makeV2Agent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    name: id,
    status: 'active',
    source: 'local',
    version: 1,
    nodes: [{ id: 'n1', type: 'shell', command: `echo ${id}` }],
    ...overrides,
  } as Agent;
}

function makeFakeProvider(): Provider {
  return {
    name: 'fake',
    initialize: async () => {},
    shutdown: async () => {},
    submitRun: async (req) => ({
      id: `run-${req.agent.name}-${Date.now()}`,
      agentName: req.agent.name,
      status: 'running',
      startedAt: new Date().toISOString(),
      triggeredBy: req.triggeredBy,
    }) satisfies Run,
    getRun: async () => null,
    listRuns: async () => [],
    cancelRun: async () => {},
    getRunLogs: async () => '',
  };
}

describe('LocalScheduler', () => {
  it('returns only agents with schedule fields', () => {
    const agents = new Map<string, AgentDefinition>([
      ['a', makeAgent('a', '* * * * *')],
      ['b', makeAgent('b')],  // no schedule
      ['c', makeAgent('c', '0 9 * * *')],
    ]);
    const scheduler = new LocalScheduler({ provider: makeFakeProvider(), agents });
    const entries = scheduler.getScheduledAgents();
    expect(entries.map(e => e.agent.name).sort()).toEqual(['a', 'c']);
  });

  it('throws on invalid cron expressions', () => {
    const agents = new Map<string, AgentDefinition>([
      ['bad', makeAgent('bad', 'not-a-cron')],
    ]);
    const scheduler = new LocalScheduler({ provider: makeFakeProvider(), agents });
    expect(() => scheduler.getScheduledAgents()).toThrow(/Invalid cron expression/);
  });

  it('throws on 6-field schedules without allowHighFrequency', () => {
    const agents = new Map<string, AgentDefinition>([
      ['fast', makeAgent('fast', '* * * * * *')],
    ]);
    const scheduler = new LocalScheduler({ provider: makeFakeProvider(), agents });
    expect(() => scheduler.getScheduledAgents()).toThrow(/fires more often than the minimum/);
  });

  it('accepts 6-field schedules when allowHighFrequency is true', () => {
    const agents = new Map<string, AgentDefinition>([
      ['fast', makeAgent('fast', '* * * * * *', { allowHighFrequency: true })],
    ]);
    const scheduler = new LocalScheduler({ provider: makeFakeProvider(), agents });
    expect(scheduler.getScheduledAgents().length).toBe(1);
  });

  it('isValid accepts standard cron expressions', () => {
    expect(LocalScheduler.isValid('* * * * *')).toBe(true);
    expect(LocalScheduler.isValid('0 9 * * *')).toBe(true);
    expect(LocalScheduler.isValid('*/5 * * * *')).toBe(true);
    expect(LocalScheduler.isValid('not valid')).toBe(false);
    expect(LocalScheduler.isValid('')).toBe(false);
  });

  it('start() registers tasks for every scheduled agent', async () => {
    const agents = new Map<string, AgentDefinition>([
      ['a', makeAgent('a', '* * * * *')],
      ['b', makeAgent('b', '0 9 * * *')],
    ]);
    const scheduler = new LocalScheduler({ provider: makeFakeProvider(), agents });
    const entries = await scheduler.start();
    expect(entries.length).toBe(2);
    scheduler.stop();
  });

  it('stop() is safe to call multiple times', async () => {
    const agents = new Map<string, AgentDefinition>([
      ['a', makeAgent('a', '* * * * *')],
    ]);
    const scheduler = new LocalScheduler({ provider: makeFakeProvider(), agents });
    await scheduler.start();
    scheduler.stop();
    scheduler.stop();  // should not throw
  });

  it('start() returns empty when no agents have schedules', async () => {
    const agents = new Map<string, AgentDefinition>([
      ['a', makeAgent('a')],
      ['b', makeAgent('b')],
    ]);
    const scheduler = new LocalScheduler({ provider: makeFakeProvider(), agents });
    const entries = await scheduler.start();
    expect(entries.length).toBe(0);
    scheduler.stop();
  });

  it('getScheduledV2Agents filters to active v2 agents with a schedule', () => {
    const v2Agents: Agent[] = [
      makeV2Agent('alpha', { schedule: '0 9 * * *', status: 'active' }),
      makeV2Agent('beta', { schedule: '0 9 * * *', status: 'paused' }),     // wrong status
      makeV2Agent('gamma', { schedule: undefined, status: 'active' }),       // no schedule
      makeV2Agent('delta', { schedule: '0 10 * * *', status: 'active' }),
    ];
    const scheduler = new LocalScheduler({
      provider: makeFakeProvider(),
      agents: new Map(),
      v2Agents,
      v2Deps: { runStore: undefined as never },
    });
    const entries = scheduler.getScheduledV2Agents();
    expect(entries.map((e) => e.agent.id).sort()).toEqual(['alpha', 'delta']);
  });

  it('throws when v2Agents is supplied without v2Deps', () => {
    expect(() => new LocalScheduler({
      provider: makeFakeProvider(),
      agents: new Map(),
      v2Agents: [makeV2Agent('alpha', { schedule: '0 9 * * *' })],
    })).toThrow(/v2Deps/);
  });

  it('start() registers v2 cron tasks alongside v1 tasks', async () => {
    const agents = new Map<string, AgentDefinition>([
      ['v1a', makeAgent('v1a', '0 9 * * *')],
    ]);
    const v2Agents: Agent[] = [
      makeV2Agent('v2a', { schedule: '0 10 * * *', status: 'active' }),
      makeV2Agent('v2b', { schedule: '0 11 * * *', status: 'active' }),
    ];
    const scheduler = new LocalScheduler({
      provider: makeFakeProvider(),
      agents,
      v2Agents,
      v2Deps: { runStore: undefined as never },
    });
    const v1Entries = await scheduler.start();
    expect(v1Entries).toHaveLength(1);
    expect(scheduler.getScheduledV2Agents()).toHaveLength(2);
    scheduler.stop();
  });

  it('onFire callback wires to submitRun with triggeredBy=schedule', async () => {
    // Use a cron expression that fires every second. Requires allowHighFrequency
    // to bypass the safety cap that rejects 6-field expressions by default.
    const agents = new Map<string, AgentDefinition>([
      ['tick', makeAgent('tick', '* * * * * *', { allowHighFrequency: true })],
    ]);
    const provider = makeFakeProvider();
    const submitSpy = vi.spyOn(provider, 'submitRun');

    const fireEvents: Array<{ name: string; runId: string }> = [];
    const scheduler = new LocalScheduler({
      provider,
      agents,
      onFire: (agent, runId) => fireEvents.push({ name: agent.name, runId }),
    });

    await scheduler.start();
    await new Promise(r => setTimeout(r, 1500));  // wait for at least one tick
    scheduler.stop();

    expect(submitSpy).toHaveBeenCalled();
    expect(submitSpy.mock.calls[0][0].triggeredBy).toBe('schedule');
    expect(fireEvents.length).toBeGreaterThan(0);
    expect(fireEvents[0].name).toBe('tick');
  }, 5000);
});
