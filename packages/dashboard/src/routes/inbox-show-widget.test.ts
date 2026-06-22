/**
 * show-widget mechanism: `resolveShowWidgetAction` points a read-only action at
 * an agent's latest completed run (so the existing inline-widget path renders
 * it), and `atLeastOneActionExecuted` excludes show-widget so a snapshot never
 * triggers a follow-up triage turn.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStore, InboxStore, RunStore, type InboxActionMeta, type InboxMessage, type InboxResponse } from '@some-useful-agents/core';
import { resolveShowWidgetAction, atLeastOneActionExecuted } from './inbox-engine.js';
import { renderInboxDetailFragment } from '../views/inbox-detail.js';
import { render, html } from '../views/html.js';

let dir: string;
let agentStore: AgentStore;
let inboxStore: InboxStore;
let runStore: RunStore;

function setup() {
  dir = mkdtempSync(join(tmpdir(), 'sua-show-widget-'));
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

/** Install an agent, optionally with an inline-able output widget. */
function mkAgent(id: string, withWidget: boolean): void {
  agentStore.createAgent({
    id, name: id, status: 'active', source: 'local', mcp: false,
    nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }],
    ...(withWidget
      ? { outputWidget: { type: 'key-value', fields: [{ name: 'x', label: 'X', type: 'text' }] } }
      : {}),
  }, 'cli');
}

function mkCompletedRun(id: string, agentName: string, startedAt = new Date().toISOString()): void {
  runStore.createRun({
    id, agentName, status: 'completed',
    startedAt, completedAt: startedAt,
    triggeredBy: 'dashboard', result: 'x: hello',
  });
}

const showWidget = (agentId: string): InboxActionMeta =>
  ({ kind: 'action', mode: 'show-widget', status: 'proposed', agentId, inputs: {} });

describe('resolveShowWidgetAction', () => {
  it('fails when the agent is not installed', () => {
    const ctx = setup();
    const r = resolveShowWidgetAction(ctx, showWidget('ghost'));
    expect(r.status).toBe('failed');
    expect(r.refusalReason).toContain('not installed');
  });

  it('fails when the agent has no inline output widget', () => {
    const ctx = setup();
    mkAgent('plain', false);
    mkCompletedRun('run-1', 'plain');
    const r = resolveShowWidgetAction(ctx, showWidget('plain'));
    expect(r.status).toBe('failed');
    expect(r.refusalReason).toContain('no inline output widget');
  });

  it('fails when there is no completed run yet', () => {
    const ctx = setup();
    mkAgent('weather', true);
    const r = resolveShowWidgetAction(ctx, showWidget('weather'));
    expect(r.status).toBe('failed');
    expect(r.refusalReason).toContain('No completed run yet');
  });

  it('resolves to the latest completed run on the happy path', () => {
    const ctx = setup();
    mkAgent('weather', true);
    mkCompletedRun('run-old', 'weather', '2026-06-01T00:00:00.000Z');
    mkCompletedRun('run-new', 'weather', '2026-06-20T00:00:00.000Z');
    const r = resolveShowWidgetAction(ctx, showWidget('weather'));
    expect(r.status).toBe('completed');
    expect(r.runId).toBe('run-new');         // newest first (listRuns DESC)
    expect(r.summary).toContain('Latest output');
  });
});

describe('atLeastOneActionExecuted excludes show-widget', () => {
  it('a resolved show-widget alone does NOT count as executed', () => {
    const ctx = setup();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const meta: InboxActionMeta = { kind: 'action', mode: 'show-widget', status: 'completed', agentId: 'weather', inputs: {}, runId: 'run-new' };
    inboxStore.addResponse(m.id, 'action', 'widget', JSON.stringify(meta));
    expect(atLeastOneActionExecuted(ctx, m.id)).toBe(false);
  });

  it('a completed run-agent action DOES count as executed', () => {
    const ctx = setup();
    const m = inboxStore.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const meta: InboxActionMeta = { kind: 'action', status: 'completed', agentId: 'analyzer', inputs: {}, runId: 'r1' };
    inboxStore.addResponse(m.id, 'action', 'ran', JSON.stringify(meta));
    expect(atLeastOneActionExecuted(ctx, m.id)).toBe(true);
  });
});

describe('show-widget card chrome', () => {
  const message: InboxMessage = {
    id: 'm1', createdAt: Date.now(), priority: 'medium', source: 'manual',
    title: 't', body: 'b', status: 'awaiting_user', starred: false, tags: [],
  };
  const completedShowWidget = (): InboxResponse => ({
    id: 'resp-1', messageId: 'm1', createdAt: Date.now(), role: 'action',
    body: 'Show the latest output from `weather`.',
    metaJson: JSON.stringify({ kind: 'action', mode: 'show-widget', status: 'completed', agentId: 'weather', inputs: {}, runId: 'run-x', resultSummary: 'Latest output from weather · run run-x.' } satisfies InboxActionMeta),
  });

  it('renders the widget slot and drops the run chrome', () => {
    const out = render(renderInboxDetailFragment({
      message,
      responses: [completedShowWidget()],
      inlineActionWidgets: { 'resp-1': html`<div class="test-widget">WIDGET</div>` },
    }));
    expect(out).toContain('Latest <span class="mono">weather</span> output'); // headline
    expect(out).toContain('inbox-action__inline-widget');                      // widget slot
    expect(out).toContain('WIDGET');
    expect(out).not.toContain('>Completed<');                                  // no completed badge
    expect(out).not.toContain('Raw result');                                   // no raw-result details
  });
});
