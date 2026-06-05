import { describe, it, expect } from 'vitest';
import type { Client } from '@temporalio/client';
import type { AgentNode, SpawnResult, SpawnProgress } from '@some-useful-agents/core';
import { createTemporalSpawnNode, extractHeartbeatProgress, describeWorkflowError } from './node-spawn.js';

const node = (overrides: Partial<AgentNode> = {}): AgentNode => ({
  id: 'fetch',
  type: 'shell',
  command: 'echo hi',
  ...overrides,
});

const spawnOpts = { agentId: 'demo', agentSource: 'local' as const };

/**
 * Minimal fake Temporal client capturing the workflow.start call and letting
 * the test resolve / reject the handle's result(), plus observe cancel().
 */
function fakeClient(behavior: {
  result?: SpawnResult;
  reject?: Error;
  onStart?: (args: { workflowType: string; options: { workflowId: string; taskQueue: string; args: unknown[] } }) => void;
  onCancel?: () => void;
  /** When set, result() resolves only after this many ms (lets polls run first). */
  resultAfterMs?: number;
  /** Returns the describe() payload (e.g. pendingActivities with heartbeatDetails). */
  describe?: () => unknown;
}): Client {
  return {
    workflow: {
      async start(workflowType: string, options: { workflowId: string; taskQueue: string; args: unknown[] }) {
        behavior.onStart?.({ workflowType, options });
        return {
          workflowId: options.workflowId,
          async result(): Promise<SpawnResult> {
            if (behavior.resultAfterMs) await new Promise((r) => setTimeout(r, behavior.resultAfterMs));
            if (behavior.reject) throw behavior.reject;
            return behavior.result ?? { result: 'ok', exitCode: 0 };
          },
          async describe() { return behavior.describe ? behavior.describe() : { pendingActivities: [] }; },
          async cancel() { behavior.onCancel?.(); },
        };
      },
    },
  } as unknown as Client;
}

describe('createTemporalSpawnNode', () => {
  it('starts runNodeWorkflow on the task queue and returns the result stamped temporal', async () => {
    let started: { workflowType: string; options: { workflowId: string; taskQueue: string; args: unknown[] } } | undefined;
    const client = fakeClient({
      result: { result: 'done', exitCode: 0 },
      onStart: (s) => { started = s; },
    });
    const spawn = createTemporalSpawnNode({ client, secretsPath: '/tmp/secrets.enc', taskQueue: 'sua-agents' });

    const res = await spawn(node(), { PATH: '/usr/bin' }, spawnOpts);

    expect(started?.workflowType).toBe('runNodeWorkflow');
    expect(started?.options.taskQueue).toBe('sua-agents');
    expect(started?.options.workflowId).toMatch(/^sua-node-demo-fetch-/);
    expect(res.exitCode).toBe(0);
    expect(res.result).toBe('done');
    expect(res.usedWorkflowProvider).toBe('temporal');
  });

  it('strips declared secrets from the activity input env', async () => {
    let started: { options: { args: unknown[] } } | undefined;
    const client = fakeClient({ result: { result: 'ok', exitCode: 0 }, onStart: (s) => { started = s; } });
    const spawn = createTemporalSpawnNode({ client, secretsPath: '/tmp/secrets.enc' });

    await spawn(
      node({ secrets: ['MY_SECRET'] }),
      { PATH: '/usr/bin', MY_SECRET: 'shh', API_TOKEN: 'abc' },
      spawnOpts,
    );

    const input = started!.options.args[0] as { env: Record<string, string>; declaredSecrets: string[] };
    expect(input.env.PATH).toBe('/usr/bin');
    expect(input.env.MY_SECRET).toBeUndefined();   // declared secret stripped
    expect(input.env.API_TOKEN).toBeUndefined();   // sensitive name stripped
    expect(input.declaredSecrets).toEqual(['MY_SECRET']);
  });

  it('cancels the workflow when the abort signal fires and returns a cancelled result', async () => {
    let cancelled = false;
    const controller = new AbortController();
    const client = fakeClient({
      onCancel: () => { cancelled = true; },
      // result() rejects (as a real cancelled workflow does) after cancel.
      reject: new Error('workflow cancelled'),
    });
    const spawn = createTemporalSpawnNode({ client, secretsPath: '/tmp/secrets.enc' });

    controller.abort();
    const res = await spawn(node(), { PATH: '/usr/bin' }, spawnOpts, undefined, controller.signal);

    expect(cancelled).toBe(true);
    expect(res.category).toBe('cancelled');
    expect(res.usedWorkflowProvider).toBe('temporal');
  });

  it('returns a failed result (not a throw) when the workflow errors', async () => {
    const client = fakeClient({ reject: new Error('boom') });
    const spawn = createTemporalSpawnNode({ client, secretsPath: '/tmp/secrets.enc' });

    const res = await spawn(node(), { PATH: '/usr/bin' }, spawnOpts);

    expect(res.exitCode).toBe(1);
    expect(res.error).toContain('boom');
    expect(res.category).toBe('exit_nonzero');
  });

  it('surfaces the underlying cause, not the generic WorkflowFailedError message', async () => {
    // Temporal's WorkflowFailedError.message is always "Workflow execution
    // failed"; the real reason (here, a heartbeat timeout) lives in .cause.
    const generic = new Error('Workflow execution failed');
    generic.cause = new Error('activity Heartbeat timeout');
    const client = fakeClient({ reject: generic });
    const spawn = createTemporalSpawnNode({ client, secretsPath: '/tmp/secrets.enc' });

    const res = await spawn(node(), { PATH: '/usr/bin' }, spawnOpts);

    expect(res.error).toContain('activity Heartbeat timeout');
    expect(res.error).not.toBe('Temporal node workflow failed: Workflow execution failed');
  });

  it('re-emits heartbeated progress through onProgress, each event once', async () => {
    const trail: SpawnProgress[] = [
      { timestamp: 't1', type: 'turn_start', turn: 1 },
      { timestamp: 't2', type: 'tool_use', message: 'bash' },
    ];
    const client = fakeClient({
      result: { result: 'ok', exitCode: 0 },
      resultAfterMs: 60,                       // let the poll fire before completion
      describe: () => ({ pendingActivities: [{ heartbeatDetails: { progress: trail } }] }),
    });
    const spawn = createTemporalSpawnNode({ client, secretsPath: '/tmp/secrets.enc', progressPollMs: 10 });

    const seen: SpawnProgress[] = [];
    await spawn(node(), { PATH: '/usr/bin' }, spawnOpts, (e) => seen.push(e));

    // Both events surfaced exactly once, in order — despite many polls.
    expect(seen).toEqual(trail);
  });
});

describe('extractHeartbeatProgress', () => {
  const trail: SpawnProgress[] = [{ timestamp: 't1', type: 'turn_start', turn: 1 }];

  it('reads progress from a single heartbeatDetails object', () => {
    expect(extractHeartbeatProgress({ pendingActivities: [{ heartbeatDetails: { progress: trail } }] })).toEqual(trail);
  });

  it('reads progress when details are wrapped in an array', () => {
    expect(extractHeartbeatProgress({ pendingActivities: [{ heartbeatDetails: [{ progress: trail }] }] })).toEqual(trail);
  });

  it('returns [] when there is no pending activity or no heartbeat yet', () => {
    expect(extractHeartbeatProgress({ pendingActivities: [] })).toEqual([]);
    expect(extractHeartbeatProgress({})).toEqual([]);
    expect(extractHeartbeatProgress({ pendingActivities: [{}] })).toEqual([]);
  });
});

describe('describeWorkflowError', () => {
  it('unwraps to the deepest cause message', () => {
    const top = new Error('Workflow execution failed');
    top.cause = new Error('Activity task timed out');
    (top.cause as Error).cause = new Error('activity Heartbeat timeout');
    expect(describeWorkflowError(top)).toBe('activity Heartbeat timeout');
  });

  it('falls back to the top message when there is no cause', () => {
    expect(describeWorkflowError(new Error('plain boom'))).toBe('plain boom');
  });

  it('stringifies non-Error values', () => {
    expect(describeWorkflowError('weird')).toBe('weird');
  });

  it('does not loop on a cyclic cause chain', () => {
    const a = new Error('a');
    const b = new Error('b');
    a.cause = b;
    b.cause = a;
    expect(typeof describeWorkflowError(a)).toBe('string');
  });
});
