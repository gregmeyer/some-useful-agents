/**
 * Process spawning for DAG node execution. Provides an LlmSpawner
 * abstraction for multi-provider support (claude, codex, future) with
 * real-time progress callbacks for turn tracking.
 *
 * Extracted from dag-executor.ts in PR 1 (file split).
 * LlmSpawner interface added in PR 2 (this PR).
 */

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import type { Agent, AgentNode, NodeErrorCategory } from './agent-v2-types.js';
import type { ExecutionResult } from './agent-executor.js';
import { substituteInputs } from './input-resolver.js';
import { resolveUpstreamTemplate, resolveVarsTemplate, resolveStateTemplate } from './node-templates.js';
import { ensureAppleRunner } from './apple-foundationmodels-runner.js';

// ── Types ──────────────────────────────────────────────────────────────

/**
 * One failed provider attempt in the LLM waterfall: which provider, the
 * classified failure category (timeout / credit_exhausted / binary_missing /
 * …), and a short error snippet for diagnosis.
 */
export interface ProviderFailure {
  provider: string;
  category: string;
  error?: string;
}

export type SpawnResult = ExecutionResult & {
  category?: NodeErrorCategory;
  /**
   * LLM provider that ultimately produced this result. Set by spawnNodeReal
   * for llm-prompt nodes only. When the waterfall ran multiple providers
   * before one succeeded (or all failed), this is the LAST provider
   * attempted — paired with `attemptedProviders` for the full trail.
   * Undefined for shell nodes.
   */
  usedLLMProvider?: string;
  /**
   * Ordered trail of every provider the waterfall tried, including the
   * one in `usedLLMProvider`. Length 1 means no fallback fired. Undefined
   * for shell nodes.
   */
  attemptedProviders?: string[];
  /**
   * Per-attempt failure reasons for every provider the waterfall tried and
   * abandoned (the winner is not listed). Lets the dashboard show WHY each
   * skipped provider was skipped (e.g. "codex: timeout") instead of a bare
   * "codex failed". Undefined when no provider failed.
   */
  providerFailures?: ProviderFailure[];
  /**
   * Execution backend that actually ran this node: `'local'` (in-process)
   * or `'temporal'` (worker activity). A backend (the injected spawnNode)
   * self-reports here; the executor copies it onto the node_executions row.
   * Distinct from `usedLLMProvider` (the LLM provider). Undefined ↔ local.
   */
  usedWorkflowProvider?: string;
};

/**
 * Optional fallback policy for llm-prompt nodes. When the primary
 * spawn returns a failure that `classifyLlmFailure` marks as
 * fallback-worthy (credit exhausted, quota exceeded, binary missing,
 * hard timeout) AND `fallback` is set, node-spawner retries the same
 * prompt under the fallback provider. `onFallback` is invoked once
 * per fallback so the runtime can record telemetry / surface the
 * event on /settings/llm.
 */
export interface LlmSettingsSnapshot {
  /**
   * Ordered provider waterfall. `providers[0]` is the global primary;
   * the rest are tried in order on classified failures. When a node
   * pins its own provider, that provider runs FIRST and the rest of
   * the chain still applies as fallbacks (deduplicated).
   */
  providers?: string[];
  /**
   * Fired once per hop in the waterfall (i.e. once per fallback
   * transition, not once per run). `from` is the provider that just
   * failed; `to` is the next provider in the chain that's about to
   * run. The runtime persists each event so /settings/llm can show
   * the last hop.
   */
  onFallback?: (event: {
    reason: LlmFailureCategory;
    from: string;
    to: string;
    agentId: string;
    nodeId: string;
  }) => void;
}

/**
 * Buckets a failed llm-prompt attempt into one of a few causes so the
 * fallback policy can decide whether to retry, switch providers, or
 * bubble up the failure unchanged.
 *
 * - `credit_exhausted` / `quota_exceeded` — operator paid-tier issue;
 *   switching providers is the helpful default
 * - `binary_missing` — CLI not installed; switching providers is the
 *   only way to make progress
 * - `timeout` — hard wall-clock cap hit; the fallback may be faster
 * - `rate_limited` — transient; retrying the same provider after a
 *   short backoff is usually better than switching
 * - `auth_required` — operator login expired; switching won't fix it,
 *   bubble up
 * - `other` — unknown / probably a real prompt or runtime bug; don't
 *   mask by switching providers
 */
export type LlmFailureCategory =
  | 'credit_exhausted'
  | 'quota_exceeded'
  | 'binary_missing'
  | 'timeout'
  | 'rate_limited'
  | 'auth_required'
  | 'other';

/**
 * Pluggable node-execution backend. `spawnNodeReal` is the in-process
 * implementation; a Temporal-backed spawnNode (B1b) implements the same
 * signature to run the node on a worker. The trailing callbacks are optional
 * so lightweight injectors (test doubles) can ignore them — they receive the
 * same `onProgress` / `signal` / `onSpawn` the real spawner does.
 */
export type SpawnNodeFn = (
  node: AgentNode,
  env: Record<string, string>,
  opts: { agentId: string; agentSource: Agent['source']; allowUntrustedShell?: ReadonlySet<string>; llmSettings?: LlmSettingsSnapshot },
  onProgress?: (event: SpawnProgress) => void,
  signal?: AbortSignal,
  onSpawn?: (pid: number, startedAtMs: number) => void,
) => Promise<SpawnResult>;

/**
 * Progress event emitted during a node's execution. Originally LLM-only
 * (turn_*, tool_use, thinking, output_chunk), now also surfaces per-iteration
 * progress for `loop` nodes so the dashboard can render "iteration 3/4: rula"
 * and per-iteration failures inline at the parent run instead of forcing the
 * user to dig into nested sub-run pages.
 */
export interface SpawnProgress {
  timestamp: string;
  type:
    | 'turn_start' | 'turn_complete' | 'tool_use' | 'thinking' | 'output_chunk'
    | 'loop_iteration_start' | 'loop_iteration_complete';
  turn?: number;
  maxTurns?: number;
  message?: string;
}

// ── LlmSpawner interface ───────────────────────────────────────────────

export interface LlmSpawnOptions {
  prompt: string;
  model?: string;
  maxTurns?: number;
  allowedTools?: string[];
}

/**
 * Abstraction for LLM CLI providers. Each implementation knows how to
 * build CLI args, parse progress events from stdout/stderr, and extract
 * the final result text.
 */
export interface LlmSpawner {
  /**
   * CLI binary name (e.g. 'claude', 'codex'). For providers whose
   * binary path is computed lazily at invocation time, `resolveBinary`
   * overrides this — the spawner registry's `binary` is still set to a
   * sensible default for static call sites (logging, error messages).
   */
  binary: string;
  /**
   * Resolve the actual binary path at invocation time. Used by
   * providers that compile-on-demand (e.g. apple-foundation-models,
   * which materializes its Swift runner under ~/.sua/runners/ on first
   * use). When undefined, callers use `binary` directly.
   *
   * Returns either a path or a structured `unsupported` signal that the
   * waterfall treats as `binary_missing` (so the chain falls through to
   * the next provider without an actual spawn attempt).
   */
  resolveBinary?: () => { path: string } | { unsupported: true; reason: string };
  /** Build the CLI argument list. */
  buildArgs(opts: LlmSpawnOptions): string[];
  /**
   * Optional env-var contribution. The prompt-on-env-var providers
   * (apple-foundation-models) use this to surface PROMPT /
   * SYSTEM_PROMPT alongside the inherited childEnv. Returned keys are
   * merged INTO the existing childEnv before the spawn — they don't
   * replace it. When undefined, no extra env is contributed.
   */
  buildEnv?: (opts: LlmSpawnOptions) => Record<string, string>;
  /**
   * When true, after the process exits successfully the waterfall emits
   * the extracted result text as a series of synthetic `output_chunk`
   * progress events (paced ~8ms apart, capped at ~1.5s total) so the
   * typewriter UI behaves consistently across streaming and non-
   * streaming providers. Used by apple-foundation-models, which has no
   * native token-delta stream.
   */
  simulateStream?: boolean;
  /**
   * If set, the prompt is passed via this env var name instead of
   * stdin. Providers that read prompts from argv (claude/codex via
   * stdinInput) leave this unset. The waterfall hands the resolved
   * prompt to `buildEnv` automatically, but explicit env-name mapping
   * keeps the interface declarative for future providers that want a
   * different name.
   */
  promptEnvVar?: string;
  /**
   * Parse a line of stdout for progress events. Returns null if the line
   * is not a progress event (e.g. regular output text).
   */
  parseProgress(line: string): SpawnProgress | null;
  /**
   * Extract the final result text from the accumulated stdout.
   * For stream-json mode, this parses the result event.
   * For text mode, this returns stdout as-is.
   */
  extractResult(stdout: string): string;
  /**
   * Inspect a fresh `SpawnResult` (after extractResult ran) and return
   * an override category when the provider's payload encodes failures
   * inline (e.g. apple-foundation-models writes `status: "unavailable"`
   * to a JSON line with exit code 0). The waterfall consults this
   * BEFORE the generic `classifyLlmFailure` text matcher.
   */
  classifyResult?: (result: SpawnResult, rawStdout: string) => LlmFailureCategory | null;
}

// ── Claude spawner ─────────────────────────────────────────────────────

/**
 * Claude CLI spawner using `--output-format stream-json` for structured
 * turn tracking. Each line of stdout is a JSON event with a `type` field.
 * The final result is extracted from the `result` event.
 */
export const claudeSpawner: LlmSpawner = {
  binary: 'claude',

  buildArgs(opts: LlmSpawnOptions): string[] {
    // Prompt is sent via stdin (see spawnProcess.stdinInput) — keeping it
    // out of argv avoids E2BIG when {{upstream.X.result}} substitution
    // produces a fat prompt.
    void opts.prompt;
    const args = ['--print', '--output-format', 'stream-json', '--verbose'];
    if (opts.model) args.push('--model', opts.model);
    if (opts.maxTurns) args.push('--max-turns', String(opts.maxTurns));
    if (opts.allowedTools?.length) args.push('--allowedTools', opts.allowedTools.join(','));
    return args;
  },

  parseProgress(line: string): SpawnProgress | null {
    if (!line.startsWith('{')) return null;
    try {
      const event = JSON.parse(line);
      // Assistant events carry an array of content items: `{type:'text', text:'...'}`
      // for the model's writing, `{type:'tool_use', ...}` when it calls a tool.
      // Each `assistant` event from the stream-json output represents a chunk
      // (the CLI streams in sub-message intervals). Per-token reveal in the
      // dashboard hangs off these text chunks.
      if (event.type === 'assistant') {
        const content = event.message?.content;
        if (Array.isArray(content)) {
          // Prefer the FIRST text chunk we find. If a single assistant
          // event interleaves text + tool_use the tool_use case still
          // fires via the dedicated branch below.
          for (const c of content) {
            if (c && c.type === 'text' && typeof c.text === 'string' && c.text.length > 0) {
              return {
                timestamp: new Date().toISOString(),
                type: 'output_chunk',
                message: c.text,
              };
            }
          }
          // Tool-use without text: surface that explicitly so the
          // dashboard's witty-label loop can flip to the action-running
          // phase rather than show the triage thinking phase.
          if (content.some((c: { type?: string }) => c && c.type === 'tool_use')) {
            return {
              timestamp: new Date().toISOString(),
              type: 'tool_use',
              message: 'Using a tool...',
            };
          }
        }
        // Empty assistant event (rare, but handle gracefully) — keep
        // the old "thinking" signal so the UI knows something happened.
        return {
          timestamp: new Date().toISOString(),
          type: 'turn_start',
          message: 'Claude is responding...',
        };
      }
      if (event.type === 'tool_use') {
        return {
          timestamp: new Date().toISOString(),
          type: 'tool_use',
          message: 'Using a tool...',
        };
      }
      if (event.type === 'result') {
        return {
          timestamp: new Date().toISOString(),
          type: 'turn_complete',
          turn: event.num_turns,
          message: `Completed in ${event.num_turns} turn${event.num_turns === 1 ? '' : 's'}.`,
        };
      }
    } catch {
      // Not valid JSON — skip.
    }
    return null;
  },

  extractResult(stdout: string): string {
    // Parse the last `result` event from the stream.
    const lines = stdout.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line.startsWith('{')) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === 'result' && typeof event.result === 'string') {
          return event.result;
        }
      } catch { continue; }
    }
    // Fallback: if no result event found, return raw stdout (shouldn't happen).
    return stdout;
  },
};

// ── Claude text spawner (legacy, no progress) ──────────────────────────

/**
 * Legacy Claude spawner using `--print` text mode. No structured progress
 * events. Used as fallback when stream-json isn't needed.
 */
export const claudeTextSpawner: LlmSpawner = {
  binary: 'claude',

  buildArgs(opts: LlmSpawnOptions): string[] {
    // Prompt rides on stdin (see claudeSpawner note).
    void opts.prompt;
    const args = ['--print'];
    if (opts.model) args.push('--model', opts.model);
    if (opts.maxTurns) args.push('--max-turns', String(opts.maxTurns));
    if (opts.allowedTools?.length) args.push('--allowedTools', opts.allowedTools.join(','));
    return args;
  },

  parseProgress(): SpawnProgress | null { return null; },
  extractResult(stdout: string): string { return stdout; },
};

// ── Codex spawner ──────────────────────────────────────────────────────

/**
 * OpenAI Codex CLI spawner. Uses `codex exec -s read-only` for
 * non-interactive execution. No structured progress events.
 */
export const codexSpawner: LlmSpawner = {
  binary: 'codex',

  buildArgs(opts: LlmSpawnOptions): string[] {
    // Prompt rides on stdin (see claudeSpawner note). `codex exec` reads
    // its prompt from stdin when no positional argument is given.
    void opts.prompt;
    // --json emits one JSON event per line, mirroring claude's
    // `--output-format stream-json`. This unlocks the inbox SSE
    // pipeline: turn.started → output_chunk → turn.completed get
    // forwarded as triage:started → triage:token → triage:complete.
    const args = ['exec', '--json', '-s', 'read-only'];
    if (opts.model) args.push('-m', opts.model);
    return args;
  },

  /**
   * Codex's --json JSONL shape (sampled live):
   *   {"type":"thread.started","thread_id":"…"}      ← discarded
   *   {"type":"turn.started"}                         → turn_start
   *   {"type":"item.completed","item":{
   *      "type":"agent_message","text":"…"}}          → output_chunk
   *   {"type":"turn.completed","usage":{
   *      "output_tokens": N, …}}                      → turn_complete
   *
   * Codex emits the full assistant text in a single agent_message
   * item rather than streaming token-by-token deltas (the way
   * claude's --output-format stream-json does). The dashboard's
   * typewriter still renders incrementally — it just gets one big
   * chunk arriving ~RTT before turn.completed, which still beats
   * the prior "whole reply lands at addResponse time" experience.
   */
  parseProgress(line: string): SpawnProgress | null {
    if (!line.startsWith('{')) return null;
    try {
      const event = JSON.parse(line);
      if (event.type === 'turn.started') {
        return {
          timestamp: new Date().toISOString(),
          type: 'turn_start',
          message: 'Codex is responding...',
        };
      }
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        const text = typeof event.item.text === 'string' ? event.item.text : '';
        if (text.length > 0) {
          return {
            timestamp: new Date().toISOString(),
            type: 'output_chunk',
            message: text,
          };
        }
      }
      if (event.type === 'turn.completed') {
        const outTokens = event.usage?.output_tokens;
        return {
          timestamp: new Date().toISOString(),
          type: 'turn_complete',
          message: typeof outTokens === 'number'
            ? `Completed (${outTokens} output tokens).`
            : 'Completed.',
        };
      }
    } catch {
      // Not valid JSON — skip.
    }
    return null;
  },

  /**
   * With --json the raw stdout is JSONL, not the model's prose. Walk
   * to the LAST `item.completed` agent_message and return its text —
   * matches the contract `claudeSpawner.extractResult` provides
   * (final prose string for the run record + downstream prompts).
   * Falls back to the raw stdout for backward compat if no
   * agent_message line is found.
   */
  extractResult(stdout: string): string {
    const lines = stdout.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line.startsWith('{')) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === 'item.completed'
          && event.item?.type === 'agent_message'
          && typeof event.item.text === 'string') {
          return event.item.text;
        }
      } catch { /* skip */ }
    }
    return stdout;
  },
};

// ── Apple Foundation Models spawner ────────────────────────────────────

/**
 * Apple Foundation Models spawner. Drives the on-device model via a
 * tiny Swift runner compiled lazily and cached at
 * `~/.sua/runners/apple_foundationmodels` (see
 * `apple-foundationmodels-runner.ts`).
 *
 * Key differences from claude/codex:
 *   - Prompt rides on environment variables (PROMPT, SYSTEM_PROMPT),
 *     not stdin or argv.
 *   - Output is a single JSON object on stdout: `{ status,
 *     response_text, model_name, error_message }`. No per-token deltas.
 *   - The typewriter UX is simulated post-completion via
 *     `simulateStream: true` so the modal's streaming-bubble path keeps
 *     working — the runlAttempt loop chunks the extracted text and
 *     emits synthetic output_chunk events on the same onProgress hook
 *     real spawners use.
 *   - `status: "unavailable"` or `"unsupported"` map to `binary_missing`
 *     via `classifyResult` so the waterfall falls through to the next
 *     provider.
 */
export const appleFoundationModelsSpawner: LlmSpawner = {
  binary: 'apple_foundationmodels',
  simulateStream: true,
  promptEnvVar: 'PROMPT',

  resolveBinary() {
    // Static import at the top of the file — the runner module's
    // dependencies are Node built-ins (child_process, fs, crypto,
    // os, path), so eager loading costs nothing. The earlier CJS
    // `require()` here was broken: this package is ESM and `require`
    // isn't defined at runtime, so every Apple FM invocation threw
    // ReferenceError before reaching the runner.
    const handle = ensureAppleRunner();
    if (handle.status === 'ready') return { path: handle.binaryPath };
    return { unsupported: true, reason: handle.message ?? 'Apple Foundation Models runner is unavailable.' };
  },

  buildArgs(_opts: LlmSpawnOptions): string[] {
    // The runner reads PROMPT + SYSTEM_PROMPT from its environment;
    // model / maxTurns / allowedTools are ignored (the on-device
    // framework doesn't expose those knobs).
    return [];
  },

  buildEnv(opts: LlmSpawnOptions): Record<string, string> {
    return { PROMPT: opts.prompt };
  },

  parseProgress(_line: string): SpawnProgress | null {
    // Real-time progress isn't available — the runner emits one JSON
    // line at completion. The simulated streaming hook in
    // `runLlmAttempt` covers the typewriter UX.
    return null;
  },

  extractResult(stdout: string): string {
    // The runner prints one JSON object on the last non-empty line.
    const lines = stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.startsWith('{')) continue;
      try {
        const obj = JSON.parse(line);
        if (typeof obj.response_text === 'string' && obj.status === 'ok') {
          return obj.response_text;
        }
        // Non-ok status: surface an empty result; classifyResult will
        // map the JSON status to a fallback-worthy category so the
        // waterfall continues to the next provider.
        return '';
      } catch { /* skip */ }
    }
    return '';
  },

  classifyResult(result: SpawnResult, rawStdout: string): LlmFailureCategory | null {
    // Apple's runner can exit 0 yet report failure inline via the JSON
    // status field. Map unavailable/unsupported to binary_missing so
    // the waterfall treats the host as if the binary weren't installed
    // (because functionally — for this prompt on this device — it
    // isn't usable). 'error' maps to 'other' so real bugs surface.
    const lines = rawStdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.startsWith('{')) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.status === 'unavailable' || obj.status === 'unsupported') {
          return 'binary_missing';
        }
        if (obj.status === 'error') return 'other';
        if (obj.status === 'ok') return null;
      } catch { /* skip */ }
    }
    return null;
  },
};

// ── Spawner registry ───────────────────────────────────────────────────

const SPAWNERS: Record<string, LlmSpawner> = {
  claude: claudeSpawner,
  'claude-text': claudeTextSpawner,
  codex: codexSpawner,
  'apple-foundation-models': appleFoundationModelsSpawner,
};

/** Get a spawner by provider name. Defaults to claude stream-json. */
export function getSpawner(provider?: string): LlmSpawner {
  if (provider && provider in SPAWNERS) return SPAWNERS[provider];
  return claudeSpawner;
}

// ── Node spawner ───────────────────────────────────────────────────────

/**
 * Production spawner for DAG nodes. Handles shell (bash -c) and
 * claude-code (LlmSpawner dispatch) execution paths.
 */
export async function spawnNodeReal(
  node: AgentNode,
  env: Record<string, string>,
  _opts: { agentId: string; agentSource: Agent['source']; allowUntrustedShell?: ReadonlySet<string>; llmSettings?: LlmSettingsSnapshot },
  onProgress?: (event: SpawnProgress) => void,
  signal?: AbortSignal,
  onSpawn?: (pid: number, startedAtMs: number) => void,
): Promise<SpawnResult> {
  if (node.type === 'shell') {
    if (!node.command) {
      return { result: '', exitCode: 1, error: `Shell node "${node.id}" has no command`, category: 'setup' };
    }
    return spawnProcess('bash', ['-c', node.command], {
      cwd: node.workingDirectory,
      env,
      timeoutSec: node.timeout ?? 300,
      signal,
      onSpawn,
    });
  }

  // claude-code — resolve templates then dispatch to LlmSpawner.
  if (!node.prompt) {
    return { result: '', exitCode: 1, error: `Claude-code node "${node.id}" has no prompt`, category: 'setup' };
  }
  let resolvedPrompt = node.prompt;
  const upstreamMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    const m = k.match(/^UPSTREAM_(.+)_RESULT$/);
    if (m) upstreamMap[m[1].toLowerCase().replace(/_/g, '-')] = v;
  }
  resolvedPrompt = resolveUpstreamTemplate(resolvedPrompt, upstreamMap);
  resolvedPrompt = resolveVarsTemplate(resolvedPrompt, env);
  // {{state}} resolves to $STATE_DIR (set by node-env when dataRoot is
  // configured). Falls through to empty string when unset.
  resolvedPrompt = resolveStateTemplate(resolvedPrompt, env.STATE_DIR);
  resolvedPrompt = substituteInputs(resolvedPrompt, env);

  // Strip UPSTREAM_*_RESULT env vars before exec: claude-code consumed
  // them via {{upstream.X.field}} substitution above (lines 228-233), so
  // the raw env-var copies are now dead weight. Leaving them in argv+env
  // total contributes to E2BIG when execve()'s argv+env exceeds ARG_MAX.
  // Shell nodes still receive these env vars — they're the intended
  // consumer (`$UPSTREAM_<ID>_RESULT` references in the command).
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (!/^UPSTREAM_[A-Z0-9_]+_RESULT$/.test(k)) childEnv[k] = v;
  }

  const chain = buildProviderChain(node.provider, _opts.llmSettings?.providers);

  const attemptedProviders: string[] = [];
  // Per-attempt failure trail: why each non-winning provider was skipped.
  // Surfaced on the node card and logged below so a successful fallback run
  // still records WHY the earlier providers failed.
  const providerFailures: ProviderFailure[] = [];
  let lastResult: SpawnResult | undefined;
  let lastCategory: LlmFailureCategory = 'other';

  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    attemptedProviders.push(provider);
    const result = await runLlmAttempt(provider, node, resolvedPrompt, childEnv, onProgress, signal, onSpawn);

    if (result.exitCode === 0) {
      // Success — annotate with the trail so the dashboard can show
      // "ran on codex after claude failed" without parsing the error
      // breadcrumb.
      return {
        ...result,
        usedLLMProvider: provider,
        attemptedProviders,
        providerFailures: providerFailures.length > 0 ? providerFailures : undefined,
        error: attemptedProviders.length > 1
          ? `Fallback ${provider} succeeded after ${attemptedProviders.slice(0, -1).join(', ')} failed (${lastCategory}).`
          : result.error,
      };
    }

    lastResult = result;
    lastCategory = classifyLlmFailure(result);

    // Record + log WHY this provider failed, so a successful fallback run
    // still leaves a diagnosable trail (the per-attempt error is otherwise
    // discarded once a later provider wins).
    const errSnippet = (result.error ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    providerFailures.push({ provider, category: lastCategory, error: errSnippet || undefined });
    process.stderr.write(
      `[llm-fallback] ${_opts.agentId ?? '?'}/${node.id}: ${provider} failed (${lastCategory})` +
      `${errSnippet ? `: ${errSnippet}` : ''}\n`,
    );

    // Decide whether to continue the waterfall.
    if (!shouldFallback(lastCategory)) break;
    const next = chain[i + 1];
    if (!next) break;

    // Fire telemetry for the hop. The runtime persists this so the
    // settings page can show "claude → codex (timeout) 3m ago".
    _opts.llmSettings?.onFallback?.({
      reason: lastCategory,
      from: provider,
      to: next,
      agentId: _opts.agentId,
      nodeId: node.id,
    });
  }

  // All attempts failed (or the chain ended on a non-fallback
  // category). Return the most recent failure with the trail so the
  // operator can see what was tried.
  return {
    ...(lastResult ?? { result: '', exitCode: 1 }),
    usedLLMProvider: attemptedProviders[attemptedProviders.length - 1],
    attemptedProviders,
    providerFailures: providerFailures.length > 0 ? providerFailures : undefined,
  };
}

/**
 * One LLM CLI invocation under a chosen provider. Extracted so the
 * fallback path can retry under a different provider with the same
 * resolved prompt + env.
 */
async function runLlmAttempt(
  provider: string,
  node: AgentNode,
  resolvedPrompt: string,
  childEnv: Record<string, string>,
  onProgress?: (event: SpawnProgress) => void,
  signal?: AbortSignal,
  onSpawn?: (pid: number, startedAtMs: number) => void,
): Promise<SpawnResult> {
  const spawner = getSpawner(provider);
  const spawnOpts: LlmSpawnOptions = {
    prompt: resolvedPrompt,
    model: node.model,
    maxTurns: node.maxTurns,
    allowedTools: node.allowedTools,
  };
  const args = spawner.buildArgs(spawnOpts);

  // Lazy-resolve binary path. Providers like apple-foundation-models
  // compile a runner on first use; the resolver returns either a
  // ready path or an `unsupported: true` signal we turn into a
  // synthetic binary_missing failure so the waterfall falls through
  // without actually trying to spawn a nonexistent executable.
  let binaryPath = spawner.binary;
  if (spawner.resolveBinary) {
    const resolved = spawner.resolveBinary();
    if ('unsupported' in resolved) {
      return {
        result: '',
        exitCode: 127,
        error: resolved.reason,
        category: 'spawn_failure',
      };
    }
    binaryPath = resolved.path;
  }

  // Merge env. The spawner's buildEnv overrides anything in childEnv
  // with the same key (so PROMPT etc. land cleanly even if the agent
  // env happens to collide).
  const mergedEnv = spawner.buildEnv
    ? { ...childEnv, ...spawner.buildEnv(spawnOpts) }
    : childEnv;

  // Providers that read the prompt from env (Apple FM) skip stdin so
  // the runner doesn't sit waiting for EOF.
  const stdinInput = spawner.promptEnvVar ? undefined : resolvedPrompt;

  const result = await spawnProcess(binaryPath, args, {
    cwd: node.workingDirectory,
    env: mergedEnv,
    stdinInput,
    timeoutSec: node.timeout ?? 300,
    onProgress: onProgress ? (line) => {
      const event = spawner.parseProgress(line);
      if (event) onProgress(event);
    } : undefined,
    extractResult: (stdout) => spawner.extractResult(stdout),
    signal,
    onSpawn,
  });

  // Inline-failure classification (e.g. apple-foundation-models writes
  // `status: "unavailable"` on a successful exit). When the spawner
  // reports a fallback-worthy category, override the result so the
  // waterfall's classifyLlmFailure picks it up.
  if (spawner.classifyResult && result.exitCode === 0) {
    const overrideCategory = spawner.classifyResult(result, result.result ?? '');
    if (overrideCategory === 'binary_missing' || overrideCategory === 'other') {
      return {
        ...result,
        result: '',
        exitCode: 1,
        category: overrideCategory === 'binary_missing' ? 'spawn_failure' : result.category,
        error: result.error ?? 'Provider reported an inline failure status.',
      };
    }
  }

  // Simulated streaming. Non-streaming providers (Apple FM) emit one
  // synthetic output_chunk burst so the typewriter UX stays consistent.
  // We only fire chunks when the run succeeded; failure already exits
  // here and the waterfall falls through.
  if (spawner.simulateStream && result.exitCode === 0 && onProgress && result.result) {
    await simulateStreamingChunks(result.result, onProgress, signal);
  }

  return result;
}

/**
 * Synthetic streaming for non-streaming providers. Splits the
 * extracted text into ~30-char chunks and pacing each by
 * SIMULATED_STREAM_INTERVAL_MS, capped at SIMULATED_STREAM_MAX_MS total
 * so long responses don't drag. Emits each chunk on `onProgress` as an
 * `output_chunk` event — the dashboard's typewriter consumes these
 * identically to real per-token streams from claude.
 */
const SIMULATED_STREAM_INTERVAL_MS = 8;
const SIMULATED_STREAM_MAX_MS = 1500;
const SIMULATED_STREAM_MIN_CHUNK = 30;

async function simulateStreamingChunks(
  text: string,
  onProgress: (event: SpawnProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!text) return;
  // Compute chunk size that keeps total time under MAX_MS.
  const maxChunks = Math.max(1, Math.floor(SIMULATED_STREAM_MAX_MS / SIMULATED_STREAM_INTERVAL_MS));
  const chunkSize = Math.max(SIMULATED_STREAM_MIN_CHUNK, Math.ceil(text.length / maxChunks));
  for (let i = 0; i < text.length; i += chunkSize) {
    if (signal?.aborted) return;
    const chunk = text.slice(i, i + chunkSize);
    onProgress({
      timestamp: new Date().toISOString(),
      type: 'output_chunk',
      message: chunk,
    });
    if (i + chunkSize < text.length) {
      await new Promise<void>((resolve) => setTimeout(resolve, SIMULATED_STREAM_INTERVAL_MS));
    }
  }
}

/**
 * Build the ordered provider waterfall for one node's LLM attempt.
 * The node's pinned provider (if any) goes first regardless of the
 * global configured order. The remaining providers from the global
 * order follow, deduplicated so the same CLI isn't retried back-to-
 * back.
 *
 * This is the load-bearing primitive behind the pinned-provider bug
 * fix: previously a pinned provider was an early-return that skipped
 * fallback entirely. Now the pin only biases the head of the chain,
 * and the rest of the chain still applies as fallbacks on classified
 * failures.
 *
 * Exported for direct unit testing — the waterfall LOOP itself
 * (which calls runLlmAttempt for each chain entry) is integration-
 * tested elsewhere via the dag-executor's spawn-injection seam.
 */
export function buildProviderChain(
  pinnedProvider: string | undefined,
  configuredOrder: readonly string[] | undefined,
): string[] {
  const order = configuredOrder ?? [];
  const seed = pinnedProvider ?? order[0] ?? 'claude';
  const chain = [seed];
  for (const p of order) {
    if (!chain.includes(p)) chain.push(p);
  }
  return chain;
}

/**
 * Inspect a failed `SpawnResult` and classify the failure cause. The
 * classifier is deliberately pattern-based (substring matches over
 * stderr/error) — LLM CLIs don't expose stable exit codes for these
 * conditions, so we rely on observable strings the CLI prints.
 */
export function classifyLlmFailure(result: SpawnResult): LlmFailureCategory {
  if (result.exitCode === 0) return 'other';
  const haystack = `${result.error ?? ''}\n${result.result ?? ''}`.toLowerCase();
  if (result.category === 'spawn_failure'
    || haystack.includes('command not found')
    || haystack.includes('enoent')) {
    return 'binary_missing';
  }
  if (result.category === 'timeout' || haystack.includes('timed out')) {
    return 'timeout';
  }
  if (haystack.includes('credit balance')
    || haystack.includes('insufficient credit')
    || haystack.includes('out of credit')
    || haystack.includes('billing')) {
    return 'credit_exhausted';
  }
  if (haystack.includes('quota exceeded')
    || haystack.includes('quota_exceeded')
    || haystack.includes('limit exceeded')
    || haystack.includes('usage limit')) {
    return 'quota_exceeded';
  }
  if (haystack.includes('rate limit')
    || haystack.includes('rate_limit')
    || haystack.includes('429')
    || haystack.includes('too many requests')) {
    return 'rate_limited';
  }
  if (haystack.includes('not authenticated')
    || haystack.includes('login required')
    || haystack.includes('please log in')
    || haystack.includes('401')
    || haystack.includes('unauthorized')) {
    return 'auth_required';
  }
  return 'other';
}

/**
 * Categories worth swapping providers for. The bar: "another provider
 * in the chain could plausibly succeed where this one failed." We fall
 * back on:
 *   - binary_missing  — the CLI isn't installed at all
 *   - timeout         — this provider hung; the next one might not
 *   - credit_exhausted / quota_exceeded — out of budget on this provider
 *   - auth_required   — operator hasn't logged in (or session expired)
 *                       on this provider but might be authed on another
 *   - rate_limited    — this provider's 429; the next provider in the
 *                       chain has its own quota and is the whole point
 *                       of wiring a waterfall
 *
 * 'other' stays excluded — silent fallback on unclassified errors masks
 * real bugs that the operator should see (and that switching providers
 * would not fix).
 *
 * Exported for unit testing — callers in this module use it directly.
 */
export function shouldFallback(category: LlmFailureCategory): boolean {
  return category === 'credit_exhausted'
    || category === 'quota_exceeded'
    || category === 'binary_missing'
    || category === 'timeout'
    || category === 'auth_required'
    || category === 'rate_limited';
}

// ── Process spawner ────────────────────────────────────────────────────

export interface SpawnProcessOptions {
  cwd?: string;
  env: Record<string, string>;
  timeoutSec: number;
  /** Called with each line of stdout for real-time progress parsing. */
  onProgress?: (line: string) => void;
  /** Transform raw stdout into final result (for stream-json parsing). */
  extractResult?: (stdout: string) => string;
  /** Cancellation signal. SIGTERMs the child process when aborted. */
  signal?: AbortSignal;
  /**
   * When set, opens stdin as a pipe, writes this string, and closes it.
   * Used by the claude / codex spawners so the prompt rides on stdin
   * instead of argv — argv+env is bounded by ARG_MAX (~256KB on Linux,
   * stricter under sandboxes), and any agent whose prompt-after-template-
   * substitution exceeds that ceiling fails with `spawn E2BIG` otherwise.
   */
  stdinInput?: string;
  /**
   * PR C (orphan-kill): fires the moment `spawn()` returns a pid, BEFORE
   * any pipe wiring or stdin writes. The executor persists pid + startedAtMs
   * onto the in-flight `node_executions` row so a future dashboard restart
   * can read it back and SIGKILL the orphan instead of letting it burn
   * tokens until it finishes naturally. startedAtMs is `Date.now()` at
   * spawn time; the reaper ps-cross-checks elapsed time against it to
   * defend against PID reuse on long-uptime machines.
   */
  onSpawn?: (pid: number, startedAtMs: number) => void;
}

/**
 * Soft cap on the rendered argv + env total. Sits well below ARG_MAX
 * (~256KB Linux, often stricter under sandboxes / containers) so the
 * executor refuses with a structured error before the kernel rejects
 * with `spawn E2BIG`. The fix-claude-stdin (#220) and tempfile-fallback
 * (this PR) paths handle the common offenders; this guardrail is the
 * safety net for any future regression or shell-node path that stacks
 * multiple fat upstreams without using $UPSTREAM_<ID>_RESULT_FILE.
 */
const SPAWN_TOTAL_SOFT_CAP = 200 * 1024;

function approximateExecSize(args: string[], env: Record<string, string>, stdinInput: string | undefined): number {
  let total = 0;
  // argv slot overhead: each arg pays its byte length + a NUL terminator.
  for (const a of args) total += a.length + 1;
  // env slot overhead: each "K=V" pays both lengths + NUL + the equals.
  for (const [k, v] of Object.entries(env)) total += k.length + v.length + 2;
  // Stdin doesn't go through execve, but a runaway prompt is still worth
  // mentioning in the error so authors know which lever to pull. Counted
  // separately from the argv+env cap.
  void stdinInput;
  return total;
}

/**
 * Low-level process spawn with timeout, exit-code categorization,
 * optional per-line progress callback, and result extraction.
 */
export async function spawnProcess(
  bin: string,
  args: string[],
  opts: SpawnProcessOptions,
): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolve) => {
    let child: ChildProcess;
    let killed = false;
    const stdinMode = opts.stdinInput !== undefined ? 'pipe' : 'ignore';

    const execSize = approximateExecSize(args, opts.env, opts.stdinInput);
    if (execSize > SPAWN_TOTAL_SOFT_CAP) {
      // Find the heaviest contributor so the error tells the author
      // which env var or arg to trim or move to a tempfile.
      const heaviestEnv = Object.entries(opts.env)
        .map(([k, v]) => ({ k, bytes: k.length + v.length + 2 }))
        .sort((a, b) => b.bytes - a.bytes)[0];
      const heaviestHint = heaviestEnv && heaviestEnv.bytes > 8 * 1024
        ? ` Largest env var: ${heaviestEnv.k} (${heaviestEnv.bytes} bytes); consider $${heaviestEnv.k}_FILE if shell, or upstream trimming.`
        : '';
      resolve({
        result: '',
        exitCode: 127,
        error: `Refusing spawn: argv+env total ${execSize} bytes exceeds soft cap ${SPAWN_TOTAL_SOFT_CAP} (kernel ARG_MAX ~256KB).${heaviestHint}`,
        category: 'setup',
      });
      return;
    }

    try {
      child = spawn(bin, args, {
        cwd: opts.cwd,
        env: opts.env,
        stdio: [stdinMode, 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ result: '', exitCode: 127, error: (err as Error).message, category: 'spawn_failure' });
      return;
    }
    // Report the freshly-spawned pid + start time so the executor can persist
    // them on the node_executions row. Fires before stdin write so a crash
    // between spawn() and the first stdout chunk still leaves a kill handle.
    // Wrapped in try/catch: the callback shouldn't kill the run if it throws.
    if (opts.onSpawn && typeof child.pid === 'number') {
      try { opts.onSpawn(child.pid, Date.now()); } catch { /* never let onSpawn break spawning */ }
    }
    if (opts.stdinInput !== undefined && child.stdin) {
      child.stdin.on('error', () => { /* child may close before we finish writing — swallow EPIPE */ });
      child.stdin.end(opts.stdinInput);
    }

    let stdout = '';
    let stderr = '';
    let stdoutBuffer = '';

    child.stdout!.on('data', (d: Buffer) => {
      const chunk = d.toString();
      stdout += chunk;

      // Line-by-line progress callback.
      if (opts.onProgress) {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split('\n');
        // Keep the last incomplete line in the buffer.
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim()) opts.onProgress(line);
        }
      }
    });

    child.stderr!.on('data', (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 5000);
    }, opts.timeoutSec * 1000);

    // Cancellation signal: SIGTERM the child when the signal fires, then
    // escalate to SIGKILL after 5s if the child is still alive. Mirrors the
    // timeout path above. Without escalation, a claude/codex CLI stuck in a
    // slow HTTP read could ignore SIGTERM indefinitely, leaving the executor
    // await pending forever and the run/node rows in `running` until the
    // next dashboard restart (which reaps them via reapOrphanedRuns).
    if (opts.signal) {
      const onAbort = () => {
        killed = true;
        child.kill('SIGTERM');
        setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 5000);
      };
      if (opts.signal.aborted) {
        onAbort();
      } else {
        opts.signal.addEventListener('abort', onAbort, { once: true });
        child.on('close', () => opts.signal!.removeEventListener('abort', onAbort));
      }
    }

    child.on('close', (code: number | null) => {
      clearTimeout(timer);

      // Flush any remaining buffered stdout line.
      if (opts.onProgress && stdoutBuffer.trim()) {
        opts.onProgress(stdoutBuffer);
      }

      const finalResult = opts.extractResult ? opts.extractResult(stdout) : stdout;

      if (killed) {
        resolve({ result: finalResult, exitCode: 124, error: `Timed out after ${opts.timeoutSec}s`, category: 'timeout' });
      } else if (code === 0) {
        resolve({ result: finalResult, exitCode: 0 });
      } else {
        resolve({
          result: finalResult,
          exitCode: code ?? 1,
          error: stderr || `Process exited with code ${code}`,
          category: 'exit_nonzero',
        });
      }
    });

    child.on('error', (err: Error) => {
      clearTimeout(timer);
      resolve({ result: '', exitCode: 127, error: err.message, category: 'spawn_failure' });
    });
  });
}
