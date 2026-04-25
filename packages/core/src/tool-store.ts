import { DatabaseSync } from 'node:sqlite';
import type { ToolDefinition, ToolSource } from './tool-types.js';
import type { McpServerConfig, McpTransport } from './mcp-server-types.js';

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
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        transport   TEXT NOT NULL,
        command     TEXT,
        args_json   TEXT,
        env_json    TEXT,
        url         TEXT,
        enabled     INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      )
    `);
    // Additive migration: link tools to their source MCP server. Null for
    // non-MCP tools or legacy MCP tools that predate this column.
    try {
      this.db.exec(`ALTER TABLE tools ADD COLUMN mcp_server_id TEXT`);
    } catch {
      // Column already exists.
    }
  }

  createTool(tool: ToolDefinition, yamlText?: string, mcpServerId?: string): ToolDefinition {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO tools (id, name, description, source, inputs_json, outputs_json, implementation_json, yaml_text, mcp_server_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tool.id,
      tool.name,
      tool.description ?? null,
      tool.source,
      JSON.stringify(tool.inputs),
      JSON.stringify(tool.outputs),
      JSON.stringify(tool.implementation),
      yamlText ?? null,
      mcpServerId ?? null,
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

  upsertTool(tool: ToolDefinition, yamlText?: string, mcpServerId?: string): ToolDefinition {
    const existing = this.getTool(tool.id);
    if (existing) return this.updateTool(tool, yamlText);
    return this.createTool(tool, yamlText, mcpServerId);
  }

  getTool(id: string): ToolDefinition | undefined {
    const row = this.db.prepare('SELECT * FROM tools WHERE id = ?').get(id) as unknown as ToolRow | undefined;
    if (!row) return undefined;
    return rowToTool(row);
  }

  getToolServerId(id: string): string | undefined {
    const row = this.db.prepare('SELECT mcp_server_id FROM tools WHERE id = ?').get(id) as unknown as { mcp_server_id: string | null } | undefined;
    return row?.mcp_server_id ?? undefined;
  }

  listTools(): ToolDefinition[] {
    const rows = this.db.prepare('SELECT * FROM tools ORDER BY id').all() as unknown as ToolRow[];
    return rows.map(rowToTool);
  }

  listToolsByServer(serverId: string): ToolDefinition[] {
    const rows = this.db.prepare('SELECT * FROM tools WHERE mcp_server_id = ? ORDER BY id').all(serverId) as unknown as ToolRow[];
    return rows.map(rowToTool);
  }

  deleteTool(id: string): boolean {
    const result = this.db.prepare('DELETE FROM tools WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // --- MCP server CRUD ---

  createMcpServer(server: McpServerConfig): McpServerConfig {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO mcp_servers (id, name, transport, command, args_json, env_json, url, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      server.id,
      server.name,
      server.transport,
      server.command ?? null,
      server.args ? JSON.stringify(server.args) : null,
      server.env ? JSON.stringify(server.env) : null,
      server.url ?? null,
      server.enabled ? 1 : 0,
      now,
      now,
    );
    return { ...server, createdAt: now, updatedAt: now };
  }

  updateMcpServer(server: McpServerConfig): McpServerConfig {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE mcp_servers SET name = ?, transport = ?, command = ?, args_json = ?, env_json = ?, url = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(
      server.name,
      server.transport,
      server.command ?? null,
      server.args ? JSON.stringify(server.args) : null,
      server.env ? JSON.stringify(server.env) : null,
      server.url ?? null,
      server.enabled ? 1 : 0,
      now,
      server.id,
    );
    return { ...server, updatedAt: now };
  }

  upsertMcpServer(server: McpServerConfig): McpServerConfig {
    return this.getMcpServer(server.id) ? this.updateMcpServer(server) : this.createMcpServer(server);
  }

  getMcpServer(id: string): McpServerConfig | undefined {
    const row = this.db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as unknown as McpServerRow | undefined;
    return row ? rowToMcpServer(row) : undefined;
  }

  listMcpServers(): McpServerConfig[] {
    const rows = this.db.prepare('SELECT * FROM mcp_servers ORDER BY id').all() as unknown as McpServerRow[];
    return rows.map(rowToMcpServer);
  }

  setMcpServerEnabled(id: string, enabled: boolean): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare('UPDATE mcp_servers SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, now, id);
    return result.changes > 0;
  }

  /** Delete a server and cascade-delete all tools imported from it. */
  deleteMcpServer(id: string): { serverDeleted: boolean; toolsDeleted: number } {
    const toolsResult = this.db.prepare('DELETE FROM tools WHERE mcp_server_id = ?').run(id);
    const serverResult = this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
    return {
      serverDeleted: serverResult.changes > 0,
      toolsDeleted: Number(toolsResult.changes),
    };
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
  mcp_server_id: string | null;
  created_at: string;
  updated_at: string;
}

interface McpServerRow {
  id: string;
  name: string;
  transport: string;
  command: string | null;
  args_json: string | null;
  env_json: string | null;
  url: string | null;
  enabled: number;
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

function rowToMcpServer(row: McpServerRow): McpServerConfig {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport as McpTransport,
    command: row.command ?? undefined,
    args: row.args_json ? JSON.parse(row.args_json) : undefined,
    env: row.env_json ? JSON.parse(row.env_json) : undefined,
    url: row.url ?? undefined,
    enabled: row.enabled !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
