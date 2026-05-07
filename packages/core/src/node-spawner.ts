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

export type SpawnNodeFn = (
  node: AgentNode,
  env: Record<string, string>,
  opts: { agentId: string; agentSource: Agent['source']; allowUntrustedShell?: ReadonlySet<string> },
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
  _opts: { agentId: string; agentSource: Agent['source']; allowUntrustedShell?: ReadonlySet<string> },
  onProgress?: (event: SpawnProgress) => void,
  signal?: AbortSignal,
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

  const spawner = getSpawner(node.provider ?? 'claude');
  const args = spawner.buildArgs({
    prompt: resolvedPrompt,
    model: node.model,
    maxTurns: node.maxTurns,
    allowedTools: node.allowedTools,
  });

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

  return spawnProcess(spawner.binary, args, {
    cwd: node.workingDirectory,
    env: childEnv,
    // Prompt rides on stdin — argv would also count toward ARG_MAX, and
    // `{{upstream.X.result}}` substitution can produce 100KB+ prompts on
    // agents like ashby-job-finder (fetch-jobs-html alone is multi-100KB).
    stdinInput: resolvedPrompt,
    timeoutSec: node.timeout ?? 300,
    onProgress: onProgress ? (line) => {
      const event = spawner.parseProgress(line);
      if (event) onProgress(event);
    } : undefined,
    extractResult: (stdout) => spawner.extractResult(stdout),
    signal,
  });
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

    // Cancellation signal: SIGTERM the child when the signal fires.
    if (opts.signal) {
      const onAbort = () => { killed = true; child.kill('SIGTERM'); };
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
