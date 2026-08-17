/**
 * Inbox producer for OutcomeDetection.
 *
 * This exists for exactly one class of event, and being narrow is the whole
 * design: **the run completed, so `run-failure` never fired, but the agent
 * missed the outcome it declared.** That is the failure nobody currently
 * hears about — a digest that quietly produces zero headlines every morning
 * generates no signal anywhere in sua today.
 *
 * Everything else is deliberately NOT raised:
 *   - failed runs           → `run-failure` already owns those
 *   - `undetermined`        → "we couldn't tell" is not evidence of a problem;
 *                             raising on it teaches operators to ignore the inbox
 *   - agents with no `outcome:` block → no record is ever produced
 *
 * Structure mirrors `run-failure-inbox.ts` deliberately: a pure builder plus a
 * raise wrapper that owns dedupe/coalescing, so both producers behave the same
 * way under repeat events and both are unit-testable without a store.
 */

import type {
  AddMessageInput,
  InboxMessage,
  InboxResponse,
  InboxStore,
  OutcomeRecord,
  Run,
} from '@some-useful-agents/core';

/**
 * Escape hatch mirroring `isLocalRunFailureInboxEnabled()`. Set
 * `SUA_INBOX_OUTCOME_MISSES=0` to stop outcome misses reaching the inbox
 * while keeping detection and `sua outcome list` working.
 */
export function isOutcomeInboxEnabled(): boolean {
  return process.env.SUA_INBOX_OUTCOME_MISSES !== '0';
}

/**
 * Should this record open/append an inbox thread?
 *
 * Exported so the gate is testable on its own — it is the highest-risk
 * decision in this file (get it wrong in the permissive direction and the
 * inbox becomes noise; wrong in the strict direction and the capability is
 * invisible).
 */
export function shouldRaiseOutcome(record: OutcomeRecord, run: Run): boolean {
  if (run.status !== 'completed') return false;
  return record.evaluation.satisfied === 'no' || record.evaluation.satisfied === 'partial';
}

const VERDICT_PHRASE: Record<string, string> = {
  no: 'did not achieve',
  partial: 'only partly achieved',
};

/**
 * The body is the *evidence*, not a summary. This producer can write a better
 * message than the run-failure one because it has the author's declared intent
 * to compare the observation against — so it says what was expected, which
 * check failed, what was actually observed, and what could not be determined.
 */
export function buildOutcomeMessage(
  record: OutcomeRecord,
  dashboardBaseUrl?: string,
): AddMessageInput {
  const runLink = dashboardBaseUrl
    ? `${dashboardBaseUrl.replace(/\/$/, '')}/runs/${record.runId}`
    : `/runs/${record.runId}`;
  const phrase = VERDICT_PHRASE[record.evaluation.satisfied] ?? 'did not achieve';

  const lines: string[] = [
    `Agent **${record.agentId}** ran successfully but ${phrase} its declared outcome.`,
    '',
  ];

  if (record.intent.expected) {
    lines.push('**Expected**', record.intent.expected.trim(), '');
  }

  const failed = (record.evaluation.criteriaResults ?? []).filter((c) => !c.passed);
  const passed = (record.evaluation.criteriaResults ?? []).filter((c) => c.passed);
  if (failed.length > 0) {
    lines.push('**Checks that failed**');
    for (const c of failed) lines.push(`- \`${c.description}\` — ${c.reason ?? 'failed'}`);
    if (passed.length > 0) {
      lines.push(`- ${passed.length} other check${passed.length === 1 ? '' : 's'} passed.`);
    }
    lines.push('');
  }

  // Inferred prose only appears when a judge ran AND its citations resolved.
  if (record.observation.observedOutcome) {
    lines.push(
      '**What appears to have happened** (inferred from the evidence below)',
      record.observation.observedOutcome.text,
      '',
    );
  }

  const shown = record.observation.evidence.slice(0, 4);
  if (shown.length > 0) {
    lines.push('**Evidence**');
    for (const ev of shown) {
      const where = ev.source.nodeId
        ? `node \`${ev.source.nodeId}\`${ev.source.field ? `.${ev.source.field}` : ''}`
        : ev.source.path
          ? `\`${ev.source.path}\``
          : 'the run';
      if (ev.kind === 'absent') {
        lines.push(`- ${where} — **not found**: ${ev.value}`);
      } else {
        lines.push(`- ${where}: ${inlinePreview(ev.value)}`);
      }
    }
    if (record.observation.evidence.length > shown.length) {
      lines.push(`- …and ${record.observation.evidence.length - shown.length} more.`);
    }
    lines.push('');
  }

  // Only the unknowns an operator can act on. `not-inferred` just means "no
  // judge was configured", which is the default and not worth reporting.
  const unknowns = record.unknowns.filter((u) => u.reason !== 'not-inferred');
  if (unknowns.length > 0) {
    lines.push('**Could not be determined**');
    for (const u of unknowns) lines.push(`- ${u.detail ?? u.field} _(${u.reason})_`);
    lines.push('');
  }

  lines.push(
    `- Run: [${record.runId.slice(0, 8)}](${runLink}) — completed cleanly; the outcome, not the execution, is what failed.`,
    `- Full record: \`sua outcome show ${record.runId.slice(0, 8)}\``,
  );

  return {
    // `medium`, not `high`: nothing is on fire — the agent ran. `high` stays
    // reserved for run-failure, so the two remain distinguishable at a glance.
    priority: 'medium',
    source: 'outcome',
    title: `Outcome missed: ${record.agentId}`,
    body: lines.join('\n'),
    agentId: record.agentId,
    runId: record.runId,
    dedupeKey: `outcome:${record.runId}`,
  };
}

/** One-line system note when an active thread absorbs a repeat miss. */
export function buildCoalescedOutcomeNote(
  record: OutcomeRecord,
  dashboardBaseUrl?: string,
): string {
  const runLink = dashboardBaseUrl
    ? `${dashboardBaseUrl.replace(/\/$/, '')}/runs/${record.runId}`
    : `/runs/${record.runId}`;
  const failed = (record.evaluation.criteriaResults ?? []).filter((c) => !c.passed);
  const why = failed.length > 0
    ? ` — \`${failed[0].description}\`: ${failed[0].reason ?? 'failed'}`
    : '';
  const phrase = VERDICT_PHRASE[record.evaluation.satisfied] ?? 'did not achieve';
  return `Another run of **${record.agentId}** ${phrase} its outcome: [${record.runId.slice(0, 8)}](${runLink})${why}`;
}

export interface RaisedOutcome {
  message: InboxMessage;
  coalesced: boolean;
  response?: InboxResponse;
}

/**
 * Raise an outcome miss into the inbox, or append to the agent's existing
 * outcome thread. Returns `undefined` when nothing was raised.
 *
 * Noise control is identical to `raiseRunFailureInbox`: an agent that misses
 * its outcome nightly gets ONE thread with a visible frequency, not N threads
 * and N auto-triage turns.
 */
export function raiseOutcomeInbox(
  inboxStore: InboxStore | undefined,
  record: OutcomeRecord,
  run: Run,
  dashboardBaseUrl?: string,
): RaisedOutcome | undefined {
  if (!inboxStore) return undefined;
  if (!isOutcomeInboxEnabled()) return undefined;
  // Synthetic internal helpers (`_yaml-fixer`, build planner agents) are not
  // user agents — same exclusion the failure producer makes.
  if (record.agentId.startsWith('_')) return undefined;
  if (!shouldRaiseOutcome(record, run)) return undefined;

  try {
    const active = inboxStore.findActiveByAgentAndSource(record.agentId, 'outcome');
    if (active) {
      const dedupeKey = `outcome:${record.runId}`;
      // Already recorded (hook double-fire, or a resumed run re-detecting).
      if (active.runId === record.runId || inboxStore.findByDedupeKey(dedupeKey)) {
        return { message: active, coalesced: true };
      }
      const shortId = record.runId.slice(0, 8);
      if (inboxStore.listResponses(active.id).some((r) => r.role === 'system' && r.body.includes(shortId))) {
        return { message: active, coalesced: true };
      }
      const response = inboxStore.addResponse(
        active.id,
        'system',
        buildCoalescedOutcomeNote(record, dashboardBaseUrl),
      );
      return { message: active, coalesced: true, response };
    }
    const message = inboxStore.add(buildOutcomeMessage(record, dashboardBaseUrl));
    return { message, coalesced: false };
  } catch {
    // Best-effort, exactly like the failure producer: raising an inbox thread
    // must never be able to affect a run that has already finished.
    return undefined;
  }
}

function inlinePreview(value: string): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  const clipped = oneLine.length > 160 ? `${oneLine.slice(0, 160)}…` : oneLine;
  return `\`${clipped}\``;
}
