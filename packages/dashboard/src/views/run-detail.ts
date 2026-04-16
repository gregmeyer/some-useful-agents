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
  /** Success/error banner surfaced on the detail page. */
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
}

export function renderRunDetail(opts: RunDetailOptions): string {
  const { run, partial, nodeExecutions, agent, back, flash } = opts;
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

  // Terminal v2 runs get clickable DAG nodes that offer "Replay from
  // here". Running / pending runs intentionally don't — the executor
  // hasn't finalised upstream outputs yet.
  const canReplay = !!agent && (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled');
  const dagSection = isDagRun ? html`
    ${renderDagFallback(agent)}
    ${renderDagView({
      agent,
      nodeExecs: nodeExecutions,
      navBase: `/runs/${run.id}`,
      replay: canReplay
        ? {
            priorRunId: run.id,
            requiresCommunityConfirm: agent.source === 'community' && agent.nodes.some((n) => n.type === 'shell'),
          }
        : undefined,
    })}
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

      ${isDagRun ? html`
        <div class="run-detail-grid">
          <div class="run-detail-grid__dag">
            ${dagSection}
            ${canReplay ? renderReplayFallback(run, agent!) : html``}
          </div>
          <div class="run-detail-grid__inspector">
            <h2 style="margin-top: 0;">Node execution</h2>
            <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3);">Click a node in the DAG to see its output.</p>
            ${renderNodeCards(nodeExecutions!, run.id, canReplay)}
          </div>
        </div>
      ` : html`
        <h2>Output</h2>
        ${run.result ? outputFrame(run.result) : html`<p class="dim">No output yet.</p>`}
      `}
    </div>
  `;

  if (partial) {
    return render(html`<!DOCTYPE html><html><body>${fragment}</body></html>`);
  }

  return render(layout({ title: `Run ${run.id.slice(0, 8)}`, activeNav: 'runs', flash, wide: !!isDagRun }, fragment));
}

/**
 * No-JS fallback replay form wrapped in a <noscript>. When the DAG viz
 * renders, the per-node dialog is the primary replay surface — this
 * block only becomes visible if JS is disabled / the Cytoscape bootstrap
 * fails to load. Keeps the feature reachable without JavaScript without
 * cluttering the main flow.
 */
function renderReplayFallback(run: Run, agent: Agent): SafeHtml {
  if (agent.nodes.length === 0) return html``;
  const options = agent.nodes.map((n) => html`<option value="${n.id}">${n.id}</option>`);
  const needsConfirm = agent.source === 'community' && agent.nodes.some((n) => n.type === 'shell');
  const confirmInput = needsConfirm
    ? html`
      <label class="replay-form__confirm">
        <input type="checkbox" name="confirm_community_shell" value="yes" required>
        I've audited this community shell agent and accept the risk.
      </label>`
    : unsafeHtml('');
  return html`
    <noscript>
      <section class="replay-form-section">
        <h2>Replay</h2>
        <p class="dim">
          JavaScript is disabled, so the clickable DAG isn't available.
          Pick a node below to replay from; upstream outputs from this run
          will be reused.
        </p>
        <form action="/runs/${run.id}/replay" method="post" class="replay-form">
          <label for="replay-from">Start from</label>
          <select id="replay-from" name="fromNodeId" required>
            <option value="">Select a node…</option>
            ${options as unknown as SafeHtml[]}
          </select>
          ${confirmInput}
          <button type="submit" class="btn btn--primary">Replay</button>
        </form>
      </section>
    </noscript>
  `;
}

/**
 * Render one collapsible card per node execution. Failed/errored nodes
 * open by default so the user doesn't have to hunt for failures; others
 * are collapsed to reduce scroll.
 */
function renderNodeCards(execs: NodeExecutionRecord[], runId?: string, canReplay?: boolean): SafeHtml {
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
        <div class="run-node__body">
          ${bodyBlocks as unknown as SafeHtml[]}
          ${canReplay && runId ? html`
            <form action="/runs/${runId}/replay" method="post" style="margin-top: var(--space-3);">
              <input type="hidden" name="fromNodeId" value="${e.nodeId}">
              <button type="submit" class="btn btn--sm btn--primary">Replay from ${e.nodeId}</button>
            </form>
          ` : html``}
        </div>
      </details>
    `;
  });
  return cards as unknown as SafeHtml;
}
