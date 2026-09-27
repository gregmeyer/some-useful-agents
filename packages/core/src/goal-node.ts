/**
 * Goal nodes (`type: goal`): give an LLM a goal, tools, and a budget, and it
 * loops — decide, call a tool, read the result — until it can answer or runs
 * out of budget. See docs/goal-agents.md and ADR-0037.
 *
 * A goal node is deliberately NOT a new execution engine. The executor turns
 * it into the llm-prompt node the spawner already runs (`toGoalPromptNode`):
 * the same provider fallback chain, the same Phase A tool surface (sua tools
 * on every provider, policy-checked, recorded), the same Temporal path. What a
 * goal node adds is the framing, the budget defaults, and a real "done"
 * signal: the model must end with `<final>…</final>`. Output that ends any
 * other way means the loop was cut off, which `finishGoalResult` turns into a
 * `budget_exhausted` failure instead of passing a half-answer downstream.
 */
import type { Agent, AgentNode } from './agent-v2-types.js';
import type { SpawnResult } from './node-spawner.js';

export const GOAL_DEFAULT_MAX_TURNS = 15;
export const GOAL_DEFAULT_TIMEOUT_SEC = 600;

export function goalBudget(node: AgentNode): { maxTurns: number; timeoutSec: number } {
  return {
    maxTurns: node.budget?.maxTurns ?? GOAL_DEFAULT_MAX_TURNS,
    timeoutSec: node.budget?.timeoutSec ?? GOAL_DEFAULT_TIMEOUT_SEC,
  };
}

/** The instructions a goal node's model works under. Templates in `goal` are resolved later, like any prompt. */
export function goalPrompt(node: AgentNode, agent: Pick<Agent, 'outputs'>): string {
  const { maxTurns, timeoutSec } = goalBudget(node);
  const tools = node.tools ?? [];
  const outputs = Object.entries(agent.outputs ?? {});
  const finish = outputs.length > 0
    ? [
        'Inside <final>, put ONLY a JSON object with these fields:',
        ...outputs.map(([name, spec]) => `  - ${name} (${spec.type})${spec.description ? `: ${spec.description}` : ''}`),
      ].join('\n')
    : 'Inside <final>, put the answer itself — complete, and readable on its own.';
  return [
    'You are working toward a goal on your own. Work in a loop: decide the next step, call a tool, read what it returns, and repeat until you can answer.',
    '',
    'GOAL',
    (node.goal ?? '').trim(),
    '',
    'TOOLS',
    `You can call: ${tools.join(', ')}. Use them to find things out — don't answer from memory when a tool can check, and don't invent results a tool didn't return.`,
    '',
    'BUDGET',
    `At most ${maxTurns} turns and ${timeoutSec} seconds. Plan briefly, then act. Don't repeat calls whose answer you already have.`,
    '',
    'HOW TO FINISH',
    'End your last message with your answer inside <final>…</final>.',
    finish,
    "If you can't fully achieve the goal, still finish with <final>: give your best answer and say what's missing. Never stop without <final>.",
  ].join('\n');
}

/**
 * The llm-prompt node that runs a goal node: same id, tools, provider, model,
 * and wiring; the goal framing as its prompt; the budget as maxTurns/timeout.
 * Called by the executor just before spawning, so every backend (including a
 * Temporal worker) sees an ordinary llm-prompt node.
 */
export function toGoalPromptNode(node: AgentNode, agent: Pick<Agent, 'outputs'>): AgentNode {
  const { maxTurns, timeoutSec } = goalBudget(node);
  const { goal: _goal, budget: _budget, ...rest } = node;
  return {
    ...rest,
    type: 'llm-prompt',
    prompt: goalPrompt(node, agent),
    maxTurns,
    timeout: timeoutSec,
  };
}

/** The content of the LAST `<final>…</final>` block, trimmed; undefined when there is none. */
export function extractGoalFinal(text: string): string | undefined {
  const matches = [...text.matchAll(/<final>([\s\S]*?)<\/final>/gi)];
  if (matches.length === 0) return undefined;
  return matches[matches.length - 1][1].trim();
}

/**
 * Turn a goal node's spawn result into the node's result: the `<final>` answer
 * on success; a `budget_exhausted` failure when the loop ended without one
 * (turn limit, time limit, or the model just stopped). Other failures (a
 * provider error, a policy block of the whole node, …) pass through.
 */
export function finishGoalResult(node: AgentNode, result: SpawnResult): SpawnResult {
  const { maxTurns, timeoutSec } = goalBudget(node);
  const exhausted = (why: string): SpawnResult => ({
    ...result,
    exitCode: result.exitCode === 0 ? 1 : result.exitCode,
    category: 'budget_exhausted',
    error: `Stopped without finishing: ${why} (budget: ${maxTurns} turns, ${timeoutSec}s). ` +
      'Raise budget.maxTurns / budget.timeoutSec, or narrow the goal.',
  });

  const final = extractGoalFinal(result.result ?? '');
  const outOfTurns = /error_max_turns|max(?:imum)?[ _-]turns|tool-call limit/i;
  if (result.exitCode === 0) {
    if (final !== undefined) return { ...result, result: final };
    // claude can exit 0 on `error_max_turns`; the HTTP loop returns its last
    // text when turns run out. Either way there is no answer to pass on.
    if (outOfTurns.test(result.result ?? '')) return exhausted(`it used all ${maxTurns} turns`);
    return exhausted('the model ended without a <final> answer');
  }
  // The provider signalled it ran out: claude's `error_max_turns`, the HTTP
  // loop's "tool-call limit", or the node timeout (= the time budget).
  const text = `${result.error ?? ''}\n${result.result ?? ''}`;
  if (result.category === 'timeout') return exhausted(`it hit the ${timeoutSec}s time limit`);
  if (outOfTurns.test(text)) return exhausted(`it used all ${maxTurns} turns`);
  return result;
}
