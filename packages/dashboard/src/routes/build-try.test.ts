import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import {
  AgentStore,
  RunStore,
  parseAgent,
} from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import { SESSION_COOKIE } from '../auth-middleware.js';
import { createTestContext, closeTestContext, type TestContext } from '../test-harness.js';
import { missingTrialInputs, trialTimeoutMs } from './build-try.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3993;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;

let runStore: RunStore;
let agentStore: AgentStore;
let t: TestContext | undefined;
const onRunFailure = vi.fn(async () => {});
const onRunComplete = vi.fn(async () => {});

async function makeApp() {
  t = await createTestContext({ port: PORT, prefix: 'sua-build-try-', extra: { onRunFailure, onRunComplete } });
  ({ runStore, agentStore } = t.ctx);
  onRunFailure.mockClear();
  onRunComplete.mockClear();
  return buildDashboardApp(t.ctx);
}

afterEach(async () => {
  await closeTestContext(t);
  t = undefined;
});

const post = (app: Parameters<typeof request>[0], body: unknown) => request(app).post('/agents/build/try')
  .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE).send(body as object);
const get = (app: Parameters<typeof request>[0], p: string) => request(app).get(p)
  .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);

async function waitDone(app: Parameters<typeof request>[0], runId: string) {
  for (let i = 0; i < 100; i++) {
    const r = await get(app, `/agents/build/try/${runId}`);
    if (r.body.done) return r.body;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error('trial did not finish');
}

const yaml = (id: string, command: string, inputs = '') => `id: ${id}
name: ${id}
status: active
${inputs}nodes:
  - id: go
    type: shell
    command: ${command}
`;

describe('POST /agents/build/try', () => {
  it('runs an unsaved draft as a trial and shows its result, without saving the agent', async () => {
    const app = await makeApp();
    const start = await post(app, { yaml: yaml('echo-draft', 'echo hello from the trial') });
    expect(start.body).toMatchObject({ ok: true, timeoutSec: 120 });
    const done = await waitDone(app, start.body.runId);
    expect(done).toMatchObject({ status: 'completed', url: `/runs/${start.body.runId}` });
    expect(done.result).toContain('hello from the trial');
    expect(agentStore.getAgent('echo-draft')).toBeNull();
    expect(runStore.getRun(start.body.runId)?.triggeredBy).toBe('trial');
    expect(onRunComplete).not.toHaveBeenCalled();
    // "Open the run" works for an agent that was never saved.
    const page = await get(app, `/runs/${start.body.runId}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('hello from the trial');
  });

  it('a failed trial is shown, not sent to the inbox', async () => {
    const app = await makeApp();
    const start = await post(app, { yaml: yaml('broken-draft', 'exit 3') });
    const done = await waitDone(app, start.body.runId);
    expect(done.status).toBe('failed');
    expect(onRunFailure).not.toHaveBeenCalled();
  });

  it('asks for required inputs first, then runs with them', async () => {
    const app = await makeApp();
    const draft = yaml('greet-draft', 'echo "hi $NAME"', 'inputs:\n  NAME: { type: string, description: Who to greet }\n');
    const ask = await post(app, { yaml: draft });
    expect(ask.body).toEqual({ ok: false, needsInputs: [{ name: 'NAME', description: 'Who to greet' }] });
    const start = await post(app, { yaml: draft, inputs: { NAME: 'Ada' } });
    expect((await waitDone(app, start.body.runId)).result).toContain('hi Ada');
  });

  it("refuses a draft that doesn't parse or whose id is taken", async () => {
    const app = await makeApp();
    expect((await post(app, { yaml: 'nodes: [' })).body.error).toMatch(/doesn't parse/);
    agentStore.createAgent(parseAgent(yaml('taken', 'echo x')), 'cli');
    expect((await post(app, { yaml: yaml('taken', 'echo y') })).body.error).toContain('already exists');
    expect((await get(app, '/agents/build/try/not-a-run')).status).toBe(404);
  });
});

describe('trial limits', () => {
  it('gives a flow two minutes and a goal agent its own time budget', () => {
    expect(trialTimeoutMs(parseAgent(yaml('f', 'echo'))) ).toBe(120_000);
    const goal = parseAgent('id: g\nname: g\nnodes:\n  - id: r\n    type: goal\n    goal: find x\n    tools: [web-fetch]\n    budget: { timeoutSec: 90 }\n');
    expect(trialTimeoutMs(goal)).toBe(120_000);
    const goalDefault = parseAgent('id: g\nname: g\nnodes:\n  - id: r\n    type: goal\n    goal: find x\n    tools: [web-fetch]\n');
    expect(trialTimeoutMs(goalDefault)).toBe(630_000);
    expect(missingTrialInputs(parseAgent(`id: i\nname: i\ninputs:\n  A: { type: string, default: x }\n  B: { type: string, required: false }\n  C: { type: string }\nnodes:\n  - id: s\n    type: shell\n    command: echo\n`), {})).toEqual([{ name: 'C' }]);
  });
});
