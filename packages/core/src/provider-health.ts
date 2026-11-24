/**
 * How each model provider in the waterfall has done lately, from what the
 * nodes recorded: who answered (`usedProvider`), who was tried and failed
 * first (`provider_failures_json`), and what it cost.
 *
 * The waterfall hides a provider that never works: its nodes still succeed,
 * on the next rung. A local model that was never started failed 707 times in
 * two weeks without anyone seeing it, and a CLI out of quota quietly moved
 * hundreds of nodes onto a paid one. This makes both visible (sua doctor,
 * Settings → LLM, a warning at dashboard start).
 */

export interface ProviderHealthInput {
  usedProvider?: string | null;
  providerFailures?: string | null;
  costUsd?: number | null;
  startedAt: string;
}

export interface ProviderHealthRow {
  provider: string;
  /** Nodes it answered. */
  succeeded: number;
  /** Times it was tried and failed (the waterfall moved on). */
  failed: number;
  /** Times it was passed over without trying, cooling down after a failure. */
  skipped: number;
  /** Failure categories, most common first. */
  reasons: Array<{ category: string; count: number }>;
  lastSucceededAt?: string;
  lastFailedAt?: string;
  /** Recorded cost of the nodes it answered. */
  costUsd: number;
}

export interface ProviderHealth {
  since: string;
  providers: ProviderHealthRow[];
  /** Nodes answered by a later rung because an earlier one failed. */
  fellBack: number;
  /** Recorded cost of those nodes. */
  fellBackCostUsd: number;
}

export interface ProviderProblem {
  provider: string;
  kind: 'never-worked' | 'mostly-failing';
  message: string;
}

const SKIPPED = /^Skipped:/;

const REASON_LABELS: Record<string, string> = {
  credit_exhausted: 'out of credit',
  quota_exceeded: 'out of quota',
  binary_missing: "couldn't be reached or isn't installed",
  timeout: 'timed out',
  rate_limited: 'rate limited',
  auth_required: 'needs signing in',
  invalid_output: 'answered in the wrong shape',
  tool_unavailable: "can't use a tool the node needs",
  model_unavailable: "the model isn't offered",
  model_busy: 'the model was busy',
  budget_exhausted: 'hit the spend limit',
  other: 'other errors',
};

/** A failure category in words a person reads (sua doctor, Settings → LLM). */
export function failureReasonLabel(category: string): string {
  return REASON_LABELS[category] ?? category.replace(/_/g, ' ');
}

/** Fold node rows into per-provider health. Pure. */
export function summarizeProviderHealth(rows: Iterable<ProviderHealthInput>, since: string): ProviderHealth {
  const by = new Map<string, ProviderHealthRow & { reasonMap: Map<string, number> }>();
  const row = (p: string) => {
    let r = by.get(p);
    if (!r) { r = { provider: p, succeeded: 0, failed: 0, skipped: 0, reasons: [], costUsd: 0, reasonMap: new Map() }; by.set(p, r); }
    return r;
  };
  let fellBack = 0;
  let fellBackCostUsd = 0;
  for (const n of rows) {
    let realFailure = false;
    if (n.providerFailures) {
      let fails: Array<{ provider?: string; category?: string; error?: string }> = [];
      try { fails = JSON.parse(n.providerFailures) as typeof fails; } catch { /* unreadable: ignore */ }
      for (const f of Array.isArray(fails) ? fails : []) {
        if (!f.provider) continue;
        const r = row(f.provider);
        if (f.error && SKIPPED.test(f.error)) { r.skipped += 1; continue; }
        realFailure = true;
        r.failed += 1;
        const cat = f.category ?? 'other';
        r.reasonMap.set(cat, (r.reasonMap.get(cat) ?? 0) + 1);
        if (!r.lastFailedAt || n.startedAt > r.lastFailedAt) r.lastFailedAt = n.startedAt;
      }
    }
    if (n.usedProvider) {
      const r = row(n.usedProvider);
      r.succeeded += 1;
      r.costUsd += n.costUsd ?? 0;
      if (!r.lastSucceededAt || n.startedAt > r.lastSucceededAt) r.lastSucceededAt = n.startedAt;
      if (realFailure) { fellBack += 1; fellBackCostUsd += n.costUsd ?? 0; }
    }
  }
  const providers = [...by.values()].map(({ reasonMap, ...r }) => ({
    ...r,
    reasons: [...reasonMap].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
  })).sort((a, b) => (b.succeeded + b.failed) - (a.succeeded + a.failed));
  return { since, providers, fellBack, fellBackCostUsd };
}

/**
 * Providers in the chain worth a warning: tried at least 5 times and never
 * answered, or failed at least half of 10+ tries. `chain` is the enabled
 * providers, in order; a provider not in it isn't flagged.
 */
export function providerHealthProblems(health: ProviderHealth, chain: readonly string[]): ProviderProblem[] {
  const out: ProviderProblem[] = [];
  for (const p of chain) {
    const r = health.providers.find((x) => x.provider === p);
    if (!r) continue;
    const tries = r.succeeded + r.failed;
    const why = r.reasons[0] ? ` (mostly ${failureReasonLabel(r.reasons[0].category)})` : '';
    if (r.succeeded === 0 && r.failed >= 5) {
      out.push({ provider: p, kind: 'never-worked', message: `${p} failed all ${r.failed} tries${why} and never answered. Fix it or turn it off in Settings → LLM.` });
    } else if (r.failed >= 10 && r.failed / tries >= 0.5) {
      out.push({ provider: p, kind: 'mostly-failing', message: `${p} failed ${r.failed} of ${tries} tries${why}; those nodes went to the next provider.` });
    }
  }
  return out;
}
