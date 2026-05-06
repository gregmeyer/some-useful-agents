import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PacksStore, type PackManifest } from './packs-store.js';
import { DashboardsStore } from './dashboards-store.js';
import { AgentStore } from './agent-store.js';
import { installPack, uninstallPack } from './pack-installer.js';

let dir: string;
let db: DatabaseSync;
let packs: PacksStore;
let dashboards: DashboardsStore;
let agents: AgentStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-pack-installer-'));
  db = new DatabaseSync(join(dir, 'runs.db'));
  packs = PacksStore.fromHandle(db);
  dashboards = DashboardsStore.fromHandle(db);
  agents = AgentStore.fromHandle(db);
});

afterEach(() => {
  try { db.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const SAMPLE_AGENT_YAML = `id: hello
name: Hello
status: active
source: local
mcp: false
nodes:
  - id: greet
    type: shell
    command: echo hi
`;

function manifestWithAgents(): PackManifest {
  return {
    id: 'starter',
    name: 'Starter',
    version: '0.1.0',
    agents: [{ id: 'hello', yaml: SAMPLE_AGENT_YAML }],
    dashboards: [
      {
        id: 'main',
        name: 'Main',
        sections: [{ title: 'Greetings', agentIds: ['hello'] }],
      },
    ],
  };
}

describe('installPack', () => {
  it('creates dashboards from the manifest and marks installed', () => {
    packs.upsertPack({ id: 'starter', name: 'Starter', version: '0.1.0', source: 'builtin', manifest: manifestWithAgents() });
    const result = installPack('starter', { packsStore: packs, dashboardsStore: dashboards, agentStore: agents });
    expect(result.dashboardsCreated).toEqual(['starter:main']);
    expect(result.agentsCreated).toEqual(['hello']);
    expect(packs.getPack('starter')?.installedAt).not.toBeNull();
    expect(dashboards.getDashboard('starter:main')?.layout.sections[0].agentIds).toEqual(['hello']);
    expect(agents.getAgent('hello')).not.toBeNull();
  });

  it('skips agents that already exist', () => {
    // Pre-create the agent.
    packs.upsertPack({ id: 'starter', name: 'Starter', version: '0.1.0', source: 'builtin', manifest: manifestWithAgents() });
    installPack('starter', { packsStore: packs, dashboardsStore: dashboards, agentStore: agents });
    // Reinstall — the agent already exists from the first run.
    const result = installPack('starter', { packsStore: packs, dashboardsStore: dashboards, agentStore: agents });
    expect(result.agentsCreated).toEqual([]);
    expect(result.agentsSkipped).toEqual(['hello']);
  });

  it('only creates dashboards when no agentStore is provided', () => {
    packs.upsertPack({ id: 'starter', name: 'Starter', version: '0.1.0', source: 'builtin', manifest: manifestWithAgents() });
    const result = installPack('starter', { packsStore: packs, dashboardsStore: dashboards });
    expect(result.dashboardsCreated).toEqual(['starter:main']);
    expect(result.agentsCreated).toEqual([]);
    // Agent ref skipped because no agent store to install into.
    expect(result.agentsSkipped).toEqual(['hello']);
  });

  it('throws on unknown pack', () => {
    expect(() => installPack('nope', { packsStore: packs, dashboardsStore: dashboards })).toThrow(/No pack registered/);
  });

  it('throws when an embedded agent YAML id mismatches the ref id', () => {
    packs.upsertPack({
      id: 'p', name: 'P', version: '0.1.0', source: 'builtin',
      manifest: {
        id: 'p', name: 'P', version: '0.1.0',
        agents: [{ id: 'wrong-id', yaml: SAMPLE_AGENT_YAML }],
        dashboards: [{ id: 'd', name: 'D', sections: [{ title: 'T', agentIds: ['hello'] }] }],
      },
    });
    expect(() =>
      installPack('p', { packsStore: packs, dashboardsStore: dashboards, agentStore: agents }),
    ).toThrow(/does not match YAML id/);
  });

  it('reinstall refreshes dashboards from the latest manifest', () => {
    packs.upsertPack({ id: 'starter', name: 'Starter', version: '0.1.0', source: 'builtin', manifest: manifestWithAgents() });
    installPack('starter', { packsStore: packs, dashboardsStore: dashboards, agentStore: agents });

    // Change the dashboard layout in the manifest, re-upsert, reinstall.
    const updated = manifestWithAgents();
    updated.dashboards![0].sections.push({ title: 'Extras', agentIds: ['hello'] });
    packs.upsertPack({ id: 'starter', name: 'Starter', version: '0.1.0', source: 'builtin', manifest: updated });
    installPack('starter', { packsStore: packs, dashboardsStore: dashboards, agentStore: agents });

    expect(dashboards.getDashboard('starter:main')?.layout.sections).toHaveLength(2);
  });
});

describe('uninstallPack', () => {
  it('removes dashboards but keeps agents', () => {
    packs.upsertPack({ id: 'starter', name: 'Starter', version: '0.1.0', source: 'builtin', manifest: manifestWithAgents() });
    installPack('starter', { packsStore: packs, dashboardsStore: dashboards, agentStore: agents });
    expect(dashboards.getDashboard('starter:main')).not.toBeNull();
    expect(agents.getAgent('hello')).not.toBeNull();

    const result = uninstallPack('starter', { packsStore: packs, dashboardsStore: dashboards, agentStore: agents });
    expect(result.dashboardsRemoved).toBe(1);
    expect(dashboards.getDashboard('starter:main')).toBeNull();
    expect(packs.getPack('starter')?.installedAt).toBeNull();
    expect(agents.getAgent('hello')).not.toBeNull();
  });

  it('is idempotent', () => {
    packs.upsertPack({ id: 'starter', name: 'Starter', version: '0.1.0', source: 'builtin', manifest: manifestWithAgents() });
    expect(() => uninstallPack('starter', { packsStore: packs, dashboardsStore: dashboards })).not.toThrow();
    expect(() => uninstallPack('starter', { packsStore: packs, dashboardsStore: dashboards })).not.toThrow();
  });
});
