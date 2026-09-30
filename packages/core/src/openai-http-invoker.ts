/**
 * OpenAI-compatible HTTP LLM invocation — the transport for custom providers
 * (local/self-hosted models behind a `/v1/chat/completions` endpoint). Returns
 * a `SpawnResult` so it drops straight into the node-spawner waterfall
 * (`runLlmAttempt`) with no changes to the fallback machinery: the loop only
 * cares about `{ result, exitCode, error, category }`, and `classifyLlmFailure`
 * already buckets the error strings we emit (401/unauthorized → auth_required,
 * 429/rate limit → rate_limited, connection refused → binary_missing, abort →
 * timeout) into the right fallback categories.
 *
 * v1 is non-streaming: the full completion is returned on success.
 */

import type { SpawnResult, SpawnProgress } from './node-spawner.js';
import type { OpenAiTool, ToolCallExecutor } from './llm-tools.js';
import { formatUsd, openAiUsageAccumulator, type LlmUsage } from './usage.js';

export interface OpenAiInvokeArgs {
  /** Base URL including the version segment, e.g. http://127.0.0.1:8181/v1 */
  apiBase: string;
  /** Bearer token; omitted ⇒ no Authorization header (local servers). */
  apiKey?: string;
  model: string;
  /** The provider's name in sua (for usage records); defaults to "openai". */
  providerName?: string;
  /**
   * Spend cap for this attempt, USD. Checked after each response of the tool
   * loop (with `costOf`); the loop stops instead of calling the model again.
   */
  maxCostUsd?: number;
  costOf?: (usage: LlmUsage) => number | undefined;
  prompt: string;
  /** Wall-clock cap; aborts the request and reports a `timeout` category. */
  timeoutSec: number;
  /** External cancellation (operator Stop / agent-level timeout). */
  signal?: AbortSignal;
  /** Injectable fetch for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Function schemas exposed to the model. When present, runs a tool loop. */
  tools?: OpenAiTool[];
  /** Executes a model tool_call → result content fed back into the loop. */
  onToolCall?: ToolCallExecutor;
  /** Max tool-call turns before giving up (default 5). Ignored without tools. */
  maxTurns?: number;
  /**
   * Progress sink for the tool loop. Emits a `tool_use` event per model tool
   * call (toolStatus:'call') and per tool result (toolStatus:'result'), so the
   * run record shows what the model actually invoked — the difference between a
   * real round-trip and a plain completion that ignored the tools.
   */
  onProgress?: (event: SpawnProgress) => void;
}

interface ToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}
interface ChatMessage {
  role?: string;
  content?: string | null;
  tool_calls?: ToolCall[];
}
interface ChatCompletionResponse {
  choices?: Array<{ message?: ChatMessage }>;
  usage?: unknown;
}

/**
 * POST a single-prompt chat completion to an OpenAI-compatible endpoint and
 * return the assistant text as a `SpawnResult`.
 */
export async function invokeOpenAiChat(args: OpenAiInvokeArgs): Promise<SpawnResult> {
  // Tokens across every response of the tool loop, reported on the result
  // whatever the outcome (a loop that ran out of turns still used them).
  const usage = openAiUsageAccumulator(args.providerName ?? 'openai', args.model);
  const result = await invokeOpenAiChatInner(args, usage);
  const attemptUsage = usage.result();
  return attemptUsage ? { ...result, attemptUsage } : result;
}

async function invokeOpenAiChatInner(
  args: OpenAiInvokeArgs,
  usage: ReturnType<typeof openAiUsageAccumulator>,
): Promise<SpawnResult> {
  const doFetch = args.fetchImpl ?? fetch;
  const url = args.apiBase.replace(/\/+$/, '') + '/chat/completions';

  // Combine the caller's signal with our own timeout so either can abort.
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), Math.max(1, args.timeoutSec) * 1000);
  const onExternalAbort = () => timeoutController.abort();
  if (args.signal) {
    if (args.signal.aborted) timeoutController.abort();
    else args.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (args.apiKey) headers.authorization = `Bearer ${args.apiKey}`;

  const useTools = Boolean(args.tools && args.tools.length > 0 && args.onToolCall);
  const maxTurns = Math.max(1, args.maxTurns ?? 5);

  try {
    // Conversation state. With tools, we iterate: model → tool_calls → tool
    // results → model, up to maxTurns. Without tools, the loop runs exactly
    // once (identical to the original single-POST behavior).
    const messages: Array<Record<string, unknown>> = [{ role: 'user', content: args.prompt }];
    let lastContent = '';

    for (let turn = 0; turn < (useTools ? maxTurns : 1); turn++) {
      if (useTools) {
        emitProgress(args.onProgress, { type: 'turn_start', turn: turn + 1, maxTurns, message: `Turn ${turn + 1} of ${maxTurns}` });
      }
      const body: Record<string, unknown> = { model: args.model, messages, stream: false };
      if (useTools) { body.tools = args.tools; body.tool_choice = 'auto'; }

      const res = await doFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: timeoutController.signal,
      });

      if (!res.ok) {
        const bodyText = (await safeText(res)).slice(0, 500);
        // The status number rides in the error string so classifyLlmFailure's
        // free-text matchers ("401", "unauthorized", "429", "rate limit") route
        // it to the right fallback category without a bespoke mapping table.
        return {
          result: '',
          exitCode: 1,
          error: `HTTP ${res.status} ${res.statusText} from ${url}: ${bodyText || '(no body)'}`,
          category: 'exit_nonzero',
        };
      }

      const json = (await res.json()) as ChatCompletionResponse;
      usage.add(json.usage);
      const message = json.choices?.[0]?.message;
      const toolCalls = message?.tool_calls ?? [];
      if (typeof message?.content === 'string') lastContent = message.content;

      // Model wants to call tools → execute each, feed results back, loop —
      // unless that would take the node past its spend limit.
      if (useTools && toolCalls.length > 0 && args.maxCostUsd !== undefined && args.costOf) {
        const soFar = usage.result();
        const spent = soFar ? args.costOf(soFar) : undefined;
        if (spent !== undefined && spent >= args.maxCostUsd) {
          return {
            result: lastContent,
            exitCode: 1,
            category: 'budget_exhausted',
            error: `Stopped at the spend limit after ${turn + 1} turn${turn === 0 ? '' : 's'}: ${formatUsd(spent)} of the ${formatUsd(args.maxCostUsd)} this node had left.`,
          };
        }
      }
      if (useTools && toolCalls.length > 0) {
        messages.push({ role: 'assistant', content: message?.content ?? '', tool_calls: toolCalls });
        for (const call of toolCalls) {
          const name = call.function?.name ?? '';
          const argsJson = call.function?.arguments ?? '{}';
          emitProgress(args.onProgress, {
            type: 'tool_use',
            toolStatus: 'call',
            toolName: name,
            message: `Calling ${name}`,
            preview: argsJson.slice(0, 200),
          });
          const { content, isError } = await args.onToolCall!(name, argsJson);
          emitProgress(args.onProgress, {
            type: 'tool_use',
            toolStatus: 'result',
            toolName: name,
            isError: isError === true,
            message: `${name} ${isError ? 'errored' : 'returned'}`,
            preview: content.slice(0, 200),
          });
          messages.push({ role: 'tool', tool_call_id: call.id ?? name, content });
        }
        continue;
      }

      // No tool calls → this is the final answer.
      if (typeof message?.content !== 'string' || message.content.length === 0) {
        return {
          result: '',
          exitCode: 1,
          error: `${url} returned no message content (empty or malformed choices[]).`,
          category: 'exit_nonzero',
        };
      }
      return { result: message.content, exitCode: 0 };
    }

    // Ran out of turns while still requesting tools. Return the last text if the
    // model produced any, else a fallback-worthy error.
    if (lastContent.length > 0) return { result: lastContent, exitCode: 0 };
    return {
      result: '',
      exitCode: 1,
      error: `${url} exceeded the tool-call limit (${maxTurns} turns) without a final answer.`,
      category: 'exit_nonzero',
    };
  } catch (err) {
    // Abort ⇒ either our timeout or the caller's signal fired. Treat as timeout
    // so the waterfall falls through to the next provider.
    if (timeoutController.signal.aborted) {
      return {
        result: '',
        exitCode: 124,
        error: `Request to ${url} timed out after ${args.timeoutSec}s (or was cancelled).`,
        category: 'timeout',
      };
    }
    // Network-level failure (endpoint down, DNS, connection refused). Map to
    // spawn_failure so classifyLlmFailure returns binary_missing ⇒ fall back.
    const msg = err instanceof Error ? err.message : String(err);
    return {
      result: '',
      exitCode: 127,
      error: `Could not reach ${url}: ${msg}`,
      category: 'spawn_failure',
    };
  } finally {
    clearTimeout(timer);
    if (args.signal) args.signal.removeEventListener('abort', onExternalAbort);
  }
}

/** Emit a timestamped progress event if a sink is present. */
function emitProgress(
  cb: ((e: SpawnProgress) => void) | undefined,
  partial: Omit<SpawnProgress, 'timestamp'>,
): void {
  if (!cb) return;
  cb({ timestamp: new Date().toISOString(), ...partial });
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).trim();
  } catch {
    return '';
  }
}
