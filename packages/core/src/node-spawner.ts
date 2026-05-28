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

// ── Types ──────────────────────────────────────────────────────────────

export type SpawnResult = ExecutionResult & { category?: NodeErrorCategory };

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
  primary?: string;
  fallback?: string;
  onFallback?: (event: {
    reason: LlmFailureCategory;
    primary: string;
    fallback: string;
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

export type SpawnNodeFn = (
  node: AgentNode,
  env: Record<string, string>,
  opts: { agentId: string; agentSource: Agent['source']; allowUntrustedShell?: ReadonlySet<string>; llmSettings?: LlmSettingsSnapshot },
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
  /** CLI binary name (e.g. 'claude', 'codex'). */
  binary: string;
  /** Build the CLI argument list. */
  buildArgs(opts: LlmSpawnOptions): string[];
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
      if (event.type === 'assistant') {
        return {
          timestamp: new Date().toISOString(),
          type: 'turn_start',
          message: 'Claude is responding...',
        };
      }
      if (event.type === 'tool_use' || (event.type === 'assistant' && event.message?.content?.some?.((c: { type: string }) => c.type === 'tool_use'))) {
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
    const args = ['exec', '-s', 'read-only'];
    if (opts.model) args.push('-m', opts.model);
    return args;
  },

  parseProgress(): SpawnProgress | null { return null; },
  extractResult(stdout: string): string { return stdout; },
};

// ── Spawner registry ───────────────────────────────────────────────────

const SPAWNERS: Record<string, LlmSpawner> = {
  claude: claudeSpawner,
  'claude-text': claudeTextSpawner,
  codex: codexSpawner,
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

  // Resolve the primary provider: explicit per-node setting wins,
  // then the operator's configured global primary, then the hardcoded
  // claude default. The fallback (if any) is consulted only when the
  // primary attempt returns a fallback-worthy failure.
  const primaryProvider = node.provider ?? _opts.llmSettings?.primary ?? 'claude';
  const primaryResult = await runLlmAttempt(primaryProvider, node, resolvedPrompt, childEnv, onProgress, signal, onSpawn);

  const fallbackProvider = _opts.llmSettings?.fallback;
  if (!fallbackProvider || fallbackProvider === primaryProvider) {
    return primaryResult;
  }
  const category = classifyLlmFailure(primaryResult);
  if (!shouldFallback(category)) {
    return primaryResult;
  }

  // Fire telemetry callback first so the operator sees the event on
  // /settings/llm even if the fallback itself fails. The retry
  // proceeds regardless.
  _opts.llmSettings?.onFallback?.({
    reason: category,
    primary: primaryProvider,
    fallback: fallbackProvider,
    agentId: _opts.agentId,
    nodeId: node.id,
  });

  const fallbackResult = await runLlmAttempt(fallbackProvider, node, resolvedPrompt, childEnv, onProgress, signal, onSpawn);
  // If the fallback succeeded, return its result but tag the error
  // field with a breadcrumb so logs show the primary was attempted
  // first. If it also failed, return its result (the more recent
  // attempt is the one the operator will be debugging).
  if (fallbackResult.exitCode === 0) {
    return {
      ...fallbackResult,
      error: `Fallback ${fallbackProvider} succeeded after primary ${primaryProvider} failed (${category}).`,
    };
  }
  return fallbackResult;
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
  const args = spawner.buildArgs({
    prompt: resolvedPrompt,
    model: node.model,
    maxTurns: node.maxTurns,
    allowedTools: node.allowedTools,
  });
  return spawnProcess(spawner.binary, args, {
    cwd: node.workingDirectory,
    env: childEnv,
    stdinInput: resolvedPrompt,
    timeoutSec: node.timeout ?? 300,
    onProgress: onProgress ? (line) => {
      const event = spawner.parseProgress(line);
      if (event) onProgress(event);
    } : undefined,
    extractResult: (stdout) => spawner.extractResult(stdout),
    signal,
    onSpawn,
  });
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
 * Categories worth swapping providers for. Rate limits and auth
 * failures are excluded: rate limits are transient on the same
 * provider, auth requires operator action, and 'other' usually means
 * a real bug we don't want to mask by silently switching.
 */
function shouldFallback(category: LlmFailureCategory): boolean {
  return category === 'credit_exhausted'
    || category === 'quota_exceeded'
    || category === 'binary_missing'
    || category === 'timeout';
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
