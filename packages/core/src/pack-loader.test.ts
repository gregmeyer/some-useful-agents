import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadBuiltinPacks } from './pack-loader.js';
import { PacksStore } from './packs-store.js';

let dir: string;
let packsDir: string;
let store: PacksStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-pack-loader-'));
  packsDir = join(dir, 'packs');
  mkdirSync(packsDir);
  store = new PacksStore(join(dir, 'runs.db'));
});

afterEach(() => {
  try { store.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function writeManifest(filename: string, contents: string): void {
  writeFileSync(join(packsDir, filename), contents);
}

describe('loadBuiltinPacks', () => {
  it('returns empty result when packs directory is missing', () => {
    const result = loadBuiltinPacks(store, join(dir, 'does-not-exist'));
    expect(result.registered).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('registers a valid manifest as builtin source', () => {
    writeManifest('starter.yaml', `
id: starter
name: Starter
version: 0.1.0
dashboards:
  - id: media
    name: Media
    sections:
      - title: Video
        agentIds: [a]
`);
    const result = loadBuiltinPacks(store, packsDir);
    expect(result.registered).toEqual(['starter']);
    const pack = store.getPack('starter');
    expect(pack?.source).toBe('builtin');
    expect(pack?.installedAt).toBeNull();
  });

  it('inlines yamlPath agent refs', () => {
    writeFileSync(join(dir, 'agent-a.yaml'), 'id: a\nname: A\n');
    writeManifest('p.yaml', `
id: p
name: P
version: 0.1.0
agents:
  - id: a
    yamlPath: ../agent-a.yaml
dashboards:
  - id: d
    name: D
    sections:
      - title: T
        agentIds: [a]
`);
    loadBuiltinPacks(store, packsDir);
    const pack = store.getPack('p');
    expect(pack?.manifest.agents?.[0].yaml).toBe('id: a\nname: A\n');
    // yamlPath is dropped from the stored form (inlined into yaml).
    expect((pack?.manifest.agents?.[0] as { yamlPath?: string }).yamlPath).toBeUndefined();
  });

  it('skips manifests that fail validation but registers the rest', () => {
    writeManifest('good.yaml', `
id: good
name: Good
version: 0.1.0
dashboards:
  - id: d
    name: D
    sections:
      - title: T
        agentIds: [a]
`);
    writeManifest('bad.yaml', `
id: BAD
name: Bad
version: not-semver
`);
    const result = loadBuiltinPacks(store, packsDir);
    expect(result.registered).toEqual(['good']);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].file).toBe('bad.yaml');
  });

  it('preserves installed_at across reload (idempotent)', () => {
    writeManifest('starter.yaml', `
id: starter
name: Starter
version: 0.1.0
dashboards:
  - id: d
    name: D
    sections:
      - title: T
        agentIds: [a]
`);
    loadBuiltinPacks(store, packsDir);
    store.markInstalled('starter');
    const before = store.getPack('starter');

    // Bump the version in the manifest and reload.
    writeManifest('starter.yaml', `
id: starter
name: Starter
version: 0.2.0
dashboards:
  - id: d
    name: D
    sections:
      - title: T
        agentIds: [a]
`);
    loadBuiltinPacks(store, packsDir);

    const after = store.getPack('starter');
    expect(after?.version).toBe('0.2.0');
    expect(after?.installedAt).toBe(before?.installedAt);
  });

  it('throws (and skips) on a yamlPath that does not exist', () => {
    writeManifest('p.yaml', `
id: p
name: P
version: 0.1.0
agents:
  - id: a
    yamlPath: ./does-not-exist.yaml
`);
    const result = loadBuiltinPacks(store, packsDir);
    expect(result.registered).toEqual([]);
    expect(result.skipped[0].reason).toMatch(/not found/);
  });
});
