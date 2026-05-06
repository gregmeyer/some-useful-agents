import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DashboardsStore, type DashboardLayout } from './dashboards-store.js';

let dir: string;
let store: DashboardsStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-dashboards-store-'));
  store = new DashboardsStore(join(dir, 'runs.db'));
});

afterEach(() => {
  try { store.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function sampleLayout(): DashboardLayout {
  return {
    sections: [
      { title: 'Video', agentIds: ['vimeo-staff-picks', 'cat-video-finder'] },
      { title: 'Weather', agentIds: ['weather-forecast'] },
    ],
  };
}

describe('DashboardsStore', () => {
  it('upserts and retrieves a dashboard', () => {
    store.upsertDashboard({ id: 'starter:media', packId: 'starter', name: 'Media', layout: sampleLayout() });
    const loaded = store.getDashboard('starter:media');
    expect(loaded).not.toBeNull();
    expect(loaded?.packId).toBe('starter');
    expect(loaded?.layout.sections).toHaveLength(2);
    expect(loaded?.layout.sections[0].agentIds).toEqual(['vimeo-staff-picks', 'cat-video-finder']);
  });

  it('preserves createdAt across upsert; bumps updatedAt', async () => {
    store.upsertDashboard({ id: 'd1', packId: null, name: 'D1', layout: { sections: [] } });
    const first = store.getDashboard('d1')!;
    await new Promise((r) => setTimeout(r, 5));
    store.upsertDashboard({ id: 'd1', packId: null, name: 'D1 renamed', layout: sampleLayout() });
    const second = store.getDashboard('d1')!;
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
    expect(second.name).toBe('D1 renamed');
  });

  it('updateLayout replaces just the layout', async () => {
    store.upsertDashboard({ id: 'd1', packId: null, name: 'D1', layout: { sections: [] } });
    const before = store.getDashboard('d1')!;
    await new Promise((r) => setTimeout(r, 5));
    store.updateLayout('d1', sampleLayout());
    const after = store.getDashboard('d1')!;
    expect(after.layout.sections).toHaveLength(2);
    expect(after.name).toBe('D1');
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
  });

  it('updateLayout throws on unknown dashboard', () => {
    expect(() => store.updateLayout('nope', sampleLayout())).toThrow(/No dashboard with id/);
  });

  it('listByPack returns only that pack\'s dashboards', () => {
    store.upsertDashboard({ id: 'starter:media', packId: 'starter', name: 'Media', layout: { sections: [] } });
    store.upsertDashboard({ id: 'starter:weather', packId: 'starter', name: 'Weather', layout: { sections: [] } });
    store.upsertDashboard({ id: 'other:foo', packId: 'other', name: 'Foo', layout: { sections: [] } });
    store.upsertDashboard({ id: 'user:morning', packId: null, name: 'Morning', layout: { sections: [] } });
    expect(store.listByPack('starter').map((d) => d.id).sort()).toEqual(['starter:media', 'starter:weather']);
  });

  it('listUserDashboards returns only pack_id IS NULL rows', () => {
    store.upsertDashboard({ id: 'starter:media', packId: 'starter', name: 'Media', layout: { sections: [] } });
    store.upsertDashboard({ id: 'user:morning', packId: null, name: 'Morning', layout: { sections: [] } });
    store.upsertDashboard({ id: 'user:focus', packId: null, name: 'Focus', layout: { sections: [] } });
    expect(store.listUserDashboards().map((d) => d.id).sort()).toEqual(['user:focus', 'user:morning']);
  });

  it('deleteDashboard removes the row', () => {
    store.upsertDashboard({ id: 'd1', packId: null, name: 'D1', layout: { sections: [] } });
    store.deleteDashboard('d1');
    expect(store.getDashboard('d1')).toBeNull();
  });

  it('deleteByPack removes only that pack\'s dashboards', () => {
    store.upsertDashboard({ id: 'starter:media', packId: 'starter', name: 'Media', layout: sampleLayout() });
    store.upsertDashboard({ id: 'starter:weather', packId: 'starter', name: 'Weather', layout: sampleLayout() });
    store.upsertDashboard({ id: 'other:foo', packId: 'other', name: 'Foo', layout: sampleLayout() });
    store.upsertDashboard({ id: 'user:morning', packId: null, name: 'Morning', layout: sampleLayout() });

    const removed = store.deleteByPack('starter');
    expect(removed).toBe(2);
    expect(store.getDashboard('starter:media')).toBeNull();
    expect(store.getDashboard('starter:weather')).toBeNull();
    expect(store.getDashboard('other:foo')).not.toBeNull();
    expect(store.getDashboard('user:morning')).not.toBeNull();
  });
});
