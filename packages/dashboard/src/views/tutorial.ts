import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';

/**
 * Dashboard-native replacement for `sua tutorial`. Unlike the CLI
 * walkthrough (which is an interactive stdin/stdout flow), this is a
 * single-page progress tracker: every step's "done" state is derived
 * from observable project state (agents exist, runs exist, secrets
 * store touched, etc.). That means refreshing the page tells you the
 * real state of your project — not a cookie-remembered script.
 */

export interface TutorialState {
  /** Total agents the project has (v1 YAML + v2 DAG, deduped by id). */
  agentCount: number;
  /** Whether any agent has ever been run in this project. */
  hasAnyRun: boolean;
  /** Whether any run's node_executions contain a DAG run (multi-node agent). */
  hasDagRun: boolean;
  /** Whether any agent uses at least one secret. */
  usesSecrets: boolean;
  /** Id of the first agent, for deep-link CTAs ("Run hello now"). */
  firstAgentId?: string;
  /** Id of the most recent run, for the "inspect output" step. */
  latestRunId?: string;
}

interface Step {
  n: number;
  title: string;
  done: boolean;
  summary: SafeHtml;
  cta?: SafeHtml;
}

export function renderTutorial(state: TutorialState): string {
  const steps = buildSteps(state);
  const doneCount = steps.filter((s) => s.done).length;
  const totalCount = steps.length;

  const progressCard = html`
    <section class="card" style="margin-bottom: var(--space-6);">
      <p class="card__title">Progress</p>
      <p style="font-size: var(--font-size-md); margin: 0;">
        <strong>${String(doneCount)}</strong>
        <span class="dim"> of ${String(totalCount)} steps complete</span>
      </p>
      ${doneCount === totalCount
        ? html`<p class="dim" style="margin: var(--space-2) 0 0;">
            You've covered the basics. See <a href="/help">the full CLI reference</a> for what's next.
          </p>`
        : html`<p class="dim" style="margin: var(--space-2) 0 0;">
            Each step's status is derived from your project's real state — refresh to re-check.
          </p>`}
    </section>
  `;

  const stepBlocks = steps.map(renderStep);

  const body = html`
    ${pageHeader({
      title: 'Dashboard tutorial',
      description: 'A guided first-run for the dashboard. Each step links to the page where the action happens.',
    })}

    ${progressCard}

    <ol style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-3);">
      ${stepBlocks as unknown as SafeHtml[]}
    </ol>
  `;

  return render(layout({ title: 'Tutorial', activeNav: 'help' }, body));
}

function buildSteps(s: TutorialState): Step[] {
  return [
    {
      n: 1,
      title: 'You have a project',
      done: s.agentCount > 0,
      summary: s.agentCount > 0
        ? html`<span class="dim">${String(s.agentCount)} agent${s.agentCount === 1 ? '' : 's'} registered.</span>`
        : html`<span class="dim">No agents yet. Run <code>sua init</code> to scaffold a starter in your project directory.</span>`,
      cta: s.agentCount > 0
        ? html`<a class="btn btn--sm" href="/agents">See agents</a>`
        : undefined,
    },
    {
      n: 2,
      title: 'Run your first agent',
      done: s.hasAnyRun,
      summary: s.hasAnyRun
        ? html`<span class="dim">At least one run recorded. Nice.</span>`
        : s.firstAgentId
          ? html`<span class="dim">Open <code>${s.firstAgentId}</code> and click <strong>Run now</strong> in the header.</span>`
          : html`<span class="dim">Create an agent first (step 1).</span>`,
      cta: !s.hasAnyRun && s.firstAgentId
        ? html`<a class="btn btn--primary btn--sm" href="/agents/${s.firstAgentId}">Open ${s.firstAgentId}</a>`
        : s.hasAnyRun
          ? html`<a class="btn btn--sm" href="/runs">View runs</a>`
          : undefined,
    },
    {
      n: 3,
      title: 'Inspect the output',
      done: s.hasAnyRun && !!s.latestRunId,
      summary: s.latestRunId
        ? html`<span class="dim">Open the latest run to see status, duration, and per-node stdout.</span>`
        : html`<span class="dim">Run an agent first (step 2).</span>`,
      cta: s.latestRunId
        ? html`<a class="btn btn--sm" href="/runs/${s.latestRunId}">Open latest run</a>`
        : undefined,
    },
    {
      n: 4,
      title: 'See a multi-node DAG in action',
      done: s.hasDagRun,
      summary: s.hasDagRun
        ? html`<span class="dim">You've executed a multi-node agent. The DAG view on each run shows node status end-to-end.</span>`
        : html`<span class="dim">
            Multi-node agents run nodes in topological order, passing outputs downstream. Create one
            by chaining YAML agents with <code>dependsOn:</code>, then
            <code>sua workflow import --apply</code> to merge them into a DAG agent.
          </span>`,
      cta: s.hasDagRun
        ? html`<a class="btn btn--sm" href="/agents">Browse DAG agents</a>`
        : html`<a class="btn btn--sm" href="/help#agents-workflows">CLI reference</a>`,
    },
    {
      n: 5,
      title: 'Wire up a secret',
      done: s.usesSecrets,
      summary: s.usesSecrets
        ? html`<span class="dim">At least one agent declares a secret. Verify it's set from the Settings page.</span>`
        : html`<span class="dim">
            To call external APIs, declare <code>secrets: [SLACK_WEBHOOK]</code> on a node, then
            <code>sua secrets set SLACK_WEBHOOK</code> to store the value. Nothing ever renders in the UI.
          </span>`,
      cta: html`<a class="btn btn--sm" href="/settings/secrets">Settings → Secrets</a>`,
    },
  ];
}

function renderStep(s: Step): SafeHtml {
  const statusBadge = s.done
    ? html`<span class="badge badge--ok">done</span>`
    : html`<span class="badge badge--muted">to do</span>`;

  return html`
    <li class="card" style="padding: var(--space-4) var(--space-6);">
      <div style="display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-2);">
        <span class="mono dim" style="font-size: var(--font-size-xs);">Step ${String(s.n)}</span>
        <strong style="font-size: var(--font-size-md);">${s.title}</strong>
        ${statusBadge}
        ${s.cta ? html`<span style="margin-left: auto;">${s.cta}</span>` : html``}
      </div>
      <div style="color: var(--color-text);">${s.summary}</div>
    </li>
  `;
}
