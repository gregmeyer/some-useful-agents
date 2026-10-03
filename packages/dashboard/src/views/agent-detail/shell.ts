import type { Agent, BlockedImgHost, EffectiveSpendLimits, Memory, Run, SecretsStore, Webhook } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from '../html.js';
import { layout } from '../layout.js';
import { pageHeader, type PageHeaderBack } from '../page-header.js';
import { sourceBadge } from '../components.js';
import { renderRunInputsForm, statusOption } from '../agent-detail-helpers.js';
import type { WidgetControlState } from '../output-widgets.js';
import type { AgentEdge } from '../../lib/agent-graph.js';

export type AgentTab = 'overview' | 'chat' | 'nodes' | 'config' | 'runs' | 'yaml';

export interface AgentDetailArgs {
  agent: Agent;
  recentRuns: Run[];
  secretsStore: SecretsStore;
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
  back?: PageHeaderBack;
  from?: string;
  activeTab: AgentTab;
  /** Previous run's agent-level inputs, for pre-filling the Run Now modal. */
  previousInputs?: Record<string, string>;
  /** URL-driven state for the latest-run output-widget preview's controls. */
  widgetControls?: WidgetControlState;
  /**
   * Resolution status for each name in `agent.behaviors`, so the page can show
   * a broken declaration BEFORE the operator hits a failed run. Only
   * project-scope specs can condition a run; anything else is `usable: false`
   * with a reason. Absent when the host did not wire behavior discovery.
   */
  behaviorStatus?: Array<{ name: string; usable: boolean; reason?: string }>;
  /**
   * Available integrations (from `/settings/integrations`) surfaced in the
   * Notify card's per-handler dropdowns. Empty when the route can't reach
   * the integrations store — the inline form keeps working.
   */
  availableIntegrations?: Array<{ id: string; kind: string; name: string }>;
  /**
   * Recent img-src hosts blocked by CSP for this agent. Surfaced in the
   * Permissions card as one-click "Allow" pills above the textarea so
   * users don't have to copy-paste the offending hostname from the
   * browser console. Empty when no blocks recorded or store unwired.
   */
  blockedImgHosts?: BlockedImgHost[];
  /**
   * All installed agents (id + name + description) for the
   * allowed-sub-agents picklist modal. Excludes the current agent
   * (you can't allow yourself as a sub-agent). Empty when the agent
   * store isn't wired.
   */
  installedAgents?: Array<{ id: string; name: string; description?: string }>;
  /**
   * This agent's place in the agent-to-agent call graph: what it invokes, and
   * what invokes it. sua has been able to compose agents since `agent-invoke`
   * shipped, but the only place that showed was a "used by N" badge on the
   * list — so the capability was invisible from the agent you were looking at.
   */
  invokes?: AgentEdge[];
  invokedBy?: AgentEdge[];
  /**
   * What this agent remembers between runs, when it has `memory:` on.
   * Undefined when memory is off, so the Overview shows no section.
   */
  memories?: Memory[];
  /** This agent's spend over the last 7 days (top-level runs; includes agents it called). */
  spend7d?: { costUsd: number; costComplete: boolean; runs: number };
  /** Spend limits in force for this agent, today's spend, and providers that can't be held to them. */
  spendLimits?: { limits: EffectiveSpendLimits; spentToday: number; unenforceable: string[] };
  /** The agent's inbound webhook (Config tab), and the URL base it's reached at. */
  webhook?: { hook?: Webhook; baseUrl: string };
}

export function agentTabStrip(agentId: string, active: AgentTab): SafeHtml {
  const tabs: Array<{ id: AgentTab; label: string; href: string }> = [
    { id: 'overview', label: 'Overview', href: `/agents/${agentId}` },
    { id: 'chat', label: 'Chat', href: `/agents/${agentId}/chat` },
    { id: 'nodes', label: 'Nodes', href: `/agents/${agentId}/nodes` },
    { id: 'config', label: 'Config', href: `/agents/${agentId}/config` },
    { id: 'runs', label: 'Runs', href: `/agents/${agentId}/runs` },
    { id: 'yaml', label: 'YAML', href: `/agents/${agentId}/yaml` },
  ];
  return html`
    <nav class="tab-strip">
      ${tabs.map((t) => html`<a href="${t.href}" class="${t.id === active ? 'is-active' : ''}">${t.label}</a>`) as unknown as SafeHtml[]}
    </nav>
  `;
}

export function agentPageShell(args: AgentDetailArgs, content: SafeHtml): string {
  const { agent, flash, back, from } = args;
  const source = agent.source;
  const hasCommunityShellNode = source === 'community' && agent.nodes.some((n) => n.type === 'shell');

  const fromHidden = from ? html`<input type="hidden" name="from" value="${from}">` : html``;
  const runNowButton = hasCommunityShellNode
    ? html`<form method="POST" action="/agents/${agent.id}/run">
        <input type="hidden" name="confirm_community_shell" value="yes">${fromHidden}
        <button type="submit" class="btn btn--warn" onclick="return confirm('This agent contains community shell nodes. Run anyway?');">Run now (community)</button>
      </form>`
    : Object.keys(agent.inputs ?? {}).length > 0
    ? html`<button type="button" class="btn btn--primary" id="run-with-inputs-btn">Run now</button>`
    : html`<form method="POST" action="/agents/${agent.id}/run" style="display: inline;" data-run-form="${agent.id}">${fromHidden}<button type="submit" class="btn btn--primary">Run now</button></form>`;

  const warningBanner = agent.status === 'archived'
    ? html`<div class="flash flash--info agent-archived" role="status" style="display: flex; align-items: center; gap: var(--space-3);">
        <span style="flex: 1;">This agent is archived: it doesn't run on its schedule, other agents can't call it, and it's left out of lists and pickers. Its runs and versions are kept.</span>
        <form method="POST" action="/agents/${agent.id}/restore" style="margin: 0;"><button type="submit" class="btn btn--sm btn--primary">Restore</button></form>
      </div>`
    : source === 'community'
      ? html`<div class="community-banner"><strong>Community agent.</strong> Read the DAG before running.</div>`
      : html``;

  const body = html`
    ${pageHeader({
      title: agent.id,
      meta: [
        html`<form method="POST" action="/agents/${agent.id}/star" style="display:inline;margin:0;">
          <button type="submit" class="btn-star${agent.starred ? ' is-starred' : ''}" title="${agent.starred ? 'Unstar' : 'Star'}" aria-label="${agent.starred ? 'Unstar' : 'Star'}">${agent.starred ? '★' : '☆'}</button>
        </form>`,
        // Status is a control, not a badge — change it from here so lifecycle
        // decisions live next to "Run now" instead of buried inside Config.
        // The auto-submit on change keeps it one click; the existing
        // POST /agents/:id/status handler is unchanged.
        html`<form method="POST" action="/agents/${agent.id}/status" class="status-select-form" style="display:inline;margin:0;">
          <select name="newStatus" class="status-select status-select--${agent.status}" onchange="this.form.submit()" aria-label="Agent status">
            ${statusOption('active', agent.status)}
            ${statusOption('paused', agent.status)}
            ${statusOption('draft', agent.status)}
            ${statusOption('archived', agent.status)}
          </select>
        </form>`,
        sourceBadge(source),
      ],
      cta: html`<span style="display: inline-flex; gap: var(--space-2);">
        ${agent.status === 'archived' ? html`` : html`<form method="POST" action="/agents/${agent.id}/ask-fix" data-ask-fix style="display: inline; margin: 0;">
          <button type="submit" class="btn btn--ghost btn--sm" title="sua looks at why this agent isn't working and drafts a fix you approve, in the panel">Ask sua to fix this</button>
        </form>`}
        <button type="button" class="btn btn--ghost btn--sm" id="suggest-btn" data-agent-id="${agent.id}">Suggest improvements</button>
        <a class="btn btn--ghost btn--sm" href="/agents/${agent.id}/versions">Versions</a>
        ${agent.status === 'archived' ? html`` : runNowButton}
      </span>`,
      description: agent.description ?? undefined,
      back,
    })}
    ${warningBanner}
    ${agentTabStrip(agent.id, args.activeTab)}
    <div class="agent-detail__tab-content">
      ${content}
    </div>

    <div id="suggest-modal" class="modal-backdrop">
      <div class="modal" style="max-width: 720px; max-height: 85vh; overflow-y: auto;">
        <div id="suggest-modal-content"></div>
      </div>
    </div>

    <div id="run-modal" class="modal-backdrop">
      <div class="modal" style="max-width: 500px;">
        <div id="run-modal-content">
          ${renderRunInputsForm(agent, from, args.previousInputs)}
        </div>
      </div>
    </div>
  `;

  return render(layout({ title: agent.id, activeNav: 'agents', flash }, body));
}
