/**
 * Stores built with `fromHandle` skip the constructor (`Object.create` +
 * assigning the handle), so class-field initializers never run. An arrow
 * method declared as a field (`private rowToX = (r) => …`) is then missing,
 * and the first read crashes ("this.rowToX is not a function"). This checks
 * every such store: a handle-built store must carry every own property a
 * constructed one has.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { InboxStore } from './inbox-store.js';
import { BlockedImgHostsStore } from './blocked-img-hosts-store.js';
import { MemoryStore } from './memory-store.js';
import { WebhookStore } from './webhooks.js';
import { PlannerTelemetryStore } from './planner-telemetry-store.js';
import { IntegrationsStore } from './integrations-store.js';
import { LayoutHintsStore } from './layout-hints-store.js';
import { ToolStore } from './tool-store.js';
import { PacksStore } from './packs-store.js';
import { HumanQuestionStore } from './human-questions.js';
import { RunStore } from './run-store.js';
import { AgentStore } from './agent-store.js';
import { DashboardsStore } from './dashboards-store.js';
import { SessionStore } from './sessions.js';
import { AgentMemoryStore } from './agent-loop/memory-store.js';
import { OutcomeStore } from './outcome/outcome-store.js';
import { PlannerMemoryStore } from './planner-loop/memory-store.js';
import { PlannerLoopStepLogStore } from './planner-loop/step-log-store.js';
import { SurfaceStore } from './surfaces/store.js';
import { NotebookStore } from './notebooks.js';

type HandleStore = { new (path: string): object; fromHandle(db: DatabaseSync): object; name: string };
const STORES = [
  InboxStore, BlockedImgHostsStore, MemoryStore, WebhookStore, PlannerTelemetryStore, IntegrationsStore,
  LayoutHintsStore, ToolStore, PacksStore, HumanQuestionStore, RunStore, AgentStore, DashboardsStore,
  SessionStore, AgentMemoryStore, OutcomeStore, PlannerMemoryStore, PlannerLoopStepLogStore, SurfaceStore, NotebookStore,
] as unknown as HandleStore[];

describe('stores built from a shared handle', () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it.each(STORES.map((S) => [S.name, S] as const))('%s has every own property a constructed one has', (_name, Store) => {
    dir = mkdtempSync(join(tmpdir(), 'sua-from-handle-'));
    const runs = new RunStore(join(dir, 'runs.db'));
    const built = new Store(join(dir, 'runs.db'));
    const fromHandle = Store.fromHandle(runs.databaseHandle());
    const missing = Object.keys(built).filter((k) => !(k in fromHandle));
    expect(missing).toEqual([]);
    runs.close();
  });
});
