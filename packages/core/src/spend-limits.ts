/**
 * Spend limits: how much an agent may spend, in USD at list price, per run
 * and per calendar day (local time). See docs/cost.md and ADR-0041.
 *
 * An agent's own `spendLimit:` wins field by field over the defaults in
 * Settings → Usage. Enforcement (dag-executor.ts, node-spawner.ts):
 *  - per day: a run that starts once the agent has spent its daily limit
 *    fails straight away, before any node runs;
 *  - per run: before each node, and inside a node — claude gets
 *    `--max-budget-usd` for what's left, OpenAI-compatible models stop
 *    between tool-loop turns. A provider only notices after a turn, so a run
 *    can end up to one model turn over its limit.
 * Only priced usage counts: a provider with no price (Settings → LLM →
 * Pricing) can't be held to a USD limit.
 */
import { formatUsd, localProviderNames } from './usage.js';

export interface SpendLimits {
  perRunUsd?: number;
  perDayUsd?: number;
}

export interface EffectiveSpendLimits extends SpendLimits {
  /** Where each limit came from. */
  source: { perRunUsd?: 'agent' | 'default'; perDayUsd?: 'agent' | 'default' };
}

export function effectiveSpendLimits(
  agent: { spendLimit?: SpendLimits },
  defaults: SpendLimits | undefined,
): EffectiveSpendLimits {
  const out: EffectiveSpendLimits = { source: {} };
  for (const key of ['perRunUsd', 'perDayUsd'] as const) {
    const own = agent.spendLimit?.[key];
    const dflt = defaults?.[key];
    if (typeof own === 'number' && own > 0) { out[key] = own; out.source[key] = 'agent'; }
    else if (typeof dflt === 'number' && dflt > 0) { out[key] = dflt; out.source[key] = 'default'; }
  }
  return out;
}

/** Midnight today, local time, as an ISO string: the start of the "per day" window. */
export function startOfLocalDay(now: Date = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function dailyLimitMessage(agentId: string, spentUsd: number, limits: EffectiveSpendLimits): string {
  const where = limits.source.perDayUsd === 'agent'
    ? `raise spendLimit.perDayUsd on "${agentId}"`
    : 'raise the default in Settings → Usage, or set spendLimit.perDayUsd on the agent';
  return `Daily spend limit reached: "${agentId}" has spent ${formatUsd(spentUsd)} today, and its limit is ${formatUsd(limits.perDayUsd ?? 0)} a day. ` +
    `New runs start again after midnight; to run it now, ${where}.`;
}

export function perRunLimitMessage(spentUsd: number, limits: EffectiveSpendLimits): string {
  const where = limits.source.perRunUsd === 'agent'
    ? 'raise spendLimit.perRunUsd on the agent'
    : 'raise the default in Settings → Usage, or set spendLimit.perRunUsd on the agent';
  return `Stopped at the spend limit: this run has spent ${formatUsd(spentUsd)}, and its limit is ${formatUsd(limits.perRunUsd ?? 0)} a run. To let it go further, ${where}.`;
}

/**
 * Enabled providers whose runs can't count toward a USD limit: they report
 * tokens only and have no price (codex, OpenAI-compatible endpoints that
 * aren't on this machine). Claude reports its cost; Apple FM and local
 * endpoints are free.
 */
export function unenforceableProviders(settings: {
  providers?: readonly string[];
  disabledProviders?: readonly string[];
  customProviders?: ReadonlyArray<{ name: string; apiBase: string }>;
  pricing?: Record<string, unknown>;
}): string[] {
  const disabled = new Set(settings.disabledProviders ?? []);
  const local = localProviderNames(settings.customProviders);
  const priced = (p: string) => Object.keys(settings.pricing ?? {}).some((k) => k === p || k.startsWith(`${p}/`));
  const customNames = new Set((settings.customProviders ?? []).map((c) => c.name));
  return (settings.providers ?? []).filter((p) => !disabled.has(p)
    && (p === 'codex' || (customNames.has(p) && !local.has(p)))
    && !priced(p));
}
