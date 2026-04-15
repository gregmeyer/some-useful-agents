import type { Agent, NodeExecutionRecord, Run } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
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
}

export function renderRunDetail(opts: RunDetailOptions): string {
  const { run, partial, nodeExecutions, agent } = opts;
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
    <h2>DAG</h2>
    ${renderDagFallback(agent)}
    ${renderDagView({ agent, nodeExecs: nodeExecutions, navBase: `/runs/${run.id}` })}
  ` : html``;

  const nodeTable = isDagRun ? html`
    <h2>Per-node execution</h2>
    <table>
      <thead>
        <tr>
          <th>Node</th><th>Status</th><th>Category</th>
          <th>Started</th><th>Duration</th><th>Exit</th>
        </tr>
      </thead>
      <tbody>${renderNodeExecRows(nodeExecutions!)}</tbody>
    </table>
    ${renderNodeDetails(nodeExecutions!, run)}
  ` : html``;

  const fragment = html`
    <div data-run-container${pollAttr}>
      <h1>
        Run <span class="mono">${run.id.slice(0, 8)}</span>
        ${statusBadge(run.status)}
      </h1>
      <dl class="kv">
        <dt>Agent</dt><dd><a href="/agents/${run.agentName}">${run.agentName}</a>${run.workflowVersion ? html` <span class="dim">v${String(run.workflowVersion)}</span>` : html``}</dd>
        <dt>Started</dt><dd class="mono">${run.startedAt}</dd>
        <dt>Completed</dt><dd class="mono">${run.completedAt ?? html`<span class="dim">in progress</span>`}</dd>
        <dt>Duration</dt><dd>${formatDuration(run.startedAt, run.completedAt)}</dd>
        <dt>Exit code</dt><dd class="mono">${run.exitCode !== undefined ? String(run.exitCode) : ''}</dd>
        <dt>Triggered by</dt><dd>${run.triggeredBy}</dd>
        ${replayedFrom}
      </dl>

      ${run.error ? html`
        <h2>Error</h2>
        <div class="flash flash-error">${run.error}</div>
      ` : html``}

      ${dagSection}
      ${nodeTable}

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

function renderNodeExecRows(execs: NodeExecutionRecord[]): SafeHtml {
  const rows = execs.map((e) => html`
    <tr>
      <td><a href="#node-${e.nodeId}" class="mono">${e.nodeId}</a></td>
      <td>${statusBadge(e.status)}</td>
      <td>${e.errorCategory ? html`<span class="badge badge-err">${e.errorCategory}</span>` : html`<span class="dim">—</span>`}</td>
      <td class="dim mono">${e.startedAt}</td>
      <td class="dim">${formatDuration(e.startedAt, e.completedAt)}</td>
      <td class="mono">${e.exitCode !== undefined ? String(e.exitCode) : html`<span class="dim">—</span>`}</td>
    </tr>
  `);
  return rows as unknown as SafeHtml;
}

function renderNodeDetails(execs: NodeExecutionRecord[], run: Run): SafeHtml {
  const sections = execs.map((e) => {
    const hasError = e.error !== undefined;
    const hasResult = e.result !== undefined && e.result.length > 0;
    if (!hasError && !hasResult) return html``;
    return html`
      <div id="node-${e.nodeId}" style="margin: 1.5rem 0;">
        <h3>
          <span class="mono">${e.nodeId}</span>
          ${statusBadge(e.status)}
          ${e.errorCategory ? html`<span class="badge badge-err">${e.errorCategory}</span>` : html``}
        </h3>
        ${e.error ? html`<div class="flash flash-error">${e.error}</div>` : html``}
        ${e.result ? html`
          <h4 class="dim">stdout</h4>
          ${outputFrame(e.result)}
        ` : html``}
      </div>
    `;
  });
  void run;
  return sections as unknown as SafeHtml;
}
