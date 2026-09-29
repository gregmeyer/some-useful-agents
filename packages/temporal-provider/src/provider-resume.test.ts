import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore, type Agent } from '@some-useful-agents/core';
import { TemporalProvider } from './provider.js';

// submitDagRun with resume (a run answered after waiting on an ask node) must
// reuse the run row, not create a second one, and start the workflow for it.
let dir: string;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe('TemporalProvider.submitDagRun resume', () => {
  it('reuses the waiting run row and starts sua-run-<id> again', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-tp-resume-'));
    const dbPath = join(dir, 'runs.db');
    const seed = new RunStore(dbPath);
    seed.createRun({ id: 'run-w', agentName: 'asker', status: 'waiting', startedAt: '2026-09-29T10:00:00.000Z', triggeredBy: 'dashboard' });
    seed.close();

    const provider = new TemporalProvider({ dbPath, secretsPath: join(dir, 'secrets.enc') });
    const started: Array<{ workflowId: string; args: Array<{ runId: string }> }> = [];
    (provider as unknown as { client: unknown }).client = {
      workflow: {
        async start(_type: string, opts: { workflowId: string; args: Array<{ runId: string }> }) {
          started.push(opts);
          return { workflowId: opts.workflowId, firstExecutionRunId: 'temporal-1', result: () => new Promise(() => {}) };
        },
        getHandle: () => ({ result: () => new Promise(() => {}) }),
      },
    };
    const agent = { id: 'asker', name: 'Asker', status: 'active', source: 'local', mcp: false, version: 1, nodes: [] } as unknown as Agent;
    const run = await provider.submitDagRun(agent, { runId: 'run-w', resume: true, triggeredBy: 'dashboard' });

    expect(run.id).toBe('run-w');
    expect(run.startedAt).toBe('2026-09-29T10:00:00.000Z');
    expect(started).toHaveLength(1);
    expect(started[0].workflowId).toBe('sua-run-run-w');
    expect(started[0].args[0].runId).toBe('run-w');
    const check = new RunStore(dbPath);
    expect(check.queryRuns({ limit: 10, offset: 0, statuses: [] }).total).toBe(1);
    check.close();
  });
});
