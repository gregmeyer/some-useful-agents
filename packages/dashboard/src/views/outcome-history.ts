import type { OutcomeHistory, OutcomeHistoryChangeReason, OutcomeVerdict } from '@some-useful-agents/core';
import { html, type SafeHtml } from './html.js';

const VERDICT: Record<OutcomeVerdict, { label: string; cls: string }> = {
  yes: { label: 'Outcome achieved', cls: 'badge--ok' },
  partial: { label: 'Outcome partly achieved', cls: 'badge--warn' },
  no: { label: 'Outcome not achieved', cls: 'badge--err' },
  undetermined: { label: 'Outcome undetermined', cls: 'badge--muted' },
};

const CHANGE_LABEL: Record<OutcomeHistoryChangeReason, string> = {
  'initial evaluation': 'initial evaluation',
  'new evidence': 'new evidence added',
  'contract changed': 'contract changed',
  'evaluator changed': 'evaluator changed',
  'criteria engine changed': 'criteria engine changed',
  'identical-input rerun': 'identical-input rerun',
};

export function renderOutcomeHistory(history: OutcomeHistory): SafeHtml {
  return html`
    <section class="outcome-history">
      <div class="outcome-history__header">
        <h2 style="margin: 0;">Outcome history</h2>
        <div class="dim" style="font-size: var(--font-size-xs);">
          ${String(history.evaluations.length)} evaluation${history.evaluations.length === 1 ? '' : 's'} · latest ${history.latestVerdict} at ${history.latestEvaluatedAt}
        </div>
      </div>
      <div class="outcome-history__timeline">
        ${history.evaluations.map((evaluation) => {
          const verdict = VERDICT[evaluation.verdict];
          const evidenceShared = evaluation.evidence.length - evaluation.addedEvidence.length;
          const deemphasized = evaluation.changeReason.length === 1 && evaluation.changeReason[0] === 'identical-input rerun';
          const contractChanged = evaluation.changeReason.includes('contract changed');
          const evaluatorChanged = evaluation.changeReason.includes('evaluator changed') || evaluation.changeReason.includes('criteria engine changed');
          return html`
            <details class="outcome-history__item${deemphasized ? ' outcome-history__item--rerun' : ''}">
              <summary class="outcome-history__summary">
                <span class="badge ${verdict.cls}">${verdict.label}</span>
                <span class="outcome-history__timestamp mono">${evaluation.evaluatedAt}</span>
                <span class="outcome-history__changes">
                  ${evaluation.changeReason.map((reason) => html`<span class="badge badge--muted">${CHANGE_LABEL[reason]}</span>`)}
                </span>
              </summary>
              <div class="outcome-history__body">
                <div class="outcome-history__delta">
                  ${evaluation.addedEvidence.length > 0
                    ? html`<div><strong>${String(evaluation.addedEvidence.length)}</strong> new evidence item${evaluation.addedEvidence.length === 1 ? '' : 's'} added${evidenceShared > 0 ? html` <span class="dim">(${String(evidenceShared)} carried forward)</span>` : ''}</div>`
                    : html`<div class="dim">No evidence changes for this evaluation.</div>`}
                  ${contractChanged
                    ? html`<div><strong>Contract updated.</strong> This evaluation used a different success definition snapshot.</div>`
                    : ''}
                  ${evaluatorChanged
                    ? html`<div><strong>Evaluator metadata changed.</strong> ${evaluation.evaluator.kind} ${evaluation.evaluator.version}${evaluation.evaluator.judge ? ` · ${evaluation.evaluator.judge}` : ''} · criteria ${evaluation.criteriaEngineVersion}</div>`
                    : ''}
                </div>

                <div class="outcome-history__inspect">
                  <details>
                    <summary>Evidence used (${String(evaluation.evidence.length)})</summary>
                    <ul class="outcome-history__list">
                      ${evaluation.evidence.map((item) => html`<li>
                        <div>${item.subject ? `${item.subject.type} ${item.subject.id}` : item.source}</div>
                        <div class="dim">
                          observed ${item.observedAt} · source ${item.source} · origin ${item.originatingRunId}${item.observingRunId ? ` · observed by ${item.observingRunId}` : ''} · ${item.observationMode}
                        </div>
                      </li>`)}
                    </ul>
                  </details>

                  ${evaluation.addedEvidence.length > 0
                    ? html`<details>
                        <summary>Evidence added since prior evaluation (${String(evaluation.addedEvidence.length)})</summary>
                        <ul class="outcome-history__list">
                          ${evaluation.addedEvidence.map((item) => html`<li>
                            <div>${item.subject ? `${item.subject.type} ${item.subject.id}` : item.source}</div>
                            <div class="dim">
                              observed ${item.observedAt} · source ${item.source} · origin ${item.originatingRunId}${item.observingRunId ? ` · observed by ${item.observingRunId}` : ''} · ${item.observationMode}
                            </div>
                          </li>`)}
                        </ul>
                      </details>`
                    : ''}

                  <details>
                    <summary>Contract snapshot</summary>
                    <pre class="outcome-history__debug">${JSON.stringify(evaluation.contractSnapshot, null, 2)}</pre>
                  </details>

                  <details>
                    <summary>Debug details</summary>
                    <pre class="outcome-history__debug">${JSON.stringify({
                      evaluationId: evaluation.evaluationId,
                      inputFingerprint: evaluation.inputFingerprint,
                      contractHash: evaluation.contractHash,
                      evaluator: evaluation.evaluator,
                      criteriaEngineVersion: evaluation.criteriaEngineVersion,
                      evidenceIds: evaluation.evidenceIds,
                    }, null, 2)}</pre>
                  </details>
                </div>
              </div>
            </details>
          `;
        })}
      </div>
    </section>
  `;
}
