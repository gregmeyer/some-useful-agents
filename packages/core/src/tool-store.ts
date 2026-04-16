import { DatabaseSync } from 'node:sqlite';
import type { ToolDefinition, ToolSource } from './tool-types.js';

/**
 * Persistent store for tool definitions. Mirrors the agent-store pattern:
 * single SQLite table, idempotent schema creation, simple CRUD.
 *
 * Tool versioning is deferred to v0.18 — editing a tool is destructive
 * (overwrite). The CHANGELOG documents this so early adopters don't
 * assume git-style history.
 */
export class ToolStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.ensureSchema();
  }

  static fromHandle(db: DatabaseSync): ToolStore {
    const store = Object.create(ToolStore.prototype) as ToolStore;
    (store as unknown as { db: DatabaseSync }).db = db;
    store.ensureSchema();
    return store;
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tools (
        id               TEXT PRIMARY KEY,
        name             TEXT NOT NULL,
        description      TEXT,
        source           TEXT NOT NULL DEFAULT 'local',
        inputs_json      TEXT NOT NULL DEFAULT '{}',
        outputs_json     TEXT NOT NULL DEFAULT '{}',
        implementation_json TEXT NOT NULL,
        yaml_text        TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      )
    `);
  }

  createTool(tool: ToolDefinition, yamlText?: string): ToolDefinition {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO tools (id, name, description, source, inputs_json, outputs_json, implementation_json, yaml_text, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tool.id,
      tool.name,
      tool.description ?? null,
      tool.source,
      JSON.stringify(tool.inputs),
      JSON.stringify(tool.outputs),
      JSON.stringify(tool.implementation),
      yamlText ?? null,
      now,
      now,
    );
    return { ...tool, createdAt: now, updatedAt: now };
  }

  updateTool(tool: ToolDefinition, yamlText?: string): ToolDefinition {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE tools SET name = ?, description = ?, source = ?, inputs_json = ?, outputs_json = ?,
        implementation_json = ?, yaml_text = ?, updated_at = ?
      WHERE id = ?
    `).run(
      tool.name,
      tool.description ?? null,
      tool.source,
      JSON.stringify(tool.inputs),
      JSON.stringify(tool.outputs),
      JSON.stringify(tool.implementation),
      yamlText ?? null,
      now,
      tool.id,
    );
    return { ...tool, updatedAt: now };
  }

  upsertTool(tool: ToolDefinition, yamlText?: string): ToolDefinition {
    const existing = this.getTool(tool.id);
    if (existing) return this.updateTool(tool, yamlText);
    return this.createTool(tool, yamlText);
  }

  getTool(id: string): ToolDefinition | undefined {
    const row = this.db.prepare('SELECT * FROM tools WHERE id = ?').get(id) as unknown as ToolRow | undefined;
    if (!row) return undefined;
    return rowToTool(row);
  }

  listTools(): ToolDefinition[] {
    const rows = this.db.prepare('SELECT * FROM tools ORDER BY id').all() as unknown as ToolRow[];
    return rows.map(rowToTool);
  }

  deleteTool(id: string): boolean {
    const result = this.db.prepare('DELETE FROM tools WHERE id = ?').run(id);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}

interface ToolRow {
  id: string;
  name: string;
  description: string | null;
  source: string;
  inputs_json: string;
  outputs_json: string;
  implementation_json: string;
  yaml_text: string | null;
  created_at: string;
  updated_at: string;
}

function rowToTool(row: ToolRow): ToolDefinition {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    source: row.source as ToolSource,
    inputs: JSON.parse(row.inputs_json),
    outputs: JSON.parse(row.outputs_json),
    implementation: JSON.parse(row.implementation_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
