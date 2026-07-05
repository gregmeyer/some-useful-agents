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
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
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

  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: args.model,
        messages: [{ role: 'user', content: args.prompt }],
        stream: false,
      }),
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
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      return {
        result: '',
        exitCode: 1,
        error: `${url} returned no message content (empty or malformed choices[]).`,
        category: 'exit_nonzero',
      };
    }
    return { result: content, exitCode: 0 };
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
