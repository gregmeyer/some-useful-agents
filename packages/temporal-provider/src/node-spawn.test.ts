import { describe, it, expect } from 'vitest';
import type { Client } from '@temporalio/client';
import type { AgentNode, SpawnResult, SpawnProgress } from '@some-useful-agents/core';
import { createTemporalSpawnNode, extractHeartbeatProgress, describeWorkflowError, untilStopped, STOPPED, ABORT_GRACE_MS } from './node-spawn.js';

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

  it('forwards memoryRunId (not the in-process memory store) so the worker rebuilds memory', async () => {
    let started: { options: { args: unknown[] } } | undefined;
    const client = fakeClient({ result: { result: 'ok', exitCode: 0 }, onStart: (s) => { started = s; } });
    const spawn = createTemporalSpawnNode({ client, secretsPath: '/tmp/secrets.enc' });
    await spawn(node(), { PATH: '/usr/bin' }, { ...spawnOpts, memoryRunId: 'run-42', memory: { agentId: 'demo', store: {} as never } });
    const input = started!.options.args[0] as Record<string, unknown>;
    expect(input.memoryRunId).toBe('run-42');
    expect(input.memory).toBeUndefined();
  });

  it('forwards the behavior block, so conditioning survives the activity boundary', async () => {
    let started: { options: { args: unknown[] } } | undefined;
    const client = fakeClient({ result: { result: 'ok', exitCode: 0 }, onStart: (s) => { started = s; } });
    const spawn = createTemporalSpawnNode({ client, secretsPath: '/tmp/secrets.enc' });
    await spawn(node(), { PATH: '/usr/bin' }, { ...spawnOpts, behaviorPreamble: 'BE CAREFUL' });
    expect((started!.options.args[0] as Record<string, unknown>).behaviorPreamble).toBe('BE CAREFUL');
  });

  it('forwards what is left of the run\'s spend limit', async () => {
    let started: { options: { args: unknown[] } } | undefined;
    const client = fakeClient({ result: { result: 'ok', exitCode: 0 }, onStart: (s) => { started = s; } });
    const spawn = createTemporalSpawnNode({ client, secretsPath: '/tmp/secrets.enc' });
    await spawn(node(), { PATH: '/usr/bin' }, { ...spawnOpts, spendBudgetUsd: 0.42 });
    expect((started!.options.args[0] as Record<string, unknown>).spendBudgetUsd).toBe(0.42);
  });

  it('forwards askRunId (not the in-process ask context) so the worker can let the node ask', async () => {
    let started: { options: { args: unknown[] } } | undefined;
    const client = fakeClient({ result: { result: 'ok', exitCode: 0 }, onStart: (s) => { started = s; } });
    const spawn = createTemporalSpawnNode({ client, secretsPath: '/tmp/secrets.enc' });
    await spawn(node(), { PATH: '/usr/bin' }, { ...spawnOpts, askRunId: 'run-7', askHuman: { runId: 'run-7', nodeId: 'fetch', agentId: 'demo', store: {} as never, onAsked: () => {} } });
    const input = started!.options.args[0] as Record<string, unknown>;
    expect(input.askRunId).toBe('run-7');
    expect(input.askHuman).toBeUndefined();
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

describe('createTemporalSpawnNode — live progress ({ live } heartbeats)', () => {
  it('passes on the text written so far as deltas, each piece once, and other events in order', async () => {
    let report: { events: Array<{ nodeId: string; event: SpawnProgress }>; text: Record<string, string> } = { events: [{ nodeId: 'n', event: { timestamp: 't1', type: 'turn_start', turn: 1 } }], text: { n: 'Hel' } };
    const client = fakeClient({
      result: { result: 'ok', exitCode: 0 },
      resultAfterMs: 80,
      describe: () => ({ pendingActivities: [{ heartbeatDetails: { live: report } }] }),
    });
    const spawn = createTemporalSpawnNode({ client, secretsPath: '/tmp/secrets.enc', progressPollMs: 10 });
    setTimeout(() => {
      report = { events: [...report.events, { nodeId: 'n', event: { timestamp: 't2', type: 'tool_use', message: 'bash' } }], text: { n: 'Hello there' } };
    }, 35);
    const seen: SpawnProgress[] = [];
    await spawn(node(), { PATH: '/usr/bin' }, spawnOpts, (e) => seen.push(e));
    expect(seen.filter((e) => e.type !== 'output_delta').map((e) => e.type)).toEqual(['turn_start', 'tool_use']);
    expect(seen.filter((e) => e.type === 'output_delta').map((e) => e.message).join('')).toBe('Hello there');
  });
});

describe('createTemporalSpawnNode — worker parity inputs', () => {
  it('sends same-host paths (never custom provider definitions or keys) so the worker loads them itself', async () => {
    let args: unknown[] = [];
    const client = fakeClient({ onStart: ({ options }) => { args = options.args; } });
    const spawn = createTemporalSpawnNode({
      client, secretsPath: '/d/secrets.enc', dbPath: '/d/sua.db', variablesPath: '/d/variables.json', llmSettingsPath: '/d/llm-settings.json',
    });
    await spawn(node({ type: 'llm-prompt', prompt: 'hi' }), {}, {
      ...spawnOpts,
      experimentalApple: true,
      llmSettings: { providers: ['local-x', 'claude'], customProviders: [{ name: 'local-x', kind: 'openai', apiBase: 'http://h/v1', model: 'm', apiKey: 'sk-must-not-leak' }] },
    });
    const input = args[0] as Record<string, unknown>;
    expect(input).toMatchObject({
      dbPath: '/d/sua.db', variablesPath: '/d/variables.json', llmSettingsPath: '/d/llm-settings.json',
      experimentalApple: true, llmProviders: ['local-x', 'claude'],
    });
    expect(JSON.stringify(input)).not.toContain('sk-must-not-leak');
  });

  it('forwards the agent call chain (plain data) so the worker can run agent tools', async () => {
    let args: unknown[] = [];
    const client = fakeClient({ onStart: ({ options }) => { args = options.args; } });
    const spawn = createTemporalSpawnNode({ client, secretsPath: '/d/s.enc', dbPath: '/d/sua.db' });
    const info = { runId: 'run-1', nodeId: 'ask', depth: 1, stack: ['root', 'mid'], triggeredBy: 'dashboard' };
    await spawn(node({ type: 'llm-prompt', prompt: 'hi', tools: ['agent:x'] }), {}, { ...spawnOpts, agentCallInfo: info });
    expect((args[0] as Record<string, unknown>).agentCallInfo).toEqual(info);
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

describe('a stopped node with Temporal not answering', () => {
  const never = <T>() => new Promise<T>(() => { /* the server is down: no answer */ });

  it('untilStopped: the value when it comes; "stopped" a grace after the abort; the rejection passed on', async () => {
    expect(await untilStopped(Promise.resolve(1), new AbortController().signal, 10)).toBe(1);
    const ac = new AbortController();
    const p = untilStopped(never<number>(), ac.signal, 10);
    ac.abort();
    expect(await p).toBe(STOPPED);
    await expect(untilStopped(Promise.reject(new Error('boom')), new AbortController().signal, 10)).rejects.toThrow('boom');
  });

  it('returns a stopped result soon after the abort when result() never settles (it waited minutes)', async () => {
    let cancelled = false;
    const client = {
      workflow: {
        async start(_t: string, o: { workflowId: string }) {
          return { workflowId: o.workflowId, result: never, describe: never, async cancel() { cancelled = true; } };
        },
      },
    } as unknown as Client;
    const ac = new AbortController();
    const spawn = createTemporalSpawnNode({ client, secretsPath: '/tmp/secrets.enc', progressPollMs: 0 });
    const t0 = Date.now();
    const pending = spawn(node(), { PATH: '/usr/bin' }, spawnOpts, undefined, ac.signal);
    setTimeout(() => ac.abort(), 5);
    const res = await pending;
    expect(Date.now() - t0).toBeLessThan(ABORT_GRACE_MS + 2_000);
    expect(cancelled).toBe(true);
    expect(res).toMatchObject({ exitCode: 143, category: 'cancelled', usedWorkflowProvider: 'temporal' });
    expect(res.error).toMatch(/Temporal didn't answer within 5s after it was stopped/);
  }, 15_000);

  it('the same when start() itself never answers', async () => {
    const client = { workflow: { start: never } } as unknown as Client;
    const ac = new AbortController();
    ac.abort();
    const res = await createTemporalSpawnNode({ client, secretsPath: '/tmp/secrets.enc' })(node(), { PATH: '/usr/bin' }, spawnOpts, undefined, ac.signal);
    expect(res.error).toMatch(/to start it/);
  }, 15_000);
});

describe('Temporal down: the node runs here instead', () => {
  const never = <T>() => new Promise<T>(() => { /* no answer */ });
  const local = async (): Promise<SpawnResult> => ({ result: 'ran here', exitCode: 0 });

  it('when the server refuses the connection, and the next node skips asking it', async () => {
    let starts = 0;
    const client = { workflow: { async start() { starts++; throw Object.assign(new Error('14 UNAVAILABLE: Connection refused'), { code: 14 }); } } } as unknown as Client;
    const spawn = createTemporalSpawnNode({ client, secretsPath: '/tmp/s.enc', local });
    expect(await spawn(node(), {}, spawnOpts)).toMatchObject({ result: 'ran here', usedWorkflowProvider: 'local' });
    expect(await spawn(node(), {}, spawnOpts)).toMatchObject({ result: 'ran here' });
    expect(starts).toBe(1);
  });

  it("when it doesn't accept the node in time (and it's cancelled if it starts later)", async () => {
    let release: ((h: unknown) => void) | undefined;
    let cancelled = false;
    const client = { workflow: { start: () => new Promise((r) => { release = r; }) } } as unknown as Client;
    const spawn = createTemporalSpawnNode({ client, secretsPath: '/tmp/s.enc', local, startTimeoutMs: 20 });
    expect(await spawn(node(), {}, spawnOpts)).toMatchObject({ result: 'ran here', usedWorkflowProvider: 'local' });
    release!({ workflowId: 'w', result: never, describe: never, async cancel() { cancelled = true; } });
    await new Promise((r) => setTimeout(r, 10));
    expect(cancelled).toBe(true);
  });

  it('a bad request still fails as before (it is not the server being down)', async () => {
    const client = { workflow: { async start() { throw new Error('Workflow type not registered'); } } } as unknown as Client;
    const res = await createTemporalSpawnNode({ client, secretsPath: '/tmp/s.enc', local })(node(), {}, spawnOpts);
    expect(res).toMatchObject({ exitCode: 1, category: 'spawn_failure' });
  });
});
