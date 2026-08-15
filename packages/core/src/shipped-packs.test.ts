import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PacksStore } from './packs-store.js';
import { loadBuiltinPacks } from './pack-loader.js';
import { installPack } from './pack-installer.js';
import { AgentStore } from './agent-store.js';
import { DashboardsStore } from './dashboards-store.js';
import { parseAgent } from './agent-yaml.js';

/**
 * The other pack tests all use synthetic fixtures written to a temp dir, so
 * nothing covered the packs we actually ship. That matters because
 * `loadBuiltinPacks` swallows per-file failures into `result.skipped` and the
 * dashboard swallows the whole call in a try/catch — a typo or a dangling
 * `yamlPath` in `packages/core/packs/*.yaml` would ship silently and the pack
 * would just never appear.
 */
const PACKS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'packs');

let dir: string | undefined;
let packsStore: PacksStore | undefined;
let agentStore: AgentStore | undefined;
let dashboardsStore: DashboardsStore | undefined;

function freshStores() {
  dir = mkdtempSync(join(tmpdir(), 'sua-shipped-packs-'));
  const dbPath = join(dir, 'packs.db');
  packsStore = new PacksStore(dbPath);
  agentStore = new AgentStore(dbPath);
  dashboardsStore = new DashboardsStore(dbPath);
  return { packsStore, agentStore, dashboardsStore };
}

afterEach(() => {
  try { packsStore?.close(); } catch { /* ignore */ }
  try { agentStore?.close(); } catch { /* ignore */ }
  try { dashboardsStore?.close(); } catch { /* ignore */ }
  packsStore = agentStore = dashboardsStore = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('shipped builtin packs', () => {
  it('every packs/*.yaml loads with nothing skipped', () => {
    const { packsStore: store } = freshStores();
    const result = loadBuiltinPacks(store, PACKS_DIR);

    // A skipped entry means a malformed manifest or a dangling yamlPath.
    expect(result.skipped).toEqual([]);

    const onDisk = readdirSync(PACKS_DIR).filter((f) => f.endsWith('.yaml'));
    expect(result.registered.length).toBe(onDisk.length);
    expect(onDisk.length).toBeGreaterThan(0);
  });

  it('ships the playground-starters pack with its three agents inlined', () => {
    const { packsStore: store } = freshStores();
    loadBuiltinPacks(store, PACKS_DIR);

    const pack = store.getPack('playground-starters');
    expect(pack).toBeDefined();
    expect(pack!.name).toBe('Start here');
    expect(pack!.source).toBe('builtin');

    const refs = pack!.manifest.agents ?? [];
    expect(refs.map((a) => a.id)).toEqual(['starter-research', 'starter-watch', 'starter-draft']);
    // yamlPath refs are inlined at load time; a missing file would have
    // thrown into `skipped` above, but assert the payload really arrived.
    for (const ref of refs) expect(ref.yaml, `${ref.id} has no inlined yaml`).toBeTruthy();
  });

  it('installs the starters and their dashboard cleanly', () => {
    const stores = freshStores();
    loadBuiltinPacks(stores.packsStore, PACKS_DIR);
    installPack('playground-starters', stores);

    for (const id of ['starter-research', 'starter-watch', 'starter-draft']) {
      const agent = stores.agentStore.getAgent(id);
      expect(agent, `${id} was not installed`).toBeDefined();
    }
    const dash = stores.dashboardsStore.getDashboard('playground-starters:start-here');
    expect(dash).toBeDefined();
    expect(stores.packsStore.listInstalled().map((p) => p.id)).toContain('playground-starters');
  });

  it('each starter parses and exposes builtin tools on an llm-prompt node', () => {
    const { packsStore: store } = freshStores();
    loadBuiltinPacks(store, PACKS_DIR);
    const refs = store.getPack('playground-starters')!.manifest.agents ?? [];

    for (const ref of refs) {
      const agent = parseAgent(ref.yaml!);
      expect(agent.id).toBe(ref.id);
      expect(agent.status).toBe('active');
      expect(agent.source).toBe('examples');

      // The whole point of the trio: an LLM node that can call tools.
      const llm = agent.nodes.filter((n) => n.type === 'llm-prompt');
      expect(llm.length, `${ref.id} has no llm-prompt node`).toBeGreaterThan(0);
      const withTools = llm.filter((n) => (n.tools?.length ?? 0) > 0);
      expect(withTools.length, `${ref.id} exposes no tools`).toBeGreaterThan(0);
    }
  });
});
