/**
 * Shared renderer for an `OutcomeRecord`.
 *
 * One renderer, two surfaces: the run detail page (`variant: 'full'`, always
 * expanded — it's the reason you opened the page) and inbox thread cards
 * (`variant: 'compact'`, collapsed behind a summary so it doesn't dominate a
 * conversation).
 *
 * The layout deliberately preserves the record's four information tiers rather
 * than flattening them into prose: what was DECLARED, what was OBSERVED, what
 * was INFERRED, and what could NOT be determined. A reader has to be able to
 * tell which is which — that separation is the only thing that makes an
 * outcome record worth more than a status string.
 */

import type { OutcomeRecord } from '@some-useful-agents/core';
import { html, type SafeHtml } from './html.js';

const VERDICT: Record<string, { label: string; cls: string }> = {
  yes: { label: 'Outcome achieved', cls: 'badge--ok' },
  partial: { label: 'Outcome partly achieved', cls: 'badge--warn' },
  no: { label: 'Outcome not achieved', cls: 'badge--err' },
  undetermined: { label: 'Outcome undetermined', cls: 'badge--muted' },
};

export interface OutcomeRecordViewOptions {
  variant?: 'full' | 'compact';
}

export function renderOutcomeRecord(
  record: OutcomeRecord,
  options: OutcomeRecordViewOptions = {},
): SafeHtml {
  const compact = options.variant === 'compact';
  const verdict = VERDICT[record.evaluation.satisfied] ?? VERDICT.undetermined;
  const failed = (record.evaluation.criteriaResults ?? []).filter((c) => !c.passed);
  const passed = (record.evaluation.criteriaResults ?? []).filter((c) => c.passed);
  const evidence = compact ? record.observation.evidence.slice(0, 3) : record.observation.evidence;
  // `not-inferred` just means "no judge configured" — the default. Reporting it
  // as a gap on every record would train people to ignore the unknowns list.
  const unknowns = record.unknowns.filter((u) => u.reason !== 'not-inferred');

  const summaryLine = html`
    <span class="badge ${verdict.cls}">${verdict.label}</span>
    <span class="dim" style="font-size: var(--font-size-xs);">
      ${record.evaluation.basis} · confidence ${record.evaluation.confidence} ·
      ${String(record.observation.evidence.length)} evidence${unknowns.length > 0 ? html` · <strong>${String(unknowns.length)} unknown</strong>` : ''}
    </span>
  `;

  const body = html`
    <div class="outcome-record__body">
      ${record.intent.expected
        ? html`<div class="outcome-record__block">
            <div class="outcome-record__label">Expected</div>
            <div>${record.intent.expected}</div>
          </div>`
        : ''}

      ${record.intent.assumptions.length > 0 && !compact
        ? html`<div class="outcome-record__block">
            <div class="outcome-record__label">Assumed (not verified)</div>
            <ul>${record.intent.assumptions.map((a) => html`<li>${a}</li>`)}</ul>
          </div>`
        : ''}

      ${record.evaluation.criteriaResults?.length
        ? html`<div class="outcome-record__block">
            <div class="outcome-record__label">Checks</div>
            <ul>
              ${failed.map((c) => html`<li><span class="outcome-record__x">✗</span> <code>${c.description}</code> — ${c.reason ?? 'failed'}</li>`)}
              ${(compact && failed.length > 0 ? [] : passed).map((c) => html`<li><span class="outcome-record__tick">✓</span> <code>${c.description}</code></li>`)}
              ${compact && failed.length > 0 && passed.length > 0
                ? html`<li class="dim">${String(passed.length)} other check${passed.length === 1 ? '' : 's'} passed</li>`
                : ''}
            </ul>
          </div>`
        : ''}

      ${record.observation.observedOutcome
        ? html`<div class="outcome-record__block">
            <div class="outcome-record__label">What happened <span class="dim">(inferred from the evidence below)</span></div>
            <div>${record.observation.observedOutcome.text}</div>
            <div class="dim" style="font-size: var(--font-size-xs);">cites ${record.observation.observedOutcome.citedEvidenceIds.join(', ')}</div>
          </div>`
        : ''}

      ${record.evaluation.expectedVsObserved
        ? html`<div class="outcome-record__block">
            <div class="outcome-record__label">Compared to expected <span class="dim">(inferred)</span></div>
            <div>${record.evaluation.expectedVsObserved.text}</div>
            <div class="dim" style="font-size: var(--font-size-xs);">cites ${record.evaluation.expectedVsObserved.citedEvidenceIds.join(', ')}</div>
          </div>`
        : ''}

      ${evidence.length > 0
        ? html`<div class="outcome-record__block">
            <div class="outcome-record__label">Evidence <span class="dim">(observed, not inferred)</span></div>
            <ul class="outcome-record__evidence">
              ${evidence.map((e) => html`<li>
                <code class="outcome-record__ev-id">${e.id}</code>
                <code>${e.source.nodeId ?? e.source.path ?? 'run'}${e.source.field ? `.${e.source.field}` : ''}</code>
                ${e.label ? html`<span class="dim"> — ${e.label}</span>` : ''}
                <div class="outcome-record__value">${e.kind === 'absent'
                  ? html`<em>not found:</em> ${e.value}`
                  : html`${compact ? clip(e.value, 140) : clip(e.value, 600)}`}${e.truncated ? html`<span class="dim"> …truncated</span>` : ''}</div>
              </li>`)}
              ${compact && record.observation.evidence.length > evidence.length
                ? html`<li class="dim">…and ${String(record.observation.evidence.length - evidence.length)} more</li>`
                : ''}
            </ul>
          </div>`
        : ''}

      ${unknowns.length > 0
        ? html`<div class="outcome-record__block">
            <div class="outcome-record__label">Could not be determined</div>
            <ul>${unknowns.map((u) => html`<li>${u.detail ?? u.field} <span class="dim">(${u.reason})</span></li>`)}</ul>
          </div>`
        : ''}

      ${record.followUp?.length
        ? html`<div class="outcome-record__block">
            <div class="outcome-record__label">Suggested follow-up <span class="dim">(advisory — nothing acts on this)</span></div>
            <ul>${record.followUp.map((f) => html`<li>${f}</li>`)}</ul>
          </div>`
        : ''}

      <div class="dim" style="font-size: var(--font-size-xs);">
        <code>sua outcome show ${record.runId.slice(0, 8)}</code>
      </div>
    </div>
  `;

  if (compact) {
    return html`
      <details class="outcome-record outcome-record--compact">
        <summary>${summaryLine}</summary>
        ${body}
      </details>
    `;
  }

  return html`
    <div class="outcome-record">
      <div class="outcome-record__summary">${summaryLine}</div>
      ${body}
    </div>
  `;
}

function clip(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}
