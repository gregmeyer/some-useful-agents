/**
 * sua's own agents for a notebook step that has none of its own. A leaf
 * module: the step runner, the conversation and the views all name them.
 */
import type { NotebookStep } from '@some-useful-agents/core';

/** sua's checker: a check step without an agent of its own uses it. */
export const NOTEBOOK_CHECKER_ID = 'notebook-checker';
/** sua's finder: a find step without an agent of its own uses it (several narrow searches at once). */
export const NOTEBOOK_FINDER_ID = 'notebook-finder';
/** The finder's helper: one of its searches. */
export const NOTEBOOK_FIND_ONE_ID = 'notebook-find-one';
/** The checker's helpers: research-fanout researches the checks an option's own facts left open, through research-one. */
export const CHECKER_HELPER_IDS = ['research-fanout', 'research-one'] as const;

/** The agents sua's step agent calls, installed or updated with it. */
export function stepAgentHelpers(agentId: string): readonly string[] {
  return agentId === NOTEBOOK_FINDER_ID ? [NOTEBOOK_FIND_ONE_ID] : agentId === NOTEBOOK_CHECKER_ID ? CHECKER_HELPER_IDS : [];
}

/** sua's own agent for a step that has none: the checker for a check, the finder for a find. */
export function suaStepAgent(kind: NotebookStep['kind']): string | undefined {
  return kind === 'check' ? NOTEBOOK_CHECKER_ID : kind === 'find' ? NOTEBOOK_FINDER_ID : undefined;
}

/** "sua’s checker" / "sua’s finder": who does a step that has no agent of its own (undefined: it needs one). */
export function suaStepAgentName(kind: NotebookStep['kind']): string | undefined {
  return kind === 'check' ? 'sua’s checker' : kind === 'find' ? 'sua’s finder' : undefined;
}
