import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AgentStore } from './agent-store.js';
import { RunStore } from './run-store.js';
import type { Agent, AgentNode } from './agent-v2-types.js';

let dir: string;
let dbPath: string;
let store: AgentStore;

function seed(overrides: Partial<Agent> = {}): Omit<Agent, 'version'> {
  const nodes: AgentNode[] = overrides.nodes ?? [
    { id: 'main', type: 'shell', command: 'echo hi' },
  ];
  const { version: _ignoreVersion, ...rest } = {
    id: 'hello',
    name: 'Hello',
    description: 'A greeter',
    status: 'active' as const,
    source: 'local' as const,
    mcp: false,
    nodes,
    ...overrides,
  };
  return rest;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-agent-store-'));
  dbPath = join(dir, 'runs.db');
  store = new AgentStore(dbPath);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('AgentStore.createAgent + getAgent', () => {
  it('round-trips a minimal agent at version 1', () => {
    const created = store.createAgent(seed(), 'cli');
    expect(created.version).toBe(1);

    const got = store.getAgent('hello');
    expect(got).not.toBeNull();
    expect(got!.id).toBe('hello');
    expect(got!.name).toBe('Hello');
    expect(got!.status).toBe('active');
    expect(got!.version).toBe(1);
    expect(got!.nodes).toHaveLength(1);
    expect(got!.nodes[0].command).toBe('echo hi');
  });

  it('persists description, schedule, mcp', () => {
    store.createAgent(
      seed({ description: 'Ada', schedule: '0 * * * *', mcp: true }),
      'cli',
    );
    const got = store.getAgent('hello')!;
    expect(got.description).toBe('Ada');
    expect(got.schedule).toBe('0 * * * *');
    expect(got.mcp).toBe(true);
  });

  it('returns null for unknown id', () => {
    expect(store.getAgent('nope')).toBeNull();
  });

  it('refuses to create duplicate id', () => {
    store.createAgent(seed(), 'cli');
    expect(() => store.createAgent(seed(), 'cli')).toThrow();
  });
});

describe('AgentStore.listAgents', () => {
  beforeEach(() => {
    store.createAgent(seed({ id: 'a', name: 'A', status: 'active', source: 'local' }), 'cli');
    store.createAgent(seed({ id: 'b', name: 'B', status: 'paused', source: 'local' }), 'cli');
    store.createAgent(seed({ id: 'c', name: 'C', status: 'active', source: 'community' }), 'cli');
    store.createAgent(seed({ id: 'd', name: 'D', status: 'archived', source: 'local', mcp: true }), 'cli');
  });

  it('lists everything when no filter', () => {
    expect(store.listAgents()).toHaveLength(4);
  });

  it('filters by status', () => {
    const a = store.listAgents({ status: 'active' });
    expect(a.map((x) => x.id).sort()).toEqual(['a', 'c']);
  });

  it('filters by source', () => {
    const a = store.listAgents({ source: 'community' });
    expect(a.map((x) => x.id)).toEqual(['c']);
  });

  it('filters by mcp=true', () => {
    const a = store.listAgents({ mcp: true });
    expect(a.map((x) => x.id)).toEqual(['d']);
  });

  it('sorts by name', () => {
    const names = store.listAgents().map((x) => x.name);
    expect(names).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('AgentStore versioning', () => {
  it('createNewVersion bumps the version counter', () => {
    store.createAgent(seed(), 'cli');
    const v2 = store.createNewVersion('hello', seed({
      nodes: [
        { id: 'main', type: 'shell', command: 'echo v2' },
      ],
    }), 'dashboard', 'add echo v2');
    expect(v2.version).toBe(2);

    const got = store.getAgent('hello')!;
    expect(got.version).toBe(2);
    expect(got.nodes[0].command).toBe('echo v2');
  });

  it('listVersions returns history newest-first', () => {
    store.createAgent(seed(), 'cli');
    store.createNewVersion('hello', seed({ nodes: [{ id: 'main', type: 'shell', command: 'echo 2' }] }), 'cli');
    store.createNewVersion('hello', seed({ nodes: [{ id: 'main', type: 'shell', command: 'echo 3' }] }), 'cli');

    const versions = store.listVersions('hello');
    expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
  });

  it('getVersion returns the specific version regardless of current_version', () => {
    store.createAgent(seed({ nodes: [{ id: 'main', type: 'shell', command: 'echo v1' }] }), 'cli');
    store.createNewVersion('hello', seed({ nodes: [{ id: 'main', type: 'shell', command: 'echo v2' }] }), 'cli');

    const v1 = store.getVersion('hello', 1);
    expect(v1!.dag.nodes[0].command).toBe('echo v1');
    const v2 = store.getVersion('hello', 2);
    expect(v2!.dag.nodes[0].command).toBe('echo v2');
  });

  it('setCurrentVersion rolls back to an older version', () => {
    store.createAgent(seed({ nodes: [{ id: 'main', type: 'shell', command: 'echo v1' }] }), 'cli');
    store.createNewVersion('hello', seed({ nodes: [{ id: 'main', type: 'shell', command: 'echo v2' }] }), 'cli');

    store.setCurrentVersion('hello', 1);
    expect(store.getAgent('hello')!.nodes[0].command).toBe('echo v1');
  });

  it('setCurrentVersion throws on non-existent version', () => {
    store.createAgent(seed(), 'cli');
    expect(() => store.setCurrentVersion('hello', 99)).toThrow(/no version 99/);
  });

  it('persists commit_message and created_by', () => {
    store.createAgent(seed(), 'import', 'migrated from v1');
    store.createNewVersion('hello', seed(), 'dashboard', 'added retry');
    const versions = store.listVersions('hello');
    expect(versions[0].createdBy).toBe('dashboard');
    expect(versions[0].commitMessage).toBe('added retry');
    expect(versions[1].createdBy).toBe('import');
    expect(versions[1].commitMessage).toBe('migrated from v1');
  });
});

describe('AgentStore.upsertAgent', () => {
  it('creates on first call, updates metadata without new version on identical DAG', () => {
    const a1 = store.upsertAgent(seed(), 'import');
    expect(a1.version).toBe(1);

    // Same DAG but different description → metadata update, no new version
    const a2 = store.upsertAgent(seed({ description: 'updated' }), 'import');
    expect(a2.version).toBe(1);
    expect(store.getAgent('hello')!.description).toBe('updated');
    expect(store.listVersions('hello')).toHaveLength(1);
  });

  it('creates a new version when the DAG changes', () => {
    store.upsertAgent(seed(), 'cli');
    store.upsertAgent(
      seed({ nodes: [{ id: 'main', type: 'shell', command: 'echo changed' }] }),
      'cli',
    );
    expect(store.listVersions('hello')).toHaveLength(2);
    expect(store.getAgent('hello')!.nodes[0].command).toBe('echo changed');
  });
});

describe('AgentStore.updateAgentMeta', () => {
  beforeEach(() => {
    store.createAgent(seed(), 'cli');
  });

  it('updates status without bumping version', () => {
    store.updateAgentMeta('hello', { status: 'archived' });
    const got = store.getAgent('hello')!;
    expect(got.status).toBe('archived');
    expect(got.version).toBe(1);
  });

  it('updates schedule + mcp flag', () => {
    store.updateAgentMeta('hello', { schedule: '*/15 * * * *', mcp: true });
    const got = store.getAgent('hello')!;
    expect(got.schedule).toBe('*/15 * * * *');
    expect(got.mcp).toBe(true);
  });

  it('no-op when patch is empty', () => {
    const before = store.getAgent('hello')!;
    store.updateAgentMeta('hello', {});
    const after = store.getAgent('hello')!;
    expect(after.name).toBe(before.name);
  });
});

describe('AgentStore.deleteAgent', () => {
  it('removes agent + cascades versions', () => {
    store.createAgent(seed(), 'cli');
    store.createNewVersion('hello', seed({ nodes: [{ id: 'main', type: 'shell', command: 'echo 2' }] }), 'cli');
    store.deleteAgent('hello');
    expect(store.getAgent('hello')).toBeNull();
    expect(store.listVersions('hello')).toHaveLength(0);
  });
});

describe('AgentStore.fromHandle — shared connection with RunStore', () => {
  it('two stores sharing one handle coexist', () => {
    store.close(); // close the path-based default
    const db = new DatabaseSync(dbPath);
    const agentStore = AgentStore.fromHandle(db);
    const runStore = RunStore.fromHandle(db);

    agentStore.createAgent(seed({ id: 'x', name: 'X' }), 'cli');
    runStore.createRun({
      id: 'r1', agentName: 'x', status: 'completed',
      startedAt: new Date().toISOString(), triggeredBy: 'cli',
      workflowId: 'x', workflowVersion: 1,
    });

    expect(agentStore.getAgent('x')!.id).toBe('x');
    expect(runStore.getRun('r1')!.workflowId).toBe('x');

    // Neither store owns the connection; closing either should NOT close the DB.
    agentStore.close();
    runStore.close();
    // Still usable:
    const agentStore2 = AgentStore.fromHandle(db);
    expect(agentStore2.getAgent('x')!.id).toBe('x');

    // Manually close the handle.
    db.close();
    store = new AgentStore(dbPath); // reopen for afterEach.
  });
});

describe('AgentStore.starred', () => {
  it('defaults to false on create', () => {
    const created = store.createAgent(seed(), 'cli');
    expect(created.starred).toBeFalsy();
    const got = store.getAgent('hello')!;
    expect(got.starred).toBe(false);
  });

  it('toggles via updateAgentMeta', () => {
    store.createAgent(seed(), 'cli');
    store.updateAgentMeta('hello', { starred: true });
    expect(store.getAgent('hello')!.starred).toBe(true);
    store.updateAgentMeta('hello', { starred: false });
    expect(store.getAgent('hello')!.starred).toBe(false);
  });

  it('sorts starred agents first in listAgents', () => {
    store.createAgent(seed({ id: 'alpha', name: 'Alpha' }), 'cli');
    store.createAgent(seed({ id: 'beta', name: 'Beta' }), 'cli');
    store.createAgent(seed({ id: 'gamma', name: 'Gamma' }), 'cli');

    // Without starring, alphabetical order.
    expect(store.listAgents().map((a) => a.id)).toEqual(['alpha', 'beta', 'gamma']);

    // Star gamma — it should sort first.
    store.updateAgentMeta('gamma', { starred: true });
    expect(store.listAgents().map((a) => a.id)).toEqual(['gamma', 'alpha', 'beta']);

    // Star alpha too — both starred sort alphabetically before unstarred.
    store.updateAgentMeta('alpha', { starred: true });
    expect(store.listAgents().map((a) => a.id)).toEqual(['alpha', 'gamma', 'beta']);
  });
});
