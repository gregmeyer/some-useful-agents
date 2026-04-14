import type { Run } from '@some-useful-agents/core';
import { html, render, unsafeHtml } from './html.js';
import { layout } from './layout.js';
import { statusBadge, outputFrame, formatDuration } from './components.js';

export interface RunDetailOptions {
  run: Run;
  /** If true, render ONLY the updatable fragment (for the 2s poll). */
  partial?: boolean;
}

export function renderRunDetail(opts: RunDetailOptions): string {
  const { run, partial } = opts;
  const inProgress = run.status === 'running' || run.status === 'pending';

  // Run id is a UUID — safe to inline in an attribute without re-escaping
  // because it contains only [a-f0-9-]. Asserted where the value is minted.
  const pollAttr = inProgress ? unsafeHtml(` data-run-in-progress="${run.id}"`) : unsafeHtml('');

  const fragment = html`
    <div data-run-container${pollAttr}>
      <h1>
        Run <span class="mono">${run.id.slice(0, 8)}</span>
        ${statusBadge(run.status)}
      </h1>
      <dl class="kv">
        <dt>Agent</dt><dd><a href="/agents/${run.agentName}">${run.agentName}</a></dd>
        <dt>Started</dt><dd class="mono">${run.startedAt}</dd>
        <dt>Completed</dt><dd class="mono">${run.completedAt ?? html`<span class="dim">in progress</span>`}</dd>
        <dt>Duration</dt><dd>${formatDuration(run.startedAt, run.completedAt)}</dd>
        <dt>Exit code</dt><dd class="mono">${run.exitCode !== undefined ? String(run.exitCode) : ''}</dd>
        <dt>Triggered by</dt><dd>${run.triggeredBy}</dd>
      </dl>

      ${run.error ? html`
        <h2>Error</h2>
        <div class="flash flash-error">${run.error}</div>
      ` : html``}

      <h2>Output</h2>
      ${run.result ? outputFrame(run.result) : html`<p class="dim">No output yet.</p>`}
    </div>
  `;

  if (partial) {
    return render(html`<!DOCTYPE html><html><body>${fragment}</body></html>`);
  }

  return render(layout({ title: `Run ${run.id.slice(0, 8)}`, activeNav: 'runs' }, fragment));
}
