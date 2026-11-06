/**
 * Each example board still gets a page that fits it. For every example
 * (lib/board-page-examples.ts), with the page agent's recorded answer
 * (fixtures/board-pages/answers.json): the right kind of page, every part
 * bound to a field its agent has, a page that draws with the board's data
 * with no empty part, and the editorial rhythm kept.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStore, RunStore, BoardsStore, gridDoc, pageRhythm, resolveBoardLayout, validateBoardDoc, boardFlagAgent, type Agent, type AgentSignal } from '@some-useful-agents/core';
import { BOARD_PAGE_EXAMPLES, type BoardPageExample } from './board-page-examples.js';
import { drawBoardPage, type DrawnBoardPage } from './board-page.js';
import { boardAgentShape, boardPageData } from './board-widgets.js';
import { buildPulseTile, withTileSignal } from '../views/pulse-tile-builder.js';
import type { PulseTile } from '../views/pulse-types.js';

const ANSWERS = JSON.parse(readFileSync(new URL('./fixtures/board-pages/answers.json', import.meta.url), 'utf8')) as Record<string, { replies: string[] }>;

let dir: string | undefined;
let runs: RunStore | undefined;
let agents: AgentStore | undefined;
afterEach(() => { try { runs?.close(); agents?.close(); } catch { /* ignore */ } if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });

async function decided(ex: BoardPageExample): Promise<{ drawn: DrawnBoardPage; tiles: Map<string, PulseTile> }> {
  dir = mkdtempSync(join(tmpdir(), 'sua-bpx-'));
  const dbPath = join(dir, 'runs.db');
  runs = new RunStore(dbPath);
  agents = new AgentStore(dbPath);
  const ids = ex.seed(agents, runs);
  new BoardsStore(dbPath).saveDoc({ id: `user:${ex.id}`, name: ex.name, doc: { components: gridDoc(ids.map((id) => ({ id }))) } });
  const tiles = new Map(ids.map((id) => [id, buildPulseTile(withTileSignal(agents!.getAgent(id)) as Agent & { signal: AgentSignal }, { runStore: runs! })]));
  const shapes = ids.map((id) => boardAgentShape(tiles.get(id)!, runs!));
  const replies = [...(ANSWERS[ex.id]?.replies ?? [])];
  const drawn = await drawBoardPage({ name: ex.name }, shapes, async () => replies.shift(), { about: ex.about });
  return { drawn, tiles };
}

describe.each(BOARD_PAGE_EXAMPLES)('$id: $name', (ex) => {
  it('gets the page it should, on the first try', async () => {
    const { drawn } = await decided(ex);
    expect('error' in drawn.answer ? drawn.answer.error : '').toBe('');
    expect(drawn.tries).toBe(1);
    const a = drawn.answer;
    if (ex.expect.page === 'drawn') expect('preset' in a).toBe(false);
    else expect('preset' in a && a.preset).toBe(ex.expect.page);
  });

  it('binds only to fields its agents have, reads well, and draws with no empty part', async () => {
    const { drawn, tiles } = await decided(ex);
    if ('error' in drawn.answer) throw new Error(drawn.answer.error);
    const components = drawn.answer.components;
    expect(pageRhythm(components)).toEqual([]);
    const page = boardPageData({ name: ex.name }, tiles, { runStore: runs! });
    const paths: string[] = [];
    const collect = (v: unknown) => { if (Array.isArray(v)) { v.forEach(collect); return; } if (!v || typeof v !== 'object') return; const o = v as Record<string, unknown>; if (typeof o.path === 'string' && Object.keys(o).length === 1) { paths.push(o.path); return; } Object.values(o).forEach(collect); };
    components.forEach(collect);
    for (const p of paths.filter((x) => x.startsWith('/board/agents/'))) {
      const m = /^\/board\/agents\/([^/]+)\/(outputs|stats)\/([^/]+)$/.exec(p);
      if (!m) continue;
      const agent = page.data.agents[m[1]];
      expect(agent, p).toBeTruthy();
      expect(Object.keys(m[2] === 'outputs' ? agent.outputs : agent.stats), p).toContain(m[3]);
    }
    for (const c of components) { const a = boardFlagAgent(c.when); if (a) expect(Object.keys(page.data.agents), String(c.when)).toContain(a); }
    const drawnNow = resolveBoardLayout(components, page.flags, { board: page.data }, { running: page.running });
    expect(validateBoardDoc({ components: drawnNow }).ok).toBe(true);
    expect(drawnNow.some((c) => c.pending)).toBe(false);
    // Every agent with a result is on the page, as a tile or a bound part.
    const shown = new Set(drawnNow.flatMap((c) => [...(c.component === 'AgentTile' ? [String(c.agentId)] : []), ...(boardFlagAgent(c.when) ? [boardFlagAgent(c.when)!] : [])]));
    for (const id of Object.keys(page.data.agents)) expect(shown.has(id), id).toBe(true);
    const byId = new Map(components.map((c) => [c.id, c]));
    if (ex.expect.lede) {
      const lede = components.find((c) => c.component === 'Panel' && c.treatment === 'lede');
      expect(lede?.when).toBe(ex.expect.lede);
    }
    if (ex.expect.rail) {
      const rail = byId.get('rail');
      const railAgents = ((rail?.children as string[] | undefined) ?? []).map((id) => boardFlagAgent(byId.get(id)?.when));
      expect(railAgents).toEqual(ex.expect.rail);
    }
  });
});
