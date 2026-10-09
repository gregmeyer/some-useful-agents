/**
 * Process spawning for DAG node execution. Provides an LlmSpawner
 * abstraction for multi-provider support (claude, codex, future) with
 * real-time progress callbacks for turn tracking.
 *
 * Extracted from dag-executor.ts in PR 1 (file split).
 * LlmSpawner interface added in PR 2 (this PR).
 */

import { claudeUsage, codexUsage, codexDefaultModel, priceUsage, totalUsage, localProviderNames, formatUsd, type LlmUsage, type NodeUsage, type PriceTable } from './usage.js';
import { MEMORY_TOOL_IDS } from './memory-store.js';
import type { SpendLimits } from './spend-limits.js';
import type { BuiltinToolContext } from './tool-types.js';
import type { AgentCallContext, AgentCallInfo } from './agent-tool.js';
import { capToolText, TOOL_CALL_ARGS_CAP, TOOL_CALL_RESULT_PREVIEW_CAP, type ToolCallRecord } from './tool-call-record.js';
import type { ChildProcess } from 'node:child_process';
import { execFileSync, spawn } from 'node:child_process';
import type { Agent, AgentNode, NodeErrorCategory, OutputContract } from './agent-v2-types.js';
import type { ExecutionResult } from './agent-executor.js';
import { substituteInputs } from './input-resolver.js';
import { resolveUpstreamTemplate, resolveVarsTemplate, resolveStateTemplate } from './node-templates.js';
import { ensureAppleRunner } from './apple-foundationmodels-runner.js';
import { invokeOpenAiChat } from './openai-http-invoker.js';
import type { CustomLlmProvider } from './llm-settings-store.js';
import { resolveExposedToolDefs, buildToolExecutor } from './llm-tool-dispatch.js';
import type { OpenAiTool, ToolCallExecutor } from './llm-tools.js';
import { startToolEndpoint, TOOL_ENDPOINT_SERVER_NAME, type ToolEndpoint } from './tool-mcp-endpoint.js';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolStore } from './tool-store.js';
import type { IntegrationsStore } from './integrations-store.js';
import type { VariablesStore } from './variables-store.js';
import type { PolicyDocument } from './policy-store.js';
import type { SecretsStore } from './secrets-store.js';

// ── Types ──────────────────────────────────────────────────────────────

/**
 * One failed provider attempt in the LLM waterfall: which provider, the
 * classified failure category (timeout / credit_exhausted / binary_missing /
 * …), and a short error snippet for diagnosis.
 */
/** Tools a node can run without: a provider that can't call them isn't skipped for them. */
// ask-human too: a provider that can't call tools just runs without it.
const OPTIONAL_TOOL_IDS: ReadonlySet<string> = new Set<string>([...MEMORY_TOOL_IDS, 'ask-human']);

/**
 * `web-search` in a node's `tools:` isn't a sua tool: it turns on the CLI's
 * own live search (claude's WebSearch, codex's web_search). A provider
 * without one is skipped for that node, like any missing tool.
 */
export const WEB_SEARCH_TOOL_ID = 'web-search';

/** Whether a node asks for live search: `tools: [web-search]`, or claude's own `WebSearch` in allowedTools (which codex now honours too). */
export function nodeWantsWebSearch(node: Pick<AgentNode, 'tools' | 'allowedTools'>): boolean {
  return (node.tools ?? []).includes(WEB_SEARCH_TOOL_ID)
    || (node.allowedTools ?? []).some((t) => t === 'WebSearch' || t === WEB_SEARCH_TOOL_ID);
}

/** The node's sua tools, served over the tool endpoint (everything but `web-search`). */
const suaToolsOf = (node: Pick<AgentNode, 'tools'>): string[] => (node.tools ?? []).filter((id) => id !== WEB_SEARCH_TOOL_ID);

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
  /**
   * Every tool call the model made during this node, across all providers the
   * waterfall tried, in order. Returned (not written) so a Temporal worker and
   * the in-process executor behave the same; the executor persists them.
   */
  toolCalls?: ToolCallRecord[];
  /**
   * Tokens and cost (USD at list price) across every provider attempt — a
   * failed attempt still spent money. Set by the LLM waterfall; see usage.ts.
   */
  usage?: NodeUsage;
  /** One attempt's usage, set by the attempt functions; the waterfall folds these into `usage`. */
  attemptUsage?: LlmUsage;
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
   * Operator-defined OpenAI-compatible HTTP providers, keyed into the waterfall
   * by `name`. When a chain entry matches a custom provider's name,
   * `runLlmAttempt` dispatches over HTTP (`invokeOpenAiChat`) instead of
   * spawning a CLI. Absent ⇒ only builtin CLI providers are available.
   */
  customProviders?: CustomLlmProvider[];
  /** USD-per-million-token prices for providers that report only tokens (usage.ts). */
  pricing?: PriceTable;
  /** Default spend limits for agents without their own (spend-limits.ts). */
  spendLimits?: SpendLimits;
  /**
   * Providers the operator toggled OFF globally. Already excluded from
   * `providers` (the runtime chain), but passed through so a node that PINS a
   * disabled provider is neutralized too — the pin falls through to the first
   * enabled provider instead of forcing the disabled one to run.
   */
  disabledProviders?: string[];
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
 * - `tool_unavailable` — the node declares `tools:` this provider can't
 *   call (e.g. codex's read-only sandbox has no web access); skipped
 *   before spawning so the waterfall reaches a provider that can
 * - `model_unavailable` — the provider rejected the configured model
 *   (retired, or not on this account's plan); a config problem on this
 *   provider that another provider doesn't share
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
  | 'invalid_output'
  | 'tool_unavailable'
  | 'model_unavailable'
  /** Hit the run's spend limit. Never falls back: another provider would spend more. */
  | 'budget_exhausted'
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
  opts: {
    agentId: string;
    agentSource: Agent['source'];
    allowUntrustedShell?: ReadonlySet<string>;
    llmSettings?: LlmSettingsSnapshot;
    secretsStore?: SecretsStore;
    policyDocument?: PolicyDocument;
    toolStore?: ToolStore;
    integrationsStore?: IntegrationsStore;
    variablesStore?: VariablesStore;
    experimentalApple?: boolean;
    /**
     * Pre-built Agent Behavior conditioning block, or undefined when the agent
     * declares no `behaviors:`. Already resolved and scope-checked by
     * behavior-conditioning/resolve.ts — by the time it reaches here it is
     * project-scope text that the operator explicitly opted into.
     */
    behaviorPreamble?: string;
    /** Agents as tools (`agent:<id>`): the live call context, in-process only. */
    agentCalls?: AgentCallContext;
    /**
     * The same call chain as plain data, so a backend that can't carry the
     * live context (a Temporal worker) can rebuild it next to its own stores.
     */
    agentCallInfo?: AgentCallInfo;
    /** Agent memory for the memory tools (in-process only). See memory-store.ts. */
    memory?: BuiltinToolContext['memory'];
    boards?: BuiltinToolContext['boards'];
    /** Set when the agent has memory on, so a backend that can't carry `memory` (Temporal) rebuilds it. */
    memoryRunId?: string;
    /** The ask-human tool's context (in-process only). See human-questions.ts. */
    askHuman?: BuiltinToolContext['askHuman'];
    /** Set when the node may ask, so a backend that can't carry `askHuman` (Temporal) rebuilds it. */
    askRunId?: string;
    /** What's left of the run's spend limit, USD (spend-limits.ts). Unset ⇒ no limit. */
    spendBudgetUsd?: number;
  },
  onProgress?: (event: SpawnProgress) => void,
  signal?: AbortSignal,
  onSpawn?: (pid: number, startedAtMs: number) => void,
  onChildExit?: () => void,
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
    /**
     * A small piece of the model's text as it's generated (claude with
     * --include-partial-messages). Live listeners only: the executor does not
     * store these in progressJson, and the full message still arrives as an
     * `output_chunk`.
     */
    | 'output_delta'
    | 'loop_iteration_start' | 'loop_iteration_complete';
  turn?: number;
  maxTurns?: number;
  /**
   * Identifies the model turn this event belongs to (claude: the assistant
   * message id). Counting distinct ids gives the turns used so far, for
   * providers that don't number their turns.
   */
  turnId?: string;
  message?: string;
  /** Tool being invoked (model-driven tool loop). Present on `tool_use` events. */
  toolName?: string;
  /** Whether this `tool_use` event is the model's call or the tool's result. */
  toolStatus?: 'call' | 'result';
  /** Short preview of the call args (on 'call') or the result (on 'result'). */
  preview?: string;
  /** True when a tool result was an error the model must recover from. */
  isError?: boolean;
}

// ── LlmSpawner interface ───────────────────────────────────────────────

export interface LlmSpawnOptions {
  prompt: string;
  model?: string;
  maxTurns?: number;
  allowedTools?: string[];
  /**
   * `--mcp-config` file for sua's per-attempt tool endpoint (see
   * tool-mcp-endpoint.ts). Only for spawners with `supportsMcpTools`.
   */
  mcpConfigPath?: string;
  /**
   * sua's per-attempt tool endpoint, for CLIs configured by flags + env
   * rather than a file (codex). The token goes in the environment.
   */
  mcpEndpoint?: { url: string; token: string };
  /** Spend cap for this attempt, USD (claude `--max-budget-usd`). */
  maxBudgetUsd?: number;
  /** Turn on the CLI's own live web search (see `nativeWebSearch`). */
  webSearch?: boolean;
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
  /** Build the CLI argument list. `env` is the child's environment (e.g. its PATH). */
  buildArgs(opts: LlmSpawnOptions, env?: Record<string, string>): string[];
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
  /**
   * The CLI can load an MCP server config, so a node's declared `tools:` are
   * served to it from sua's per-attempt tool endpoint (ADR-0036). A CLI
   * without this is skipped as `tool_unavailable` for nodes that declare
   * tools, rather than run without them.
   */
  supportsMcpTools?: boolean;
  /**
   * The CLI has its own live web search, turned on by `webSearch` in the
   * spawn options. A node that declares `tools: [web-search]` skips a
   * provider without it.
   */
  nativeWebSearch?: boolean;
  /**
   * Tool calls the CLI refused during the run (raw stdout in). A refused
   * call still exits 0 with a "success" result, so without this the node
   * reads as a clean answer built on data the model never got.
   */
  detectDeniedTools?: (rawStdout: string) => string[];
  /**
   * The provider's own error message from a failed run (raw stdout in), for
   * CLIs that report failures as JSON events. Replaces stderr as the node
   * error when present: stderr carries unrelated noise (e.g. codex logging
   * its MCP servers' auth errors) that otherwise decides the category.
   */
  extractError?: (rawStdout: string) => string | undefined;
  /**
   * True when the CLI finished its turn and gave its answer (raw stdout in),
   * so a non-zero exit after that (codex exits 1 while shutting down at
   * times) keeps the answer, with a warning, instead of failing the node.
   */
  finishedTurn?: (rawStdout: string) => boolean;
  /** Its own noise to strip from stderr before it's shown as an error ("Reading prompt from stdin..."). */
  stderrNoise?: RegExp;
  /** The CLI's own tool calls, read back from its event stream (raw stdout in). */
  extractToolCalls?: (rawStdout: string) => ToolCallRecord[];
  /** True when the CLI stopped because it hit `maxBudgetUsd` (raw stdout in). */
  stoppedAtBudget?: (rawStdout: string) => boolean;
  /** Tokens (and cost, if the CLI reports it) for the attempt, from its event stream. */
  extractUsage?: (rawStdout: string, opts: LlmSpawnOptions) => LlmUsage | undefined;
}

/**
 * codex finished its turn: a `turn.completed` event and a final agent
 * message, and no `turn.failed` / `error` event.
 */
export function codexFinishedTurn(rawStdout: string): boolean {
  let completed = false; let answered = false;
  for (const line of rawStdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let event: { type?: string; item?: { type?: string; text?: unknown } };
    try { event = JSON.parse(t); } catch { continue; }
    if (event.type === 'turn.failed' || event.type === 'error') return false;
    if (event.type === 'turn.completed') completed = true;
    if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string' && event.item.text.trim()) answered = true;
  }
  return completed && answered;
}

/**
 * Message from codex's `turn.failed` (or `error`) event. The message is often
 * itself a JSON API error; unwrap it to "<status> <type>: <message>".
 */
export function codexFailureMessage(rawStdout: string): string | undefined {
  const lines = rawStdout.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    let event: { type?: string; message?: unknown; error?: { message?: unknown } };
    try { event = JSON.parse(line); } catch { continue; }
    const raw = event.type === 'turn.failed' ? event.error?.message
      : event.type === 'error' ? event.message
      : undefined;
    if (typeof raw !== 'string' || raw.length === 0) continue;
    try {
      const inner = JSON.parse(raw) as { status?: number; error?: { type?: string; message?: string } };
      if (inner.error?.message) {
        const prefix = [inner.status, inner.error.type].filter(Boolean).join(' ');
        return prefix ? `${prefix}: ${inner.error.message}` : inner.error.message;
      }
    } catch { /* plain-text message */ }
    return raw;
  }
  return undefined;
}

/**
 * claude's own tool calls from its stream-json output: `tool_use` items in
 * `assistant` events, paired by id with `tool_result` items in `user` events.
 * A call with no result (run killed mid-call) is still recorded, as an error.
 * The stream carries no per-event timestamps, so timing is left unset.
 */
export function claudeToolCalls(rawStdout: string): ToolCallRecord[] {
  const calls: ToolCallRecord[] = [];
  const byId = new Map<string, ToolCallRecord>();
  for (const line of rawStdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event: { type?: string; message?: { content?: unknown } };
    try { event = JSON.parse(trimmed); } catch { continue; }
    const content = Array.isArray(event.message?.content) ? event.message!.content as Array<Record<string, unknown>> : [];
    if (event.type === 'assistant') {
      for (const c of content) {
        if (c?.type !== 'tool_use' || typeof c.name !== 'string') continue;
        const record: ToolCallRecord = {
          source: 'native',
          toolId: c.name,
          argsJson: capToolText(JSON.stringify(c.input ?? {}), TOOL_CALL_ARGS_CAP),
          resultPreview: '(no result: the run ended before this call returned)',
          resultChars: 0,
          isError: true,
        };
        calls.push(record);
        if (typeof c.id === 'string') byId.set(c.id, record);
      }
    } else if (event.type === 'user') {
      for (const c of content) {
        if (c?.type !== 'tool_result' || typeof c.tool_use_id !== 'string') continue;
        const record = byId.get(c.tool_use_id);
        if (!record) continue;
        const text = typeof c.content === 'string'
          ? c.content
          : Array.isArray(c.content)
            ? (c.content as Array<{ type?: string; text?: unknown }>)
                .map((b) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('\n')
            : JSON.stringify(c.content ?? '');
        record.resultPreview = capToolText(text, TOOL_CALL_RESULT_PREVIEW_CAP);
        record.resultChars = text.length;
        record.isError = c.is_error === true;
      }
    }
  }
  return calls;
}

/** Tool names from the `permission_denials` of claude's stream-json `result` event. */
export function claudeDeniedTools(rawStdout: string): string[] {
  const lines = rawStdout.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      const event = JSON.parse(line);
      if (event.type !== 'result') continue;
      const denials = Array.isArray(event.permission_denials) ? event.permission_denials : [];
      const names = denials
        .map((d: { tool_name?: unknown }) => (typeof d?.tool_name === 'string' ? d.tool_name : ''))
        .filter((n: string) => n.length > 0);
      return [...new Set<string>(names)];
    } catch { continue; }
  }
  return [];
}

// ── Claude spawner ─────────────────────────────────────────────────────

/** "error_max_turns: Reached maximum number of turns (8)" from a claude `result` event. */
function claudeResultError(event: Record<string, unknown>): string | undefined {
  const errors = Array.isArray(event.errors) ? event.errors.filter((e): e is string => typeof e === 'string') : [];
  const subtype = typeof event.subtype === 'string' && event.subtype !== 'success' ? event.subtype : undefined;
  if (!errors.length && !subtype) return undefined;
  return [subtype, errors.join('; ')].filter(Boolean).join(': ');
}

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
    // --include-partial-messages: text deltas as the model writes, so live
    // chat can stream it (parseProgress → output_delta).
    const args = ['--print', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
    if (opts.model) args.push('--model', opts.model);
    if (opts.maxTurns) args.push('--max-turns', String(opts.maxTurns));
    const allowed = claudeAllowedTools(opts);
    if (allowed.length) args.push('--allowedTools', allowed.join(','));
    // Only sua's endpoint: the operator's own claude MCP servers (Notion, …)
    // must not leak into an agent run.
    if (opts.mcpConfigPath) args.push('--mcp-config', opts.mcpConfigPath, '--strict-mcp-config');
    // Checked by the CLI after each turn, so the run can end one turn over.
    if (opts.maxBudgetUsd !== undefined) args.push('--max-budget-usd', Math.max(0.0001, opts.maxBudgetUsd).toFixed(4));
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
      if (event.type === 'stream_event' && event.event?.type === 'content_block_delta'
        && event.event.delta?.type === 'text_delta' && typeof event.event.delta.text === 'string' && event.event.delta.text) {
        return { timestamp: new Date().toISOString(), type: 'output_delta', message: event.event.delta.text };
      }
      if (event.type === 'assistant') {
        const content = event.message?.content;
        const turnId = typeof event.message?.id === 'string' ? event.message.id as string : undefined;
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
                ...(turnId ? { turnId } : {}),
              };
            }
          }
          // Tool-use without text: surface that explicitly so the
          // dashboard's witty-label loop can flip to the action-running
          // phase rather than show the triage thinking phase.
          const toolUse = content.find((c: { type?: string }) => c && c.type === 'tool_use') as
            { name?: unknown; input?: unknown } | undefined;
          if (toolUse) {
            const toolName = typeof toolUse.name === 'string' ? toolUse.name : undefined;
            return {
              timestamp: new Date().toISOString(),
              type: 'tool_use',
              message: toolName ? `Calling ${toolName}` : 'Using a tool...',
              ...(toolName ? { toolName, toolStatus: 'call' as const, preview: JSON.stringify(toolUse.input ?? {}).slice(0, 200) } : {}),
              ...(turnId ? { turnId } : {}),
            };
          }
        }
        // Empty assistant event (rare, but handle gracefully) — keep
        // the old "thinking" signal so the UI knows something happened.
        return {
          timestamp: new Date().toISOString(),
          type: 'turn_start',
          message: 'Claude is responding...',
          ...(turnId ? { turnId } : {}),
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
        // A failed run's result event has no text, only `errors` (e.g. on
        // error_max_turns). Return those, not the raw stream: it carries a
        // rate_limit_event on every run, which read as rate_limited.
        if (event.type === 'result') return claudeResultError(event) ?? '';
      } catch { continue; }
    }
    // Fallback: if no result event found, return raw stdout (shouldn't happen).
    return stdout;
  },

  extractError: (stdout) => {
    const lines = stdout.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line.startsWith('{')) continue;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        if (event.type === 'result') return event.is_error ? claudeResultError(event) : undefined;
      } catch { continue; }
    }
    return undefined;
  },
  supportsMcpTools: true,
  nativeWebSearch: true,
  detectDeniedTools: claudeDeniedTools,
  extractToolCalls: claudeToolCalls,
  extractUsage: (stdout) => claudeUsage(stdout),
  stoppedAtBudget: (stdout) => /"subtype"\s*:\s*"error_max_budget_usd"/.test(stdout),
};

/** claude's --allowedTools: the node's own, plus WebSearch when it asks for live search. */
function claudeAllowedTools(opts: LlmSpawnOptions): string[] {
  const own = (opts.allowedTools ?? []).filter((t) => t !== WEB_SEARCH_TOOL_ID);
  return opts.webSearch && !own.includes('WebSearch') ? [...own, 'WebSearch'] : own;
}

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
    const allowed = claudeAllowedTools(opts);
    if (allowed.length) args.push('--allowedTools', allowed.join(','));
    // Only sua's endpoint: the operator's own claude MCP servers (Notion, …)
    // must not leak into an agent run.
    if (opts.mcpConfigPath) args.push('--mcp-config', opts.mcpConfigPath, '--strict-mcp-config');
    return args;
  },

  parseProgress(): SpawnProgress | null { return null; },
  extractResult(stdout: string): string { return stdout; },
  supportsMcpTools: true,
  nativeWebSearch: true,
};

// ── Codex spawner ──────────────────────────────────────────────────────

/**
 * OpenAI Codex CLI spawner. Uses `codex exec -s read-only` for
 * non-interactive execution. No structured progress events.
 */
/** Env var the codex child reads sua's tool-endpoint token from. */
export const CODEX_TOOL_TOKEN_ENV = 'SUA_TOOL_ENDPOINT_TOKEN';

let codexServersCache: { at: number; path: string; names: string[] } | undefined;
/**
 * MCP servers the operator configured for codex (`codex mcp list --json`,
 * ~60ms; cached for a minute). Each is switched off for a sua attempt so only
 * sua's endpoint loads. A listing that fails yields none — the attempt still
 * works, just without that isolation.
 */
export function codexConfiguredMcpServers(env?: Record<string, string>, now = Date.now()): string[] {
  // The same codex the attempt will run: the child's PATH decides.
  const path = env?.PATH ?? process.env.PATH ?? '';
  if (codexServersCache && codexServersCache.path === path && now - codexServersCache.at < 60_000) return codexServersCache.names;
  let names: string[] = [];
  try {
    const out = execFileSync('codex', ['mcp', 'list', '--json'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, PATH: path } });
    const listed = JSON.parse(out) as Array<{ name?: unknown }>;
    names = listed.map((s) => s.name).filter((n): n is string => typeof n === 'string' && /^[A-Za-z0-9_-]+$/.test(n));
  } catch { names = []; }
  codexServersCache = { at: now, path, names };
  return names;
}

/** Test seam: forget the cached codex server list. */
export function resetCodexMcpServerCache(): void { codexServersCache = undefined; }

export const codexSpawner: LlmSpawner = {
  binary: 'codex',

  buildEnv(opts: LlmSpawnOptions): Record<string, string> {
    return opts.mcpEndpoint ? { [CODEX_TOOL_TOKEN_ENV]: opts.mcpEndpoint.token } : {};
  },

  buildArgs(opts: LlmSpawnOptions, env?: Record<string, string>): string[] {
    // Prompt rides on stdin (see claudeSpawner note). `codex exec` reads
    // its prompt from stdin when no positional argument is given.
    void opts.prompt;
    // --json emits one JSON event per line, mirroring claude's
    // `--output-format stream-json`. This unlocks the inbox SSE
    // pipeline: turn.started → output_chunk → turn.completed get
    // forwarded as triage:started → triage:token → triage:complete.
    // --skip-git-repo-check: codex refuses to run outside a git repo it
    // trusts, which breaks any sua project in a plain folder. The check
    // guards against unreviewable file edits; this run is read-only.
    const args = ['exec', '--json', '-s', 'read-only', '--skip-git-repo-check'];
    if (opts.model) args.push('-m', opts.model);
    // sua's tools (ADR-0044): codex takes MCP servers as config, so the
    // per-attempt endpoint goes in with -c. Only sua's server is on for this
    // run (the operator's own codex MCP servers are switched off, like
    // claude's --strict-mcp-config), its tools are pre-approved (`exec` has
    // nobody to approve them), and the bearer token comes from the env so it
    // never appears in `ps`.
    if (opts.mcpEndpoint) {
      for (const name of codexConfiguredMcpServers(env)) {
        if (name !== TOOL_ENDPOINT_SERVER_NAME) args.push('-c', `mcp_servers.${name}.enabled=false`);
      }
      args.push('-c', `mcp_servers.${TOOL_ENDPOINT_SERVER_NAME}={url=${JSON.stringify(opts.mcpEndpoint.url)},bearer_token_env_var="${CODEX_TOOL_TOKEN_ENV}",default_tools_approval_mode="approve"}`);
    }
    // Live web search (the Responses web_search tool, no per-call approval).
    if (opts.webSearch) args.push('-c', 'web_search="live"');
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
      // sua tools reached over MCP (ADR-0044): show the call and its outcome.
      if ((event.type === 'item.started' || event.type === 'item.completed') && event.item?.type === 'mcp_tool_call') {
        const toolName = typeof event.item.tool === 'string' ? event.item.tool : 'tool';
        const started = event.type === 'item.started';
        const failed = !started && (event.item.status === 'failed' || Boolean(event.item.error));
        return {
          timestamp: new Date().toISOString(),
          type: 'tool_use',
          toolName,
          toolStatus: started ? 'call' : 'result',
          ...(started ? { preview: JSON.stringify(event.item.arguments ?? {}).slice(0, 200) } : { isError: failed }),
          message: started ? `Calling ${toolName}` : `${toolName} ${failed ? 'errored' : 'returned'}`,
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

  extractError: codexFailureMessage,
  finishedTurn: codexFinishedTurn,
  stderrNoise: /^Reading prompt from stdin\.\.\.\s*$/gm,
  // sua's tools reach codex over MCP (see buildArgs).
  supportsMcpTools: true,
  nativeWebSearch: true,
  extractUsage: (stdout, opts) => {
    const usage = codexUsage(stdout);
    return usage ? { ...usage, model: opts.model ?? codexDefaultModel() } : undefined;
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

/** True for providers `runLlmAttempt` can spawn as a CLI (vs. a custom HTTP one). */
export function isCliProvider(provider: string): boolean {
  return provider in SPAWNERS;
}

// ── Node spawner ───────────────────────────────────────────────────────

/**
 * Production spawner for DAG nodes. Handles shell (bash -c) and
 * claude-code (LlmSpawner dispatch) execution paths.
 */
export async function spawnNodeReal(
  node: AgentNode,
  env: Record<string, string>,
  _opts: {
    agentId: string;
    agentSource: Agent['source'];
    allowUntrustedShell?: ReadonlySet<string>;
    llmSettings?: LlmSettingsSnapshot;
    secretsStore?: SecretsStore;
    policyDocument?: PolicyDocument;
    toolStore?: ToolStore;
    integrationsStore?: IntegrationsStore;
    variablesStore?: VariablesStore;
    experimentalApple?: boolean;
    /** See SpawnNodeFn.behaviorPreamble — resolved once per run by dag-executor. */
    behaviorPreamble?: string;
    /** See SpawnNodeFn.agentCalls. */
    agentCalls?: AgentCallContext;
    agentCallInfo?: AgentCallInfo;
    memory?: BuiltinToolContext['memory'];
    boards?: BuiltinToolContext['boards'];
    memoryRunId?: string;
    askHuman?: BuiltinToolContext['askHuman'];
    askRunId?: string;
    spendBudgetUsd?: number;
  },
  onProgress?: (event: SpawnProgress) => void,
  signal?: AbortSignal,
  onSpawn?: (pid: number, startedAtMs: number) => void,
  onChildExit?: () => void,
): Promise<SpawnResult> {
  if (node.type === 'shell') {
    if (!node.command) {
      // A node carrying a `tool:` reference should have been resolved + executed
      // by the dag-executor before ever reaching the shell spawn path. If it
      // lands here with no command, the tool did NOT resolve — give an
      // actionable reason instead of the misleading "has no command".
      if (node.tool) {
        return {
          result: '',
          exitCode: 1,
          error: `Tool "${node.tool}" did not resolve for node "${node.id}". The integration may be disabled (experimental flag off), not installed, or this worker may be running stale code (restart it).`,
          category: 'setup',
        };
      }
      return { result: '', exitCode: 1, error: `Shell node "${node.id}" has no command`, category: 'setup' };
    }
    return spawnProcess('bash', ['-c', node.command], {
      cwd: node.workingDirectory,
      env,
      timeoutSec: node.timeout ?? 300,
      signal,
      onSpawn,
      onChildExit,
    });
  }

  // claude-code — resolve templates then dispatch to LlmSpawner.
  if (!node.prompt) {
    return { result: '', exitCode: 1, error: `Claude-code node "${node.id}" has no prompt`, category: 'setup' };
  }
  let resolvedPrompt = node.prompt;
  const upstreamMap: Record<string, string> = {};
  const upstreamOutputs: Record<string, Record<string, unknown>> = {};
  for (const [k, v] of Object.entries(env)) {
    const m = k.match(/^UPSTREAM_(.+)_RESULT$/);
    if (m) upstreamMap[m[1].toLowerCase().replace(/_/g, '-')] = fullUpstreamResult(v, env[`${k}_FILE`]);
    const o = k.match(/^UPSTREAM_(.+)_OUTPUTS$/);
    if (o) {
      try { upstreamOutputs[o[1].toLowerCase().replace(/_/g, '-')] = JSON.parse(v) as Record<string, unknown>; } catch { /* not JSON */ }
    }
  }
  resolvedPrompt = resolveUpstreamTemplate(resolvedPrompt, upstreamMap, upstreamOutputs);
  resolvedPrompt = resolveVarsTemplate(resolvedPrompt, env);
  // {{state}} resolves to $STATE_DIR (set by node-env when dataRoot is
  // configured). Falls through to empty string when unset.
  resolvedPrompt = resolveStateTemplate(resolvedPrompt, env.STATE_DIR);
  resolvedPrompt = substituteInputs(resolvedPrompt, env);

  // Behavior conditioning. PREPENDED HERE, DELIBERATELY, AND NOWHERE ELSE.
  //
  // This is after every resolver above, which is the whole point: the injected
  // text is third-party content from .agents/behaviors/, and prepending it
  // post-substitution means a `{{inputs.API_KEY}}` or `{{state}}` written into
  // a behavior body stays literal instead of interpolating a secret. Moving
  // this line above `substituteInputs` would silently turn behavior files into
  // a template-injection primitive. behavior-conditioning.test.ts pins it.
  //
  // Resolved once per run in dag-executor (where the Agent is in scope), not
  // here — re-reading disk per node would be wasteful and could see a spec
  // change mid-run.
  if (_opts.behaviorPreamble) {
    resolvedPrompt = `${_opts.behaviorPreamble}\n${resolvedPrompt}`;
  }

  // Strip UPSTREAM_*_RESULT env vars before exec: claude-code consumed
  // them via {{upstream.X.field}} substitution above (lines 228-233), so
  // the raw env-var copies are now dead weight. Leaving them in argv+env
  // total contributes to E2BIG when execve()'s argv+env exceeds ARG_MAX.
  // Shell nodes still receive these env vars — they're the intended
  // consumer (`$UPSTREAM_<ID>_RESULT` references in the command).
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (!/^UPSTREAM_[A-Z0-9_]+_(RESULT|OUTPUTS)$/.test(k)) childEnv[k] = v;
  }

  const chain = buildProviderChain(node.provider, _opts.llmSettings?.providers, _opts.llmSettings?.disabledProviders);

  const attemptedProviders: string[] = [];
  // Per-attempt failure trail: why each non-winning provider was skipped.
  // Surfaced on the node card and logged below so a successful fallback run
  // still records WHY the earlier providers failed.
  const providerFailures: ProviderFailure[] = [];
  let lastResult: SpawnResult | undefined;
  let lastCategory: LlmFailureCategory = 'other';
  // Across every attempt: a provider that called tools and then failed still
  // did those things (fetched, wrote, ran), so its calls stay in the trace.
  const toolCalls: ToolCallRecord[] = [];
  const collectedToolCalls = (): ToolCallRecord[] | undefined =>
    toolCalls.length > 0 ? toolCalls.map((c, seq) => ({ ...c, seq })) : undefined;
  // Every attempt's tokens and cost: a provider that failed after working
  // still spent them. Priced here, where the operator's price table is known.
  const usageAttempts: LlmUsage[] = [];
  const localProviders = localProviderNames(_opts.llmSettings?.customProviders);
  const collectedUsage = (): NodeUsage | undefined =>
    usageAttempts.length > 0 ? { total: totalUsage(usageAttempts), attempts: usageAttempts } : undefined;

  const costOf = (u: LlmUsage): number | undefined => priceUsage(u, { pricing: _opts.llmSettings?.pricing, localProviders }).costUsd;
  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    // Per-run spend limit: what's left after this node's earlier attempts.
    let attemptBudgetUsd: number | undefined;
    if (_opts.spendBudgetUsd !== undefined) {
      attemptBudgetUsd = _opts.spendBudgetUsd - usageAttempts.reduce((s, a) => s + (a.costUsd ?? 0), 0);
      if (attemptBudgetUsd <= 0) {
        lastResult = {
          result: '',
          exitCode: 1,
          category: 'budget_exhausted',
          error: `Stopped at the spend limit before trying ${provider}: this node used what was left of the run's limit.`,
        };
        lastCategory = 'budget_exhausted';
        break;
      }
    }
    attemptedProviders.push(provider);
    let result = await runLlmAttempt(provider, node, resolvedPrompt, childEnv, onProgress, signal, onSpawn, onChildExit, _opts.llmSettings?.customProviders, {
      onToolCall: (r) => { toolCalls.push(r); },
      agentId: _opts.agentId,
      agentSource: _opts.agentSource,
      secretsStore: _opts.secretsStore,
      policyDocument: _opts.policyDocument,
      toolStore: _opts.toolStore,
      integrationsStore: _opts.integrationsStore,
      variablesStore: _opts.variablesStore,
      experimentalApple: _opts.experimentalApple,
      agentCalls: _opts.agentCalls,
      memory: _opts.memory,
      boards: _opts.boards,
      askHuman: _opts.askHuman,
      attemptBudgetUsd,
      costOf,
    });
    if (result.attemptUsage) {
      usageAttempts.push(priceUsage(result.attemptUsage, { pricing: _opts.llmSettings?.pricing, localProviders }));
    } else if (provider === 'apple-foundation-models' && result.exitCode === 0) {
      usageAttempts.push({ provider, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, costSource: 'free' });
    }
    const { attemptUsage: _attemptUsage, ...attemptResult } = result;
    void _attemptUsage;
    result = attemptResult;

    // A 0-exit result still has to satisfy the node's output contract. A weak
    // fallback model that ignores the required format (e.g. no <plan> block)
    // "succeeds" at the CLI level but produced nothing useful — treat that as a
    // fallback-worthy failure so the waterfall escalates to a stronger model.
    if (result.exitCode === 0) {
      const check = validateOutputContract(node.outputContract, result.result);
      if (check.ok) {
        // Success — annotate with the trail so the dashboard can show
        // "ran on codex after claude failed" without parsing the error
        // breadcrumb.
        return {
          ...result,
          toolCalls: collectedToolCalls(),
          usage: collectedUsage(),
          usedLLMProvider: provider,
          attemptedProviders,
          providerFailures: providerFailures.length > 0 ? providerFailures : undefined,
          error: attemptedProviders.length > 1
            ? `Fallback ${provider} succeeded after ${attemptedProviders.slice(0, -1).join(', ')} failed (${lastCategory}).`
            : result.error,
        };
      }
      // Contract failed: rewrite the 0-exit result into a failure so the
      // shared failure path below records it + decides whether to fall back.
      result = {
        ...result,
        exitCode: 1,
        category: 'invalid_output',
        error: `Output failed contract: ${check.reason}`,
      };
    }

    lastResult = result;
    lastCategory = classifyLlmFailure(result);
    // Stopped from outside (cancel, or the node asked the person and is now
    // waiting): never hand the step to the next provider.
    if (signal?.aborted) break;

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

  // Every provider was skipped for tools: say what would fix it, rather than
  // leaving the last provider's "can't call X" as the whole story.
  const allToolSkips = providerFailures.length > 0
    && providerFailures.every((f) => f.category === 'tool_unavailable');
  const toolsError = allToolSkips
    ? `No enabled provider can use this node's tools (${(node.tools ?? []).join(', ')}). ` +
      'Enable Claude, Codex or an OpenAI-compatible provider (Settings → LLM); they can all call any sua tool.'
    : undefined;

  // All attempts failed (or the chain ended on a non-fallback
  // category). Return the most recent failure with the trail so the
  // operator can see what was tried.
  return {
    ...(lastResult ?? { result: '', exitCode: 1 }),
    ...(toolsError ? { error: toolsError } : {}),
    toolCalls: collectedToolCalls(),
    usage: collectedUsage(),
    usedLLMProvider: attemptedProviders[attemptedProviders.length - 1],
    attemptedProviders,
    providerFailures: providerFailures.length > 0 ? providerFailures : undefined,
  };
}

/** Context for a node attempt's tools (stores, identity, recording). */
type AttemptToolCtx = NonNullable<Parameters<typeof runLlmAttemptInner>[9]>;

/**
 * The tools a node attempt may call: schemas to advertise plus the executor
 * that runs them. One construction for every provider — the OpenAI-compatible
 * HTTP loop calls the executor directly, a CLI reaches it through the MCP
 * endpoint — so the allowlist, policy seam, output cap and `tool_calls`
 * recording are the same whichever provider answers. Undefined when none of
 * the candidate ids resolve.
 */
function buildAttemptToolSurface(
  candidateIds: readonly string[],
  node: AgentNode,
  childEnv: Record<string, string>,
  provider: string,
  toolCtx: AttemptToolCtx | undefined,
  signal: AbortSignal | undefined,
): { tools: OpenAiTool[]; execute: ToolCallExecutor } | undefined {
  if (!toolCtx || candidateIds.length === 0) return undefined;
  const { tools, idByFunctionName, exposedToolIds } = resolveExposedToolDefs(candidateIds, {
    toolStore: toolCtx.toolStore,
    integrationsStore: toolCtx.integrationsStore,
    secretsStore: toolCtx.secretsStore,
    variablesStore: toolCtx.variablesStore,
    experimentalApple: toolCtx.experimentalApple,
    agentCalls: toolCtx.agentCalls,
  });
  if (exposedToolIds.length === 0) return undefined;
  const execute = buildToolExecutor({
    exposedToolIds,
    idByFunctionName,
    agentId: toolCtx.agentId,
    agentSource: toolCtx.agentSource,
    policyDocument: toolCtx.policyDocument,
    env: childEnv,
    workingDirectory: node.workingDirectory,
    timeoutSec: node.timeout ?? 300,
    secretsStore: toolCtx.secretsStore,
    toolStore: toolCtx.toolStore,
    integrationsStore: toolCtx.integrationsStore,
    variablesStore: toolCtx.variablesStore,
    experimentalApple: toolCtx.experimentalApple,
    signal,
    onCall: toolCtx.onToolCall ? (r) => toolCtx.onToolCall?.({ ...r, provider }) : undefined,
    agentCalls: toolCtx.agentCalls,
    memory: toolCtx.memory,
    boards: toolCtx.boards,
    askHuman: toolCtx.askHuman,
  });
  return { tools, execute };
}

/**
 * One provider attempt. For a CLI that can load MCP servers (claude) and a
 * node that declares `tools:`, this stands up sua's per-attempt tool endpoint
 * first, points the CLI at it, and always tears it down — however the attempt
 * ends. See ADR-0036.
 */
async function runLlmAttempt(
  provider: string,
  node: AgentNode,
  resolvedPrompt: string,
  childEnv: Record<string, string>,
  onProgress?: (event: SpawnProgress) => void,
  signal?: AbortSignal,
  onSpawn?: (pid: number, startedAtMs: number) => void,
  onChildExit?: () => void,
  customProviders?: readonly CustomLlmProvider[],
  toolCtx?: AttemptToolCtx,
): Promise<SpawnResult> {
  const isCustom = customProviders?.some((c) => c.name === provider) ?? false;
  const declaredTools = suaToolsOf(node);
  const wantsEndpoint = !isCustom && isCliProvider(provider)
    && getSpawner(provider).supportsMcpTools === true && declaredTools.length > 0;
  if (!wantsEndpoint) {
    return runLlmAttemptInner(provider, node, resolvedPrompt, childEnv, onProgress, signal, onSpawn, onChildExit, customProviders, toolCtx);
  }

  // Only the node's `tools:` — on a CLI, `allowedTools` names the CLI's own
  // tools (Read, Bash…), not sua ids.
  const surface = buildAttemptToolSurface(declaredTools, node, childEnv, provider, toolCtx, signal);
  if (!surface) {
    return runLlmAttemptInner(provider, node, resolvedPrompt, childEnv, onProgress, signal, onSpawn, onChildExit, customProviders, toolCtx);
  }

  let endpoint: ToolEndpoint | undefined;
  let configDir: string | undefined;
  try {
    endpoint = await startToolEndpoint({ tools: surface.tools, execute: surface.execute });
    configDir = mkdtempSync(join(tmpdir(), 'sua-mcp-'));
    const configPath = join(configDir, 'mcp.json');
    // A file (mode 0600), not an argv string: the bearer token must not show
    // up in `ps` output.
    writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        [TOOL_ENDPOINT_SERVER_NAME]: { type: 'http', url: endpoint.url, headers: { Authorization: `Bearer ${endpoint.token}` } },
      },
    }), { mode: 0o600 });
    return await runLlmAttemptInner(provider, node, resolvedPrompt, childEnv, onProgress, signal, onSpawn, onChildExit, customProviders, toolCtx, configPath, { url: endpoint.url, token: endpoint.token });
  } catch (err) {
    return {
      result: '',
      exitCode: 1,
      category: 'tool_unavailable',
      error: `Could not start sua's tool endpoint for ${provider}: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    await endpoint?.close().catch(() => { /* already closed */ });
    if (configDir) rmSync(configDir, { recursive: true, force: true });
  }
}

/**
 * One LLM CLI invocation under a chosen provider. Extracted so the
 * fallback path can retry under a different provider with the same
 * resolved prompt + env.
 */
async function runLlmAttemptInner(
  provider: string,
  node: AgentNode,
  resolvedPrompt: string,
  childEnv: Record<string, string>,
  onProgress?: (event: SpawnProgress) => void,
  signal?: AbortSignal,
  onSpawn?: (pid: number, startedAtMs: number) => void,
  onChildExit?: () => void,
  customProviders?: readonly CustomLlmProvider[],
  toolCtx?: {
    /** Receives each tool call made during this attempt (provider not yet stamped). */
    onToolCall?: (record: ToolCallRecord) => void;
    agentId: string;
    agentSource: Agent['source'];
    secretsStore?: SecretsStore;
    policyDocument?: PolicyDocument;
    toolStore?: ToolStore;
    integrationsStore?: IntegrationsStore;
    variablesStore?: VariablesStore;
    experimentalApple?: boolean;
    agentCalls?: AgentCallContext;
    memory?: BuiltinToolContext['memory'];
    boards?: BuiltinToolContext['boards'];
    askHuman?: BuiltinToolContext['askHuman'];
    /** What this attempt may still spend, USD. Unset ⇒ no limit. */
    attemptBudgetUsd?: number;
    /** USD cost of a usage record (the waterfall's pricing), for budget checks inside a tool loop. */
    costOf?: (usage: LlmUsage) => number | undefined;
  },
  /** Set by `runLlmAttempt` when sua's tool endpoint is up for this attempt. */
  mcpConfigPath?: string,
  mcpEndpoint?: { url: string; token: string },
): Promise<SpawnResult> {
  // Custom OpenAI-compatible provider ⇒ HTTP transport, not a CLI spawn. This
  // is the ONLY divergence from the CLI path; the returned SpawnResult flows
  // through the same waterfall (contract check, classifyLlmFailure, fallback).
  const custom = customProviders?.find((c) => c.name === provider);
  if (custom && custom.kind === 'openai') {
    if ((node.tools ?? []).includes(WEB_SEARCH_TOOL_ID)) {
      return { result: '', exitCode: 1, category: 'tool_unavailable', error: `${provider} has no live web search, which this node declares in tools: (web-search).` };
    }
    // Expose the tools the model may CALL: the union of node.tools and any
    // registry-id entries in node.allowedTools (back-compat). Builtin, generated
    // integration, and MCP tools are exposed (schemas + a function-name→id map);
    // non-callable ids are dropped. Empty ⇒ plain completion (no tool loop).
    const candidateIds = [...suaToolsOf(node), ...(node.allowedTools ?? [])];
    const surface = buildAttemptToolSurface(candidateIds, node, childEnv, provider, toolCtx, signal);
    const tools = surface?.tools;
    const onToolCall = surface?.execute;
    return invokeOpenAiChat({
      apiBase: custom.apiBase,
      apiKey: custom.apiKey,
      // A node may pin a different model on the same endpoint; else use the
      // provider's configured model.
      model: node.model ?? custom.model,
      providerName: provider,
      maxCostUsd: toolCtx?.attemptBudgetUsd,
      costOf: toolCtx?.costOf,
      prompt: resolvedPrompt,
      timeoutSec: node.timeout ?? 300,
      signal,
      ...(onToolCall ? { tools, onToolCall, maxTurns: node.maxTurns ?? 5, onProgress } : {}),
    });
  }
  // A name that is neither a custom provider known to this process nor a CLI
  // provider must not fall through `getSpawner`'s claude default: on a worker
  // missing the custom-provider definitions, `local-qwen-8b` silently ran
  // claude under Qwen's name. Fail it (fallback-worthy) so the chain moves on
  // and the trail says why.
  if (!isCliProvider(provider)) {
    return {
      result: '',
      exitCode: 127,
      error: `Provider "${provider}" is not configured in this process (no custom provider with that name). Check Settings → LLM.`,
      category: 'spawn_failure',
    };
  }

  const spawner = getSpawner(provider);

  // A CLI that can't load sua's tool endpoint is skipped for a node that
  // declares tools, so the waterfall moves on — running anyway is how
  // starter-watch "completed" a watch that never read the page.
  let allowedTools = node.allowedTools;
  const declaredTools = suaToolsOf(node);
  if ((node.tools ?? []).includes(WEB_SEARCH_TOOL_ID) && !spawner.nativeWebSearch) {
    return {
      result: '',
      exitCode: 1,
      category: 'tool_unavailable',
      error: `${provider} has no live web search, which this node declares in tools: (web-search).`,
    };
  }
  // Optional tools (the memory tools the executor adds for agents with memory
  // on) never make a provider skip the node: without tool support it runs
  // without them, still starting from the recalled memories.
  const requiredTools = declaredTools.filter((id) => !OPTIONAL_TOOL_IDS.has(id));
  if (requiredTools.length > 0 && !spawner.supportsMcpTools) {
    return {
      result: '',
      exitCode: 1,
      category: 'tool_unavailable',
      error: `${provider} can't call sua tools (${requiredTools.join(', ')}), which this node declares in tools:.`,
    };
  }
  if (mcpConfigPath) {
    allowedTools = [...new Set([...(node.allowedTools ?? []), `mcp__${TOOL_ENDPOINT_SERVER_NAME}`])];
  }

  const spawnOpts: LlmSpawnOptions = {
    prompt: resolvedPrompt,
    model: node.model,
    maxTurns: node.maxTurns,
    allowedTools,
    mcpConfigPath,
    mcpEndpoint,
    maxBudgetUsd: toolCtx?.attemptBudgetUsd,
    ...(spawner.nativeWebSearch && nodeWantsWebSearch(node) ? { webSearch: true } : {}),
  };
  const args = spawner.buildArgs(spawnOpts, childEnv);

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

  // Keep the raw stdout: inline-failure checks (classifyResult,
  // detectDeniedTools) read the provider's JSON, not the extracted prose.
  let rawStdout = '';
  let result = await spawnProcess(binaryPath, args, {
    cwd: node.workingDirectory,
    env: mergedEnv,
    stdinInput,
    timeoutSec: node.timeout ?? 300,
    onProgress: onProgress ? (line) => {
      const event = spawner.parseProgress(line);
      if (event) onProgress(event);
    } : undefined,
    extractResult: (stdout) => {
      rawStdout = stdout;
      return spawner.extractResult(stdout);
    },
    signal,
    onSpawn,
    onChildExit,
  });

  const attemptUsage = spawner.extractUsage?.(rawStdout, spawnOpts);
  if (attemptUsage) result = { ...result, attemptUsage };
  if (toolCtx?.attemptBudgetUsd !== undefined && spawner.stoppedAtBudget?.(rawStdout)) {
    return {
      ...result,
      result: '',
      exitCode: 1,
      category: 'budget_exhausted',
      error: `Stopped at the spend limit: ${provider} reached the ${formatUsd(toolCtx.attemptBudgetUsd)} this node had left of the run's limit.`,
    };
  }

  // Inline-failure classification (e.g. apple-foundation-models writes
  // `status: "unavailable"` on a successful exit). When the spawner
  // reports a fallback-worthy category, override the result so the
  // waterfall's classifyLlmFailure picks it up.
  // Read back the CLI's own tool calls before any early return below: a
  // failed or refused run's calls are exactly the ones worth seeing.
  if (spawner.extractToolCalls && toolCtx?.onToolCall) {
    for (const r of spawner.extractToolCalls(rawStdout)) {
      // A call to sua's own endpoint was already recorded by the executor
      // (source 'sua', real tool id); claude's copy would double-count it.
      if (r.toolId.startsWith(`mcp__${TOOL_ENDPOINT_SERVER_NAME}__`)) continue;
      toolCtx.onToolCall({ ...r, provider });
    }
  }

  // Prefer the provider's own error over stderr for a failed run. codex logs
  // its MCP servers' auth failures to stderr, which used to classify a
  // "model not supported" failure as auth_required.
  if (spawner.extractError && result.category === 'exit_nonzero') {
    const providerError = spawner.extractError(rawStdout);
    if (providerError) {
      result = { ...result, error: providerError };
    } else if (spawner.finishedTurn?.(rawStdout) && result.result.trim()) {
      // It finished and answered, then exited non-zero with no error of its
      // own: keep the answer, and say what happened on the node.
      const { category: _failed, ...rest } = result;
      result = { ...rest, exitCode: 0, error: `${provider} exited with code ${String(result.exitCode)} after finishing its answer, without reporting an error. The answer was kept.` };
    } else if (spawner.stderrNoise) {
      // Its own banner isn't a reason: say it gave none (plus anything else stderr had).
      const rest = (result.error ?? '').replace(spawner.stderrNoise, '').trim();
      result = { ...result, error: rest || `${provider} exited with code ${String(result.exitCode)} without saying why.` };
    }
  }

  if (spawner.classifyResult && result.exitCode === 0) {
    const overrideCategory = spawner.classifyResult(result, rawStdout);
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

  // A refused tool call doesn't fail the node — the model often recovers
  // with a tool it was given — but it must not read as a clean answer
  // either. The warning rides on `error`, which the run page shows on
  // completed nodes too.
  if (spawner.detectDeniedTools && result.exitCode === 0) {
    const denied = spawner.detectDeniedTools(rawStdout);
    if (denied.length > 0) {
      const warning = `${provider} was blocked from using ${denied.join(', ')} (not permitted for this node). ` +
        'The answer may be missing whatever that tool would have returned.';
      return { ...result, error: result.error ? `${result.error}\n${warning}` : warning };
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
  disabledProviders?: readonly string[],
): string[] {
  const order = configuredOrder ?? [];
  // A globally-disabled provider is OFF everywhere. Ignore an explicit node pin
  // that names a disabled provider so the node falls through to the first
  // enabled provider, instead of the pin forcing the disabled one to run. Note:
  // a pin to a provider that's simply not in the operator's waterfall STILL
  // seeds the chain (that's a deliberate "use this provider" choice) — only an
  // explicitly disabled provider is neutralized.
  const pinDisabled = pinnedProvider !== undefined && (disabledProviders ?? []).includes(pinnedProvider);
  const effectivePin = pinDisabled ? undefined : pinnedProvider;
  const seed = effectivePin ?? order[0] ?? 'claude';
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
  // Output-contract violations are pre-classified by the waterfall.
  if (result.category === 'invalid_output') return 'invalid_output';
  if (result.category === 'tool_unavailable') return 'tool_unavailable';
  if (result.category === 'budget_exhausted') return 'budget_exhausted';
  const haystack = `${result.error ?? ''}\n${result.result ?? ''}`.toLowerCase();
  if (result.category === 'spawn_failure'
    || haystack.includes('command not found')
    || haystack.includes('enoent')) {
    return 'binary_missing';
  }
  if (result.category === 'timeout' || haystack.includes('timed out')) {
    return 'timeout';
  }
  // Ran out of turns: a prompt problem, not the provider's. Checked before
  // the quota words, which turn up in the CLI's own status events.
  if (/error_max_turns|maximum number of turns/.test(haystack)) return 'other';
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
    // A status, not any number with 429 in it (costs, durations, ids).
    || /(?:^|[^\w.-])429(?:[^\w.-]|$)/.test(haystack)
    || haystack.includes('too many requests')) {
    return 'rate_limited';
  }
  if (haystack.includes('not authenticated')
    || haystack.includes('login required')
    || haystack.includes('please log in')
    // claude CLI: "Not logged in · Please run /login"
    || haystack.includes('not logged in')
    || haystack.includes('run /login')
    || haystack.includes('401')
    || haystack.includes('unauthorized')) {
    return 'auth_required';
  }
  if (haystack.includes('model is not supported')
    || haystack.includes('model_not_found')
    || haystack.includes('unsupported model')
    || /model [`'"]?[\w.:-]+[`'"]? (does not exist|is not supported|not found)/.test(haystack)) {
    return 'model_unavailable';
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
 *   - tool_unavailable — this provider can't call the node's declared
 *                       tools; one later in the chain may
 *   - model_unavailable — this provider rejected its configured model
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
    || category === 'rate_limited'
    || category === 'invalid_output'
    || category === 'tool_unavailable'
    || category === 'model_unavailable';
}

/**
 * Validate a node's text output against its declared {@link OutputContract}. A
 * 0-exit result that fails this is treated as a fallback-worthy failure so the
 * provider waterfall escalates to a stronger model instead of accepting useless
 * output. Opt-in: a missing/empty contract always passes. A malformed
 * `mustMatch` regex is treated as no constraint (never blocks on operator typo).
 */
export function validateOutputContract(
  contract: OutputContract | undefined,
  output: string | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!contract) return { ok: true };
  const text = output ?? '';
  if (typeof contract.minChars === 'number' && contract.minChars > 0) {
    const nonWs = text.replace(/\s+/g, '').length;
    if (nonWs < contract.minChars) {
      return { ok: false, reason: `output too short (${nonWs} < ${contract.minChars} chars)` };
    }
  }
  if (contract.mustMatch) {
    let re: RegExp | undefined;
    try { re = new RegExp(contract.mustMatch, 's'); } catch { re = undefined; }
    if (re && !re.test(text)) {
      return { ok: false, reason: `missing ${contract.description ?? `/${contract.mustMatch}/`}` };
    }
  }
  return { ok: true };
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
  /**
   * The counterpart to `onSpawn`: fires once the child is definitively gone.
   * The executor clears the persisted pid, because a pid that has exited is
   * not a kill handle any more — it is a false liveness signal.
   *
   * This matters most inside the LLM provider waterfall. A CLI provider
   * (codex, claude) spawns a child and records its pid; an `openai`-kind
   * provider is a plain HTTP call and never spawns anything. When the chain
   * falls from the former to the latter, the node row kept pointing at the
   * dead CLI child, and the stuck-run watchdog read that as "every child of
   * this run is dead" and reaped a node that was actively mid-request.
   */
  onChildExit?: () => void;
}

/**
 * Most of an upstream result a prompt takes. The prompt goes over stdin, so
 * it isn't bound by the env cap that spills results over 32KB to a file.
 */
export const PROMPT_UPSTREAM_CAP = 256 * 1024;

/**
 * An upstream result for a prompt: the full value from its spill file when
 * the env copy was cut short. The cut copy ends "full value at $…_FILE",
 * which sent one-turn llm nodes off to Read the file until they ran out of
 * turns.
 */
export function fullUpstreamResult(inline: string, file: string | undefined): string {
  if (!file) return inline;
  let full: string;
  try { full = readFileSync(file, 'utf8'); } catch { return inline; }
  if (full.length <= PROMPT_UPSTREAM_CAP) return full;
  return `${full.slice(0, PROMPT_UPSTREAM_CAP)}\n...(cut at ${String(PROMPT_UPSTREAM_CAP / 1024)}KB of ${String(Math.round(full.length / 1024))}KB)`;
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
 * Build a node-timeout error message. When the actual wall-clock that elapsed
 * (`elapsedMs`) vastly exceeds the configured limit, the timer was almost
 * certainly suspended mid-run — the classic case is the laptop sleeping, which
 * pauses Node's timers, so a 300s timeout can "fire" 4 hours later. The node
 * did NOT run for that long, so we annotate instead of implying a true hang.
 *
 * `elapsedMs` is undefined for a cancellation (operator Stop), which reaches
 * the same `killed` branch but isn't a real timeout — keep the bare message.
 */
export function timeoutError(timeoutSec: number, elapsedMs?: number): string {
  const bare = `Timed out after ${timeoutSec}s`;
  if (elapsedMs === undefined) return bare;
  const elapsedSec = Math.round(elapsedMs / 1000);
  // Trip only when elapsed is both a large multiple of the limit AND at least
  // a couple minutes past it, so ordinary scheduling jitter never annotates.
  if (elapsedSec <= timeoutSec * 2 || elapsedSec - timeoutSec < 120) return bare;
  const elapsedHuman = elapsedSec >= 3600
    ? `${(elapsedSec / 3600).toFixed(1)}h`
    : `${Math.round(elapsedSec / 60)}m`;
  return `Timed out — limit ${timeoutSec}s, but ${elapsedHuman} elapsed; the machine likely slept (timers suspend during sleep), so the node did not actually run that long.`;
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
    // `timedOut` is set ONLY by the wall-clock timer (not by the cancellation
    // signal, which also sets `killed`) so the close handler can tell a real
    // timeout apart from an operator Stop and annotate the slept-machine case.
    let timedOut = false;
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
    const spawnedAt = Date.now();
    // Report the freshly-spawned pid + start time so the executor can persist
    // them on the node_executions row. Fires before stdin write so a crash
    // between spawn() and the first stdout chunk still leaves a kill handle.
    // Wrapped in try/catch: the callback shouldn't kill the run if it throws.
    if (opts.onSpawn && typeof child.pid === 'number') {
      try { opts.onSpawn(child.pid, Date.now()); } catch { /* never let onSpawn break spawning */ }
    }
    // Idempotent: `close` and `error` can both fire for one child, and the
    // pid only needs clearing once.
    let childGoneReported = false;
    const reportChildGone = () => {
      if (childGoneReported) return;
      childGoneReported = true;
      if (!opts.onChildExit) return;
      try { opts.onChildExit(); } catch { /* never let the callback break teardown */ }
    };

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
      timedOut = true;
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
      reportChildGone();

      // Flush any remaining buffered stdout line.
      if (opts.onProgress && stdoutBuffer.trim()) {
        opts.onProgress(stdoutBuffer);
      }

      const finalResult = opts.extractResult ? opts.extractResult(stdout) : stdout;

      if (killed) {
        resolve({ result: finalResult, exitCode: 124, error: timeoutError(opts.timeoutSec, timedOut ? Date.now() - spawnedAt : undefined), category: 'timeout' });
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
      reportChildGone();
      resolve({ result: '', exitCode: 127, error: err.message, category: 'spawn_failure' });
    });
  });
}
