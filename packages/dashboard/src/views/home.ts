import type { Agent, Run, RunStatus } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { statusBadge, formatAge, formatDuration } from './components.js';

export interface HomePageInput {
  /** All v2 agents. */
  agents: Agent[];
  /** Recent runs (newest first). */
  recentRuns: Run[];
  /** Runs started in the last 24 hours. */
  todayRuns: Run[];
  /** Currently running/pending. */
  inFlightRuns: Run[];
  /** Agents with a cron schedule. */
  scheduledAgents: Agent[];
}

export function renderHomePage(input: HomePageInput): string {
  const { agents, recentRuns, todayRuns, inFlightRuns, scheduledAgents } = input;

  const todayCompleted = todayRuns.filter((r) => r.status === 'completed').length;
  const todayFailed = todayRuns.filter((r) => r.status === 'failed').length;

  const body = html`
    <div style="display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-6);">
      <h1 style="margin: 0;">Dashboard</h1>
      <span style="font-size: var(--font-size-sm); color: var(--color-text-muted);">
        ${String(agents.length)} agents registered
      </span>
    </div>

    <!-- Stats row -->
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-4); margin-bottom: var(--space-8);">
      ${statTile('Today', String(todayRuns.length), todayRuns.length === 0 ? 'No runs today' : `${String(todayCompleted)} completed, ${String(todayFailed)} failed`)}
      ${statTile('In flight', String(inFlightRuns.length), inFlightRuns.length === 0 ? 'Nothing running' : `${inFlightRuns.map((r) => r.agentName).join(', ')}`)}
      ${statTile('Agents', String(agents.length), `${String(agents.filter((a) => a.status === 'active').length)} active`)}
      ${statTile('Scheduled', String(scheduledAgents.length), scheduledAgents.length === 0 ? 'No cron agents' : scheduledAgents.slice(0, 2).map((a) => a.id).join(', '))}
    </div>

    <div style="display: grid; grid-template-columns: 2fr 1fr; gap: var(--space-6);">
      <!-- Recent activity -->
      <div>
        <h2 style="margin-top: 0; margin-bottom: var(--space-3);">Recent activity</h2>
        ${recentRuns.length === 0
          ? html`<p style="color: var(--color-text-muted);">No runs yet. <a href="/agents">Run an agent</a> to get started.</p>`
          : html`
            <div style="display: flex; flex-direction: column; gap: var(--space-2);">
              ${recentRuns.slice(0, 12).map((r) => renderActivityCard(r)) as unknown as SafeHtml[]}
            </div>
            <p style="margin-top: var(--space-3); font-size: var(--font-size-xs);">
              <a href="/runs">View all runs &rarr;</a>
            </p>
          `
        }
      </div>

      <!-- Sidebar -->
      <div>
        <!-- In-flight -->
        ${inFlightRuns.length > 0 ? html`
          <h2 style="margin-top: 0; margin-bottom: var(--space-3);">Running now</h2>
          ${inFlightRuns.map((r) => html`
            <div class="card" style="margin-bottom: var(--space-2);">
              <div style="display: flex; align-items: center; gap: var(--space-2);">
                <div class="spinner" style="width: 12px; height: 12px; border-width: 2px;"></div>
                <a href="/runs/${r.id}" class="mono" style="font-size: var(--font-size-sm);">${r.agentName}</a>
                <span style="font-size: var(--font-size-xs); color: var(--color-text-muted); margin-left: auto;">${formatAge(r.startedAt)}</span>
              </div>
            </div>
          `) as unknown as SafeHtml[]}
        ` : html``}

        <!-- Scheduled agents -->
        <h2 style="margin-top: ${inFlightRuns.length > 0 ? 'var(--space-6)' : '0'}; margin-bottom: var(--space-3);">Scheduled</h2>
        ${scheduledAgents.length === 0
          ? html`<p style="color: var(--color-text-muted); font-size: var(--font-size-sm);">No agents have a cron schedule. Add <code>schedule:</code> to an agent YAML to automate runs.</p>`
          : html`
            ${scheduledAgents.map((a) => html`
              <div class="card" style="margin-bottom: var(--space-2);">
                <div style="display: flex; align-items: center; gap: var(--space-2);">
                  <a href="/agents/${a.id}" class="mono" style="font-size: var(--font-size-sm);">${a.id}</a>
                  <span class="mono" style="font-size: var(--font-size-xs); color: var(--color-text-muted); margin-left: auto;">${a.schedule}</span>
                </div>
              </div>
            `) as unknown as SafeHtml[]}
          `
        }

        <!-- Quick actions -->
        <h2 style="margin-top: var(--space-6); margin-bottom: var(--space-3);">Quick actions</h2>
        <div style="display: flex; flex-direction: column; gap: var(--space-2);">
          <a href="/agents/new" class="btn btn--sm" style="justify-content: center;">New agent</a>
          <a href="/agents" class="btn btn--sm btn--ghost" style="justify-content: center;">Browse agents</a>
          <a href="/help/tutorial" class="btn btn--sm btn--ghost" style="justify-content: center;">Tutorial</a>
        </div>
      </div>
    </div>
  `;

  return render(layout({ title: 'Dashboard', activeNav: 'agents' }, body));
}

function truncateOutput(text: string | undefined, max = 200): string {
  if (!text) return '';
  // Strip ANSI escape codes and collapse whitespace.
  const clean = text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1) + '\u2026';
}

function renderActivityCard(r: Run): SafeHtml {
  const output = truncateOutput(r.result);
  const hasOutput = output.length > 0;
  const isError = r.status === 'failed';
  const errorPreview = isError && r.error ? truncateOutput(r.error, 150) : '';

  return html`
    <a href="/runs/${r.id}" style="text-decoration: none; color: inherit; display: block;">
      <div class="card" style="padding: var(--space-3) var(--space-4);">
        <div style="display: flex; align-items: center; gap: var(--space-2); margin-bottom: ${hasOutput || errorPreview ? 'var(--space-2)' : '0'};">
          <span class="mono" style="font-size: var(--font-size-sm); font-weight: var(--weight-semibold);">${r.agentName}</span>
          ${statusBadge(r.status)}
          <span style="font-size: var(--font-size-xs); color: var(--color-text-subtle); margin-left: auto;">
            ${formatAge(r.startedAt)} \u00b7 ${formatDuration(r.startedAt, r.completedAt)}
          </span>
        </div>
        ${hasOutput ? html`
          <div style="font-family: var(--font-mono); font-size: var(--font-size-xs); color: var(--color-text-muted); line-height: 1.4; white-space: pre-wrap; word-break: break-word;">${output}</div>
        ` : errorPreview ? html`
          <div style="font-size: var(--font-size-xs); color: var(--color-err); line-height: 1.4;">${errorPreview}</div>
        ` : html``}
      </div>
    </a>
  `;
}

function statTile(label: string, value: string, hint: string): SafeHtml {
  return html`
    <div class="card">
      <div style="font-family: var(--font-mono); font-size: var(--font-size-xs); font-weight: var(--weight-semibold); text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-text-subtle);">${label}</div>
      <div style="font-family: var(--font-mono); font-size: 28px; font-weight: var(--weight-bold); line-height: 1.2; margin-top: 2px;">${value}</div>
      <div style="font-size: var(--font-size-xs); color: var(--color-text-muted); margin-top: 2px;">${hint}</div>
    </div>
  `;
}
