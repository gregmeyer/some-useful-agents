import { describe, it, expect } from 'vitest';
import { summarizeNodeBudget, formatNodeBudget, formatClock, exhaustedLimit } from './node-budget.js';

const t0 = '2026-09-30T10:00:00.000Z';
const at = (sec: number) => new Date(Date.parse(t0) + sec * 1000).toISOString();

describe('summarizeNodeBudget', () => {
  it('reads numbered turns and live tool calls for a running goal node, with its budget defaults', () => {
    const progress = [
      { type: 'turn_start', turn: 1, maxTurns: 15 },
      { type: 'tool_use', toolStatus: 'call' },
      { type: 'tool_use', toolStatus: 'result' },
      { type: 'turn_start', turn: 2, maxTurns: 15 },
      { type: 'tool_use', toolStatus: 'call' },
    ];
    const v = summarizeNodeBudget({ startedAt: t0, progressJson: JSON.stringify(progress) }, { type: 'goal' }, { now: Date.parse(at(130)) })!;
    expect(v).toEqual({ turnsUsed: 2, maxTurns: 15, toolCalls: 2, elapsedMs: 130_000, timeoutMs: 600_000 });
    expect(formatNodeBudget(v, true)).toBe('turn 2 of 15 · 2 tool calls · 2:10 of 10:00');
  });

  it('counts claude turns by message id, and uses the recorded call count once done', () => {
    const progress = [
      { type: 'output_chunk', turnId: 'msg_a' },
      { type: 'tool_use', toolStatus: 'call', turnId: 'msg_a' },
      { type: 'output_chunk', turnId: 'msg_b' },
      { type: 'turn_complete' },
    ];
    const v = summarizeNodeBudget({ startedAt: t0, completedAt: at(45), progressJson: JSON.stringify(progress) }, { type: 'llm-prompt', maxTurns: 5 }, { recordedToolCalls: 3 })!;
    expect(v).toMatchObject({ turnsUsed: 2, maxTurns: 5, toolCalls: 3, elapsedMs: 45_000 });
    expect(formatNodeBudget(v, false)).toBe('2 of 5 turns · 3 tool calls · 0:45');
  });

  it("uses the goal node's own budget, and ignores shell nodes", () => {
    const v = summarizeNodeBudget({ startedAt: t0, completedAt: at(1) }, { type: 'goal', budget: { maxTurns: 4, timeoutSec: 60 } })!;
    expect(v).toMatchObject({ maxTurns: 4, timeoutMs: 60_000, turnsUsed: undefined });
    expect(formatNodeBudget(v, true)).toBe('up to 4 turns · 0:01 of 1:00');
    expect(summarizeNodeBudget({ startedAt: t0 }, { type: 'shell' })).toBeUndefined();
  });
});

describe('formatting and limits', () => {
  it('formats clocks', () => {
    expect(formatClock(5_000)).toBe('0:05');
    expect(formatClock(3_723_000)).toBe('1:02:03');
  });

  it('tells which limit a budget_exhausted node hit', () => {
    expect(exhaustedLimit('Stopped without finishing: it used all 15 turns (budget: 15 turns, 600s).')).toBe('turns');
    expect(exhaustedLimit('Stopped without finishing: it hit the 600s time limit (budget: 15 turns, 600s).')).toBe('time');
    expect(exhaustedLimit('Stopped without finishing: the model ended without a <final> answer (budget: 15 turns, 600s).')).toBe('no-answer');
    expect(exhaustedLimit('Stopped at the spend limit: this run has spent $0.61')).toBe('spend');
    expect(exhaustedLimit(undefined)).toBeUndefined();
  });
});
