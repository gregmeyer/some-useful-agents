import type { Agent, NodeExecutionRecord, Run } from '@some-useful-agents/core';
import { unallowedWidgetImageHosts } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader, type PageHeaderBack } from './page-header.js';
import { statusBadge, outputFrame, formatDuration, formatExitCode, formatErrorCategory } from './components.js';
import { renderDagView, renderDagFallback } from './dag-view.js';
import { renderOutputWidget, type WidgetControlState } from './output-widgets.js';

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
  /** URL-driven state for the output widget's interactive controls. */
  widgetControls?: WidgetControlState;
}

export function renderRunDetail(opts: RunDetailOptions): string {
  const { run, partial, nodeExecutions, agent, back, flash, widgetControls } = opts;
  const inProgress = run.status === 'running' || run.status === 'pending';

  // Run id is a UUID — safe to inline in an attribute without re-escaping.
  const pollAttr = inProgress ? unsafeHtml(` data-run-in-progress="${run.id}"`) : unsafeHtml('');

  const isDagRun = run.workflowId && nodeExecutions && agent;

  // Image hosts the widget would render that aren't in permissions.imgSrc.
  // When non-empty, the executor failed the run for exactly this reason. We
  // hide the widget here so the blocked <img> never renders (and never
  // re-fires the CSP violation the poll would otherwise spam), and render a
  // server-side one-click "Allow" form per host. Server-rendered (not the
  // client CSP banner) so it works even though the hidden widget fires no
  // violation — the failed run already knows the exact hosts.
  const blockedImageHosts = agent
    ? unallowedWidgetImageHosts({
        outputWidget: agent.outputWidget,
        permissions: agent.permissions,
        result: run.result,
      })
    : [];
  const widgetBlocked = blockedImageHosts.length > 0;
  const allowForms = blockedImageHosts.map((host) => html`
    <form method="POST" action="/agents/${run.agentName}/permissions/allow-host" style="display: inline; margin: 0;">
      <input type="hidden" name="host" value="${host}">
      <input type="hidden" name="redirect" value="/runs/${run.id}">
      <button type="submit" class="btn btn--sm btn--primary">Allow ${host}</button>
    </form>
  `);
  const widgetHiddenNotice = html`
    <div class="flash flash--error">
      <div style="font-size: var(--font-size-xs); margin-bottom: var(--space-2);">
        Output widget hidden — it references ${String(blockedImageHosts.length)} image host${blockedImageHosts.length === 1 ? '' : 's'}
        not allowed by the page security policy. Allow ${blockedImageHosts.length === 1 ? 'it' : 'them'}
        (adds to the agent's <code>permissions.imgSrc</code> as a new version), then <strong>Retry run</strong>.
      </div>
      <div style="display: flex; gap: var(--space-2); flex-wrap: wrap;">
        ${allowForms as unknown as SafeHtml[]}
      </div>
    </div>
  `;

  const replayedFrom = run.replayedFromRunId ? html`
    <dt>Replayed from</dt>
    <dd class="mono">
      <a href="/runs/${run.replayedFromRunId}">${run.replayedFromRunId.slice(0, 8)}</a>
      <span class="dim"> @ ${run.replayedFromNodeId ?? ''}</span>
    </dd>
  ` : html``;

  const retryOf = run.retryOfRunId ? html`
    <dt>Retry of</dt>
    <dd class="mono">
      <a href="/runs/${run.retryOfRunId}">${run.retryOfRunId.slice(0, 8)}</a>
      <span class="dim"> · attempt ${String(run.attempt ?? 1)}</span>
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

  const cancelButton = inProgress
    ? html`<button type="button" class="btn btn--warn btn--sm"
        onclick="document.getElementById('cancel-modal').classList.add('is-open')">Stop run</button>`
    : html``;

  const cancelModal = inProgress
    ? html`
      <div id="cancel-modal" class="modal-backdrop">
        <div class="modal" style="max-width: 480px;">
          <h3 style="margin: 0 0 var(--space-3);">Stop this run?</h3>
          <p class="dim" style="font-size: var(--font-size-sm); margin: 0 0 var(--space-2);">
            This will terminate the running process and cancel any remaining nodes.
          </p>
          <dl class="kv" style="margin: 0 0 var(--space-4); font-size: var(--font-size-xs);">
            <dt>Run</dt><dd class="mono">${run.id.slice(0, 8)}</dd>
            <dt>Agent</dt><dd>${run.agentName}</dd>
            <dt>Started</dt><dd>${formatDuration(run.startedAt, undefined)} ago</dd>
          </dl>
          <div style="display: flex; gap: var(--space-2); justify-content: flex-end;">
            <button type="button" class="btn btn--ghost btn--sm"
              onclick="document.getElementById('cancel-modal').classList.remove('is-open')">Keep running</button>
            <form method="POST" action="/runs/${run.id}/cancel" style="display:inline; margin:0;">
              <button type="submit" class="btn btn--warn btn--sm">Stop run</button>
            </form>
          </div>
        </div>
      </div>
    `
    : html``;


  const attemptBadge = (run.attempt ?? 1) > 1
    ? html`<span class="badge badge--muted" title="This run is a retry of an earlier attempt">attempt ${String(run.attempt)}</span>`
    : html``;

  // The live poll reconciles by `data-poll-region`, replacing only changed
  // regions instead of nuking the whole container — so the DAG canvas, focused
  // inputs, the node filter, and scroll position survive an update. The status
  // badge is wrapped identically in both header shapes so the poll can swap it
  // in place regardless of full-page vs partial chrome.
  const statusRegion = html`<span data-poll-region="status">${statusBadge(run.status)} ${cancelButton}</span>`;
  const header = partial
    ? html`<h1>Run <span class="mono">${run.id.slice(0, 8)}</span> ${statusRegion} ${attemptBadge}</h1>`
    : pageHeader({
        title: `Run ${run.id.slice(0, 8)}`,
        meta: [statusRegion, attemptBadge],
        back,
      });

  // data-csp-agent lets the CSP-allow helper attribute any blocked widget
  // image to this run's agent and offer a one-click "Allow host".
  const cspAttr = unsafeHtml(` data-csp-agent="${run.agentName.replace(/"/g, '&quot;')}"`);
  const fragment = html`
    <div data-run-container${pollAttr}${cspAttr}>
      ${header}

      <div class="card" data-poll-region="meta" style="margin-bottom: var(--space-6);">
        <dl class="kv">
          <dt>Agent</dt><dd><a href="/agents/${run.agentName}">${run.agentName}</a>${run.workflowVersion ? html` <span class="dim">v${String(run.workflowVersion)}</span>` : html``}</dd>
          <dt>Started</dt><dd class="mono">${run.startedAt}</dd>
          <dt>Completed</dt><dd class="mono">${run.completedAt ?? html`<span class="dim">in progress</span>`}</dd>
          <dt>Duration</dt><dd>${formatDuration(run.startedAt, run.completedAt)}</dd>
          <dt>Exit code</dt><dd class="mono">${formatExitCode(run.exitCode) || html`<span class="dim">—</span>`}</dd>
          <dt>Triggered by</dt><dd>${run.triggeredBy}</dd>
          ${replayedFrom}
          ${retryOf}
        </dl>
      </div>

      <div data-poll-region="error">${run.error ? html`
        <h2>Error</h2>
        <div class="flash flash--error" style="display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3);">
          <span>${run.error}</span>
          <span style="display: inline-flex; gap: var(--space-2); flex-shrink: 0; white-space: nowrap;">
            ${run.status === 'failed' ? html`
              <form method="POST" action="/runs/${run.id}/retry" style="display: inline; margin: 0;">
                <button type="submit" class="btn btn--sm btn--primary" data-retry-run>Retry run</button>
              </form>
            ` : html``}
            <a href="/agents/${run.agentName}?suggest=1&focus=${encodeURIComponent(run.error)}"
              class="btn btn--sm btn--ghost">Suggest improvements</a>
          </span>
        </div>
      ` : html``}</div>

      ${isDagRun ? html`
        <!-- Top: DAG + Result side-by-side, sticky while node logs scroll. -->
        <div class="run-detail-grid run-detail-grid--sticky">
          <div class="run-detail-grid__dag" data-poll-region="dag" data-poll-preserve>
            ${dagSection}
            ${canReplay ? renderReplayFallback(run, agent!) : html``}
          </div>
          <div class="run-detail-grid__result" data-poll-region="result">
            <h2 style="margin-top: 0;">Result</h2>
            ${!inProgress && run.result
              ? (widgetBlocked
                  ? widgetHiddenNotice
                  : agent?.outputWidget
                    ? renderOutputWidget(agent.outputWidget, run.result, agent.id, widgetControls, agent.inputs) ?? outputFrame(run.result)
                    : outputFrame(run.result))
              : inProgress
                ? html`<p class="dim" style="font-size: var(--font-size-xs);">Run in progress...</p>`
                : html`<p class="dim" style="font-size: var(--font-size-xs);">No output yet.</p>`}
          </div>
        </div>

        <!-- Bottom: Node execution (full width, searchable). The header is
             sticky so the search + filter stay reachable while the user
             scrolls long node-card lists. A sibling IntersectionObserver
             (run-detail-filter.js) releases the DAG sticky bar above so it
             doesn't sit between the header and the cards. -->
        <section class="run-detail-nodes" data-dag-release-sentinel>
          <div class="run-detail-nodes__header">
            <h2 class="run-detail-nodes__title">Node execution</h2>
            <input type="text" class="run-detail-nodes__search" placeholder="Search nodes...">
            <select class="run-detail-nodes__status-filter">
              <option value="">All statuses</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="running">Running</option>
              <option value="skipped">Skipped</option>
            </select>
          </div>
          <div data-poll-region="nodes">${renderNodeCards(nodeExecutions!, run.id, canReplay)}</div>
        </section>
      ` : html`
        <h2>Output</h2>
        <div data-poll-region="result">${run.result
          ? (widgetBlocked
              ? widgetHiddenNotice
              : agent?.outputWidget ? renderOutputWidget(agent.outputWidget, run.result, agent.id, widgetControls, agent.inputs) ?? outputFrame(run.result) : outputFrame(run.result))
          : html`<p class="dim">No output yet.</p>`}</div>
      `}
      ${cancelModal}
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

function truncate(text: string, max = 120): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '\u2026';
}

/**
 * Render a collapsible panel showing the resolved variables (env) that
 * were injected into a node at execution time. Groups entries by source:
 * agent inputs, global variables, upstream outputs, and other env.
 * Returns null if no inputsJson was captured (pre-v0.15 runs).
 */
function renderNodeVarsPanel(e: NodeExecutionRecord): SafeHtml | null {
  let inputs: Record<string, string> = {};
  let upstreams: Record<string, string> = {};

  try {
    if (e.inputsJson) inputs = JSON.parse(e.inputsJson);
  } catch { /* ignore malformed */ }
  try {
    if (e.upstreamInputsJson) upstreams = JSON.parse(e.upstreamInputsJson);
  } catch { /* ignore malformed */ }

  const inputEntries = Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b));
  const upstreamEntries = Object.entries(upstreams).sort(([a], [b]) => a.localeCompare(b));

  if (inputEntries.length === 0 && upstreamEntries.length === 0) return null;

  // Categorize input entries
  const upstreamEnvKeys = new Set<string>();
  for (const [k] of inputEntries) {
    if (k.startsWith('UPSTREAM_') && k.endsWith('_RESULT')) upstreamEnvKeys.add(k);
  }

  const agentVars: Array<[string, string]> = [];
  for (const [k, v] of inputEntries) {
    if (upstreamEnvKeys.has(k)) continue;
    agentVars.push([k, v]);
  }

  const renderRows = (entries: Array<[string, string]>, group: string) => entries.map(([k, v]) => {
    const displayVal = v === '<redacted>'
      ? html`<span style="color: var(--color-warn);">&lt;redacted&gt;</span>`
      : html`<span class="mono">${truncate(v, 200)}</span>`;
    return html`
      <tr data-vars-group="${group}" data-vars-name="${k.toLowerCase()}" data-vars-value="${v === '<redacted>' ? '' : v.toLowerCase()}">
        <td class="mono">${k}</td>
        <td>${displayVal}</td>
      </tr>
    `;
  });

  const panelId = `vars-panel-${e.nodeId}`;
  const filterId = `vars-filter-${e.nodeId}`;
  const total = agentVars.length + upstreamEntries.length;

  const sections: SafeHtml[] = [];

  if (upstreamEntries.length > 0) {
    sections.push(html`
      <h5 class="node-vars__heading" data-vars-heading="upstream">Upstream outputs</h5>
      <table class="table node-vars__table">
        <thead><tr><th>Node</th><th>Result</th></tr></thead>
        <tbody>${renderRows(upstreamEntries, 'upstream') as unknown as SafeHtml[]}</tbody>
      </table>
    `);
  }

  if (agentVars.length > 0) {
    sections.push(html`
      <h5 class="node-vars__heading" data-vars-heading="resolved">Resolved variables</h5>
      <table class="table node-vars__table">
        <thead><tr><th>Name</th><th>Value</th></tr></thead>
        <tbody>${renderRows(agentVars, 'resolved') as unknown as SafeHtml[]}</tbody>
      </table>
    `);
  }

  return html`
    <details class="node-vars" id="${panelId}" style="margin-bottom: var(--space-3);">
      <summary class="node-vars__summary">
        Variables (${String(total)} resolved)
      </summary>
      <div class="node-vars__body">
        <input type="text" class="node-vars__filter" id="${filterId}"
          placeholder="Filter by name or value\u2026"
          data-vars-panel="${panelId}">
        ${sections as unknown as SafeHtml[]}
      </div>
    </details>
  `;
}

/**
 * Render a turn/progress indicator from the node's progressJson.
 * Shows the latest progress event as a small inline label.
 */
function renderProgressIndicator(e: NodeExecutionRecord): SafeHtml {
  if (!e.progressJson) return html``;
  try {
    const events = JSON.parse(e.progressJson) as Array<{ type: string; turn?: number; message?: string }>;
    if (events.length === 0) return html``;
    const latest = events[events.length - 1];
    const label = latest.message ?? latest.type;
    if (e.status === 'running') {
      return html`<span class="dim" style="font-size: var(--font-size-xs); margin-left: var(--space-2);">${label}</span>`;
    }
    // For completed nodes, show the turn count if available.
    if (latest.turn && latest.turn > 1) {
      return html`<span class="dim" style="font-size: var(--font-size-xs); margin-left: var(--space-2);">${String(latest.turn)} turns</span>`;
    }
  } catch { /* malformed */ }
  return html``;
}

/**
 * Render one collapsible card per node execution. Failed/errored nodes
 * open by default so the user doesn't have to hunt for failures; others
 * are collapsed to reduce scroll.
 */
function renderNodeCards(execs: NodeExecutionRecord[], runId?: string, canReplay?: boolean): SafeHtml {
  const cards = execs.map((e) => {
    const shouldOpen = e.status === 'completed' || e.status === 'failed' || e.error !== undefined;
    const openAttr = shouldOpen ? unsafeHtml(' open') : unsafeHtml('');
    const duration = formatDuration(e.startedAt, e.completedAt);
    const exitLabel = formatExitCode(e.exitCode);
    const category = e.errorCategory
      ? html` <span class="badge badge--err">${formatErrorCategory(e.errorCategory)}</span>`
      : html``;

    // PR D.1: render the state-bytes delta as a small badge when the agent
    // actually has a state dir AND the delta is non-zero. Skipped silently
    // when both fields are unset (tests, one-shot CLI, agents that don't
    // touch $STATE_DIR).
    let stateDelta: SafeHtml = html``;
    if (e.stateBytesBefore !== undefined && e.stateBytesAfter !== undefined) {
      const delta = e.stateBytesAfter - e.stateBytesBefore;
      if (delta !== 0) {
        const sign = delta > 0 ? '+' : '−';
        const abs = Math.abs(delta);
        const formatted = abs < 1024 ? `${abs} B`
          : abs < 1024 * 1024 ? `${(abs / 1024).toFixed(1)} KB`
          : abs < 1024 * 1024 * 1024 ? `${(abs / 1024 / 1024).toFixed(1)} MB`
          : `${(abs / 1024 / 1024 / 1024).toFixed(2)} GB`;
        stateDelta = html`<span class="badge badge--muted" title="State dir change">state ${sign}${formatted}</span>`;
      }
    }

    // Parse progress events for turn indicator.
    const progressIndicator = renderProgressIndicator(e);

    // Show a fallback chip on the node row when the LLM waterfall fell
    // through. Silent when only one provider was tried (the common
    // case) or when the node is shell (both fields unset).
    let waterfallChip: SafeHtml = html``;
    if (e.attemptedProviders) {
      const trail = e.attemptedProviders.split(',').filter(Boolean);
      if (trail.length > 1 && e.usedProvider) {
        const failedFrom = trail.slice(0, -1).join(', ');
        const verdict = e.status === 'completed' ? 'ran on' : 'ended on';
        waterfallChip = html`<span class="badge badge--muted" title="LLM waterfall: ${trail.join(' → ')}">${verdict} <span class="mono">${e.usedProvider}</span> · <span class="mono">${failedFrom}</span> failed</span>`;
      }
    }

    const bodyBlocks: SafeHtml[] = [];

    // Collapsible variables panel showing resolved env at execution time.
    const varsPanel = renderNodeVarsPanel(e);
    if (varsPanel) bodyBlocks.push(varsPanel);

    if (e.error) bodyBlocks.push(html`<div class="flash flash--error">${e.error}</div>`);
    if (e.result && e.result.length > 0) {
      bodyBlocks.push(html`<h4 class="dim" style="margin: var(--space-4) 0 var(--space-2);">stdout</h4>`);
      bodyBlocks.push(outputFrame(e.result));
    }
    if (bodyBlocks.length === 0) {
      bodyBlocks.push(html`<p class="dim" style="margin: var(--space-2) 0 0;">No output.</p>`);
    }

    return html`
      <details class="run-node" id="node-${e.nodeId}" data-node-id="${e.nodeId}" data-node-status="${e.status}"${openAttr}>
        <summary class="run-node__header">
          <span class="run-node__id">${e.nodeId}</span>
          ${statusBadge(e.status)}
          ${category}
          ${stateDelta}
          ${waterfallChip}
          ${progressIndicator}
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
