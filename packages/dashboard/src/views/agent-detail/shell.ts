import type { Agent, Run, SecretsStore } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from '../html.js';
import { layout } from '../layout.js';
import { pageHeader, type PageHeaderBack } from '../page-header.js';
import { sourceBadge } from '../components.js';
import { renderRunInputsForm, vStatusBadge } from '../agent-detail-helpers.js';

export type AgentTab = 'overview' | 'nodes' | 'config' | 'runs' | 'yaml';

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
}

export function agentTabStrip(agentId: string, active: AgentTab): SafeHtml {
  const tabs: Array<{ id: AgentTab; label: string; href: string }> = [
    { id: 'overview', label: 'Overview', href: `/agents/${agentId}` },
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

  const warningBanner = source === 'community'
    ? html`<div class="community-banner"><strong>Community agent.</strong> Read the DAG before running.</div>`
    : html``;

  const body = html`
    ${pageHeader({
      title: agent.id,
      meta: [
        html`<form method="POST" action="/agents/${agent.id}/star" style="display:inline;margin:0;">
          <button type="submit" class="btn-star${agent.starred ? ' is-starred' : ''}" title="${agent.starred ? 'Unstar' : 'Star'}" aria-label="${agent.starred ? 'Unstar' : 'Star'}">${agent.starred ? '★' : '☆'}</button>
        </form>`,
        vStatusBadge(agent.status),
        sourceBadge(source),
      ],
      cta: html`<span style="display: inline-flex; gap: var(--space-2);">
        <button type="button" class="btn btn--ghost btn--sm" id="suggest-btn" data-agent-id="${agent.id}">Suggest improvements</button>
        <a class="btn btn--ghost btn--sm" href="/agents/${agent.id}/versions">Versions</a>
        ${runNowButton}
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
