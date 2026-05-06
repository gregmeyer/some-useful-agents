import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PacksStore, type PackManifest } from './packs-store.js';

let dir: string;
let store: PacksStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-packs-store-'));
  store = new PacksStore(join(dir, 'runs.db'));
});

afterEach(() => {
  try { store.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function sampleManifest(id = 'starter', overrides: Partial<PackManifest> = {}): PackManifest {
  return {
    id,
    name: 'Starter',
    description: 'A guided tour of widget capabilities.',
    version: '0.1.0',
    author: 'sua',
    agents: [{ id: 'weather-forecast' }],
    dashboards: [
      {
        id: 'media',
        name: 'Media',
        sections: [{ title: 'Video', agentIds: ['vimeo-staff-picks'] }],
      },
    ],
    ...overrides,
  };
}

describe('PacksStore', () => {
  it('upserts and retrieves a pack', () => {
    const manifest = sampleManifest();
    store.upsertPack({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      author: manifest.author,
      source: 'builtin',
      manifest,
    });
    const loaded = store.getPack('starter');
    expect(loaded).not.toBeNull();
    expect(loaded?.name).toBe('Starter');
    expect(loaded?.source).toBe('builtin');
    expect(loaded?.installedAt).toBeNull();
    expect(loaded?.manifest.dashboards?.[0].name).toBe('Media');
  });

  it('returns null for unknown pack id', () => {
    expect(store.getPack('nope')).toBeNull();
  });

  it('lists packs sorted by name', () => {
    store.upsertPack({ id: 'b', name: 'Beta', version: '1.0.0', source: 'builtin', manifest: sampleManifest('b', { name: 'Beta' }) });
    store.upsertPack({ id: 'a', name: 'Alpha', version: '1.0.0', source: 'builtin', manifest: sampleManifest('a', { name: 'Alpha' }) });
    const all = store.listPacks();
    expect(all.map((p) => p.name)).toEqual(['Alpha', 'Beta']);
  });

  it('preserves installed_at across upsertPack (re-registering a built-in does not toggle install state)', () => {
    const manifest = sampleManifest();
    store.upsertPack({ id: 'starter', name: 'Starter', version: '0.1.0', source: 'builtin', manifest });
    store.markInstalled('starter', 1_700_000_000_000);
    // Daemon restarts — re-registers the same pack with an updated version.
    store.upsertPack({ id: 'starter', name: 'Starter', version: '0.2.0', source: 'builtin', manifest: sampleManifest('starter', { version: '0.2.0' }) });
    const loaded = store.getPack('starter');
    expect(loaded?.installedAt).toBe(1_700_000_000_000);
    expect(loaded?.version).toBe('0.2.0');
  });

  it('markInstalled / markUninstalled toggles installed_at', () => {
    store.upsertPack({ id: 'starter', name: 'Starter', version: '0.1.0', source: 'builtin', manifest: sampleManifest() });
    expect(store.getPack('starter')?.installedAt).toBeNull();
    store.markInstalled('starter');
    expect(store.getPack('starter')?.installedAt).not.toBeNull();
    store.markUninstalled('starter');
    expect(store.getPack('starter')?.installedAt).toBeNull();
  });

  it('markInstalled throws on unknown pack', () => {
    expect(() => store.markInstalled('nope')).toThrow(/No pack with id/);
  });

  it('markUninstalled is idempotent', () => {
    store.upsertPack({ id: 'starter', name: 'Starter', version: '0.1.0', source: 'builtin', manifest: sampleManifest() });
    expect(() => store.markUninstalled('starter')).not.toThrow();
    expect(() => store.markUninstalled('starter')).not.toThrow();
    expect(() => store.markUninstalled('nope')).not.toThrow();
  });

  it('listInstalled filters out uninstalled packs', () => {
    store.upsertPack({ id: 'a', name: 'Alpha', version: '1.0.0', source: 'builtin', manifest: sampleManifest('a') });
    store.upsertPack({ id: 'b', name: 'Beta', version: '1.0.0', source: 'builtin', manifest: sampleManifest('b') });
    store.markInstalled('a');
    const installed = store.listInstalled();
    expect(installed.map((p) => p.id)).toEqual(['a']);
  });

  it('deletePack removes the row entirely', () => {
    store.upsertPack({ id: 'x', name: 'X', version: '1.0.0', source: 'builtin', manifest: sampleManifest('x') });
    store.deletePack('x');
    expect(store.getPack('x')).toBeNull();
  });

  it('round-trips JSON-heavy manifests', () => {
    const manifest: PackManifest = {
      id: 'big',
      name: 'Big',
      version: '1.0.0',
      agents: [{ id: 'a', yaml: 'path/a.yaml' }, { id: 'b' }],
      dashboards: [
        { id: 'd1', name: 'D1', sections: [{ title: 'T1', agentIds: ['a', 'b'] }] },
        { id: 'd2', name: 'D2', sections: [{ title: 'T2', agentIds: [] }] },
      ],
    };
    store.upsertPack({ id: 'big', name: 'Big', version: '1.0.0', source: 'builtin', manifest });
    const loaded = store.getPack('big');
    expect(loaded?.manifest).toEqual(manifest);
  });
});
