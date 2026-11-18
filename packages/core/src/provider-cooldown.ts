/**
 * Providers known to be down, for a while (in this process). A provider that
 * just failed in a way that will keep failing (out of quota until a stated
 * time, its CLI or server not there, signed out) is skipped by every node's
 * waterfall until its cooldown ends, instead of being tried, and failing, on
 * every call: before this, a codex quota error and an unreachable local model
 * cost each LLM node ~16s (a quarter of all LLM node time on the live install).
 *
 * In memory, per process: the worker and the dashboard each learn it once.
 * A success on the provider clears it; so does the cooldown running out.
 */
import type { LlmFailureCategory } from './node-spawner.js';

export interface ProviderCooldown {
  provider: string;
  category: LlmFailureCategory;
  /** When it's tried again (ms since epoch). */
  until: number;
  /** When it failed (ms since epoch). */
  at: number;
}

const MIN = 60_000;
/** How long each lasting failure keeps a provider out, when the error doesn't say. */
export const COOLDOWN_MS: Partial<Record<LlmFailureCategory, number>> = {
  quota_exceeded: 30 * MIN,
  credit_exhausted: 30 * MIN,
  binary_missing: 5 * MIN,
  auth_required: 5 * MIN,
  rate_limited: 1 * MIN,
};
/** The longest a stated reset time may keep a provider out. */
const MAX_MS = 7 * 24 * 60 * MIN;

const cooling = new Map<string, ProviderCooldown>();

/**
 * When the error says it can be tried again: "try again at Nov 18th, 2026
 * 12:28 PM", "try again in 20 minutes", "retry after 30 seconds". Only a time
 * in the future, at most a week away. Pure.
 */
export function retryAtFrom(text: string, now = Date.now()): number | undefined {
  const rel = /(?:try again|retry)(?: after| in) (\d+(?:\.\d+)?)\s*(second|sec|s|minute|min|m|hour|hr|h)s?\b/i.exec(text);
  if (rel) {
    const n = Number(rel[1]);
    const u = rel[2].toLowerCase();
    const ms = n * (u.startsWith('h') ? 60 * MIN : u.startsWith('m') ? MIN : 1000);
    return ms > 0 && ms <= MAX_MS ? now + ms : undefined;
  }
  const abs = /try again (?:at|after) ([A-Za-z]{3,9}\.? \d{1,2}(?:st|nd|rd|th)?,? \d{4},? \d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)/i.exec(text);
  if (!abs) return undefined;
  const when = Date.parse(abs[1].replace(/(\d)(st|nd|rd|th)\b/i, '$1').replace(/\.(?= )/, '').replace(/,(?= \d{1,2}:)/, ''));
  return Number.isFinite(when) && when > now && when - now <= MAX_MS ? when : undefined;
}

/**
 * Note a failure: a lasting one puts the provider in a cooldown, until the
 * time the error states or for the category's default. Returns the cooldown,
 * or undefined for a failure that says nothing about the next call (a bad
 * answer, a timeout, a tool it can't use).
 */
export function noteProviderFailure(provider: string, category: LlmFailureCategory, errorText = '', now = Date.now()): ProviderCooldown | undefined {
  const base = COOLDOWN_MS[category];
  if (base === undefined) return undefined;
  const stated = category === 'quota_exceeded' || category === 'credit_exhausted' || category === 'rate_limited' ? retryAtFrom(errorText, now) : undefined;
  const c: ProviderCooldown = { provider, category, at: now, until: stated ?? now + base };
  cooling.set(provider, c);
  return c;
}

/** It worked: it's back. */
export function clearProviderCooldown(provider: string): void {
  cooling.delete(provider);
}

/** The provider's cooldown, while it lasts. */
export function providerCooldown(provider: string, now = Date.now()): ProviderCooldown | undefined {
  const c = cooling.get(provider);
  if (!c) return undefined;
  if (c.until <= now) { cooling.delete(provider); return undefined; }
  return c;
}

/** Every provider cooling down now, soonest back first. */
export function providerCooldowns(now = Date.now()): ProviderCooldown[] {
  return [...cooling.keys()].map((p) => providerCooldown(p, now)).filter((c): c is ProviderCooldown => !!c).sort((a, b) => a.until - b.until);
}

/**
 * A node's waterfall without the providers cooling down. When every one of
 * them is, the chain as it was: something has to be tried. Pure but for the
 * cooldown state.
 */
export function withoutCoolingProviders(chain: readonly string[], now = Date.now()): { chain: string[]; skipped: ProviderCooldown[] } {
  const skipped = chain.map((p) => providerCooldown(p, now)).filter((c): c is ProviderCooldown => !!c);
  if (skipped.length === 0 || skipped.length === chain.length) return { chain: [...chain], skipped: [] };
  return { chain: chain.filter((p) => !skipped.some((s) => s.provider === p)), skipped };
}

/** For tests: forget every cooldown. */
export function resetProviderCooldowns(): void {
  cooling.clear();
}
