import type { Agent, Run, SecretsStore } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader, type PageHeaderBack } from './page-header.js';
import { sourceBadge, statusBadge, formatDuration, formatAge } from './components.js';
import { renderDagView, renderDagFallback } from './dag-view.js';

export async function renderAgentDetailV2(args: {
  agent: Agent;
  recentRuns: Run[];
  secretsStore: SecretsStore;
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
  /** Contextual back link ("Back to tutorial", "Back to runs", etc.). */
  back?: PageHeaderBack;
  /**
   * Origin-marker propagated via ?from=… query param. When set, we
   * thread it through the Run-now form as a hidden field so the run
   * detail page knows the user's original origin was (e.g.) the
   * tutorial — not just the immediate Referer.
   */
  from?: string;
}): Promise<string> {
  const { agent, recentRuns, secretsStore, flash, back, from } = args;
  const source = agent.source;
  const hasCommunityShellNode = source === 'community' && agent.nodes.some((n) => n.type === 'shell');

  // Secret presence lookup (never reveals values).
  let secretsSet = 0;
  let secretsMissing = 0;
  let secretsUnknown = 0;
  const secretRows: SafeHtml[] = [];
  const seenSecrets = new Set<string>();
  for (const node of agent.nodes) {
    for (const name of node.secrets ?? []) {
      const key = `${node.id}:${name}`;
      if (seenSecrets.has(key)) continue;
      seenSecrets.add(key);
      let present: 'ok' | 'missing' | 'unknown';
      try {
        present = (await secretsStore.has(name)) ? 'ok' : 'missing';
      } catch {
        present = 'unknown';
      }
      if (present === 'ok') secretsSet++;
      else if (present === 'missing') secretsMissing++;
      else secretsUnknown++;
      const badge = present === 'ok'
        ? html`<span class="badge badge--ok">set</span>`
        : present === 'missing'
        ? html`<span class="badge badge--err">missing</span>`
        : html`<span class="badge badge--warn">locked</span>`;
      secretRows.push(html`
        <tr>
          <td class="mono">${node.id}</td>
          <td class="mono">${name}</td>
          <td>${badge}</td>
        </tr>
      `);
    }
  }

  const fromHidden = from
    ? html`<input type="hidden" name="from" value="${from}">`
    : html``;
  const runNowButton = hasCommunityShellNode
    ? html`
        <form method="POST" action="/agents/${agent.id}/run">
          <input type="hidden" name="confirm_community_shell" value="yes">
          ${fromHidden}
          <button type="submit" class="btn btn--warn"
            onclick="return confirm('This agent contains community shell nodes. Run anyway?');">
            Run now (community)
          </button>
        </form>
      `
    : Object.keys(agent.inputs ?? {}).length > 0
    ? html`
        <button type="button" class="btn btn--primary" id="run-with-inputs-btn">Run now</button>
      `
    : html`
        <form method="POST" action="/agents/${agent.id}/run" style="display: inline;" data-run-form="${agent.id}">
          ${fromHidden}
          <button type="submit" class="btn btn--primary">Run now</button>
        </form>
      `;

  const warningBanner = source === 'community'
    ? html`<div class="community-banner">
        <strong>Community agent.</strong> Read the DAG before running. See
        <a href="https://github.com/gregmeyer/some-useful-agents/blob/main/docs/SECURITY.md#trust-model">docs/SECURITY.md</a> for the trust model.
      </div>`
    : html``;

  // Per-node table below the DAG. Each row gets Edit + Delete actions
  // that POST to the node-edit routes (PR 3). Delete is refused server-side
  // if any downstream node depends on this one.
  const nodeRows = agent.nodes.map((n) => {
    const body = n.type === 'shell' ? oneLine(n.command ?? '') : oneLine(n.prompt ?? '');
    const deps = n.dependsOn?.length ? n.dependsOn.join(', ') : html`<span class="dim">—</span>`;
    const secrets = n.secrets?.length ? n.secrets.join(', ') : html`<span class="dim">—</span>`;
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
                data-confirm="Delete node '${n.id}'? This creates a new version. Refuses if downstream nodes depend on it.">
            <button type="submit" class="btn btn--sm btn--ghost" style="color: var(--color-err);">Delete</button>
          </form>
        </td>
      </tr>
    `;
  });

  const runRows = recentRuns.map((r) => html`
    <tr>
      <td><a href="/runs/${r.id}" class="mono">${r.id.slice(0, 8)}</a></td>
      <td>${statusBadge(r.status)}</td>
      <td class="dim">${formatAge(r.startedAt)}</td>
      <td class="dim">${formatDuration(r.startedAt, r.completedAt)}</td>
      <td class="dim">${r.triggeredBy}</td>
    </tr>
  `);

  const secretsSummary = seenSecrets.size === 0
    ? html`<span class="dim">No secrets declared.</span>`
    : html`
        <span class="badge badge--ok">${String(secretsSet)} set</span>
        ${secretsMissing > 0 ? html`<span class="badge badge--err">${String(secretsMissing)} missing</span>` : html``}
        ${secretsUnknown > 0 ? html`<span class="badge badge--warn">${String(secretsUnknown)} locked</span>` : html``}
      `;

  // Latest completed run powers the DAG's "Replay from here" node-click
  // action. Without one, clicking a node still opens the action dialog
  // (Edit node is always offered) but the replay button is absent.
  const latestCompletedRun = recentRuns.find((r) => r.status === 'completed');

  // Inspector (right-column) default state: agent-level summary card.
  // Node inspection happens via a dialog triggered by clicks on the
  // DAG viz — not this panel. The inspector stays as an agent-scoped
  // overview.
  const inspector = html`
    <aside class="inspector" id="inspector">
      <header class="inspector__header">
        <h2 class="inspector__title">Overview</h2>
      </header>

      <section class="inspector__section">
        <h4>Status</h4>
        <form method="POST" action="/agents/${agent.id}/status" style="display: flex; gap: var(--space-2); align-items: center;">
          <select name="newStatus" style="padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-sm);">
            ${statusOption('active', agent.status)}
            ${statusOption('paused', agent.status)}
            ${statusOption('draft', agent.status)}
            ${statusOption('archived', agent.status)}
          </select>
          <button type="submit" class="btn btn--sm">Apply</button>
        </form>
      </section>

      <section class="inspector__section">
        <h4>Metadata</h4>
        <dl class="kv">
          <dt>Version</dt>
          <dd class="mono">
            v${String(agent.version)}
            <a href="/agents/${agent.id}/versions" class="dim" style="margin-left: var(--space-2); font-size: var(--font-size-xs);">history \u2192</a>
          </dd>
          <dt>Schedule</dt><dd>${agent.schedule ?? html`<span class="dim">none</span>`}</dd>
          <dt>MCP</dt><dd>${agent.mcp ? 'exposed' : html`<span class="dim">not exposed</span>`}</dd>
          <dt>Nodes</dt><dd>${String(agent.nodes.length)}</dd>
        </dl>
      </section>

      ${renderInputsSection(agent)}

      <section class="inspector__section">
        <h4>Secrets</h4>
        <div style="display:flex; gap:var(--space-2); flex-wrap:wrap;">
          ${secretsSummary}
        </div>
      </section>

      ${renderToolsSection(agent)}

      <div class="inspector__actions" style="flex-wrap: wrap;">
        <a class="btn btn--primary btn--sm" href="/agents/${agent.id}/add-node">+ Add node</a>
        <a class="btn btn--sm" href="/agents/${agent.id}/yaml">Edit YAML</a>
        <button type="button" class="btn btn--sm" id="suggest-btn" data-agent-id="${agent.id}">Suggest improvements</button>
        <a class="btn btn--sm" href="/agents/${agent.id}/versions">Versions</a>
        <a class="btn btn--sm" href="#runs">Recent runs</a>
      </div>
    </aside>
  `;

  const body = html`
    ${pageHeader({
      title: agent.id,
      meta: [
        html`<form method="POST" action="/agents/${agent.id}/star" style="display:inline;margin:0;">
          <button type="submit" class="btn-star${agent.starred ? ' is-starred' : ''}"
                  title="${agent.starred ? 'Unstar' : 'Star'}"
                  aria-label="${agent.starred ? 'Unstar' : 'Star'}">
            ${agent.starred ? '\u2605' : '\u2606'}
          </button>
        </form>`,
        vStatusBadge(agent.status),
        sourceBadge(source),
      ],
      cta: runNowButton,
      description: agent.description ?? undefined,
      back,
    })}

    ${warningBanner}

    <div class="agent-detail">
      <div class="agent-detail__main">
        ${renderDagFallback(agent)}
        ${renderDagView({
          agent,
          editBase: `/agents/${agent.id}/nodes`,
          replay: latestCompletedRun
            ? {
                priorRunId: latestCompletedRun.id,
                requiresCommunityConfirm: hasCommunityShellNode,
              }
            : undefined,
        })}

        <section id="nodes">
          <h2>Nodes</h2>
          <table class="table">
            <thead>
              <tr>
                <th>Id</th><th>Type</th><th>Depends on</th><th>Secrets</th><th>Body</th><th></th>
              </tr>
            </thead>
            <tbody>${nodeRows as unknown as SafeHtml[]}</tbody>
          </table>
        </section>

        ${secretRows.length > 0 ? html`
          <section>
            <h2>Secrets by node</h2>
            <table class="table">
              <thead><tr><th>Node</th><th>Secret</th><th>Status</th></tr></thead>
              <tbody>${secretRows}</tbody>
            </table>
          </section>
        ` : html``}

        ${renderInputDefaultsSection(agent)}

        <section id="runs">
          <h2>Recent runs</h2>
          ${recentRuns.length === 0
            ? html`<p class="dim">No runs yet.</p>`
            : html`<table class="table">
                <thead><tr><th>ID</th><th>Status</th><th>Started</th><th>Duration</th><th>Triggered</th></tr></thead>
                <tbody>${runRows as unknown as SafeHtml[]}</tbody>
              </table>`}
        </section>
      </div>

      <div class="agent-detail__aside">
        ${inspector}
      </div>
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

  return render(layout({ title: agent.id, activeNav: 'agents', flash, wide: true }, body));
}

/**
 * Render the Run Now inputs form for the run modal. Shows each declared
 * input with its type, default value pre-filled, description, and whether
 * it's required. Submits to POST /agents/:id/run with input_NAME fields.
 */
function renderRunInputsForm(agent: Agent, from?: string): SafeHtml {
  const inputs = Object.entries(agent.inputs ?? {});
  const FIELD = 'padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-sm); font-family: var(--font-mono); width: 100%;';

  if (inputs.length === 0) {
    // No inputs — just a spinner (form submits immediately via JS).
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
    const desc = spec.description
      ? html`<span class="dim" style="font-size: var(--font-size-xs);">${spec.description}</span>`
      : html``;
    return html`
      <label style="display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-3);">
        <div style="display: flex; align-items: baseline; gap: var(--space-2);">
          <strong style="font-size: var(--font-size-sm);">${name}</strong>
          <span class="badge badge--muted" style="font-size: 9px;">${spec.type}</span>
          ${reqLabel}
        </div>
        <input type="text" name="input_${name}" value="${defVal}"
          placeholder="${defVal || '(empty)'}"
          style="${FIELD}"
          ${spec.required !== false && spec.default === undefined ? 'required' : ''}>
        ${desc}
      </label>
    `;
  });

  return html`
    <form method="POST" action="/agents/${agent.id}/run" data-run-form="${agent.id}">
      ${from ? html`<input type="hidden" name="from" value="${from}">` : html``}
      <h3 style="margin: 0 0 var(--space-3);">Run ${agent.id}</h3>
      <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-4);">
        Set input values for this run. Defaults are pre-filled.
      </p>
      ${fields as unknown as SafeHtml[]}
      <div style="display: flex; gap: var(--space-2); justify-content: flex-end; margin-top: var(--space-3);">
        <button type="button" class="btn btn--ghost btn--sm" data-close-modal="1">Cancel</button>
        <button type="submit" class="btn btn--primary btn--sm">Run</button>
      </div>
    </form>
  `;
}

/**
 * Render the full "Variables" section in the main content area.
 * Shows existing agent inputs with defaults + descriptions in a table,
 * plus an inline form for editing defaults on existing inputs and
 * adding new ones. Editing POSTs to /agents/:id/inputs/update.
 *
 * Provisional: this section migrates into the dashboard revamp's
 * tabbed agent detail layout as its own tab.
 */
function typeSelect(namePrefix: string, current: string): SafeHtml {
  const opt = (val: string) => val === current
    ? html`<option value="${val}" selected>${val}</option>`
    : html`<option value="${val}">${val}</option>`;
  return html`
    <select name="${namePrefix}" style="padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-xs);">
      ${opt('string')}${opt('number')}${opt('boolean')}${opt('enum')}
    </select>
  `;
}

function renderInputDefaultsSection(agent: Agent): SafeHtml {
  const inputs = Object.entries(agent.inputs ?? {});
  const FIELD = 'padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-xs);';

  const inputRows = inputs.map(([name, spec]) => {
    const defVal = spec.default !== undefined ? String(spec.default) : '';
    const desc = spec.description ?? '';
    return html`
      <tr>
        <td class="mono">${name}
          <input type="hidden" name="inputName[]" value="${name}">
        </td>
        <td>${typeSelect(`type_${name}`, spec.type)}</td>
        <td>
          <input type="text" name="default_${name}" value="${defVal}"
            placeholder="(none)"
            style="${FIELD} font-family: var(--font-mono); width: 10rem;">
        </td>
        <td>
          <input type="text" name="description_${name}" value="${desc}"
            placeholder="(none)"
            style="${FIELD} width: 14rem;">
        </td>
      </tr>
    `;
  });

  // Inline "new row" at the bottom of the table — no separate toggle needed.
  const newRow = html`
    <tr style="border-top: 2px solid var(--color-border);">
      <td>
        <input type="text" name="newInputName" placeholder="NEW_VAR" pattern="[A-Z_][A-Z0-9_]*"
          style="${FIELD} font-family: var(--font-mono); width: 10rem;">
      </td>
      <td>
        <select name="newInputType" style="${FIELD}">
          <option value="string">string</option>
          <option value="number">number</option>
          <option value="boolean">boolean</option>
          <option value="enum">enum</option>
        </select>
      </td>
      <td>
        <input type="text" name="newInputDefault" placeholder="default"
          style="${FIELD} font-family: var(--font-mono); width: 10rem;">
      </td>
      <td>
        <input type="text" name="newInputDescription" placeholder="description"
          style="${FIELD} width: 14rem;">
      </td>
    </tr>
  `;

  return html`
    <section id="variables">
      <h2>Variables</h2>
      <p class="dim" style="font-size: var(--font-size-xs); margin-bottom: var(--space-3);">
        Agent-level inputs referenced as <code>$NAME</code> in shell or <code>{{inputs.NAME}}</code> in prompts.
        Defaults fill in when no <code>--input</code> value is supplied at run time.
        Fill in the bottom row to add a new variable. Save creates a new version.
      </p>
      <form method="POST" action="/agents/${agent.id}/inputs/update">
        <table class="table" style="font-size: var(--font-size-xs); margin-bottom: var(--space-3);">
          <thead>
            <tr><th>Name</th><th>Type</th><th>Default</th><th>Description</th></tr>
          </thead>
          <tbody>
            ${inputRows as unknown as SafeHtml[]}
            ${newRow}
          </tbody>
        </table>
        <div style="display: flex; gap: var(--space-2); justify-content: flex-end;">
          <button type="submit" class="btn btn--primary btn--sm">Save variables</button>
        </div>
      </form>
    </section>
  `;
}

/**
 * Render the agent-level inputs section in the inspector sidebar.
 * Shows declared inputs with their type, default, and description.
 * Links to #variables for full editing.
 */
function renderInputsSection(agent: Agent): SafeHtml {
  const inputs = Object.entries(agent.inputs ?? {});
  if (inputs.length === 0) {
    return html`
      <section class="inspector__section">
        <h4>Variables</h4>
        <span class="dim" style="font-size: var(--font-size-xs);">No agent inputs declared.</span>
        <div style="margin-top: var(--space-2);">
          <a class="dim" href="#variables" style="font-size: var(--font-size-xs);">+ Add input</a>
        </div>
      </section>
    `;
  }

  const rows = inputs.map(([name, spec]) => {
    const defVal = spec.default !== undefined ? String(spec.default) : '';
    const typeBadge = html`<span class="badge badge--muted" style="font-size: 9px;">${spec.type}</span>`;
    return html`
      <div style="display: flex; align-items: baseline; gap: var(--space-2); font-size: var(--font-size-xs); padding: var(--space-1) 0; border-bottom: 1px solid var(--color-border);">
        <code style="flex: 0 0 auto;">${name}</code>
        ${typeBadge}
        <span class="dim" style="margin-left: auto; text-align: right;">
          ${defVal ? defVal : spec.required !== false ? 'required' : 'optional'}
        </span>
      </div>
    `;
  });

  return html`
    <section class="inspector__section">
      <h4>Variables</h4>
      <div>${rows as unknown as SafeHtml[]}</div>
      <div style="margin-top: var(--space-2);">
        <a class="dim" href="#variables" style="font-size: var(--font-size-xs);">Edit defaults</a>
      </div>
    </section>
  `;
}

/**
 * Collect the unique tools this agent's nodes reference and render them
 * as a sidebar section. Derives from the DAG — no separate store query.
 * Shows which tools the agent depends on at a glance.
 */
function renderToolsSection(agent: Agent): SafeHtml {
  const toolIds = new Set<string>();
  for (const node of agent.nodes) {
    if (node.tool) {
      toolIds.add(node.tool);
    } else {
      // v0.15 nodes without an explicit tool: show their implicit tool.
      toolIds.add(node.type === 'shell' ? 'shell-exec' : 'claude-code');
    }
  }
  if (toolIds.size === 0) return html``;

  const badges = [...toolIds].sort().map((id) => html`
    <a href="/tools/${id}" class="badge badge--muted" style="text-decoration: none;">${id}</a>
  `);

  return html`
    <section class="inspector__section">
      <h4>Tools</h4>
      <div style="display:flex; gap:var(--space-2); flex-wrap:wrap;">
        ${badges as unknown as SafeHtml[]}
      </div>
    </section>
  `;
}

function vStatusBadge(status: string): SafeHtml {
  const kind = status === 'active' ? 'badge--ok'
    : status === 'paused' ? 'badge--warn'
    : status === 'archived' ? 'badge--muted'
    : 'badge--info';
  return html`<span class="badge ${kind}">${status}</span>`;
}

function statusOption(value: string, current: string): SafeHtml {
  const selected = value === current ? unsafeHtml(' selected') : unsafeHtml('');
  return html`<option value="${value}"${selected}>${value}</option>`;
}

function oneLine(text: string, max = 120): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max - 1) + '…';
}
