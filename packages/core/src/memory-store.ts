/**
 * Agent memory: short notes an agent keeps across runs. Per agent — one agent
 * never sees another's memories (they share by calling each other as tools).
 * See docs/memory.md and ADR-0038.
 *
 * Two ways in, both opt-in via the agent's `memory:` field:
 * - Auto-recall: at the start of a run the executor puts the pinned memories
 *   and the ones most relevant to the run (token overlap, the same scoring
 *   the build planner's memory uses) in a small capped block the model sees.
 * - Tools: `memory-save`, `memory-search`, `memory-forget`, scoped to the
 *   calling agent by the executor (no agent-id argument to spoof).
 *
 * Text is redacted on save (known secret prefixes + the node's own secret
 * values), so a secret the agent handled doesn't become a lasting note.
 */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { openStoreDb } from './sqlite-open.js';
import { tokeniseGoal } from './planner-loop/memory-store.js';
import { jaccard } from './planner-loop/memory-retrieval.js';
import { redactKnownSecrets } from './secret-redactor.js';
import { takeWithinBudget } from './transcript.js';

export const MEMORY_TEXT_MAX_CHARS = 2000;
export const MEMORY_MAX_PER_AGENT = 500;
export const MEMORY_RECALL_DEFAULT = 5;
export const MEMORY_RECALL_MAX = 20;
export const MEMORY_RECALL_BLOCK_MAX_BYTES = 3 * 1024;

export interface Memory {
  id: string;
  agentId: string;
  text: string;
  tags: string[];
  pinned: boolean;
  sourceRunId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Replace any occurrence of a secret value (≥ 6 chars) and known key prefixes. */
export function redactMemoryText(text: string, secretValues: readonly string[] = []): string {
  let out = redactKnownSecrets(text);
  for (const v of secretValues) {
    if (v && v.length >= 6) out = out.split(v).join('[REDACTED]');
  }
  return out;
}

export class MemoryStore {
  private db: DatabaseSync;
  private readonly ownsConnection: boolean;

  constructor(dbPath: string) {
    this.db = openStoreDb(dbPath);
    this.ownsConnection = true;
    this.ensureSchema();
  }

  static fromHandle(db: DatabaseSync): MemoryStore {
    const store = Object.create(MemoryStore.prototype) as MemoryStore;
    (store as unknown as { db: DatabaseSync }).db = db;
    (store as unknown as { ownsConnection: boolean }).ownsConnection = false;
    store.ensureSchema();
    return store;
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        text TEXT NOT NULL,
        tokens TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        pinned INTEGER NOT NULL DEFAULT 0,
        source_run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id, updated_at DESC);
    `);
  }

  /** Save a memory. Text is redacted and capped; the oldest unpinned are pruned past the per-agent cap. */
  save(input: { agentId: string; text: string; tags?: string[]; pinned?: boolean; sourceRunId?: string; secretValues?: readonly string[] }): Memory {
    const text = redactMemoryText(input.text.trim(), input.secretValues).slice(0, MEMORY_TEXT_MAX_CHARS);
    if (!text) throw new Error('A memory needs some text.');
    const now = new Date().toISOString();
    const id = randomUUID().slice(0, 8);
    const tags = [...new Set((input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 10);
    this.db.prepare(`
      INSERT INTO memories (id, agent_id, text, tokens, tags_json, pinned, source_run_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.agentId, text, JSON.stringify(tokeniseGoal(`${text} ${tags.join(' ')}`)), JSON.stringify(tags),
      input.pinned ? 1 : 0, input.sourceRunId ?? null, now, now);
    this.prune(input.agentId);
    return this.get(input.agentId, id)!;
  }

  get(agentId: string, id: string): Memory | undefined {
    const row = this.db.prepare('SELECT * FROM memories WHERE agent_id = ? AND id = ?').get(agentId, id) as Record<string, unknown> | undefined;
    return row ? toMemory(row) : undefined;
  }

  /** Newest first. */
  list(agentId: string, limit = 100): Memory[] {
    const rows = this.db.prepare('SELECT * FROM memories WHERE agent_id = ? ORDER BY pinned DESC, updated_at DESC LIMIT ?').all(agentId, limit) as Record<string, unknown>[];
    return rows.map(toMemory);
  }

  /** Memories most relevant to `query`, best first (pinned are NOT forced in — see recall). */
  search(agentId: string, query: string, limit = MEMORY_RECALL_DEFAULT): Memory[] {
    const q = new Set(tokeniseGoal(query));
    const rows = this.db.prepare('SELECT * FROM memories WHERE agent_id = ?').all(agentId) as Record<string, unknown>[];
    return rows
      .map((r) => ({ m: toMemory(r), score: jaccard(q, new Set(JSON.parse(String(r.tokens)) as string[])) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.m.updatedAt.localeCompare(a.m.updatedAt))
      .slice(0, limit)
      .map((x) => x.m);
  }

  /** What a run starts with: all pinned, then the top-k relevant unpinned. */
  recall(agentId: string, query: string, k = MEMORY_RECALL_DEFAULT): Memory[] {
    const pinned = (this.db.prepare('SELECT * FROM memories WHERE agent_id = ? AND pinned = 1 ORDER BY updated_at DESC').all(agentId) as Record<string, unknown>[]).map(toMemory);
    const relevant = this.search(agentId, query, k + pinned.length).filter((m) => !m.pinned).slice(0, k);
    return [...pinned, ...relevant];
  }

  forget(agentId: string, id: string): boolean {
    return Number(this.db.prepare('DELETE FROM memories WHERE agent_id = ? AND id = ?').run(agentId, id).changes ?? 0) > 0;
  }

  setPinned(agentId: string, id: string, pinned: boolean): boolean {
    return Number(this.db.prepare('UPDATE memories SET pinned = ?, updated_at = ? WHERE agent_id = ? AND id = ?')
      .run(pinned ? 1 : 0, new Date().toISOString(), agentId, id).changes ?? 0) > 0;
  }

  forgetAll(agentId: string): number {
    return Number(this.db.prepare('DELETE FROM memories WHERE agent_id = ?').run(agentId).changes ?? 0);
  }

  private prune(agentId: string): void {
    this.db.prepare(`
      DELETE FROM memories WHERE agent_id = ? AND pinned = 0 AND id IN (
        SELECT id FROM memories WHERE agent_id = ? AND pinned = 0
        ORDER BY updated_at DESC LIMIT -1 OFFSET ?
      )
    `).run(agentId, agentId, MEMORY_MAX_PER_AGENT);
  }

  close(): void {
    if (this.ownsConnection) this.db.close();
  }
}

function toMemory(r: Record<string, unknown>): Memory {
  return {
    id: String(r.id),
    agentId: String(r.agent_id),
    text: String(r.text),
    tags: JSON.parse(String(r.tags_json ?? '[]')) as string[],
    pinned: Number(r.pinned) === 1,
    sourceRunId: (r.source_run_id as string | null) ?? undefined,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

/**
 * The block a run starts with. Plain text (never template-expanded — it's
 * prepended after substitution, like the behavior preamble), capped at
 * MEMORY_RECALL_BLOCK_MAX_BYTES, dropping the least relevant first.
 */
export function formatRecallBlock(memories: readonly Memory[]): { text: string; ids: string[] } {
  if (memories.length === 0) return { text: '', ids: [] };
  const header = 'WHAT YOU REMEMBER (from earlier runs of this agent — use it, and keep it current with memory-save / memory-forget):';
  const lines = takeWithinBudget(
    memories.map((m) => `- [${m.id}]${m.pinned ? ' (pinned)' : ''} ${m.text.replace(/\s+/g, ' ')}`),
    MEMORY_RECALL_BLOCK_MAX_BYTES - Buffer.byteLength(header),
  );
  if (lines.length === 0) return { text: '', ids: [] };
  return { text: `${header}\n${lines.join('\n')}\n`, ids: memories.slice(0, lines.length).map((m) => m.id) };
}

/** An agent's memory setting, normalised: off, or on with a recall count. */
export function memorySettings(agent: { memory?: boolean | { recall?: number } }): { enabled: boolean; recall: number } {
  const m = agent.memory;
  if (!m) return { enabled: false, recall: 0 };
  if (m === true) return { enabled: true, recall: MEMORY_RECALL_DEFAULT };
  return { enabled: true, recall: Math.min(m.recall ?? MEMORY_RECALL_DEFAULT, MEMORY_RECALL_MAX) };
}

/** The memory tools an agent with memory on gets offered on its llm / goal nodes. */
export const MEMORY_TOOL_IDS = ['memory-save', 'memory-search', 'memory-forget'] as const;
