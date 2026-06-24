/**
 * dashboard-editor action: `executeDashboardEditor` writes a user dashboard
 * (create an empty one, or add an agent's signal tile, creating the dashboard if
 * needed). It refuses agents that aren't installed or have no Pulse signal —
 * dashboards only render signal tiles. Plus a render assertion for the action
 * card chrome.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStore, InboxStore, RunStore, DashboardsStore, type InboxActionMeta, type InboxMessage, type InboxResponse } from '@some-useful-agents/core';
import { executeDashboardEditor } from './inbox-engine.js';
import { renderInboxDetailFragment } from '../views/inbox-detail.js';
import { render } from '../views/html.js';

let dir: string;
let agentStore: AgentStore;
let inboxStore: InboxStore;
let runStore: RunStore;
let dashboardsStore: DashboardsStore;

function setup() {
  dir = mkdtempSync(join(tmpdir(), 'sua-dash-editor-'));
  const db = join(dir, 'runs.db');
  agentStore = new AgentStore(db);
  inboxStore = new InboxStore(db);
  runStore = new RunStore(db);
  dashboardsStore = new DashboardsStore(db);
  return { agentStore, inboxStore, runStore, dashboardsStore } as never as ReturnType<typeof import('../context.js').getContext>;
}

afterEach(() => {
  try { agentStore.close(); } catch { /* ignore */ }
  try { inboxStore.close(); } catch { /* ignore */ }
  try { runStore.close(); } catch { /* ignore */ }
  try { dashboardsStore.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** Install an agent, optionally with a Pulse signal (required to render as a tile). */
function mkAgent(id: string, withSignal: boolean): void {
  agentStore.createAgent({
    id, name: id, status: 'active', source: 'local', mcp: false,
    nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }],
    ...(withSignal ? { signal: { title: id } } : {}),
  }, 'cli');
}

/** A prior completed run so maybeKickoffFirstRun no-ops (keeps the test hermetic). */
function mkCompletedRun(id: string, agentName: string): void {
  const now = new Date().toISOString();
  runStore.createRun({
    id, agentName, status: 'completed',
    startedAt: now, completedAt: now,
    triggeredBy: 'dashboard', result: 'ok',
  });
}

const addTile = (inputs: Record<string, string>): InboxActionMeta =>
  ({ kind: 'action', status: 'proposed', agentId: 'dashboard-editor', inputs: { op: 'add-tile', ...inputs }, effect: 'write' });

describe('executeDashboardEditor — create', () => {
  it('creates an empty user dashboard', () => {
    const ctx = setup();
    const r = executeDashboardEditor(ctx, { kind: 'action', status: 'proposed', agentId: 'dashboard-editor', inputs: { op: 'create', DASHBOARD: 'Markets' } });
    expect(r.status).toBe('completed');
    expect(r.summary).toContain('/dashboards/user:markets');
    const made = dashboardsStore.listUserDashboards();
    expect(made.map((d) => d.id)).toContain('user:markets');
    expect(made[0].layout.sections).toEqual([]);
  });

  it('refuses create with no DASHBOARD name', () => {
    const ctx = setup();
    const r = executeDashboardEditor(ctx, { kind: 'action', status: 'proposed', agentId: 'dashboard-editor', inputs: { op: 'create' } });
    expect(r.status).toBe('failed');
    expect(r.refusalReason).toContain('DASHBOARD name');
  });
});

describe('executeDashboardEditor — add-tile', () => {
  it('creates the dashboard and adds the tile to the default Widgets section', () => {
    const ctx = setup();
    mkAgent('weather', true);
    mkCompletedRun('run-1', 'weather');
    const r = executeDashboardEditor(ctx, addTile({ DASHBOARD: 'Markets', AGENT_ID: 'weather' }));
    expect(r.status).toBe('completed');
    expect(r.summary).toContain('/dashboards/user:markets');
    const dash = dashboardsStore.getDashboard('user:markets')!;
    expect(dash.layout.sections).toHaveLength(1);
    expect(dash.layout.sections[0].title).toBe('Widgets');
    expect(dash.layout.sections[0].agentIds).toEqual(['weather']);
  });

  it('honors a custom SECTION title', () => {
    const ctx = setup();
    mkAgent('weather', true);
    mkCompletedRun('run-1', 'weather');
    executeDashboardEditor(ctx, addTile({ DASHBOARD: 'Markets', AGENT_ID: 'weather', SECTION: 'Top' }));
    const dash = dashboardsStore.getDashboard('user:markets')!;
    expect(dash.layout.sections[0].title).toBe('Top');
  });

  it('adds to an EXISTING dashboard referenced by user:<slug> id', () => {
    const ctx = setup();
    mkAgent('weather', true);
    mkCompletedRun('run-1', 'weather');
    dashboardsStore.upsertDashboard({ id: 'user:markets', packId: null, name: 'Markets', layout: { sections: [] } });
    const r = executeDashboardEditor(ctx, addTile({ DASHBOARD: 'user:markets', AGENT_ID: 'weather' }));
    expect(r.status).toBe('completed');
    expect(dashboardsStore.listUserDashboards()).toHaveLength(1); // no duplicate dashboard
    expect(dashboardsStore.getDashboard('user:markets')!.layout.sections[0].agentIds).toEqual(['weather']);
  });

  it('refuses an agent that is not installed', () => {
    const ctx = setup();
    const r = executeDashboardEditor(ctx, addTile({ DASHBOARD: 'Markets', AGENT_ID: 'ghost' }));
    expect(r.status).toBe('failed');
    expect(r.refusalReason).toContain('not installed');
  });

  it('refuses an agent with no Pulse signal', () => {
    const ctx = setup();
    mkAgent('plain', false);
    const r = executeDashboardEditor(ctx, addTile({ DASHBOARD: 'Markets', AGENT_ID: 'plain' }));
    expect(r.status).toBe('failed');
    expect(r.refusalReason).toContain('Pulse signal');
  });

  it('dedupes — adding an agent already on the dashboard is a no-op success', () => {
    const ctx = setup();
    mkAgent('weather', true);
    mkCompletedRun('run-1', 'weather');
    executeDashboardEditor(ctx, addTile({ DASHBOARD: 'Markets', AGENT_ID: 'weather' }));
    const before = dashboardsStore.getDashboard('user:markets')!;
    const r = executeDashboardEditor(ctx, addTile({ DASHBOARD: 'user:markets', AGENT_ID: 'weather' }));
    expect(r.status).toBe('completed');
    expect(r.summary).toContain('already on');
    const after = dashboardsStore.getDashboard('user:markets')!;
    expect(after.layout.sections).toHaveLength(before.layout.sections.length);
    expect(after.layout.sections[0].agentIds).toEqual(['weather']); // unchanged
  });

  it('refuses an unknown op', () => {
    const ctx = setup();
    const r = executeDashboardEditor(ctx, { kind: 'action', status: 'proposed', agentId: 'dashboard-editor', inputs: { op: 'nuke', DASHBOARD: 'x' } });
    expect(r.status).toBe('failed');
    expect(r.refusalReason).toContain('Unknown dashboard-editor op');
  });
});

describe('dashboard-editor card chrome', () => {
  const message: InboxMessage = {
    id: 'm1', createdAt: Date.now(), priority: 'medium', source: 'manual',
    title: 't', body: 'b', status: 'awaiting_user', starred: false, tags: [],
  };
  const completedAddTile = (): InboxResponse => ({
    id: 'resp-1', messageId: 'm1', createdAt: Date.now(), role: 'action',
    body: 'Add weather to Markets.',
    metaJson: JSON.stringify({
      kind: 'action', status: 'completed', agentId: 'dashboard-editor',
      inputs: { op: 'add-tile', DASHBOARD: 'Markets', AGENT_ID: 'weather' },
      effect: 'write',
      resultSummary: 'Added weather to new dashboard "Markets" — /dashboards/user:markets',
    } satisfies InboxActionMeta),
  });

  it('renders the "Add tile" headline with the dashboard + agent', () => {
    const out = render(renderInboxDetailFragment({
      message,
      responses: [completedAddTile()],
      inlineActionWidgets: {},
    }));
    expect(out).toContain('Add tile');
    expect(out).toContain('Markets');
    expect(out).toContain('/dashboards/user:markets'); // summary preview
  });
});
