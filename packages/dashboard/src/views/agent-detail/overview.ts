import { html, type SafeHtml } from '../html.js';
import { statusBadge, formatDuration, formatAge, cronToHuman } from '../components.js';
import { renderDagView, renderDagFallback } from '../dag-view.js';
import { renderOutputWidget } from '../output-widgets.js';
import { agentPageShell, type AgentDetailArgs } from './shell.js';

export async function renderAgentOverview(args: AgentDetailArgs): Promise<string> {
  const { agent, recentRuns, widgetControls } = args;
  const latestCompletedRun = recentRuns.find((r) => r.status === 'completed');
  const hasCommunityShellNode = agent.source === 'community' && agent.nodes.some((n) => n.type === 'shell');

  // Quick stats row
  const toolIds = new Set<string>();
  for (const n of agent.nodes) toolIds.add(n.tool ?? (n.type === 'shell' ? 'shell-exec' : 'claude-code'));
  const toolBadges = [...toolIds].sort().map((id) => html`<a href="/tools/${id}" class="badge badge--muted" style="text-decoration: none;">${id}</a>`);

  const runRows = recentRuns.slice(0, 5).map((r) => html`
    <tr>
      <td><a href="/runs/${r.id}" class="mono">${r.id.slice(0, 8)}</a></td>
      <td>${statusBadge(r.status)}</td>
      <td class="dim">${formatAge(r.startedAt)}</td>
      <td class="dim">${formatDuration(r.startedAt, r.completedAt)}</td>
    </tr>
  `);

  const content = html`
    <!-- DAG + Widget preview (side-by-side when widget exists) -->
    ${agent.outputWidget ? html`
      <div class="run-detail-grid">
        <div>
          ${renderDagFallback(agent)}
          ${renderDagView({
            agent,
            editBase: `/agents/${agent.id}/nodes`,
            replay: latestCompletedRun
              ? { priorRunId: latestCompletedRun.id, requiresCommunityConfirm: hasCommunityShellNode }
              : undefined,
          })}
        </div>
        <div class="card" style="padding: var(--space-4);">
          <div style="display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-3);">
            <h3 style="margin: 0;">Output widget</h3>
            <span class="badge badge--muted" style="font-size: 9px;">${agent.outputWidget.type}</span>
          </div>
          ${latestCompletedRun?.result
            ? html`
              ${renderOutputWidget(agent.outputWidget, latestCompletedRun.result, agent.id, widgetControls) ?? html`<p class="dim" style="font-size: var(--font-size-xs);">No output to preview.</p>`}
              <p class="dim" style="font-size: var(--font-size-xs); margin: var(--space-3) 0 0;">From run <a href="/runs/${latestCompletedRun.id}" class="mono">${latestCompletedRun.id.slice(0, 8)}</a></p>
            `
            : html`<p class="dim" style="font-size: var(--font-size-xs); margin: 0;">Run the agent to see a preview.</p>`}
        </div>
      </div>
    ` : html`
      ${renderDagFallback(agent)}
      ${renderDagView({
        agent,
        editBase: `/agents/${agent.id}/nodes`,
        replay: latestCompletedRun
          ? { priorRunId: latestCompletedRun.id, requiresCommunityConfirm: hasCommunityShellNode }
          : undefined,
      })}
    `}

    <!-- Quick stats -->
    <div class="agent-stats">
      <dl class="kv">
        <dt>Version</dt><dd class="mono">v${String(agent.version)} <a href="/agents/${agent.id}/versions" class="dim" style="font-size: var(--font-size-xs);">history</a></dd>
        <dt>Provider</dt><dd class="mono">${agent.provider ?? 'claude'} / ${agent.model ?? 'default'}</dd>
        <dt>Schedule</dt><dd>${agent.schedule ? html`<span title="${agent.schedule}">${cronToHuman(agent.schedule)}</span>` : html`<span class="dim">none</span>`}</dd>
        <dt>MCP</dt><dd>${agent.mcp ? 'exposed' : html`<span class="dim">not exposed</span>`}</dd>
        <dt>Nodes</dt><dd>${String(agent.nodes.length)}</dd>
      </dl>
      <div style="display: flex; gap: var(--space-2); flex-wrap: wrap; margin-top: var(--space-2);">
        ${toolBadges as unknown as SafeHtml[]}
      </div>
    </div>

    <!-- Recent runs -->
    <section>
      <h2>Recent runs</h2>
      ${recentRuns.length === 0
        ? html`<p class="dim">No runs yet. Hit "Run now" to get started.</p>`
        : html`
          <table class="table">
            <thead><tr><th>ID</th><th>Status</th><th>Started</th><th>Duration</th></tr></thead>
            <tbody>${runRows as unknown as SafeHtml[]}</tbody>
          </table>
          ${recentRuns.length > 5 ? html`<p style="margin-top: var(--space-2);"><a href="/agents/${agent.id}/runs" style="font-size: var(--font-size-xs);">View all runs &rarr;</a></p>` : html``}
        `}
    </section>

    <!-- Danger zone — hard delete. Hidden behind a disclosure so it
         can't be hit by an idle scroll-and-click. The form's input
         pattern requires the operator to type the agent id verbatim
         before the browser will submit. -->
    <section style="margin-top: var(--space-6); border-top: 1px solid var(--color-border); padding-top: var(--space-4);">
      <details>
        <summary style="cursor: pointer; color: var(--color-err); font-weight: var(--weight-bold);">Danger zone</summary>
        <div class="card" style="padding: var(--space-4); margin-top: var(--space-3); border-color: var(--color-err);">
          <p style="margin-top: 0;">
            <strong>Delete this agent.</strong>
            All ${String(agent.nodes.length)}-node ${agent.source === 'community' ? 'community ' : ''}DAG and every prior version are removed.
            <span class="dim">Run history is kept (orphaned — runs reference the agent by id, no FK).</span>
          </p>
          <form method="POST" action="/agents/${agent.id}/delete" style="display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap;">
            <label style="font-size: var(--font-size-xs);">
              Type <code>${agent.id}</code> to confirm:
              <input type="text" name="confirm" required
                pattern="^${agent.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$"
                placeholder="${agent.id}"
                style="margin-left: var(--space-2); font-family: var(--font-mono);" />
            </label>
            <button type="submit" class="btn btn--sm" style="color: var(--color-err); border-color: var(--color-err);">
              Delete forever
            </button>
          </form>
        </div>
      </details>
    </section>
  `;

  return agentPageShell({ ...args, activeTab: 'overview' }, content);
}
