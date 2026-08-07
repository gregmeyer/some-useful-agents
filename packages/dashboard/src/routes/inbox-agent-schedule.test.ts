/**
 * agent-schedule action: triage changes (or clears) an agent's cron cadence.
 * `parseProposedActions` accepts the `agent-schedule` type (shape-check only);
 * `executeAgentSchedule` validates the cron and applies it via
 * `updateAgentMeta` (no version bump). It refuses uninstalled agents and
 * invalid / too-frequent crons, and reports the humanized cadence + the
 * scheduler-restart caveat.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStore, InboxStore, RunStore, type InboxActionMeta } from '@some-useful-agents/core';
import { executeAgentSchedule } from './inbox-engine.js';
import { parseProposedActions } from './inbox-plan.js';

let dir: string;
let agentStore: AgentStore;
let inboxStore: InboxStore;
let runStore: RunStore;

function setup() {
  dir = mkdtempSync(join(tmpdir(), 'sua-agent-schedule-'));
  const db = join(dir, 'runs.db');
  agentStore = new AgentStore(db);
  inboxStore = new InboxStore(db);
  runStore = new RunStore(db);
  return { agentStore, inboxStore, runStore } as never as ReturnType<typeof import('../context.js').getContext>;
}

afterEach(() => {
  try { agentStore.close(); } catch { /* ignore */ }
  try { inboxStore.close(); } catch { /* ignore */ }
  try { runStore.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function mkAgent(id: string, schedule?: string): void {
  agentStore.createAgent({
    id, name: id, status: 'active', source: 'local', mcp: false,
    nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }],
    ...(schedule ? { schedule } : {}),
  }, 'cli');
}

const meta = (inputs: Record<string, string>): InboxActionMeta =>
  ({ kind: 'action', status: 'proposed', agentId: 'agent-schedule', inputs, effect: 'write' });

describe('parseProposedActions — agent-schedule', () => {
  it('accepts a well-formed agent-schedule as a single write', () => {
    const { accepted, rejected } = parseProposedActions(
      [{ type: 'agent-schedule', rationale: 'run hourly', inputs: { AGENT_ID: 'news', SCHEDULE: '0 * * * *' } }],
      [],
    );
    expect(rejected).toHaveLength(0);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].agentId).toBe('agent-schedule');
    expect(accepted[0].effect).toBe('write');
    expect(accepted[0].ctaLabel).toBe('Set schedule');
    expect(accepted[0].inputs).toEqual({ AGENT_ID: 'news', SCHEDULE: '0 * * * *' });
  });

  it('labels an empty SCHEDULE as Unschedule', () => {
    const { accepted } = parseProposedActions(
      [{ type: 'agent-schedule', inputs: { AGENT_ID: 'news', SCHEDULE: '' } }],
      [],
    );
    expect(accepted[0].ctaLabel).toBe('Unschedule');
  });

  it('rejects agent-schedule with no AGENT_ID', () => {
    const { accepted, rejected } = parseProposedActions(
      [{ type: 'agent-schedule', inputs: { SCHEDULE: '0 * * * *' } }],
      [],
    );
    expect(accepted).toHaveLength(0);
    expect(rejected[0].reason).toContain('AGENT_ID');
  });
});

describe('executeAgentSchedule', () => {
  it('applies a valid cron via updateAgentMeta (no version bump) with a humanized, restart-noted summary', () => {
    const ctx = setup();
    mkAgent('news', '0 8 * * *');
    const before = agentStore.getAgent('news')!;
    const r = executeAgentSchedule(ctx, meta({ AGENT_ID: 'news', SCHEDULE: '0 * * * *' }));
    expect(r.status).toBe('completed');
    expect(r.summary).toContain('Every hour'); // cronToHuman
    expect(r.summary).toContain('0 * * * *');
    expect(r.summary).toMatch(/restart/i);
    const after = agentStore.getAgent('news')!;
    expect(after.schedule).toBe('0 * * * *');
    expect(after.version).toBe(before.version); // metadata change, not a new version
  });

  it('clears the schedule when SCHEDULE is empty', () => {
    const ctx = setup();
    mkAgent('news', '0 8 * * *');
    const r = executeAgentSchedule(ctx, meta({ AGENT_ID: 'news', SCHEDULE: '' }));
    expect(r.status).toBe('completed');
    expect(r.summary).toMatch(/[Uu]nscheduled/);
    expect(agentStore.getAgent('news')!.schedule).toBeUndefined();
  });

  it('refuses an invalid cron and leaves the schedule unchanged', () => {
    const ctx = setup();
    mkAgent('news', '0 8 * * *');
    const r = executeAgentSchedule(ctx, meta({ AGENT_ID: 'news', SCHEDULE: 'not-a-cron' }));
    expect(r.status).toBe('failed');
    expect(agentStore.getAgent('news')!.schedule).toBe('0 8 * * *');
  });

  it('refuses a sub-minute (6-field) cron as too frequent', () => {
    const ctx = setup();
    mkAgent('news', '0 8 * * *');
    const r = executeAgentSchedule(ctx, meta({ AGENT_ID: 'news', SCHEDULE: '*/10 * * * * *' }));
    expect(r.status).toBe('failed');
    expect(agentStore.getAgent('news')!.schedule).toBe('0 8 * * *');
  });

  it('refuses an agent that is not installed', () => {
    const ctx = setup();
    const r = executeAgentSchedule(ctx, meta({ AGENT_ID: 'ghost', SCHEDULE: '0 * * * *' }));
    expect(r.status).toBe('failed');
    expect(r.refusalReason).toContain('not installed');
  });

  it('can add a schedule to a previously unscheduled agent', () => {
    const ctx = setup();
    mkAgent('news'); // no schedule
    expect(agentStore.getAgent('news')!.schedule).toBeUndefined();
    const r = executeAgentSchedule(ctx, meta({ AGENT_ID: 'news', SCHEDULE: '0 9 * * 1-5' }));
    expect(r.status).toBe('completed');
    expect(agentStore.getAgent('news')!.schedule).toBe('0 9 * * 1-5');
  });
});
