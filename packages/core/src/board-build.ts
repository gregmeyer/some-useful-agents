/**
 * Build a board from a request (docs/boards.md § Build a board): the plan the
 * board-builder agent returns, turning it into a canvas document, and a small
 * store that tracks each build (so the board page can show progress and the
 * inbox can say when it's done).
 */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { openStoreDb } from './sqlite-open.js';
import { applyBoardOps, type BoardOp } from './board-tree.js';
import type { BoardDoc } from './boards.js';

const AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,127}$/;

export const boardBuildPlanSchema = z.object({
  name: z.string().trim().min(1).max(60),
  summary: z.string().trim().max(400).default(''),
  layout: z.enum(['sections', 'tabs']).default('sections'),
  sections: z.array(z.object({
    title: z.string().trim().min(1).max(80),
    tiles: z.array(z.object({
      agentId: z.string().regex(AGENT_ID),
      span: z.number().int().min(1).max(3).optional(),
    })).max(24),
  })).max(8),
  missing: z.array(z.object({
    purpose: z.string().trim().min(1).max(200),
    suggestedName: z.string().regex(AGENT_ID).optional(),
  })).max(10).default([]),
});
export type BoardBuildPlan = z.infer<typeof boardBuildPlanSchema>;

/**
 * The plan as a canvas document. Tiles for agents `known` rejects (not
 * installed, or no tile) are dropped and reported; each agent appears once;
 * empty sections are left out. "tabs" puts each section in a tab of one Tabs.
 */
export function boardDocFromBuildPlan(plan: BoardBuildPlan, known: (agentId: string) => boolean): { doc: BoardDoc; dropped: string[]; placed: string[] } {
  const dropped: string[] = [];
  const placed: string[] = [];
  const seen = new Set<string>();
  const sections = plan.sections
    .map((s) => ({
      title: s.title,
      tiles: s.tiles.filter((t) => {
        if (seen.has(t.agentId)) return false;
        if (!known(t.agentId)) { dropped.push(t.agentId); return false; }
        seen.add(t.agentId);
        placed.push(t.agentId);
        return true;
      }),
    }))
    .filter((s) => s.tiles.length > 0);
  let doc: BoardDoc = { components: [{ id: 'root', component: 'Column', children: [] }] };
  if (sections.length === 0) return { doc, dropped, placed };
  // Build each section, then its tiles, with the same tree operations as the editor.
  let parent = 'root';
  if (plan.layout === 'tabs') {
    const out = applyBoardOps(doc, [{ op: 'insert', parent: 'root', node: { type: 'tabs', title: sections[0].title } }]);
    doc = out.doc;
    parent = out.created[0];
  }
  sections.forEach((s, i) => {
    const ops: BoardOp[] = [];
    if (plan.layout === 'tabs') {
      // The tabs start with one tab (holding a grid); later sections are new tabs, each a grid.
      if (i > 0) ops.push({ op: 'insert', parent, node: { type: 'grid' } });
    } else {
      ops.push({ op: 'insert', parent: 'root', node: { type: 'section', title: s.title } });
    }
    let out = ops.length ? applyBoardOps(doc, ops) : { doc, created: [] as string[] };
    doc = out.doc;
    const tabs = plan.layout === 'tabs' ? doc.components.find((c) => c.id === parent)! : undefined;
    const grid = plan.layout === 'tabs'
      ? (tabs!.tabs as Array<{ title: string; child: string }>)[i].child
      : (doc.components.find((c) => c.id === out.created[0])!.child as string);
    out = applyBoardOps(doc, [
      ...(plan.layout === 'tabs' && i > 0 ? [{ op: 'set' as const, id: parent, props: { tabTitles: [...(tabs!.tabs as Array<{ title: string }>).map((t) => t.title).slice(0, i), s.title] } }] : []),
      ...s.tiles.map((t) => ({ op: 'insert' as const, parent: grid, node: { type: 'tile' as const, agentId: t.agentId } })),
    ]);
    doc = out.doc;
    const spans: BoardOp[] = s.tiles.flatMap((t, k) => (t.span && t.span > 1 ? [{ op: 'span' as const, id: out.created[k], span: t.span }] : []));
    if (spans.length) doc = applyBoardOps(doc, spans).doc;
  });
  return { doc, dropped, placed };
}

/** Pull the plan out of the agent's reply: `<plan>{…}</plan>`, else the whole text. */
export function extractBoardBuildPlan(text: string): { ok: true; plan: BoardBuildPlan } | { ok: false; error: string } {
  const tagged = /<plan>([\s\S]*?)<\/plan>/i.exec(text);
  const raw = (tagged?.[1] ?? text).trim().replace(/^```(?:json)?\s*|```$/g, '');
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return { ok: false, error: 'The board builder didn\'t return a plan.' }; }
  const v = boardBuildPlanSchema.safeParse(json);
  return v.success ? { ok: true, plan: v.data } : { ok: false, error: `The board builder's plan wasn't usable: ${v.error.issues[0]?.path.join('.')}: ${v.error.issues[0]?.message}` };
}

// ── Builds ───────────────────────────────────────────────────────────────

export type BoardBuildPhase = 'planning' | 'arranging' | 'running' | 'drafting' | 'done' | 'failed';

export interface BoardBuild {
  id: string;
  boardId: string;
  request: string;
  phase: BoardBuildPhase;
  /** One line for the board page ("Running 4 tiles…"). */
  detail: string;
  error?: string;
  /** Agents placed, agents whose first run failed, parts no agent covers. */
  placed: string[];
  failed: string[];
  missing: Array<{ purpose: string; suggestedName?: string }>;
  /** Agents drafted for the missing parts (saved with status "draft" until approved). */
  drafts: Array<{ purpose: string; ok: boolean; id?: string; name?: string; hasTile?: boolean; error?: string }>;
  /** The one approval for the drafts: pending (asked in the inbox), approved, declined. */
  approval?: 'pending' | 'approved' | 'declined';
  approvalMessageId?: string;
  plannerRunId?: string;
  createdAt: number;
  updatedAt: number;
}

export class BoardBuildStore {
  private db: DatabaseSync;
  private readonly ownsConnection: boolean;
  constructor(dbPathOrHandle: string | DatabaseSync) {
    if (typeof dbPathOrHandle === 'string') { this.db = openStoreDb(dbPathOrHandle); this.ownsConnection = true; } else { this.db = dbPathOrHandle; this.ownsConnection = false; }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS board_builds (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        request TEXT NOT NULL,
        phase TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        error TEXT,
        result_json TEXT NOT NULL DEFAULT '{}',
        planner_run_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS board_builds_board ON board_builds (board_id, created_at DESC);
    `);
  }
  create(boardId: string, request: string): BoardBuild {
    const now = Date.now();
    const id = randomUUID();
    this.db.prepare('INSERT INTO board_builds (id, board_id, request, phase, detail, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, boardId, request, 'planning', 'Choosing agents for this board…', now, now);
    return this.get(id)!;
  }
  update(id: string, patch: Partial<Pick<BoardBuild, 'phase' | 'detail' | 'error' | 'placed' | 'failed' | 'missing' | 'drafts' | 'approval' | 'approvalMessageId' | 'plannerRunId'>>): void {
    const cur = this.get(id);
    if (!cur) return;
    const next = { ...cur, ...patch };
    this.db.prepare('UPDATE board_builds SET phase = ?, detail = ?, error = ?, result_json = ?, planner_run_id = ?, updated_at = ? WHERE id = ?')
      .run(next.phase, next.detail, next.error ?? null, JSON.stringify({ placed: next.placed, failed: next.failed, missing: next.missing, drafts: next.drafts, approval: next.approval, approvalMessageId: next.approvalMessageId }), next.plannerRunId ?? null, Date.now(), id);
  }
  get(id: string): BoardBuild | undefined {
    const r = this.db.prepare('SELECT * FROM board_builds WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? this.row(r) : undefined;
  }
  /** The latest build of a board. */
  latestFor(boardId: string): BoardBuild | undefined {
    const r = this.db.prepare('SELECT * FROM board_builds WHERE board_id = ? ORDER BY created_at DESC LIMIT 1').get(boardId) as Record<string, unknown> | undefined;
    return r ? this.row(r) : undefined;
  }
  /** Builds a restart interrupted (still planning/arranging/running). */
  unfinished(): BoardBuild[] {
    return (this.db.prepare("SELECT * FROM board_builds WHERE phase IN ('planning','arranging','running','drafting')").all() as Array<Record<string, unknown>>).map((r) => this.row(r));
  }
  private row(r: Record<string, unknown>): BoardBuild {
    let res: { placed?: string[]; failed?: string[]; missing?: BoardBuild['missing']; drafts?: BoardBuild['drafts']; approval?: BoardBuild['approval']; approvalMessageId?: string } = {};
    try { res = JSON.parse(String(r.result_json ?? '{}')); } catch { res = {}; }
    return {
      id: String(r.id), boardId: String(r.board_id), request: String(r.request), phase: r.phase as BoardBuildPhase,
      detail: String(r.detail ?? ''), ...(r.error ? { error: String(r.error) } : {}),
      placed: res.placed ?? [], failed: res.failed ?? [], missing: res.missing ?? [], drafts: res.drafts ?? [],
      ...(res.approval ? { approval: res.approval } : {}), ...(res.approvalMessageId ? { approvalMessageId: res.approvalMessageId } : {}),
      ...(r.planner_run_id ? { plannerRunId: String(r.planner_run_id) } : {}),
      createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
    };
  }
  close(): void { if (this.ownsConnection) this.db.close(); }
}
