import { describe, it, expect, vi } from 'vitest';
import { LocalScheduler } from './scheduler.js';
import type { AgentDefinition, Provider, Run } from './types.js';

function makeAgent(name: string, schedule?: string, overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return { name, type: 'shell', command: `echo ${name}`, schedule, ...overrides };
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
