import type { Agent, AgentDefinition, Run } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { typeBadge, sourceBadge, formatAge } from './components.js';

export interface HomeStats {
  agents: number;
  /** Count of agents that are `status: active` (v2 only — v1 has no status). */
  activeAgents: number;
  /** Total runs across all time. */
  totalRuns: number;
  /** Runs currently running or pending. */
  runningRuns: number;
  /** ISO timestamp of the most recent run's startedAt, or undefined if none. */
  latestRunAt?: string;
}

export interface AgentsListInput {
  /** v1 YAML-loaded single-node agents, after removing any that were
   *  superseded by a v2 DAG with the same id. */
  v1: AgentDefinition[];
  /** v2 DAG agents from AgentStore. */
  v2: Agent[];
  /** Recent runs (across all agents), used to look up last-run-per-agent. */
  recentRuns: Run[];
  /** Overview stats for the tiles row. */
  stats: HomeStats;
}

export function renderAgentsList(input: AgentsListInput): string {
  const hasV2 = input.v2.length > 0;
  const hasV1 = input.v1.length > 0;
  const v1Count = input.v1.length;
  const totalVisible = input.v2.length + v1Count;

  // Build a `lastRun` index keyed by agent id / v1 name. Uses whatever the
  // caller passed in `recentRuns`; we assume that list is sorted newest-first
  // and includes enough rows to cover most active agents.
  const lastRunByAgent = new Map<string, Run>();
  for (const r of input.recentRuns) {
    if (!lastRunByAgent.has(r.agentName)) lastRunByAgent.set(r.agentName, r);
  }

  const empty = !hasV2 && !hasV1;

  const body = html`
    ${pageHeader({
      title: 'Agents',
      cta: html`
        <span style="display: inline-flex; gap: var(--space-2);">
          <a class="btn btn--ghost btn--sm" href="/help/tutorial">Tutorial</a>
          <a class="btn btn--primary btn--sm" href="/agents/new">New agent</a>
        </span>
      `,
    })}

    ${empty ? renderEmptyState() : renderStatStrip(input.stats)}

    ${hasV2 ? html`
      <div class="agent-grid">
        ${input.v2.map((a) => renderV2Card(a, lastRunByAgent.get(a.id))) as unknown as SafeHtml[]}
      </div>
    ` : html``}

    ${renderV1Block(input.v1, hasV2)}

    ${empty ? html`` : html`
      <footer style="margin-top: var(--space-8); text-align: center;">
        <p class="dim">
          ${String(totalVisible)} agent${totalVisible === 1 ? '' : 's'} visible \u00b7
          <a href="/help">CLI reference</a> \u00b7
          <a href="/help/tutorial">Tutorial</a>
        </p>
      </footer>
    `}
  `;

  return render(layout({ title: 'Agents', activeNav: 'agents' }, body));
}

function renderStatStrip(s: HomeStats): SafeHtml {
  const latestHint = s.latestRunAt
    ? `Most recent ${formatAge(s.latestRunAt)}`
    : 'No runs yet';
  const runningHint = s.runningRuns === 0 ? 'Nothing in flight' : 'Active now';

  return html`
    <section class="stat-strip">
      <div class="stat-tile">
        <span class="stat-tile__label">Agents</span>
        <span class="stat-tile__value">${String(s.agents)}</span>
        <span class="stat-tile__hint">${s.activeAgents === s.agents ? 'all active' : `${String(s.activeAgents)} active`}</span>
      </div>
      <div class="stat-tile stat-tile--info">
        <span class="stat-tile__label">Total runs</span>
        <span class="stat-tile__value">${String(s.totalRuns)}</span>
        <span class="stat-tile__hint">${latestHint}</span>
      </div>
      <div class="stat-tile ${s.runningRuns > 0 ? 'stat-tile--ok' : 'stat-tile--muted'}">
        <span class="stat-tile__label">In flight</span>
        <span class="stat-tile__value">${String(s.runningRuns)}</span>
        <span class="stat-tile__hint">${runningHint}</span>
      </div>
      <a class="stat-tile stat-tile--warn" href="/help/tutorial"
         style="text-decoration: none; color: inherit;">
        <span class="stat-tile__label">Getting started</span>
        <span class="stat-tile__value" style="font-size: var(--font-size-md); font-weight: var(--weight-semibold);">Open the tutorial \u2192</span>
        <span class="stat-tile__hint">Progress tracked against your project state</span>
      </a>
    </section>
  `;
}

function renderEmptyState(): SafeHtml {
  return html`
    <section class="card" style="padding: var(--space-8) var(--space-6); text-align: center; margin-bottom: var(--space-6);">
      <h2 style="margin-top: 0;">No agents yet</h2>
      <p class="dim" style="max-width: 48ch; margin: 0 auto var(--space-4);">
        An agent is a named task sua can run. Create one right now from the dashboard,
        or follow the guided tutorial.
      </p>
      <p style="display: flex; gap: var(--space-3); justify-content: center; margin: 0;">
        <a class="btn btn--primary" href="/agents/new">New agent</a>
        <a class="btn" href="/help/tutorial">Open tutorial</a>
      </p>
      <p class="dim" style="margin-top: var(--space-4); font-size: var(--font-size-xs);">
        Prefer the terminal? <code>sua init &amp;&amp; sua agent new</code>
      </p>
    </section>
  `;
}

function renderV2Card(a: Agent, lastRun?: Run): SafeHtml {
  const shape = dagShape(a);
  const runInfo = lastRun
    ? html`<span class="agent-card__last-run">
        Last run <span class="mono">${lastRun.status}</span> \u00b7 ${formatAge(lastRun.startedAt)}
      </span>`
    : html`<span class="agent-card__last-run dim">Never run</span>`;

  const mcpBadge = a.mcp ? html`<span class="badge badge--info">mcp</span>` : html``;

  // Multi-node agents get an inline <details> that reveals the DAG as
  // mini-cards indented by topological depth. Downstream nodes sit
  // visually under their upstreams so the reveal mirrors the actual DAG
  // rather than a flat list that ignores the edges.
  const nodesDisclosure = a.nodes.length > 1
    ? html`
      <details class="agent-card__nodes">
        <summary>Show ${String(a.nodes.length)} nodes</summary>
        <div class="agent-card__dag">
          ${renderDagMiniCards(a) as unknown as SafeHtml}
        </div>
      </details>
    `
    : html``;

  return html`
    <article class="agent-card">
      <div class="agent-card__header">
        <h3 class="agent-card__title"><a href="/agents/${a.id}">${a.id}</a></h3>
        ${statusBadge(a.status)}
        ${sourceBadge(a.source)}
        ${mcpBadge}
      </div>
      <p class="agent-card__desc">${a.description ?? 'No description.'}</p>
      <div class="agent-card__meta">
        <span><strong>${String(a.nodes.length)}</strong> node${a.nodes.length === 1 ? '' : 's'}</span>
        ${a.schedule ? html`<span>Cron <span class="mono">${a.schedule}</span></span>` : html``}
      </div>
      ${nodesDisclosure}
      <div class="agent-card__footer">
        <span class="agent-card__dag-shape" aria-hidden="true">${shape}</span>
        ${runInfo}
        <form method="POST" action="/agents/${a.id}/run" style="margin: 0;"
              onclick="event.stopPropagation();">
          <button type="submit" class="btn btn--primary btn--sm">Run</button>
        </form>
      </div>
    </article>
  `;
}

/**
 * Render each node of a multi-node agent as a mini-card, indented by
 * its topological depth so the expansion visually reflects the DAG
 * shape — upstream nodes at depth 0 (flush left), their downstream
 * neighbours at depth 1, etc. Siblings at the same depth stack
 * vertically in id order.
 *
 * A small connector rail on the left hints at the parent/child
 * relationship without turning the card into a full graph widget.
 */
function renderDagMiniCards(a: Agent): SafeHtml {
  const depthById = computeNodeDepths(a);
  const sorted = [...a.nodes].sort((n1, n2) => {
    const d1 = depthById.get(n1.id) ?? 0;
    const d2 = depthById.get(n2.id) ?? 0;
    if (d1 !== d2) return d1 - d2;
    return n1.id.localeCompare(n2.id);
  });

  const cards = sorted.map((n) => {
    const depth = depthById.get(n.id) ?? 0;
    const body = n.type === 'shell' ? oneLine(n.command ?? '') : oneLine(n.prompt ?? '');
    const typeClass = n.type === 'shell' ? 'badge--ok' : 'badge--info';
    const deps = n.dependsOn?.length
      ? html`<span class="agent-card__node-dep">\u2190 ${n.dependsOn.join(', ')}</span>`
      : html``;
    // Inline --depth so each card can use it for padding + the left rail.
    return html`
      <div class="agent-card__node" style="--depth: ${String(depth)};" data-depth="${String(depth)}">
        <div class="agent-card__node-rail" aria-hidden="true"></div>
        <div class="agent-card__node-body-wrap">
          <div class="agent-card__node-head">
            <code class="agent-card__node-id">${n.id}</code>
            <span class="badge ${typeClass}">${n.type}</span>
            ${deps}
          </div>
          <div class="mono dim agent-card__node-body">${body}</div>
        </div>
      </div>
    `;
  });
  return cards as unknown as SafeHtml;
}

/**
 * Longest-path depth per node (roots = 0, their immediate children = 1,
 * etc.). Iterative memoisation with cycle guard — cycles aren't legal in
 * a v2 DAG but defensive handling keeps a broken agent from crashing the
 * render.
 */
function computeNodeDepths(a: Agent): Map<string, number> {
  const byId = new Map(a.nodes.map((n) => [n.id, n]));
  const memo = new Map<string, number>();
  const seen = new Set<string>();

  function depth(id: string): number {
    if (memo.has(id)) return memo.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const node = byId.get(id);
    if (!node || !node.dependsOn || node.dependsOn.length === 0) {
      memo.set(id, 0);
      return 0;
    }
    let max = 0;
    for (const dep of node.dependsOn) {
      const d = depth(dep);
      if (d + 1 > max) max = d + 1;
    }
    memo.set(id, max);
    return max;
  }

  for (const n of a.nodes) depth(n.id);
  return memo;
}

function oneLine(text: string, max = 80): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max - 1) + '\u2026';
}

/**
 * A compact mono-string visual for the DAG: one dot per node, arrows
 * for edges in topological order. Caps at 6 nodes to avoid overflow.
 */
function dagShape(a: Agent): string {
  const nodes = a.nodes.slice(0, 6);
  if (nodes.length === 0) return '\u25cb';
  const hasEdges = nodes.some((n) => (n.dependsOn?.length ?? 0) > 0);
  const dots = nodes.map(() => '\u25cf');
  const joined = hasEdges ? dots.join(' \u2192 ') : dots.join(' \u00b7 ');
  return a.nodes.length > 6 ? `${joined} \u2026` : joined;
}

function renderV1Block(v1: AgentDefinition[], hasV2: boolean): SafeHtml {
  if (v1.length === 0) return html``;
  const v1Rows = v1.map((a) => html`
    <tr>
      <td><a href="/agents/${a.name}">${a.name}</a></td>
      <td><span class="badge badge--muted">v1</span></td>
      <td>${sourceBadge(a.source ?? 'local')}</td>
      <td>${typeBadge(a.type)}</td>
      <td>${a.schedule ?? html`<span class="dim">\u2014</span>`}</td>
      <td>${a.mcp ? html`<span class="badge badge--info">mcp</span>` : html`<span class="dim">\u2014</span>`}</td>
      <td class="dim">${a.description ?? ''}</td>
    </tr>
  `);
  const table = html`
    <table class="table">
      <thead>
        <tr>
          <th>Name</th><th>Kind</th><th>Source</th>
          <th>Type</th><th>Schedule</th><th>MCP</th><th>Description</th>
        </tr>
      </thead>
      <tbody>${v1Rows as unknown as SafeHtml[]}</tbody>
    </table>
  `;
  if (!hasV2) {
    return html`
      <p class="dim">
        No DAG agents yet. These v1 YAML files will migrate on
        <code>sua workflow import --apply</code>.
      </p>
      ${table}
    `;
  }
  return html`
    <details style="margin-top: var(--space-6);">
      <summary>Show ${String(v1.length)} legacy v1 agent${v1.length === 1 ? '' : 's'}</summary>
      <p class="dim" style="margin-top: var(--space-2);">
        Not yet migrated. Run <code>sua workflow import --apply</code> to merge these into DAG agents.
      </p>
      ${table}
    </details>
  `;
}

function statusBadge(status: string): SafeHtml {
  const kind = status === 'active' ? 'badge--ok'
    : status === 'paused' ? 'badge--warn'
    : status === 'archived' ? 'badge--muted'
    : status === 'draft' ? 'badge--info'
    : 'badge--muted';
  return html`<span class="badge ${kind}">${status}</span>`;
}
