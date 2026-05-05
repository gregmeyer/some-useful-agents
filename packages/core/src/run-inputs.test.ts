import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { RunStore } from './run-store.js';
import { extractPriorAgentInputs } from './run-inputs.js';
import type { Agent } from './agent-v2-types.js';

const TEST_DB = join(import.meta.dirname, '__test-data__', 'run-inputs.db');

let store: RunStore;

beforeEach(() => { store = new RunStore(TEST_DB); });
afterEach(() => {
  store.close();
  rmSync(join(import.meta.dirname, '__test-data__'), { recursive: true, force: true });
});

const agent: Pick<Agent, 'inputs'> = {
  inputs: {
    CITY: { type: 'string', default: 'sf' },
    UNITS: { type: 'string', default: 'metric' },
  },
};

describe('extractPriorAgentInputs', () => {
  it('returns the declared agent inputs from the first node execution', () => {
    store.createRun({
      id: 'r1', agentName: 'weather', status: 'completed',
      startedAt: new Date().toISOString(), triggeredBy: 'cli',
    });
    store.createNodeExecution({
      runId: 'r1', nodeId: 'fetch', workflowVersion: 1,
      status: 'completed', startedAt: new Date().toISOString(),
      inputsJson: JSON.stringify({
        CITY: 'tokyo', UNITS: 'metric',
        // Non-input env vars must be filtered out.
        PATH: '/usr/bin', SECRET_TOKEN: 'redacted',
      }),
    });
    const got = extractPriorAgentInputs(agent, 'r1', store);
    expect(got).toEqual({ CITY: 'tokyo', UNITS: 'metric' });
  });

  it('returns empty object when the agent declares no inputs', () => {
    store.createRun({
      id: 'r2', agentName: 'noop', status: 'completed',
      startedAt: new Date().toISOString(), triggeredBy: 'cli',
    });
    expect(extractPriorAgentInputs({ inputs: undefined }, 'r2', store)).toEqual({});
    expect(extractPriorAgentInputs({ inputs: {} }, 'r2', store)).toEqual({});
  });

  it('returns empty object when the run has no node executions yet', () => {
    store.createRun({
      id: 'r3', agentName: 'weather', status: 'pending',
      startedAt: new Date().toISOString(), triggeredBy: 'cli',
    });
    expect(extractPriorAgentInputs(agent, 'r3', store)).toEqual({});
  });

  it('returns empty object when inputsJson is malformed', () => {
    store.createRun({
      id: 'r4', agentName: 'weather', status: 'failed',
      startedAt: new Date().toISOString(), triggeredBy: 'cli',
    });
    store.createNodeExecution({
      runId: 'r4', nodeId: 'fetch', workflowVersion: 1,
      status: 'failed', startedAt: new Date().toISOString(),
      inputsJson: 'not valid json',
    });
    expect(extractPriorAgentInputs(agent, 'r4', store)).toEqual({});
  });

  it('skips empty-string values', () => {
    store.createRun({
      id: 'r5', agentName: 'weather', status: 'completed',
      startedAt: new Date().toISOString(), triggeredBy: 'cli',
    });
    store.createNodeExecution({
      runId: 'r5', nodeId: 'fetch', workflowVersion: 1,
      status: 'completed', startedAt: new Date().toISOString(),
      inputsJson: JSON.stringify({ CITY: 'paris', UNITS: '' }),
    });
    expect(extractPriorAgentInputs(agent, 'r5', store)).toEqual({ CITY: 'paris' });
  });
});
