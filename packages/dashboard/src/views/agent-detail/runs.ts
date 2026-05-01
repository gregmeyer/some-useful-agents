import { html, type SafeHtml } from '../html.js';
import { statusBadge, formatDuration, formatAge } from '../components.js';
import { agentPageShell, type AgentDetailArgs } from './shell.js';

export function renderAgentRuns(args: AgentDetailArgs): string {
  const { agent, recentRuns } = args;

  const runRows = recentRuns.map((r) => html`
    <tr>
      <td><a href="/runs/${r.id}" class="mono">${r.id.slice(0, 8)}</a></td>
      <td>${statusBadge(r.status)}</td>
      <td class="dim">${formatAge(r.startedAt)}</td>
      <td class="dim">${formatDuration(r.startedAt, r.completedAt)}</td>
      <td class="dim">${r.triggeredBy}</td>
    </tr>
  `);

  const content = html`
    <h2>Run history</h2>
    ${recentRuns.length === 0
      ? html`<p class="dim">No runs yet.</p>`
      : html`
        <table class="table">
          <thead><tr><th>ID</th><th>Status</th><th>Started</th><th>Duration</th><th>Triggered</th></tr></thead>
          <tbody>${runRows as unknown as SafeHtml[]}</tbody>
        </table>
      `}
  `;

  return agentPageShell({ ...args, activeTab: 'runs' }, content);
}
