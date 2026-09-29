/**
 * What an LLM call used and cost. See docs/cost.md.
 *
 * Cost is in USD at list price. Where a provider reports it (claude's
 * stream-json `total_cost_usd`) that number is used as-is; where it reports
 * only tokens (codex, OpenAI-compatible endpoints) the cost is estimated from
 * the operator's price table (`LlmSettings.pricing`); a local endpoint with no
 * price is free; anything else is `unpriced` — tokens recorded, cost unknown.
 * On a subscription, "list price" is what the same usage would cost on the API,
 * not the bill.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type CostSource = 'reported' | 'estimated' | 'free' | 'unpriced';

export interface LlmUsage {
  provider: string;
  model?: string;
  /** Input tokens not served from a prompt cache. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** USD at list price. Undefined when `costSource` is `unpriced`. */
  costUsd?: number;
  costSource: CostSource;
}

/** A node's usage: the total across every provider attempt, and each attempt. */
export interface NodeUsage {
  total: UsageTotal;
  attempts: LlmUsage[];
}

export interface UsageTotal {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Sum of the known costs. */
  costUsd: number;
  /** False when some tokens had no price, so `costUsd` is a lower bound. */
  costComplete: boolean;
}

/** USD per million tokens. */
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  /** Defaults to `inputPerMTok`. */
  cacheReadPerMTok?: number;
  /** Defaults to `inputPerMTok`. */
  cacheWritePerMTok?: number;
}

/** Price table, keyed `provider/model` (most specific) or `provider`. */
export type PriceTable = Record<string, ModelPrice>;

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

function lastJsonEvent(stdout: string, match: (e: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  const lines = stdout.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      const e = JSON.parse(line) as Record<string, unknown>;
      if (match(e)) return e;
    } catch { /* not JSON */ }
  }
  return undefined;
}

/** claude `--output-format stream-json`: the final `result` event carries usage and cost. */
export function claudeUsage(stdout: string): LlmUsage | undefined {
  const e = lastJsonEvent(stdout, (ev) => ev.type === 'result');
  if (!e) return undefined;
  const u = (e.usage ?? {}) as Record<string, unknown>;
  const models = Object.keys((e.modelUsage ?? {}) as Record<string, unknown>);
  const cost = typeof e.total_cost_usd === 'number' && Number.isFinite(e.total_cost_usd) ? e.total_cost_usd : undefined;
  return {
    provider: 'claude',
    model: models[0]?.replace(/\[.*\]$/, ''),
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheReadTokens: num(u.cache_read_input_tokens),
    cacheWriteTokens: num(u.cache_creation_input_tokens),
    ...(cost !== undefined ? { costUsd: cost, costSource: 'reported' as const } : { costSource: 'unpriced' as const }),
  };
}

/** codex `exec --json`: one `turn.completed` per turn; `input_tokens` includes the cached ones. */
export function codexUsage(stdout: string): LlmUsage | undefined {
  let seen = false;
  const total = { input: 0, cached: 0, cacheWrite: 0, output: 0 };
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('{') || !line.includes('turn.completed')) continue;
    try {
      const e = JSON.parse(line) as { type?: string; usage?: Record<string, unknown> };
      if (e.type !== 'turn.completed' || !e.usage) continue;
      seen = true;
      total.input += num(e.usage.input_tokens);
      total.cached += num(e.usage.cached_input_tokens);
      total.cacheWrite += num(e.usage.cache_write_input_tokens);
      total.output += num(e.usage.output_tokens);
    } catch { /* not JSON */ }
  }
  if (!seen) return undefined;
  return {
    provider: 'codex',
    inputTokens: Math.max(0, total.input - total.cached - total.cacheWrite),
    outputTokens: total.output,
    cacheReadTokens: total.cached,
    cacheWriteTokens: total.cacheWrite,
    costSource: 'unpriced',
  };
}

/** Accumulates OpenAI-style `usage` objects across the responses of one tool loop. */
export function openAiUsageAccumulator(provider: string, model: string): {
  add(usage: unknown): void;
  result(): LlmUsage | undefined;
} {
  let seen = false;
  let input = 0;
  let cached = 0;
  let output = 0;
  return {
    add(usage) {
      if (!usage || typeof usage !== 'object') return;
      const u = usage as Record<string, unknown>;
      seen = true;
      input += num(u.prompt_tokens);
      output += num(u.completion_tokens);
      const details = u.prompt_tokens_details as Record<string, unknown> | undefined;
      cached += num(details?.cached_tokens);
    },
    result() {
      if (!seen) return undefined;
      return {
        provider,
        model,
        inputTokens: Math.max(0, input - cached),
        outputTokens: output,
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
        costSource: 'unpriced',
      };
    },
  };
}

let codexModelCache: { value: string | undefined } | undefined;
/** The model codex uses when a node doesn't pin one: `model = "…"` in ~/.codex/config.toml. */
export function codexDefaultModel(): string | undefined {
  if (!codexModelCache) {
    let value: string | undefined;
    try {
      const toml = readFileSync(join(homedir(), '.codex', 'config.toml'), 'utf-8');
      value = /^\s*model\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
    } catch { value = undefined; }
    codexModelCache = { value };
  }
  return codexModelCache.value;
}

const LOOPBACK = /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)(:\d+)?(\/|$)/i;

/**
 * Fill in the cost of a usage record that has none: from the price table
 * (`provider/model`, then `provider`), else free for a local endpoint, else
 * unpriced. A reported cost is kept.
 */
export function priceUsage(
  usage: LlmUsage,
  opts: { pricing?: PriceTable; localProviders?: ReadonlySet<string> } = {},
): LlmUsage {
  if (usage.costSource === 'reported' || usage.costSource === 'free') return usage;
  const price = (usage.model && opts.pricing?.[`${usage.provider}/${usage.model}`]) || opts.pricing?.[usage.provider];
  if (price) {
    const m = 1_000_000;
    const cost =
      (usage.inputTokens * price.inputPerMTok
        + usage.outputTokens * price.outputPerMTok
        + usage.cacheReadTokens * (price.cacheReadPerMTok ?? price.inputPerMTok)
        + usage.cacheWriteTokens * (price.cacheWritePerMTok ?? price.inputPerMTok)) / m;
    return { ...usage, costUsd: cost, costSource: 'estimated' };
  }
  if (opts.localProviders?.has(usage.provider)) return { ...usage, costUsd: 0, costSource: 'free' };
  return { ...usage, costUsd: undefined, costSource: 'unpriced' };
}

/** Custom providers whose endpoint is on this machine (free unless priced). */
export function localProviderNames(customProviders: ReadonlyArray<{ name: string; apiBase: string }> = []): Set<string> {
  return new Set(customProviders.filter((c) => LOOPBACK.test(c.apiBase)).map((c) => c.name));
}

export function totalUsage(attempts: readonly LlmUsage[]): UsageTotal {
  const t: UsageTotal = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, costComplete: true };
  for (const a of attempts) {
    t.inputTokens += a.inputTokens;
    t.outputTokens += a.outputTokens;
    t.cacheReadTokens += a.cacheReadTokens;
    t.cacheWriteTokens += a.cacheWriteTokens;
    if (a.costUsd !== undefined) t.costUsd += a.costUsd;
    else if (a.inputTokens + a.outputTokens + a.cacheReadTokens + a.cacheWriteTokens > 0) t.costComplete = false;
  }
  return t;
}

/** "$0.15", "$0.0042", "<$0.0001", "$12.30"; "≥ " prefix when incomplete. */
export function formatUsd(usd: number, complete = true): string {
  const prefix = complete ? '' : '≥ ';
  if (usd === 0) return `${prefix}$0`;
  if (usd < 0.0001) return `${prefix}<$0.0001`;
  if (usd < 0.01) return `${prefix}$${usd.toFixed(4)}`;
  if (usd < 100) return `${prefix}$${usd.toFixed(2)}`;
  return `${prefix}$${Math.round(usd).toLocaleString('en-US')}`;
}

/** "812", "12.4k", "1.3M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
