import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { chmod600Safe } from './fs-utils.js';
import { removeStateDir } from './agent-state.js';
import type {
  Agent,
  AgentNode,
  AgentSource,
  AgentStatus,
  AgentVersion,
  AgentVersionDag,
} from './agent-v2-types.js';
import { deriveCapabilities } from './agent-capabilities.js';

type SqlValue = string | number | null | bigint | Uint8Array;

/**
 * DB-backed store for DAG agents + their immutable version history.
 *
 * - `agents` row holds mutable per-agent metadata (status, schedule, mcp
 *   exposure, current_version pointer, provenance)
 * - `agent_versions` rows hold the DAG snapshot (nodes, edges-via-dependsOn,
 *   agent-level inputs). Immutable once written.
 *
 * Every save of a DAG creates a new version row and advances the
 * `current_version` pointer (git-like). Editing metadata like status or
 * schedule does NOT bump the version — those changes aren't part of the
 * DAG shape.
 *
 * Connection model: by default opens its own DatabaseSync at `dbPath` (same
 * file as RunStore by convention, usually `data/runs.db`). In tests / the
 * CLI main process, use `AgentStore.fromHandle(db)` to share a
 * DatabaseSync with RunStore — avoids two handles on the same file. The
 * shared-handle variant does NOT close the connection on `close()`.
 */
export class AgentStore {
  private db: DatabaseSync;
  private readonly ownsConnection: boolean;
  /** Base data dir (parent of the sqlite file). Used for cascading state-dir cleanup on delete. */
  public readonly dataRoot: string;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.ownsConnection = true;
    chmod600Safe(dbPath);
    this.dataRoot = dir;
    this.ensureSchema();
  }

  static fromHandle(db: DatabaseSync): AgentStore {
    const store = Object.create(AgentStore.prototype) as AgentStore;
    (store as unknown as { db: DatabaseSync }).db = db;
    (store as unknown as { ownsConnection: boolean }).ownsConnection = false;
    store.ensureSchema();
    return store;
  }

  private ensureSchema(): void {
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL CHECK (status IN ('active','paused','archived','draft')),
        schedule TEXT,
        source TEXT NOT NULL,
        mcp INTEGER NOT NULL DEFAULT 0,
        current_version INTEGER NOT NULL,
        provenance_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_versions (
        agent_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        dag_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL CHECK (created_by IN ('cli','dashboard','import')),
        commit_message TEXT,
        PRIMARY KEY (agent_id, version),
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
      )
    `);
    // Additive migrations. ALTER ADD COLUMN is not idempotent in SQLite,
    // so each migration is wrapped in try/catch. New columns are nullable
    // so existing rows keep working without a backfill.
    try { this.db.exec(`ALTER TABLE agents ADD COLUMN starred INTEGER NOT NULL DEFAULT 0`); } catch { /* exists */ }
    try { this.db.exec(`ALTER TABLE agents ADD COLUMN pulse_visible INTEGER`); } catch { /* exists */ }
    try { this.db.exec(`ALTER TABLE agents ADD COLUMN dashboard_visible INTEGER`); } catch { /* exists */ }
    try { this.db.exec(`ALTER TABLE agents ADD COLUMN state_max_bytes INTEGER`); } catch { /* exists */ }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
      CREATE INDEX IF NOT EXISTS idx_agents_schedule ON agents(schedule) WHERE schedule IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_agents_mcp ON agents(mcp) WHERE mcp = 1;
      CREATE INDEX IF NOT EXISTS idx_agents_starred ON agents(starred) WHERE starred = 1;
    `);
  }

  /**
   * Insert a new agent with its first version. Atomic — both rows or neither.
   * Throws if `agent.id` already exists (use `upsertAgent` for import paths).
   */
  createAgent(
    agent: Omit<Agent, 'version'>,
    createdBy: 'cli' | 'dashboard' | 'import',
    commitMessage?: string,
  ): Agent {
    const now = new Date().toISOString();
    const dag: AgentVersionDag = this.extractDag(agent);

    this.db.exec('BEGIN');
    try {
      this.db.prepare(`
        INSERT INTO agents (id, name, description, status, schedule, source, mcp,
                            current_version, created_at, updated_at,
                            pulse_visible, dashboard_visible, state_max_bytes)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
      `).run(
        agent.id, agent.name, agent.description ?? null,
        agent.status, agent.schedule ?? null, agent.source,
        agent.mcp ? 1 : 0, now, now,
        agent.pulseVisible === undefined ? null : (agent.pulseVisible ? 1 : 0),
        agent.dashboardVisible === undefined ? null : (agent.dashboardVisible ? 1 : 0),
        agent.stateMaxBytes ?? null,
      );
      this.db.prepare(`
        INSERT INTO agent_versions (agent_id, version, dag_json, created_at, created_by, commit_message)
        VALUES (?, 1, ?, ?, ?, ?)
      `).run(agent.id, JSON.stringify(dag), now, createdBy, commitMessage ?? null);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    return { ...agent, version: 1 };
  }

  /**
   * Create or replace an agent. Used by the v1 → v2 migration (the importer
   * reruns are idempotent) and `sua workflow import`. If the agent exists
   * and the incoming DAG differs from the current version, creates a new
   * version + advances current_version.
   */
  upsertAgent(
    agent: Omit<Agent, 'version'>,
    createdBy: 'cli' | 'dashboard' | 'import',
    commitMessage?: string,
  ): Agent {
    const existing = this.getAgent(agent.id);
    if (!existing) return this.createAgent(agent, createdBy, commitMessage);

    // Same DAG? Just update metadata; skip the new version row.
    const currentDagJson = this.getVersion(agent.id, existing.version)?.dag
      ? JSON.stringify(this.getVersion(agent.id, existing.version)!.dag)
      : '';
    const newDag = this.extractDag(agent);
    const newDagJson = JSON.stringify(newDag);
    if (currentDagJson === newDagJson) {
      this.updateAgentMeta(agent.id, {
        name: agent.name,
        description: agent.description,
        status: agent.status,
        schedule: agent.schedule,
        mcp: agent.mcp,
        source: agent.source,
        pulseVisible: agent.pulseVisible,
        dashboardVisible: agent.dashboardVisible,
        stateMaxBytes: agent.stateMaxBytes,
      });
      return { ...agent, version: existing.version };
    }

    return this.createNewVersion(agent.id, agent, createdBy, commitMessage);
  }

  getAgent(id: string): Agent | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const version = this.getVersion(id, row.current_version as number);
    if (!version) return null;
    return this.mergeRowWithVersion(row, version);
  }

  listAgents(filter?: { status?: AgentStatus; source?: AgentSource; mcp?: boolean }): Agent[] {
    const clauses: string[] = [];
    const values: SqlValue[] = [];
    if (filter?.status) { clauses.push('status = ?'); values.push(filter.status); }
    if (filter?.source) { clauses.push('source = ?'); values.push(filter.source); }
    if (filter?.mcp !== undefined) { clauses.push('mcp = ?'); values.push(filter.mcp ? 1 : 0); }
    const where = clauses.length > 0 ? 'WHERE ' + clauses.join(' AND ') : '';
    const rows = this.db.prepare(`SELECT * FROM agents ${where} ORDER BY starred DESC, name`).all(...values) as Record<string, unknown>[];
    const out: Agent[] = [];
    for (const row of rows) {
      const v = this.getVersion(row.id as string, row.current_version as number);
      if (v) out.push(this.mergeRowWithVersion(row, v));
    }
    return out;
  }

  /**
   * Update editable agent-level metadata. Does NOT bump the version — these
   * fields aren't part of the DAG shape. Use `createNewVersion` to record a
   * structural change.
   */
  updateAgentMeta(
    id: string,
    patch: Partial<Pick<Agent, 'name' | 'description' | 'status' | 'schedule' | 'mcp' | 'starred' | 'source' | 'pulseVisible' | 'dashboardVisible' | 'stateMaxBytes'>>,
  ): void {
    const fields: string[] = [];
    const values: SqlValue[] = [];
    if (patch.name !== undefined) { fields.push('name = ?'); values.push(patch.name); }
    if (patch.description !== undefined) { fields.push('description = ?'); values.push(patch.description ?? null); }
    if (patch.status !== undefined) { fields.push('status = ?'); values.push(patch.status); }
    if (patch.schedule !== undefined) { fields.push('schedule = ?'); values.push(patch.schedule ?? null); }
    if (patch.mcp !== undefined) { fields.push('mcp = ?'); values.push(patch.mcp ? 1 : 0); }
    if (patch.starred !== undefined) { fields.push('starred = ?'); values.push(patch.starred ? 1 : 0); }
    if (patch.source !== undefined) { fields.push('source = ?'); values.push(patch.source); }
    if (patch.pulseVisible !== undefined) { fields.push('pulse_visible = ?'); values.push(patch.pulseVisible ? 1 : 0); }
    if (patch.dashboardVisible !== undefined) { fields.push('dashboard_visible = ?'); values.push(patch.dashboardVisible ? 1 : 0); }
    if (patch.stateMaxBytes !== undefined) { fields.push('state_max_bytes = ?'); values.push(patch.stateMaxBytes); }
    if (fields.length === 0) return;
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    this.db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  /**
   * Record a new DAG version for an existing agent and advance
   * `current_version`. Atomic.
   */
  createNewVersion(
    id: string,
    agent: Omit<Agent, 'version'>,
    createdBy: 'cli' | 'dashboard' | 'import',
    commitMessage?: string,
  ): Agent {
    const existing = this.getAgent(id);
    if (!existing) {
      throw new Error(`Cannot create new version: agent "${id}" does not exist.`);
    }
    const now = new Date().toISOString();
    const nextVersion = existing.version + 1;
    const dag = this.extractDag(agent);

    this.db.exec('BEGIN');
    try {
      this.db.prepare(`
        INSERT INTO agent_versions (agent_id, version, dag_json, created_at, created_by, commit_message)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, nextVersion, JSON.stringify(dag), now, createdBy, commitMessage ?? null);
      this.updateAgentMeta(id, {
        name: agent.name,
        description: agent.description,
        status: agent.status,
        schedule: agent.schedule,
        mcp: agent.mcp,
        source: agent.source,
      });
      this.db.prepare(`UPDATE agents SET current_version = ?, updated_at = ? WHERE id = ?`).run(nextVersion, now, id);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    return { ...agent, version: nextVersion };
  }

  /** Rollback helper: move `current_version` to any existing version. */
  setCurrentVersion(id: string, version: number): void {
    const exists = this.db.prepare(
      `SELECT 1 FROM agent_versions WHERE agent_id = ? AND version = ?`,
    ).get(id, version);
    if (!exists) {
      throw new Error(`Agent "${id}" has no version ${version}.`);
    }
    this.db.prepare(
      `UPDATE agents SET current_version = ?, updated_at = ? WHERE id = ?`,
    ).run(version, new Date().toISOString(), id);
  }

  getVersion(agentId: string, version: number): AgentVersion | null {
    const row = this.db.prepare(
      `SELECT * FROM agent_versions WHERE agent_id = ? AND version = ?`,
    ).get(agentId, version) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToVersion(row);
  }

  listVersions(agentId: string): AgentVersion[] {
    const rows = this.db.prepare(
      `SELECT * FROM agent_versions WHERE agent_id = ? ORDER BY version DESC`,
    ).all(agentId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToVersion(r));
  }

  /**
   * Find all agents that invoke a given agent via `agent-invoke` nodes.
   * Scans all agents' current DAGs. Returns invoker agent id + the node
   * id that references the target. Used for deletion guards and "used by"
   * badges.
   */
  getAgentInvokers(targetAgentId: string): { agentId: string; nodeId: string }[] {
    const invokers: { agentId: string; nodeId: string }[] = [];
    for (const agent of this.listAgents()) {
      for (const node of agent.nodes) {
        if (node.type === 'agent-invoke' && node.agentInvokeConfig?.agentId === targetAgentId) {
          invokers.push({ agentId: agent.id, nodeId: node.id });
        }
        if (node.type === 'loop' && node.loopConfig?.agentId === targetAgentId) {
          invokers.push({ agentId: agent.id, nodeId: node.id });
        }
      }
    }
    return invokers;
  }

  /**
   * Hard delete an agent + every version + cascade to node_executions via
   * FK ON DELETE CASCADE on both agent_versions and node_executions-to-runs.
   * Use sparingly — `updateAgentMeta({ status: 'archived' })` is the usual
   * soft path. Refuses if other agents invoke this one.
   */
  deleteAgent(id: string): void {
    const invokers = this.getAgentInvokers(id);
    if (invokers.length > 0) {
      const refs = invokers.map((i) => `"${i.agentId}" (node "${i.nodeId}")`).join(', ');
      throw new Error(
        `Cannot delete "${id}" \u2014 invoked by ${refs}. Remove the agent-invoke node${invokers.length > 1 ? 's' : ''} first.`,
      );
    }
    this.db.prepare(`DELETE FROM agents WHERE id = ?`).run(id);
    // Cascade: remove the agent's persistent state directory if it exists.
    // Idempotent — no-op when the dir was never created.
    try {
      removeStateDir(id, this.dataRoot);
    } catch {
      // Defense-in-depth: a malformed id would have failed the DELETE above,
      // and removeStateDir's regex check would also reject it. Swallow any
      // residual failure here so a successful delete doesn't roll back.
    }
  }

  close(): void {
    if (this.ownsConnection) {
      this.db.close();
    }
  }

  // -- helpers --

  private extractDag(agent: Omit<Agent, 'version'>): AgentVersionDag {
    // Only versioned parts of the shape. Agent-level metadata (name,
    // description, status, schedule, mcp, source) lives on the `agents`
    // row and can change without bumping the version.
    const dag: AgentVersionDag = {
      id: agent.id,
      nodes: agent.nodes.map(cloneNode),
    };
    if (agent.provider) dag.provider = agent.provider;
    if (agent.model) dag.model = agent.model;
    if (agent.inputs) dag.inputs = agent.inputs;
    if (agent.outputs) dag.outputs = agent.outputs;
    if (agent.signal) dag.signal = agent.signal;
    if (agent.outputWidget) dag.outputWidget = agent.outputWidget;
    if (agent.notify) dag.notify = agent.notify;
    if (agent.author !== undefined) dag.author = agent.author;
    if (agent.tags) dag.tags = agent.tags;
    return dag;
  }

  private rowToVersion(row: Record<string, unknown>): AgentVersion {
    return {
      agentId: row.agent_id as string,
      version: row.version as number,
      dag: JSON.parse(row.dag_json as string) as AgentVersionDag,
      createdAt: row.created_at as string,
      createdBy: row.created_by as AgentVersion['createdBy'],
      commitMessage: (row.commit_message as string | null) ?? undefined,
    };
  }

  private mergeRowWithVersion(
    row: Record<string, unknown>,
    version: AgentVersion,
  ): Agent {
    const dag = version.dag;
    const agent: Agent = {
      id: row.id as string,
      name: row.name as string,
      description: ((row.description as string | null) ?? undefined) as string | undefined,
      status: row.status as AgentStatus,
      schedule: ((row.schedule as string | null) ?? undefined) as string | undefined,
      source: row.source as AgentSource,
      mcp: (row.mcp as number) === 1,
      starred: (row.starred as number) === 1,
      pulseVisible: row.pulse_visible == null ? undefined : (row.pulse_visible as number) === 1,
      dashboardVisible: row.dashboard_visible == null ? undefined : (row.dashboard_visible as number) === 1,
      stateMaxBytes: row.state_max_bytes == null ? undefined : (row.state_max_bytes as number),
      version: row.current_version as number,
      provider: dag.provider,
      model: dag.model,
      inputs: dag.inputs,
      outputs: dag.outputs,
      nodes: dag.nodes,
      signal: dag.signal,
      outputWidget: dag.outputWidget,
      notify: dag.notify,
      author: dag.author,
      tags: dag.tags,
    };
    agent.capabilities = deriveCapabilities(agent);
    return agent;
  }
}

function cloneNode(n: AgentNode): AgentNode {
  return JSON.parse(JSON.stringify(n)) as AgentNode;
}
