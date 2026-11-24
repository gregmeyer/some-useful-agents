/**
 * A daily cap on fallback spend: money spent only because an earlier
 * provider failed.
 *
 * When codex runs out of quota (or a local model isn't running), every
 * node's next stop is a paid provider. On the live install that was
 * ~$75 a day on Claude for several days, with nothing to stop it. With
 * `fallbackCapUsd` set (Settings → LLM), a node stops instead of falling
 * back to a paid provider once the day's fallback spend has reached the cap,
 * and a paid fallback is held to what's left (claude's --max-budget-usd).
 * A node whose first provider answers, and a free provider (a local model, a
 * CLI with no price), are never held back.
 */
import { formatUsd } from './usage.js';
import type { PriceTable } from './usage.js';

export interface FallbackCap {
  /** The cap, USD a day (local time). */
  capUsd: number;
  /** Spent on fallbacks so far today, before this node. */
  spentUsd: number;
}

/** A provider whose calls cost money here: Claude reports its own cost; others cost only with a price set. */
export function isPaidProvider(provider: string, pricing?: PriceTable): boolean {
  if (provider === 'claude') return true;
  return !!pricing && Object.keys(pricing).some((k) => k === provider || k.startsWith(`${provider}/`));
}

export function fallbackCapMessage(provider: string, cap: FallbackCap, firstChoice: string): string {
  return `Stopped before falling back to ${provider}: today's spend on fallbacks (${formatUsd(cap.spentUsd)}) reached the daily cap of ${formatUsd(cap.capUsd)}. ` +
    `Raise the cap in Settings → LLM, or run it again once ${firstChoice} is answering.`;
}
