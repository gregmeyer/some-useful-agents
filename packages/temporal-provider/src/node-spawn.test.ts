import { describe, it, expect } from 'vitest';
import type { Client } from '@temporalio/client';
import type { AgentNode, SpawnResult } from '@some-useful-agents/core';
import { createTemporalSpawnNode } from './node-spawn.js';

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
}): Client {
  return {
    workflow: {
      async start(workflowType: string, options: { workflowId: string; taskQueue: string; args: unknown[] }) {
        behavior.onStart?.({ workflowType, options });
        return {
          workflowId: options.workflowId,
          async result(): Promise<SpawnResult> {
            if (behavior.reject) throw behavior.reject;
            return behavior.result ?? { result: 'ok', exitCode: 0 };
          },
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
});
