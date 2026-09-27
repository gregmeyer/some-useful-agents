/**
 * One tool call made by a model during an llm-prompt node, whichever provider
 * made it. `source: 'sua'` is a sua tool dispatched by `buildToolExecutor`
 * (the OpenAI-compatible HTTP loop today); `'native'` is a CLI provider's own
 * tool (claude's WebFetch, Bash, …) read back from its event stream.
 *
 * Records ride on `SpawnResult.toolCalls` so the local and Temporal paths are
 * identical (the worker returns them; the executor persists them), and land
 * in the `tool_calls` table. This is the trace behavior grading and outcome
 * evidence need: node rows alone can't say what an agent actually did.
 */
export interface ToolCallRecord {
  /** Order within the node execution, assigned when the node's calls are collected. */
  seq?: number;
  /** LLM provider that made the call (e.g. `local-qwen-8b`, `claude`). */
  provider?: string;
  source: 'sua' | 'native';
  /** sua tool id (e.g. `web-fetch`), or the CLI's own tool name (e.g. `WebFetch`). */
  toolId: string;
  /** Arguments as JSON, capped at {@link TOOL_CALL_ARGS_CAP}. */
  argsJson: string;
  /** Start of the result, capped at {@link TOOL_CALL_RESULT_PREVIEW_CAP}. */
  resultPreview: string;
  /** Full result length before capping. */
  resultChars: number;
  isError: boolean;
  /** ISO time the call started, when the provider exposes it. */
  startedAt?: string;
  durationMs?: number;
}

export const TOOL_CALL_ARGS_CAP = 4000;
export const TOOL_CALL_RESULT_PREVIEW_CAP = 2000;

export function capToolText(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}… [${text.length - cap} more chars]` : text;
}
