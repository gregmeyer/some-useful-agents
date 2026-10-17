import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

/**
 * What an agent is for, in the catalog: the group it sits in ("Jobs &
 * companies") and one plain line on what to use it for ("Find open roles at a
 * company on Ashby"). Written by the `agent-catalog-sorter` system agent
 * (dashboard lib/agent-catalog-sort.ts) and read by the /agents page.
 *
 * Kept apart from the versioned agent definition: sorting is sua's reading of
 * the agent, not the author's, and re-sorting must never bump a version. Each
 * row remembers the `agentKey` it was sorted from, so an agent whose name,
 * description, tags, questions or version changed is sorted again.
 */
export interface AgentCatalogEntry {
  agentId: string;
  group: string;
  useFor?: string;
  agentKey: string;
  sortedAt: string;
}

/** The fields an agent is sorted from. */
export interface SortableAgent {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  sampleQuestions?: string[];
  version?: number;
}

/** A short fingerprint of what the sorter reads, so a changed agent is sorted again. */
export function agentCatalogKey(a: SortableAgent): string {
  const text = JSON.stringify([a.version ?? 0, a.name, a.description ?? '', a.tags ?? [], a.sampleQuestions ?? []]);
  return createHash('sha1').update(text).digest('hex').slice(0, 16);
}

/** How long a failed sort waits before it's tried again. */
export const CATALOG_RETRY_MS = 10 * 60 * 1000;

export class AgentCatalogStore {
  private constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_catalog (
        agent_id TEXT PRIMARY KEY,
        group_name TEXT,
        use_for TEXT,
        agent_key TEXT NOT NULL,
        sorted_at TEXT NOT NULL,
        failed_at TEXT
      )
    `);
  }

  static fromHandle(db: DatabaseSync): AgentCatalogStore {
    return new AgentCatalogStore(db);
  }

  /** Every sorted agent, by id (failed-only rows left out). */
  all(): Map<string, AgentCatalogEntry> {
    const rows = this.db.prepare(
      'SELECT agent_id, group_name, use_for, agent_key, sorted_at FROM agent_catalog WHERE group_name IS NOT NULL',
    ).all() as Array<Record<string, string | null>>;
    return new Map(rows.map((r) => [r.agent_id as string, {
      agentId: r.agent_id as string,
      group: r.group_name as string,
      ...(r.use_for ? { useFor: r.use_for } : {}),
      agentKey: r.agent_key as string,
      sortedAt: r.sorted_at as string,
    }]));
  }

  /** The group names in use, most agents first. */
  groups(): string[] {
    const rows = this.db.prepare(
      'SELECT group_name, COUNT(*) AS n FROM agent_catalog WHERE group_name IS NOT NULL GROUP BY group_name ORDER BY n DESC, group_name',
    ).all() as Array<{ group_name: string }>;
    return rows.map((r) => r.group_name);
  }

  /** Keep the sorter's answer for these agents. */
  save(entries: ReadonlyArray<{ agent: SortableAgent; group: string; useFor?: string }>, now = new Date()): void {
    const stmt = this.db.prepare(`
      INSERT INTO agent_catalog (agent_id, group_name, use_for, agent_key, sorted_at, failed_at)
      VALUES (?, ?, ?, ?, ?, NULL)
      ON CONFLICT(agent_id) DO UPDATE SET group_name = excluded.group_name, use_for = excluded.use_for,
        agent_key = excluded.agent_key, sorted_at = excluded.sorted_at, failed_at = NULL
    `);
    for (const e of entries) stmt.run(e.agent.id, e.group, e.useFor ?? null, agentCatalogKey(e.agent), now.toISOString());
  }

  /** The sorter didn't answer for these: try again after CATALOG_RETRY_MS (an earlier group is kept). */
  markFailed(agents: readonly SortableAgent[], now = new Date()): void {
    const stmt = this.db.prepare(`
      INSERT INTO agent_catalog (agent_id, group_name, use_for, agent_key, sorted_at, failed_at)
      VALUES (?, NULL, NULL, '', ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET failed_at = excluded.failed_at
    `);
    for (const a of agents) stmt.run(a.id, now.toISOString(), now.toISOString());
  }

  /** The agents that need sorting: never sorted, or changed since — skipping a recent failure. */
  stale<T extends SortableAgent>(agents: readonly T[], now = Date.now()): T[] {
    const rows = this.db.prepare('SELECT agent_id, agent_key, failed_at FROM agent_catalog')
      .all() as Array<{ agent_id: string; agent_key: string; failed_at: string | null }>;
    const byId = new Map(rows.map((r) => [r.agent_id, r]));
    return agents.filter((a) => {
      const row = byId.get(a.id);
      if (row?.failed_at && now - Date.parse(row.failed_at) < CATALOG_RETRY_MS) return false;
      return !row || row.agent_key !== agentCatalogKey(a);
    });
  }
}
