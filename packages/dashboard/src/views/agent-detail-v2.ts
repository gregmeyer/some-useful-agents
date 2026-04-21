/**
 * Agent detail page — tabbed layout.
 *
 * Tabs:
 *   Overview  /agents/:id         — DAG + stats + recent runs + suggest
 *   Nodes     /agents/:id/nodes   — node table + add/edit/delete
 *   Config    /agents/:id/config  — LLM, variables, secrets, status
 *   Runs      /agents/:id/runs    — paginated run history
 *   YAML      /agents/:id/yaml    — already exists (separate route)
 */

import type { Agent, Run, SecretsStore } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader, type PageHeaderBack } from './page-header.js';
import { sourceBadge, statusBadge, formatDuration, formatAge } from './components.js';
import { renderDagView, renderDagFallback } from './dag-view.js';

// ── Tab types ────────────────────────────────────────────────────────────

export type AgentTab = 'overview' | 'nodes' | 'config' | 'runs' | 'yaml';

export interface AgentDetailArgs {
  agent: Agent;
  recentRuns: Run[];
  secretsStore: SecretsStore;
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
  back?: PageHeaderBack;
  from?: string;
  activeTab: AgentTab;
}

// ── Tab strip ────────────────────────────────────────────────────────────

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

// ── Page shell ───────────────────────────────────────────────────────────

function agentPageShell(args: AgentDetailArgs, content: SafeHtml): string {
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
          <button type="submit" class="btn-star${agent.starred ? ' is-starred' : ''}" title="${agent.starred ? 'Unstar' : 'Star'}" aria-label="${agent.starred ? 'Unstar' : 'Star'}">${agent.starred ? '\u2605' : '\u2606'}</button>
        </form>`,
        vStatusBadge(agent.status),
        sourceBadge(source),
      ],
      cta: runNowButton,
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
          ${renderRunInputsForm(agent, from)}
        </div>
      </div>
    </div>
  `;

  return render(layout({ title: agent.id, activeNav: 'agents', flash }, body));
}

// ── Overview tab ─────────────────────────────────────────────────────────

export async function renderAgentOverview(args: AgentDetailArgs): Promise<string> {
  const { agent, recentRuns } = args;
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
    <!-- DAG -->
    ${renderDagFallback(agent)}
    ${renderDagView({
      agent,
      editBase: `/agents/${agent.id}/nodes`,
      replay: latestCompletedRun
        ? { priorRunId: latestCompletedRun.id, requiresCommunityConfirm: hasCommunityShellNode }
        : undefined,
    })}

    <!-- Quick stats -->
    <div class="agent-stats">
      <dl class="kv">
        <dt>Version</dt><dd class="mono">v${String(agent.version)} <a href="/agents/${agent.id}/versions" class="dim" style="font-size: var(--font-size-xs);">history</a></dd>
        <dt>Provider</dt><dd class="mono">${agent.provider ?? 'claude'} / ${agent.model ?? 'default'}</dd>
        <dt>Schedule</dt><dd>${agent.schedule ?? html`<span class="dim">none</span>`}</dd>
        <dt>MCP</dt><dd>${agent.mcp ? 'exposed' : html`<span class="dim">not exposed</span>`}</dd>
        <dt>Nodes</dt><dd>${String(agent.nodes.length)}</dd>
      </dl>
      <div style="display: flex; gap: var(--space-2); flex-wrap: wrap; margin-top: var(--space-2);">
        ${toolBadges as unknown as SafeHtml[]}
      </div>
    </div>

    <!-- Actions -->
    <div style="display: flex; gap: var(--space-2); flex-wrap: wrap;">
      <button type="button" class="btn btn--sm" id="suggest-btn" data-agent-id="${agent.id}">Suggest improvements</button>
      <a class="btn btn--sm" href="/agents/${agent.id}/versions">Versions</a>
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
  `;

  return agentPageShell({ ...args, activeTab: 'overview' }, content);
}

// ── Nodes tab ────────────────────────────────────────────────────────────

export async function renderAgentNodes(args: AgentDetailArgs): Promise<string> {
  const { agent, secretsStore } = args;

  const nodeRows = agent.nodes.map((n) => {
    const body = n.type === 'shell' ? oneLine(n.command ?? '') : oneLine(n.prompt ?? '');
    const deps = n.dependsOn?.length ? n.dependsOn.join(', ') : html`<span class="dim">\u2014</span>`;
    const secrets = n.secrets?.length ? n.secrets.join(', ') : html`<span class="dim">\u2014</span>`;
    return html`
      <tr id="node-${n.id}">
        <td class="mono">${n.id}</td>
        <td>${n.type === 'shell' ? html`<span class="badge badge--ok">shell</span>` : html`<span class="badge badge--info">claude-code</span>`}</td>
        <td class="mono">${deps}</td>
        <td class="mono">${secrets}</td>
        <td class="dim">${body}</td>
        <td style="white-space: nowrap;">
          <a class="btn btn--sm" href="/agents/${agent.id}/nodes/${n.id}/edit">Edit</a>
          <form method="POST" action="/agents/${agent.id}/nodes/${n.id}/delete" style="display: inline; margin: 0;"
                data-confirm="Delete node '${n.id}'?">
            <button type="submit" class="btn btn--sm btn--ghost" style="color: var(--color-err);">Delete</button>
          </form>
        </td>
      </tr>
    `;
  });

  // Secrets by node
  const secretRows: SafeHtml[] = [];
  for (const node of agent.nodes) {
    for (const name of node.secrets ?? []) {
      let present: 'ok' | 'missing' | 'unknown';
      try { present = (await secretsStore.has(name)) ? 'ok' : 'missing'; } catch { present = 'unknown'; }
      const badge = present === 'ok' ? html`<span class="badge badge--ok">set</span>`
        : present === 'missing' ? html`<span class="badge badge--err">missing</span>`
        : html`<span class="badge badge--warn">locked</span>`;
      secretRows.push(html`<tr><td class="mono">${node.id}</td><td class="mono">${name}</td><td>${badge}</td></tr>`);
    }
  }

  const content = html`
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-4);">
      <h2 style="margin: 0;">Nodes</h2>
      <a class="btn btn--primary btn--sm" href="/agents/${agent.id}/add-node">+ Add node</a>
    </div>
    <table class="table">
      <thead><tr><th>Id</th><th>Type</th><th>Depends on</th><th>Secrets</th><th>Body</th><th></th></tr></thead>
      <tbody>${nodeRows as unknown as SafeHtml[]}</tbody>
    </table>

    ${secretRows.length > 0 ? html`
      <section style="margin-top: var(--space-6);">
        <h2>Secrets by node</h2>
        <table class="table">
          <thead><tr><th>Node</th><th>Secret</th><th>Status</th></tr></thead>
          <tbody>${secretRows}</tbody>
        </table>
      </section>
    ` : html``}
  `;

  return agentPageShell({ ...args, activeTab: 'nodes' }, content);
}

// ── Config tab ───────────────────────────────────────────────────────────

export async function renderAgentConfig(args: AgentDetailArgs): Promise<string> {
  const { agent, secretsStore } = args;

  // Secret counts for the secrets section
  let secretsSet = 0;
  let secretsMissing = 0;
  const allSecrets = new Set<string>();
  for (const node of agent.nodes) {
    for (const name of node.secrets ?? []) allSecrets.add(name);
  }
  for (const name of allSecrets) {
    try { if (await secretsStore.has(name)) secretsSet++; else secretsMissing++; } catch { /* unknown */ }
  }

  const content = html`
    <!-- Status -->
    <section class="card" style="margin-bottom: var(--space-6);">
      <h3 style="margin: 0 0 var(--space-3);">Status</h3>
      <form method="POST" action="/agents/${agent.id}/status" style="display: flex; gap: var(--space-2); align-items: center;">
        <select name="newStatus" class="form-field" style="padding: var(--space-1) var(--space-2); font-size: var(--font-size-sm);">
          ${statusOption('active', agent.status)}
          ${statusOption('paused', agent.status)}
          ${statusOption('draft', agent.status)}
          ${statusOption('archived', agent.status)}
        </select>
        <button type="submit" class="btn btn--sm">Apply</button>
      </form>
    </section>

    <!-- LLM defaults -->
    <section class="card" style="margin-bottom: var(--space-6);">
      <h3 style="margin: 0 0 var(--space-3);">LLM defaults</h3>
      <form method="POST" action="/agents/${agent.id}/llm" id="llm-form" style="display: flex; flex-direction: column; gap: var(--space-2);">
        <div style="display: flex; gap: var(--space-2); align-items: center;">
          <label style="font-size: var(--font-size-xs); color: var(--color-text-muted); min-width: 55px;">Provider</label>
          <select name="provider" id="llm-provider" class="form-field" style="flex: 1; padding: var(--space-1) var(--space-2); font-size: var(--font-size-sm);">
            ${providerOption('claude', agent.provider)}
            ${providerOption('codex', agent.provider)}
          </select>
        </div>
        <div style="display: flex; gap: var(--space-2); align-items: center;">
          <label style="font-size: var(--font-size-xs); color: var(--color-text-muted); min-width: 55px;">Model</label>
          <select name="model" id="llm-model" class="form-field" style="flex: 1; padding: var(--space-1) var(--space-2); font-size: var(--font-size-sm); font-family: var(--font-mono);">
            ${renderModelOptions(agent.provider, agent.model)}
          </select>
        </div>
        <div id="llm-model-desc" class="dim" style="font-size: var(--font-size-xs); min-height: 1.2em;"></div>
        <div style="display: flex; justify-content: flex-end;">
          <button type="submit" class="btn btn--sm">Apply</button>
        </div>
        <p class="dim" style="font-size: var(--font-size-xs); margin: 0;">Applies to all claude-code nodes. Individual nodes can override in YAML.</p>
      </form>
    </section>

    <!-- Variables -->
    <section class="card" style="margin-bottom: var(--space-6);">
      <h3 style="margin: 0 0 var(--space-3);">Variables</h3>
      ${renderVariablesEditor(agent)}
    </section>

    <!-- Secrets -->
    <section class="card">
      <h3 style="margin: 0 0 var(--space-3);">Secrets</h3>
      <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-2);">
        ${String(allSecrets.size)} declared. ${String(secretsSet)} set, ${String(secretsMissing)} missing.
      </p>
      <a href="/settings/secrets" class="btn btn--sm">Manage secrets</a>
    </section>
  `;

  return agentPageShell({ ...args, activeTab: 'config' }, content);
}

// ── Runs tab ─────────────────────────────────────────────────────────────

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

// ── Shared helpers ───────────────────────────────────────────────────────

function renderRunInputsForm(agent: Agent, from?: string): SafeHtml {
  const inputs = Object.entries(agent.inputs ?? {});
  const FIELD = 'padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-sm); font-family: var(--font-mono); width: 100%;';

  if (inputs.length === 0) {
    return html`
      <div style="text-align: center; padding: var(--space-6);">
        <div class="spinner" style="margin: 0 auto var(--space-3);"></div>
        <p style="font-weight: var(--weight-medium); margin: 0 0 var(--space-2);">Running ${agent.id}...</p>
        <p class="dim" style="font-size: var(--font-size-xs); margin: 0;">Starting execution.</p>
      </div>
    `;
  }

  const fields = inputs.map(([name, spec]) => {
    const defVal = spec.default !== undefined ? String(spec.default) : '';
    const reqLabel = spec.required !== false && spec.default === undefined
      ? html`<span style="color: var(--color-err); font-size: var(--font-size-xs);">required</span>`
      : html`<span class="dim" style="font-size: var(--font-size-xs);">optional</span>`;
    const desc = spec.description ? html`<span class="dim" style="font-size: var(--font-size-xs);">${spec.description}</span>` : html``;
    return html`
      <label style="display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-3);">
        <div style="display: flex; align-items: baseline; gap: var(--space-2);">
          <strong style="font-size: var(--font-size-sm);">${name}</strong>
          <span class="badge badge--muted" style="font-size: 9px;">${spec.type}</span>
          ${reqLabel}
        </div>
        <input type="text" name="input_${name}" value="${defVal}" placeholder="${defVal || '(empty)'}" style="${FIELD}" ${spec.required !== false && spec.default === undefined ? 'required' : ''}>
        ${desc}
      </label>
    `;
  });

  return html`
    <form method="POST" action="/agents/${agent.id}/run" data-run-form="${agent.id}">
      ${from ? html`<input type="hidden" name="from" value="${from}">` : html``}
      <h3 style="margin: 0 0 var(--space-3);">Run ${agent.id}</h3>
      <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-4);">Set input values for this run.</p>
      ${fields as unknown as SafeHtml[]}
      <div style="display: flex; gap: var(--space-2); justify-content: flex-end; margin-top: var(--space-3);">
        <button type="button" class="btn btn--ghost btn--sm" data-close-modal="1">Cancel</button>
        <button type="submit" class="btn btn--primary btn--sm">Run</button>
      </div>
    </form>
  `;
}

function renderVariablesEditor(agent: Agent): SafeHtml {
  const inputs = Object.entries(agent.inputs ?? {});
  const FIELD = 'padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-xs);';

  const inputRows = inputs.map(([name, spec]) => {
    const defVal = spec.default !== undefined ? String(spec.default) : '';
    const desc = spec.description ?? '';
    return html`
      <tr>
        <td class="mono">${name}<input type="hidden" name="inputName[]" value="${name}"></td>
        <td>${typeSelect(`type_${name}`, spec.type)}</td>
        <td><input type="text" name="default_${name}" value="${defVal}" placeholder="(none)" style="${FIELD} font-family: var(--font-mono); width: 10rem;"></td>
        <td><input type="text" name="description_${name}" value="${desc}" placeholder="(none)" style="${FIELD} width: 14rem;"></td>
      </tr>
    `;
  });

  const newRow = html`
    <tr style="border-top: 2px solid var(--color-border);">
      <td><input type="text" name="newInputName" placeholder="NEW_VAR" pattern="[A-Z_][A-Z0-9_]*" style="${FIELD} font-family: var(--font-mono); width: 10rem;"></td>
      <td><select name="newInputType" style="${FIELD}"><option value="string">string</option><option value="number">number</option><option value="boolean">boolean</option><option value="enum">enum</option></select></td>
      <td><input type="text" name="newInputDefault" placeholder="default" style="${FIELD} font-family: var(--font-mono); width: 10rem;"></td>
      <td><input type="text" name="newInputDescription" placeholder="description" style="${FIELD} width: 14rem;"></td>
    </tr>
  `;

  return html`
    <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3);">
      Agent-level inputs. Referenced as <code>$NAME</code> in shell or <code>{{inputs.NAME}}</code> in prompts.
    </p>
    <form method="POST" action="/agents/${agent.id}/inputs/update">
      <table class="table" style="font-size: var(--font-size-xs); margin-bottom: var(--space-3);">
        <thead><tr><th>Name</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
        <tbody>${inputRows as unknown as SafeHtml[]}${newRow}</tbody>
      </table>
      <div style="display: flex; gap: var(--space-2); justify-content: flex-end;">
        <button type="submit" class="btn btn--primary btn--sm">Save variables</button>
      </div>
    </form>
  `;
}

// ── Small helpers ────────────────────────────────────────────────────────

function typeSelect(namePrefix: string, current: string): SafeHtml {
  const opt = (val: string) => val === current ? html`<option value="${val}" selected>${val}</option>` : html`<option value="${val}">${val}</option>`;
  return html`<select name="${namePrefix}" style="padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-xs);">${opt('string')}${opt('number')}${opt('boolean')}${opt('enum')}</select>`;
}

function vStatusBadge(status: string): SafeHtml {
  const kind = status === 'active' ? 'badge--ok' : status === 'paused' ? 'badge--warn' : status === 'archived' ? 'badge--muted' : 'badge--info';
  return html`<span class="badge ${kind}">${status}</span>`;
}

function statusOption(value: string, current: string): SafeHtml {
  const selected = value === current ? unsafeHtml(' selected') : unsafeHtml('');
  return html`<option value="${value}"${selected}>${value}</option>`;
}

function providerOption(value: string, current?: string): SafeHtml {
  const effective = current ?? 'claude';
  const selected = value === effective ? unsafeHtml(' selected') : unsafeHtml('');
  return html`<option value="${value}"${selected}>${value}</option>`;
}

interface ModelEntry { id: string; label: string; desc: string }

const CLAUDE_MODELS: ModelEntry[] = [
  { id: '', label: 'default', desc: 'Uses the Claude CLI default model' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6', desc: 'Most capable. Deep analysis, complex reasoning, long outputs' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', desc: 'Fast + capable. Good balance of speed and quality' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', desc: 'Fastest. Best for simple tasks, classification, extraction' },
];

const CODEX_MODELS: ModelEntry[] = [
  { id: '', label: 'default', desc: 'Uses the Codex CLI default model' },
  { id: 'o4-mini', label: 'o4-mini', desc: 'Fast reasoning model. Good for code analysis and generation' },
  { id: 'o3', label: 'o3', desc: 'Most capable reasoning model. Deep multi-step analysis' },
  { id: 'gpt-4.1', label: 'GPT-4.1', desc: 'Latest GPT. Strong at code, instruction following' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', desc: 'Compact GPT-4.1. Fast, lower cost' },
  { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano', desc: 'Smallest GPT-4.1. Very fast, simple tasks' },
];

function renderModelOptions(provider?: string, currentModel?: string): SafeHtml {
  const models = (provider === 'codex') ? CODEX_MODELS : CLAUDE_MODELS;
  const effective = currentModel ?? '';
  const options = models.map((m) => {
    const sel = m.id === effective ? unsafeHtml(' selected') : unsafeHtml('');
    return html`<option value="${m.id}" title="${m.desc}"${sel}>${m.label}</option>`;
  });
  if (effective && !models.some((m) => m.id === effective)) {
    options.push(html`<option value="${effective}" selected>${effective}</option>`);
  }
  return html`${options as unknown as SafeHtml[]}`;
}

function oneLine(text: string, max = 120): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max - 1) + '\u2026';
}

// ── Legacy export (backward compat for the route) ────────────────────────

/** @deprecated Use renderAgentOverview directly */
export async function renderAgentDetailV2(args: {
  agent: Agent;
  recentRuns: Run[];
  secretsStore: SecretsStore;
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
  back?: PageHeaderBack;
  from?: string;
}): Promise<string> {
  return renderAgentOverview({ ...args, activeTab: 'overview' });
}
