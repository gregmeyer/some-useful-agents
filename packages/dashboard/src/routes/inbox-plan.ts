import {
  isSafeUrl,
  type InboxActionMeta,
  type InboxResponse,
} from '@some-useful-agents/core';
import { getContext } from '../context.js';
import {
  stableStringifyInputs,
  parseActionMeta,
  publishInboxEvent,
  TRIAGE_REJECTION_RECOVERY_NOTE,
} from './inbox-shared.js';

/**
 * How many times a triage run may crash with an infra error before we stop
 * auto-retrying and post a terminal "crashed" note. Owned here because
 * planTriageCrashRecovery is its only consumer.
 */
const MAX_TRIAGE_CRASH_RETRIES = 1;

export function hasMatchingFailedAction(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
  candidate: InboxActionMeta,
): boolean {
  if (!ctx.inboxStore) return false;
  const candidateInputs = stableStringifyInputs(candidate.inputs);
  // When the target agent was edited AFTER a failure, that failure is stale —
  // the operator fixing the agent is exactly the "something changed that would
  // make a retry succeed" case. Without this, an inputs-less agent (every
  // re-proposal looks identical) is blocked forever even after a fix, and the
  // "revise the inputs" advice is impossible to follow. Compare the agent's
  // updatedAt against the failed action's end time.
  let agentUpdatedAt = 0;
  try {
    const raw = ctx.agentStore.getAgent(candidate.agentId)?.updatedAt;
    if (raw) agentUpdatedAt = Date.parse(raw);
  } catch { /* agent gone — fall through, treat as no edit */ }
  for (const response of ctx.inboxStore.listResponses(messageId)) {
    const existing = parseActionMeta(response);
    if (!existing) continue;
    if (existing.agentId !== candidate.agentId) continue;
    if (existing.status !== 'failed' && existing.status !== 'refused') continue;
    if (stableStringifyInputs(existing.inputs) !== candidateInputs) continue;
    // Agent changed since this failure → the prior failure no longer applies.
    if (agentUpdatedAt && existing.endedAt && agentUpdatedAt > existing.endedAt) continue;
    return true;
  }
  return false;
}

/**
 * Parse + validate the `actions` field from a triage `<plan>` block.
 * Returns valid action proposals + the rejected ones (with a reason)
 * so the route can surface refusals as `system` responses in the
 * conversation. Unknown agent ids fall into rejected.
 */
/** Max structured link-CTA buttons a single triage reply may carry. */
const MAX_TRIAGE_LINKS = 4;

export interface TriageLink {
  label: string;
  href: string;
}

export function hasRecoveryRefireSinceLastUser(
  ctx: ReturnType<typeof getContext>,
  messageId: string,
): boolean {
  if (!ctx.inboxStore) return false;
  const responses = ctx.inboxStore.listResponses(messageId);
  for (let i = responses.length - 1; i >= 0; i -= 1) {
    const response = responses[i];
    if (response.role === 'user') return false;
    if (response.role === 'system' && response.body.trim() === TRIAGE_REJECTION_RECOVERY_NOTE) {
      return true;
    }
  }
  return false;
}

/**
 * Validate the optional `links` array on a triage <plan>. Each entry needs a
 * short label and an href that passes the sanitizer's URL allowlist (relative
 * or http(s)/mailto). Capped at MAX_TRIAGE_LINKS; invalid entries are dropped.
 *
 * `agentExists`, when supplied, kills fabricated agent links: triage likes to
 * claim it built an agent and link `/agents/<id>` before any such agent
 * exists. A dead link reads as "it's there, go click it" when it 404s. With
 * the predicate, an `/agents/<id>` href whose agent isn't in the store is
 * dropped — only real agents get linked. The genuine link is emitted by the
 * system after the build actually commits (see maybeCommitBuiltAgent).
 */
export function parseTriageLinks(
  raw: unknown,
  agentExists?: (id: string) => boolean,
): TriageLink[] {
  if (!Array.isArray(raw)) return [];
  const out: TriageLink[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const label = typeof e.label === 'string' ? e.label.trim().slice(0, 40) : '';
    const href = typeof e.href === 'string' ? e.href.trim() : '';
    if (!label || !href || !isSafeUrl(href)) continue;
    if (agentExists) {
      const m = href.match(/^\/agents\/([a-zA-Z0-9_-]+)(?:[/?#].*)?$/);
      if (m && !agentExists(m[1])) continue; // fabricated agent link — drop it
    }
    out.push({ label, href });
    if (out.length >= MAX_TRIAGE_LINKS) break;
  }
  return out;
}

export function findLatestTriageLinks(
  responses: readonly InboxResponse[],
): TriageLink[] {
  for (let i = responses.length - 1; i >= 0; i -= 1) {
    const response = responses[i];
    if (response.role !== 'triage' || !response.metaJson) continue;
    try {
      const parsed = JSON.parse(response.metaJson) as { links?: unknown };
      const links = parseTriageLinks(parsed.links);
      if (links.length > 0) return links;
    } catch { /* ignore */ }
  }
  return [];
}

export function postTriageFailureFallback(
  ctx: ReturnType<typeof getContext>,
  message: { id: string; agentId?: string },
  responses: readonly InboxResponse[],
): void {
  const priorLinks = findLatestTriageLinks(responses);
  const links = priorLinks.length > 0
    ? priorLinks
    : message.agentId
      ? [{ label: 'Open agent', href: `/agents/${message.agentId}` }]
      : [{ label: 'Open agents', href: '/agents' }];
  const body = priorLinks.length > 0
    ? 'I hit a triage failure before I could suggest a new step. Use the last concrete destination below and continue from there.'
    : message.agentId
      ? `I hit a triage failure before I could suggest a new step. Open /agents/${message.agentId} to continue directly.`
      : 'I hit a triage failure before I could suggest a new step. Open /agents to continue directly, or retry triage.';
  const metaJson = JSON.stringify({ links });
  const reply = ctx.inboxStore!.addResponse(message.id, 'triage', body, metaJson);
  publishInboxEvent(ctx, message.id, 'triage:complete', {
    responseId: reply.id,
    role: 'triage',
    body,
    createdAt: reply.createdAt,
  });
}

export function parseProposedActions(
  rawActions: unknown,
  allowlist: readonly string[],
  candidates: readonly string[] = [],
): {
  accepted: InboxActionMeta[];
  rejected: { agentId: string; reason: string }[];
  deferred: { agentId: string }[];
} {
  const accepted: InboxActionMeta[] = [];
  const rejected: { agentId: string; reason: string }[] = [];
  const deferred: { agentId: string }[] = [];
  if (!Array.isArray(rawActions)) return { accepted, rejected, deferred };
  const allowSet = new Set(allowlist);
  const candidateSet = new Set(candidates);
  for (const entry of rawActions.slice(0, 3)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const type = typeof e.type === 'string' ? e.type : '';
    const agentId = typeof e.agentId === 'string' ? e.agentId : '';
    if (type !== 'run-agent' || !agentId) {
      rejected.push({ agentId: agentId || '<unknown>', reason: 'malformed action entry' });
      continue;
    }
    // An agent that's already runnable runs directly. An installed
    // candidate is accepted as an "Enable & run": approving it grants
    // inboxRunnable first (grantsInboxRunnable), then runs. Anything else
    // is rejected.
    const isRunnable = allowSet.has(agentId);
    const isCandidate = !isRunnable && candidateSet.has(agentId);
    if (!isRunnable && !isCandidate) {
      rejected.push({ agentId, reason: 'not in ALLOWED_SUB_AGENTS or RUNNABLE_CANDIDATES' });
      continue;
    }
    const inputs: Record<string, string> = {};
    if (e.inputs && typeof e.inputs === 'object' && !Array.isArray(e.inputs)) {
      for (const [k, v] of Object.entries(e.inputs as Record<string, unknown>)) {
        if (typeof k === 'string' && typeof v === 'string') inputs[k] = v;
      }
    }
    const rationale = typeof e.rationale === 'string' ? e.rationale.trim() : undefined;
    const ctaLabel = typeof e.ctaLabel === 'string' ? e.ctaLabel.trim().slice(0, 40) : undefined;
    // `write` mutates external state; anything else (incl. absent) is `read`.
    const effect: 'read' | 'write' = e.effect === 'write' ? 'write' : 'read';
    accepted.push({
      kind: 'action',
      status: 'proposed',
      agentId,
      inputs,
      rationale: rationale || undefined,
      effect,
      // For a candidate, override the CTA so the operator sees they're
      // granting run permission, not just running.
      ctaLabel: isCandidate ? (ctaLabel || 'Enable & run') : (ctaLabel || undefined),
      ...(isCandidate ? { grantsInboxRunnable: true } : {}),
    });
  }
  // Sequence side effects: keep at most ONE `write` action per turn so the
  // operator confirms one mutation before the next is even proposed. Extra
  // writes are deferred — once the first completes, the follow-up triage turn
  // re-plans and proposes the next from the updated state. `read` actions
  // (search, diagnosis, list probes) still batch freely.
  let sawWrite = false;
  const sequenced: InboxActionMeta[] = [];
  for (const action of accepted) {
    if (action.effect === 'write') {
      if (sawWrite) {
        deferred.push({ agentId: action.agentId });
        continue;
      }
      sawWrite = true;
    }
    sequenced.push(action);
  }
  return { accepted: sequenced, rejected, deferred };
}

/**
 * Decide how to recover from a crashed triage run, given how many auto-retries
 * have already been spent on this thread. Pure so the branching (retry vs.
 * terminal note, the operator-facing copy) is unit-testable without forcing a
 * real crash. `willRetry` true → schedule another attempt and bump the count;
 * false → the budget is spent, post a terminal note and clear the count.
 */
export function planTriageCrashRecovery(
  used: number,
  errorMessage: string,
): { willRetry: boolean; noteBody: string } {
  if (used < MAX_TRIAGE_CRASH_RETRIES) {
    return { willRetry: true, noteBody: `Triage hit a transient error (${errorMessage}). Retrying…` };
  }
  return {
    willRetry: false,
    noteBody: `Triage agent crashed after ${used + 1} attempts: ${errorMessage}. Reply or ask triage to try again.`,
  };
}
