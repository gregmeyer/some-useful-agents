/**
 * buildDashboardsCatalogJson feeds the triage turn the operator's existing
 * dashboards so triage can answer "where can I add agents" and target an
 * existing dashboard by id (instead of guessing a name and minting a
 * near-duplicate). Read-only projection of DashboardsStore.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStore, DashboardsStore } from '@some-useful-agents/core';
import { buildDashboardsCatalogJson } from './inbox-catalog.js';

let dir: string;
let agentStore: AgentStore;
let dashboardsStore: DashboardsStore;

function setup(withStore = true) {
  dir = mkdtempSync(join(tmpdir(), 'sua-dash-catalog-'));
  const db = join(dir, 'runs.db');
  agentStore = new AgentStore(db);
  dashboardsStore = new DashboardsStore(db);
  const ctx = { agentStore, ...(withStore ? { dashboardsStore } : {}) };
  return ctx as never as ReturnType<typeof import('../context.js').getContext>;
}

afterEach(() => {
  try { agentStore.close(); } catch { /* ignore */ }
  try { dashboardsStore.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('buildDashboardsCatalogJson', () => {
  it('returns [] when there are no named dashboards', () => {
    const ctx = setup();
    expect(buildDashboardsCatalogJson(ctx)).toBe('[]');
  });

  it('returns [] when the dashboards store is unavailable', () => {
    const ctx = setup(false);
    expect(buildDashboardsCatalogJson(ctx)).toBe('[]');
  });

  it('projects id, name, tile count, and the distinct pinned agents', () => {
    const ctx = setup();
    dashboardsStore.upsertDashboard({
      id: 'user:markets', packId: null, name: 'Markets',
      layout: { sections: [
        { title: 'Widgets', agentIds: ['spx', 'btc'] },
        { title: 'Extras', agentIds: ['btc'] }, // dup across sections → deduped
      ] },
    });
    const parsed = JSON.parse(buildDashboardsCatalogJson(ctx));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ id: 'user:markets', name: 'Markets', tiles: 2 });
    expect(parsed[0].agents.sort()).toEqual(['btc', 'spx']);
  });

  it('lists multiple dashboards, most-recently-updated first', () => {
    const ctx = setup();
    dashboardsStore.upsertDashboard({ id: 'user:a', packId: null, name: 'A', layout: { sections: [] } });
    dashboardsStore.upsertDashboard({ id: 'user:b', packId: null, name: 'B', layout: { sections: [] } });
    // Touch A so it becomes the most-recently-updated.
    dashboardsStore.updateLayout('user:a', { sections: [{ title: 'Widgets', agentIds: ['x'] }] });
    const parsed = JSON.parse(buildDashboardsCatalogJson(ctx));
    expect(parsed.map((d: { id: string }) => d.id)).toEqual(['user:a', 'user:b']);
    expect(parsed[0]).toMatchObject({ id: 'user:a', tiles: 1 });
  });
});
