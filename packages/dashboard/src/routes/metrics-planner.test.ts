import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PlannerTelemetryStore } from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import { SESSION_COOKIE } from '../auth-middleware.js';
import { createTestContext, closeTestContext, type TestContext } from '../test-harness.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3997;

let plannerTelemetryStore: PlannerTelemetryStore;
let t: TestContext | undefined;

async function makeApp(): Promise<ReturnType<typeof buildDashboardApp>> {
  t = await createTestContext({ port: PORT, prefix: 'sua-metrics-planner-', extra: ({ dbPath }) => ({
    plannerTelemetryStore: new PlannerTelemetryStore(dbPath),
  }) });
  const { ctx } = t;
  writeFileSync(join(t.agentsDir, 'hello.yaml'), 'name: hello\ntype: shell\ncommand: echo hi\n');
  plannerTelemetryStore = ctx.plannerTelemetryStore!;

  return buildDashboardApp(ctx);
}

afterEach(async () => {
  await closeTestContext(t);
  t = undefined;
});

describe('GET /metrics/planner', () => {
  it('renders an empty-state page when no rows exist', async () => {
    const app = await makeApp();
    const res = await request(app)
      .get('/metrics/planner')
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
      .set('Host', `127.0.0.1:${PORT}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Planner metrics');
    expect(res.text).toContain('No completed plan-extracts');
  });

  it('renders headline metrics + recent rows when telemetry has data', async () => {
    const app = await makeApp();
    plannerTelemetryStore.recordStart('run-a', 'build me a daily news digest');
    plannerTelemetryStore.recordExtract({
      runId: 'run-a',
      status: 'ok',
      autofixCount: 1,
      timeToPlanMs: 4500,
      intent: 'agent',
    });
    plannerTelemetryStore.recordCommit('run-a', 12000);

    plannerTelemetryStore.recordStart('run-b', 'fetch ashby jobs');
    plannerTelemetryStore.recordExtract({
      runId: 'run-b',
      status: 'schema-invalid',
      autofixCount: 0,
      validationErrors: 2,
      timeToPlanMs: 6000,
    });

    const res = await request(app)
      .get('/metrics/planner')
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
      .set('Host', `127.0.0.1:${PORT}`);
    expect(res.status).toBe(200);
    // Headline metrics — 2 attempted, 1 committed = 50% commit rate.
    expect(res.text).toContain('50.0%');
    // First-attempt-clean rate = 1/2 = 50%.
    expect(res.text).toMatch(/extract=ok/);
    // Histogram surfaces both statuses.
    expect(res.text).toContain('schema-invalid');
    expect(res.text).toContain('ok');
    // Recent table renders truncated runId + intent + goal.
    expect(res.text).toContain('run-a'.slice(0, 8));
    expect(res.text).toContain('build me a daily news digest');
  });

  it('clamps the days query param to [1, 90]', async () => {
    const app = await makeApp();
    const res = await request(app)
      .get('/metrics/planner?days=99999')
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}`)
      .set('Host', `127.0.0.1:${PORT}`);
    expect(res.status).toBe(200);
    // Clamp to 90.
    expect(res.text).toContain('the last 90 days');
  });
});
