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
import { substitutePlaceholders } from './html-sanitizer.js';

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

  it('each starter is a real multi-node DAG, not a single node', () => {
    const { packsStore: store } = freshStores();
    loadBuiltinPacks(store, PACKS_DIR);
    const refs = store.getPack('playground-starters')!.manifest.agents ?? [];

    for (const ref of refs) {
      const agent = parseAgent(ref.yaml!);
      // A one-node "DAG" renders as a dot, which makes "watch the graph"
      // and "click a node" hollow on the very first run someone does.
      expect(agent.nodes.length, `${ref.id} is single-node`).toBeGreaterThanOrEqual(3);

      // Every node past the roots must actually be wired up, or the graph
      // is several disconnected dots rather than a DAG.
      const ids = new Set(agent.nodes.map((n) => n.id));
      const wired = agent.nodes.filter((n) => (n.dependsOn?.length ?? 0) > 0);
      expect(wired.length, `${ref.id} has no edges`).toBeGreaterThan(0);
      for (const n of agent.nodes) {
        for (const dep of n.dependsOn ?? []) {
          expect(ids.has(dep), `${ref.id}: node "${n.id}" depends on unknown "${dep}"`).toBe(true);
        }
      }
    }
  });

  it('starter-research fans out — two gather nodes share a parent and run concurrently', () => {
    const { packsStore: store } = freshStores();
    loadBuiltinPacks(store, PACKS_DIR);
    const refs = store.getPack('playground-starters')!.manifest.agents ?? [];
    const agent = parseAgent(refs.find((r) => r.id === 'starter-research')!.yaml!);

    const gatherers = agent.nodes.filter((n) => n.dependsOn?.includes('plan'));
    expect(gatherers.length, 'no fan-out from plan').toBe(2);
    // Neither may depend on the other, or they serialize and the graph shows
    // one node pulsing at a time instead of two.
    const ids = gatherers.map((n) => n.id);
    for (const g of gatherers) {
      for (const other of ids) {
        if (other !== g.id) expect(g.dependsOn).not.toContain(other);
      }
    }
    const merge = agent.nodes.find((n) => ids.every((i) => n.dependsOn?.includes(i)));
    expect(merge, 'nothing merges the two gather branches').toBeDefined();
  });

  it('starter-watch guards its alert with onlyIf so a NO run visibly skips', () => {
    const { packsStore: store } = freshStores();
    loadBuiltinPacks(store, PACKS_DIR);
    const refs = store.getPack('playground-starters')!.manifest.agents ?? [];
    const agent = parseAgent(refs.find((r) => r.id === 'starter-watch')!.yaml!);

    const alert = agent.nodes.find((n) => n.onlyIf);
    expect(alert, 'no conditional node').toBeDefined();
    expect(alert!.onlyIf).toMatchObject({ upstream: 'judge', field: 'verdict', equals: 'YES' });
  });

  it('every terminal path emits the JSON contract the widget reads', () => {
    const { packsStore: store } = freshStores();
    loadBuiltinPacks(store, PACKS_DIR);
    const refs = store.getPack('playground-starters')!.manifest.agents ?? [];

    for (const ref of refs) {
      const agent = parseAgent(ref.yaml!);
      const depended = new Set(agent.nodes.flatMap((n) => n.dependsOn ?? []));
      const terminals = agent.nodes.filter((n) => !depended.has(n.id));
      expect(terminals.length, `${ref.id} has no terminal node`).toBeGreaterThan(0);

      // The run's `result` is the LAST COMPLETED node's output, and the
      // widget parses its fields from there. So EVERY node that can end a
      // run has to emit the framed JSON — otherwise one branch renders a
      // populated card and another renders an empty one.
      for (const t of terminals) {
        expect(
          t.prompt ?? '',
          `${ref.id}: terminal node "${t.id}" never emits framed JSON`,
        ).toMatch(/LAST line/i);
      }
    }
  });

  it('each starter widget template renders against its declared outputs', () => {
    const { packsStore: store } = freshStores();
    loadBuiltinPacks(store, PACKS_DIR);
    const refs = store.getPack('playground-starters')!.manifest.agents ?? [];

    for (const ref of refs) {
      const agent = parseAgent(ref.yaml!);
      const widget = agent.outputWidget;
      expect(widget?.type, `${ref.id} is not an ai-template widget`).toBe('ai-template');
      expect(widget?.controls?.length, `${ref.id} has no replay control`).toBeGreaterThan(0);

      // Build a payload from the DECLARED outputs, so a template referencing
      // a field the agent never declares shows up as an unrendered token.
      const payload: Record<string, unknown> = {};
      for (const [name, spec] of Object.entries(agent.outputs ?? {})) {
        payload[name] = spec.type === 'array'
          ? [{ point: `POINT_${name}`, source_title: 'T', source_url: 'https://example.com' }]
          : `VALUE_${name}`;
      }

      const rendered = substitutePlaceholders(widget!.template!, { outputs: payload, result: '' });

      // Nothing may survive unsubstituted — that catches typo'd field names
      // and syntax the renderer doesn't actually support.
      expect(rendered, `${ref.id} left an unrendered token`).not.toMatch(/\{\{/);
      for (const name of Object.keys(agent.outputs ?? {})) {
        const spec = agent.outputs![name];
        if (spec.type === 'array') continue;
        expect(rendered, `${ref.id}: declared output "${name}" is never shown`).toContain(`VALUE_${name}`);
      }
    }
  });
});
