import type { Agent, AgentDefinition, Run } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { typeBadge, sourceBadge, formatAge, cronToHuman } from './components.js';

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
  v1: AgentDefinition[];
  v2: Agent[];
  recentRuns: Run[];
  stats: HomeStats;
  invokerCounts?: Map<string, number>;
  filter?: {
    status?: string;
    source?: string;
    q?: string;
    sort?: string;
  };
  /** Active tab — filters the list by source. */
  tab?: 'user' | 'examples' | 'community';
  /** Per-tab counts for the tab strip (post-filter, pre-paginate). */
  tabCounts?: { user: number; examples: number; community: number };
  /** Pagination. */
  limit: number;
  offset: number;
  /** Total v2 count before pagination (after filtering). */
  total: number;
}

export function renderAgentsList(input: AgentsListInput): string {
  const hasV2 = input.v2.length > 0;
  const hasV1 = input.v1.length > 0;
  const { limit, offset, total } = input;

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
          <button type="button" class="btn btn--sm" id="build-from-goal-btn">Build from goal</button>
          <a class="btn btn--primary btn--sm" href="/agents/new">New agent</a>
        </span>
      `,
    })}

    ${empty ? renderEmptyState() : renderStatStrip(input.stats)}

    ${!empty ? renderTabStrip(input) : html``}
    ${!empty ? renderFilterBar(input.filter, input.tab ?? 'user') : html``}

    ${hasV2 ? html`
      <div class="agent-grid">
        ${input.v2.map((a) => renderV2Card(a, lastRunByAgent.get(a.id), input.invokerCounts?.get(a.id) ?? 0)) as unknown as SafeHtml[]}
      </div>
    ` : html``}

    ${renderV1Block(input.v1, hasV2)}

    ${total > 0 ? renderAgentPager(input) : html``}

    ${empty ? html`` : html`
      <footer style="margin-top: var(--space-8); text-align: center;">
        <p class="dim">
          ${String(total)} agent${total === 1 ? '' : 's'} total \u00b7
          <a href="/help">CLI reference</a> \u00b7
          <a href="/help/tutorial">Tutorial</a>
        </p>
      </footer>
    `}

    <div id="build-modal" class="modal-backdrop">
      <div class="modal" style="max-width: 600px; max-height: 85vh; overflow-y: auto;">
        <div id="build-modal-content">
          <h3 style="margin: 0 0 var(--space-3);">Build from goal</h3>
          <p class="dim" style="font-size: var(--font-size-xs); margin: 0 0 var(--space-3);">
            Describe what you want your agent to do. Claude will design a complete agent with the right nodes, tools, and wiring.
          </p>
          <label style="display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-3);">
            <strong style="font-size: var(--font-size-sm);">Goal</strong>
            <textarea id="build-goal" rows="3" placeholder="e.g. Scrape job listings from ashbyhq, extract key details, and save to a local JSON file"
              style="padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-sm); resize: vertical;"></textarea>
          </label>
          <label style="display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-4);">
            <strong style="font-size: var(--font-size-sm);">Constraints <span class="dim" style="font-weight: var(--weight-regular);">(optional)</span></strong>
            <input id="build-focus" type="text" placeholder="e.g. use shell nodes only, schedule daily at 9am"
              style="padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-sm);">
          </label>
          <div style="display: flex; gap: var(--space-2); justify-content: flex-end;">
            <button type="button" class="btn btn--ghost btn--sm" data-close-build="1">Cancel</button>
            <button type="button" class="btn btn--primary btn--sm" id="build-submit-btn">Build agent</button>
          </div>
        </div>
      </div>
    </div>
  `;

  return render(layout({ title: 'Agents', activeNav: 'agents' }, body));
}

function renderTabStrip(input: AgentsListInput): SafeHtml {
  const active = input.tab ?? 'user';
  const counts = input.tabCounts ?? { user: 0, examples: 0, community: 0 };
  const tab = (t: 'user' | 'examples' | 'community', label: string, count: number): SafeHtml => {
    const isActive = t === active;
    const url = agentBuildUrl(input.filter, input.limit, 0, t);
    const style = isActive
      ? 'border-bottom: 2px solid var(--color-primary); color: var(--color-text); font-weight: var(--weight-bold);'
      : 'border-bottom: 2px solid transparent; color: var(--color-text-muted);';
    return html`<a href="${url}" style="padding: var(--space-2) var(--space-1); ${style} text-decoration: none;">${label} <span class="dim">(${String(count)})</span></a>`;
  };
  // Hide Community tab unless at least one community agent exists — uncommon in practice.
  const communityTab = counts.community > 0 ? tab('community', 'Community', counts.community) : html``;
  return html`
    <nav style="display: flex; gap: var(--space-4); border-bottom: 1px solid var(--color-border); margin-bottom: var(--space-4);">
      ${tab('user', 'User', counts.user)}
      ${tab('examples', 'Examples', counts.examples)}
      ${communityTab}
    </nav>
  `;
}

function renderFilterBar(filter: { status?: string; source?: string; q?: string; sort?: string } | undefined, tab: 'user' | 'examples' | 'community'): SafeHtml {
  const f = filter ?? {};
  const selIf = (val: string, current?: string) => val === current ? ' selected' : '';
  return html`
    <form method="GET" action="/agents" class="filters" style="display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; margin-bottom: var(--space-4);">
      <input type="hidden" name="tab" value="${tab}">
      <input type="text" name="q" value="${f.q ?? ''}" placeholder="Search agents..."
        style="padding: var(--space-1) var(--space-3); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-sm); font-family: var(--font-mono); width: 16rem;">
      <select name="status" style="padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-sm);">
        ${html`<option value="">All statuses</option>
        <option value="active"${selIf('active', f.status)}>active</option>
        <option value="paused"${selIf('paused', f.status)}>paused</option>
        <option value="draft"${selIf('draft', f.status)}>draft</option>
        <option value="archived"${selIf('archived', f.status)}>archived</option>`}
      </select>
      <select name="sort" style="padding: var(--space-1) var(--space-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--font-size-sm);">
        ${html`<option value="name"${selIf('name', f.sort)}>Sort: name</option>
        <option value="status"${selIf('status', f.sort)}>Sort: status</option>
        <option value="recent"${selIf('recent', f.sort)}>Sort: recently run</option>
        <option value="starred"${selIf('starred', f.sort)}>Sort: starred first</option>`}
      </select>
      <button type="submit" class="btn btn--sm">Filter</button>
      ${(f.q || f.status || f.sort) ? html`<a href="${agentBuildUrl({}, 12, 0, tab)}" class="dim" style="font-size: var(--font-size-xs);">Reset</a>` : html``}
    </form>
  `;
}

function renderAgentPager(input: AgentsListInput): SafeHtml {
  const { limit, offset, total, filter: f, tab } = input;
  const t = tab ?? 'user';
  const showingStart = Math.min(offset + 1, total);
  const showingEnd = Math.min(offset + limit, total);
  const prevOffset = Math.max(0, offset - limit);
  const nextOffset = offset + limit;
  const sizes = [12, 24, 48, 100];
  const sizeLinks = sizes.map((s) => {
    const url = agentBuildUrl(f, s, 0, t);
    return s === limit
      ? html`<a href="${url}" style="font-weight: var(--weight-bold); color: var(--color-text);">${String(s)}</a>`
      : html`<a href="${url}">${String(s)}</a>`;
  });

  return html`
    <div class="pager">
      <div>Showing ${String(showingStart)}\u2013${String(showingEnd)} of ${String(total)}</div>
      <div style="display: flex; align-items: center; gap: var(--space-3);">
        <span style="display: flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-xs); color: var(--color-text-muted);">
          Show: ${sizeLinks as unknown as SafeHtml[]}
        </span>
        <span style="color: var(--color-border);">|</span>
        ${offset > 0 ? html`<a href="${agentBuildUrl(f, limit, prevOffset, t)}">\u2190 Prev</a>` : html`<span class="dim">\u2190 Prev</span>`}
        ${nextOffset < total ? html`<a href="${agentBuildUrl(f, limit, nextOffset, t)}">Next \u2192</a>` : html`<span class="dim">Next \u2192</span>`}
      </div>
    </div>
  `;
}

function agentBuildUrl(
  f: AgentsListInput['filter'] | undefined,
  limit: number,
  offset: number,
  tab: 'user' | 'examples' | 'community',
): string {
  const params = new URLSearchParams();
  if (tab !== 'user') params.set('tab', tab);
  if (f?.status) params.set('status', f.status);
  if (f?.q) params.set('q', f.q);
  if (f?.sort && f.sort !== 'name') params.set('sort', f.sort);
  if (limit !== 12) params.set('limit', String(limit));
  if (offset !== 0) params.set('offset', String(offset));
  const qs = params.toString();
  return qs ? `/agents?${qs}` : '/agents';
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

function renderV2Card(a: Agent, lastRun?: Run, invokerCount = 0): SafeHtml {
  const shape = dagShape(a);
  const runInfo = lastRun
    ? html`<span class="agent-card__last-run">
        Last run <span class="mono">${lastRun.status}</span> \u00b7 ${formatAge(lastRun.startedAt)}
      </span>`
    : html`<span class="agent-card__last-run dim">Never run</span>`;

  const mcpBadge = a.mcp ? html`<span class="badge badge--info">mcp</span>` : html``;
  const usedByBadge = invokerCount > 0
    ? html`<span class="badge badge--info">used by ${String(invokerCount)}</span>`
    : html``;

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
        <form method="POST" action="/agents/${a.id}/star" style="display:inline;margin:0;"
              onclick="event.stopPropagation();">
          <button type="submit" class="btn-star${a.starred ? ' is-starred' : ''}"
                  title="${a.starred ? 'Unstar' : 'Star'}"
                  aria-label="${a.starred ? 'Unstar' : 'Star'}">
            ${a.starred ? '\u2605' : '\u2606'}
          </button>
        </form>
        <h3 class="agent-card__title"><a href="/agents/${a.id}">${a.id}</a></h3>
        ${statusBadge(a.status)}
        ${sourceBadge(a.source)}
        ${mcpBadge}
        ${usedByBadge}
      </div>
      <p class="agent-card__desc">${a.description ?? 'No description.'}</p>
      <div class="agent-card__meta">
        <span><strong>${String(a.nodes.length)}</strong> node${a.nodes.length === 1 ? '' : 's'}</span>
        ${a.schedule ? html`<span title="${a.schedule}">${cronToHuman(a.schedule)}</span>` : html``}
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
      <td>${a.schedule ? html`<span title="${a.schedule}">${cronToHuman(a.schedule)}</span>` : html`<span class="dim">\u2014</span>`}</td>
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
