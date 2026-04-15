import type { Agent, NodeExecutionRecord, Run } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader, type PageHeaderBack } from './page-header.js';
import { statusBadge, outputFrame, formatDuration } from './components.js';
import { renderDagView, renderDagFallback } from './dag-view.js';

export interface RunDetailOptions {
  run: Run;
  /** If true, render ONLY the updatable fragment (for the 2s poll). */
  partial?: boolean;
  /** v2 per-node executions, present when `run.workflowId` is set. */
  nodeExecutions?: NodeExecutionRecord[];
  /** v2 agent definition at the run's version, for DAG rendering + node labels. */
  agent?: Agent;
  /** Contextual back link derived from the request's Referer header. */
  back?: PageHeaderBack;
}

export function renderRunDetail(opts: RunDetailOptions): string {
  const { run, partial, nodeExecutions, agent, back } = opts;
  const inProgress = run.status === 'running' || run.status === 'pending';

  // Run id is a UUID — safe to inline in an attribute without re-escaping.
  const pollAttr = inProgress ? unsafeHtml(` data-run-in-progress="${run.id}"`) : unsafeHtml('');

  const isDagRun = run.workflowId && nodeExecutions && agent;

  const replayedFrom = run.replayedFromRunId ? html`
    <dt>Replayed from</dt>
    <dd class="mono">
      <a href="/runs/${run.replayedFromRunId}">${run.replayedFromRunId.slice(0, 8)}</a>
      <span class="dim"> @ ${run.replayedFromNodeId ?? ''}</span>
    </dd>
  ` : html``;

  const dagSection = isDagRun ? html`
    ${renderDagFallback(agent)}
    ${renderDagView({ agent, nodeExecs: nodeExecutions, navBase: `/runs/${run.id}` })}
  ` : html``;

  // Per-node execution as click-expandable cards (one <details> per node).
  // Compact by default; the user opens only what they care about.
  const nodeCards = isDagRun ? html`
    <section>
      <h2>Per-node execution</h2>
      ${renderNodeCards(nodeExecutions!)}
    </section>
  ` : html``;

  const header = partial
    ? html`<h1>Run <span class="mono">${run.id.slice(0, 8)}</span> ${statusBadge(run.status)}</h1>`
    : pageHeader({
        title: `Run ${run.id.slice(0, 8)}`,
        meta: [statusBadge(run.status)],
        back,
      });

  const fragment = html`
    <div data-run-container${pollAttr}>
      ${header}

      <div class="card" style="margin-bottom: var(--space-6);">
        <dl class="kv">
          <dt>Agent</dt><dd><a href="/agents/${run.agentName}">${run.agentName}</a>${run.workflowVersion ? html` <span class="dim">v${String(run.workflowVersion)}</span>` : html``}</dd>
          <dt>Started</dt><dd class="mono">${run.startedAt}</dd>
          <dt>Completed</dt><dd class="mono">${run.completedAt ?? html`<span class="dim">in progress</span>`}</dd>
          <dt>Duration</dt><dd>${formatDuration(run.startedAt, run.completedAt)}</dd>
          <dt>Exit code</dt><dd class="mono">${run.exitCode !== undefined ? String(run.exitCode) : ''}</dd>
          <dt>Triggered by</dt><dd>${run.triggeredBy}</dd>
          ${replayedFrom}
        </dl>
      </div>

      ${run.error ? html`
        <h2>Error</h2>
        <div class="flash flash--error">${run.error}</div>
      ` : html``}

      ${dagSection}
      ${nodeCards}

      ${isDagRun ? html`` : html`
        <h2>Output</h2>
        ${run.result ? outputFrame(run.result) : html`<p class="dim">No output yet.</p>`}
      `}
    </div>
  `;

  if (partial) {
    return render(html`<!DOCTYPE html><html><body>${fragment}</body></html>`);
  }

  return render(layout({ title: `Run ${run.id.slice(0, 8)}`, activeNav: 'runs' }, fragment));
}

/**
 * Render one collapsible card per node execution. Failed/errored nodes
 * open by default so the user doesn't have to hunt for failures; others
 * are collapsed to reduce scroll.
 */
function renderNodeCards(execs: NodeExecutionRecord[]): SafeHtml {
  const cards = execs.map((e) => {
    const shouldOpen = e.status === 'failed' || e.error !== undefined;
    const openAttr = shouldOpen ? unsafeHtml(' open') : unsafeHtml('');
    const duration = formatDuration(e.startedAt, e.completedAt);
    const exitLabel = e.exitCode !== undefined ? `exit ${e.exitCode}` : '';
    const category = e.errorCategory
      ? html` <span class="badge badge--err">${e.errorCategory}</span>`
      : html``;

    const bodyBlocks: SafeHtml[] = [];
    if (e.error) bodyBlocks.push(html`<div class="flash flash--error">${e.error}</div>`);
    if (e.result && e.result.length > 0) {
      bodyBlocks.push(html`<h4 class="dim" style="margin: var(--space-4) 0 var(--space-2);">stdout</h4>`);
      bodyBlocks.push(outputFrame(e.result));
    }
    if (bodyBlocks.length === 0) {
      bodyBlocks.push(html`<p class="dim" style="margin: var(--space-2) 0 0;">No output.</p>`);
    }

    return html`
      <details class="run-node" id="node-${e.nodeId}"${openAttr}>
        <summary class="run-node__header">
          <span class="run-node__id">${e.nodeId}</span>
          ${statusBadge(e.status)}
          ${category}
          <span class="run-node__meta">
            <span>${duration}</span>
            ${exitLabel ? html`<span class="mono">${exitLabel}</span>` : html``}
          </span>
        </summary>
        <div class="run-node__body">${bodyBlocks as unknown as SafeHtml[]}</div>
      </details>
    `;
  });
  return cards as unknown as SafeHtml;
}
