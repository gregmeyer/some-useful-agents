import type { AgentNode, NodeExecutionRecord } from '@some-useful-agents/core';

/** Defaults the runtime applies to a goal node (core goal-node.ts). */
const GOAL_MAX_TURNS = 15;
const GOAL_TIMEOUT_SEC = 600;

export interface NodeBudgetView {
  /** Turns used so far (or in all), when the provider tells us. */
  turnsUsed?: number;
  /** The turn limit, when the node has one. */
  maxTurns?: number;
  toolCalls: number;
  elapsedMs: number;
  /** The time limit, when the node has one worth showing. */
  timeoutMs?: number;
}

interface ProgressEvent {
  type: string;
  turn?: number;
  maxTurns?: number;
  turnId?: string;
  toolStatus?: 'call' | 'result';
}

/**
 * What a goal or llm node has used of its budget: turns (from numbered turn
 * events, else distinct claude message ids), tool calls, and time. Undefined
 * for nodes that aren't goal / llm nodes.
 */
export function summarizeNodeBudget(
  exec: Pick<NodeExecutionRecord, 'startedAt' | 'completedAt' | 'progressJson'>,
  node: Pick<AgentNode, 'type' | 'maxTurns' | 'timeout' | 'budget'> | undefined,
  opts: { recordedToolCalls?: number; now?: number } = {},
): NodeBudgetView | undefined {
  if (!node || !['goal', 'llm-prompt', 'claude-code'].includes(node.type)) return undefined;
  let events: ProgressEvent[] = [];
  if (exec.progressJson) {
    try { events = JSON.parse(exec.progressJson) as ProgressEvent[]; } catch { events = []; }
  }
  const numbered = events.map((e) => e.turn).filter((t): t is number => typeof t === 'number');
  const ids = new Set(events.map((e) => e.turnId).filter((t): t is string => typeof t === 'string'));
  const turnsUsed = numbered.length > 0 ? Math.max(...numbered) : ids.size > 0 ? ids.size : undefined;
  const reportedMax = events.map((e) => e.maxTurns).find((m): m is number => typeof m === 'number');
  const goal = node.type === 'goal';
  const maxTurns = goal ? node.budget?.maxTurns ?? GOAL_MAX_TURNS : node.maxTurns ?? reportedMax;
  const timeoutSec = goal ? node.budget?.timeoutSec ?? GOAL_TIMEOUT_SEC : node.timeout;
  const liveCalls = events.filter((e) => e.toolStatus === 'call').length;
  const end = exec.completedAt ? Date.parse(exec.completedAt) : (opts.now ?? Date.now());
  return {
    turnsUsed,
    maxTurns,
    toolCalls: opts.recordedToolCalls ?? liveCalls,
    elapsedMs: Math.max(0, end - Date.parse(exec.startedAt)),
    timeoutMs: timeoutSec !== undefined ? timeoutSec * 1000 : undefined,
  };
}

/** "2:05" / "1:02:03". */
export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "turn 6 of 15 · 4 tool calls · 2:10 of 10:00" (running) / "6 of 15 turns · 4 tool calls · 2:10" (done). */
export function formatNodeBudget(v: NodeBudgetView, running: boolean): string {
  const parts: string[] = [];
  if (v.turnsUsed !== undefined) {
    parts.push(running
      ? `turn ${v.turnsUsed}${v.maxTurns ? ` of ${v.maxTurns}` : ''}`
      : `${v.turnsUsed}${v.maxTurns ? ` of ${v.maxTurns}` : ''} turn${v.turnsUsed === 1 && !v.maxTurns ? '' : 's'}`);
  } else if (v.maxTurns) {
    parts.push(`up to ${v.maxTurns} turns`);
  }
  if (v.toolCalls > 0) parts.push(`${v.toolCalls} tool call${v.toolCalls === 1 ? '' : 's'}`);
  parts.push(running && v.timeoutMs ? `${formatClock(v.elapsedMs)} of ${formatClock(v.timeoutMs)}` : formatClock(v.elapsedMs));
  return parts.join(' · ');
}

export type ExhaustedLimit = 'turns' | 'time' | 'no-answer' | 'spend';

/** Which limit a `budget_exhausted` node hit, from its error text. */
export function exhaustedLimit(error: string | undefined): ExhaustedLimit | undefined {
  if (!error) return undefined;
  if (/spend limit/i.test(error)) return 'spend';
  if (/time limit/i.test(error)) return 'time';
  if (/used all \d+ turns|turns?\b.*limit|max(?:imum)?[ _-]turns/i.test(error)) return 'turns';
  if (/without a <final> answer|ended without/i.test(error)) return 'no-answer';
  return undefined;
}
