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

import type { SpawnResult } from './node-spawner.js';
import type { OpenAiTool, ToolCallExecutor } from './llm-tools.js';

export interface OpenAiInvokeArgs {
  /** Base URL including the version segment, e.g. http://127.0.0.1:8181/v1 */
  apiBase: string;
  /** Bearer token; omitted ⇒ no Authorization header (local servers). */
  apiKey?: string;
  model: string;
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
}

/**
 * POST a single-prompt chat completion to an OpenAI-compatible endpoint and
 * return the assistant text as a `SpawnResult`.
 */
export async function invokeOpenAiChat(args: OpenAiInvokeArgs): Promise<SpawnResult> {
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
      const message = json.choices?.[0]?.message;
      const toolCalls = message?.tool_calls ?? [];
      if (typeof message?.content === 'string') lastContent = message.content;

      // Model wants to call tools → execute each, feed results back, loop.
      if (useTools && toolCalls.length > 0) {
        messages.push({ role: 'assistant', content: message?.content ?? '', tool_calls: toolCalls });
        for (const call of toolCalls) {
          const name = call.function?.name ?? '';
          const argsJson = call.function?.arguments ?? '{}';
          const { content } = await args.onToolCall!(name, argsJson);
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

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).trim();
  } catch {
    return '';
  }
}
