import type { Agent, AgentCatalogEntry, AgentDefinition, Run } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';
import { sectionTabs } from './section-tabs.js';
import { typeBadge, sourceBadge, formatAge, cronToHuman } from './components.js';
import { buildFromGoalButton, buildFromGoalModal } from './build-from-goal-modal.js';

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
  /** How many other agents each agent calls — the "calls N" badge. */
  calleeCounts?: Map<string, number>;
  /** Total agents that call at least one other agent, across the whole store. */
  composedCount?: number;
  /** Archived agents hidden from the default view; links to them when > 0. */
  archivedCount?: number;
  /** Whether the list is currently narrowed to those agents. */
  composedOnly?: boolean;
  /** How many notebooks each agent feeds — the "feeds N notebooks" badge. */
  feedCounts?: Map<string, number>;
  /** Agents on this tab that feed a notebook; whether the list is narrowed to them. */
  feedsCount?: number;
  feedsOnly?: boolean;
  filter?: {
    status?: string;
    source?: string;
    q?: string;
    /** Raw `?sort=` — undefined means "no preference". Drives URLs. */
    sort?: string;
    /** What the list is actually sorted by, including the implicit
     *  `relevance` used while searching. Drives the dropdown only. */
    sortEffective?: string;
    /** The Calls-other-agents and Feeds-notebooks chips, kept across pages and tabs. */
    composed?: boolean;
    feeds?: boolean;
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
  /** Banner shown above the page (redirected from a mutation route). */
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
  /** User-owned dashboards offered as targets in the Build-from-goal wizard. */
  availableDashboards?: Array<{ id: string; name: string }>;
  /** When each agent last ran (any status), for "used 2h ago". */
  lastRunAt?: Map<string, string>;
  /** Runs per agent in the last 30 days, for "14 runs". */
  runCounts?: Map<string, number>;
  /** The User tab with nothing filtered: shelves instead of one long grid. */
  shelves?: AgentShelves;
  /** sua's agent finder, asked the question in the box (polled by the page). */
  find?: { id: string; status: 'working' | 'ready' | 'failed' };
  /** sua's sorting of the catalog: each agent's group and "use it for" line. */
  catalog?: ReadonlyMap<string, AgentCatalogEntry>;
  /** sua is sorting new or changed agents right now (the page reloads once when done). */
  sorting?: boolean;
  /** `?group=`: one group's agents, as the compact list. */
  group?: { name: string; agents: Agent[] };
}

/** The User tab's shelves: the agents you use, then everything, then the demos and tests folded away. */
export interface AgentShelves {
  goTo: Agent[];
  recent: Agent[];
  feeds: Agent[];
  scheduled: Agent[];
  /** A shelf per group sua sorted the agents into, biggest first. */
  groups: Array<{ name: string; agents: Agent[] }>;
  /** Agents sua hasn't sorted yet. */
  unsorted: Agent[];
  all: Agent[];
  folded: Agent[];
}

/** Cards a group's shelf shows before "All N →". */
const GROUP_SHELF_CARDS = 3;

/** What to use an agent for: sua's one line when it has one, else the author's description. */
function useForText(a: Agent, input: AgentsListInput): string | undefined {
  return input.catalog?.get(a.id)?.useFor ?? a.description;
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

  // `empty` is scoped to the ACTIVE TAB — v2/v1 are already filtered by
  // source before they get here. That distinction is load-bearing: the page
  // used to treat an empty tab as an empty install, so an operator whose
  // agents are all `source: examples` landed on the default User tab, was
  // told "No agents yet", and — worse — the tab strip that would have
  // revealed them was suppressed too. A hundred agents, invisible.
  const empty = !hasV2 && !hasV1;
  const counts = input.tabCounts ?? { user: 0, examples: 0, community: 0 };
  const installEmpty = empty && counts.user + counts.examples + counts.community === 0;
  // "Nothing matched your search" and "you have no agents" are different
  // situations with different next steps. Conflating them told a searching
  // user to run `sua init`.
  const emptySearch = empty && Boolean(input.filter?.q);
  // Empty tab, agents elsewhere. Same shape of problem as an empty search:
  // the reader needs to be told where the agents actually are.
  const emptyTab = empty && !emptySearch && !installEmpty;

  const body = html`
    ${pageHeader({
      crumbs: [{ label: 'Home', href: '/' }, { label: 'Agents' }],
      title: 'Agents',
      description: 'Everything you have built or installed. Open one to see what it does, run it, or put it on a schedule.',
      cta: html`
        <span style="display: inline-flex; gap: var(--space-2);">
          <a class="btn btn--ghost btn--sm" href="/help/tutorial">Tutorial</a>
          ${buildFromGoalButton()}
          <a class="btn btn--primary btn--sm" href="/agents/new">New agent</a>
        </span>
      `,
    })}

    ${sectionTabs('agents')}

    ${installEmpty ? renderEmptyState() : html``}

    ${/* Keep the tabs and the filter box on screen unless the install is
          genuinely empty. Hiding them on an empty SEARCH stranded you with no
          way to edit the query; hiding them on an empty TAB was worse — it
          removed the only route to the agents you actually have. */ html``}
    ${!installEmpty ? renderAskBox(input) : html``}
    ${!installEmpty ? renderTabStrip(input) : html``}
    ${!installEmpty ? renderFilterBar(input) : html``}
    ${input.filter?.q && input.find ? renderFindPanel(input.filter.q, input.find) : html``}
    ${emptySearch ? renderNoMatches(input) : html``}
    ${emptyTab ? renderEmptyTab(input) : html``}

    ${input.group ? renderGroupList(input, input.group) : input.shelves ? renderShelves(input, input.shelves) : html`
      ${hasV2 ? html`
        ${input.filter?.q ? html`<h2 class="ag-shelf__title">Keyword matches</h2>` : html``}
        <div class="agent-grid">
          ${input.v2.map((a) => renderV2Card(a, input, lastRunByAgent.get(a.id))) as unknown as SafeHtml[]}
        </div>
      ` : html``}
      ${total > 0 ? renderAgentPager(input) : html``}
    `}

    ${renderV1Block(input.v1, hasV2)}

    ${empty ? html`` : html`
      <footer style="margin-top: var(--space-8); text-align: center;">
        <p class="dim">
          ${String(input.shelves ? input.shelves.all.length + input.shelves.folded.length : total)} agent${total === 1 ? '' : 's'} total \u00b7
          <a href="/help">CLI reference</a> \u00b7
          <a href="/help/tutorial">Tutorial</a>
        </p>
      </footer>
    `}

    ${buildFromGoalModal({ availableDashboards: input.availableDashboards })}
  `;

  return render(layout({ title: 'Agents', activeNav: 'agents', flash: input.flash }, body));
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

/**
 * The question box: "What do you want to do?". Submitting shows the agents
 * whose words match at once, and asks sua's agent finder (the page polls for
 * its picks). The same box searches every tab.
 */
function renderAskBox(input: AgentsListInput): SafeHtml {
  const f = input.filter ?? {};
  const tab = input.tab ?? 'user';
  return html`
    <form method="GET" action="/agents" class="ag-ask" role="search">
      ${tab !== 'user' ? html`<input type="hidden" name="tab" value="${tab}">` : html``}
      <label class="ag-ask__label" for="ag-ask-q">What do you want to do?<span class="sr-only"> Search agents</span></label>
      <div class="ag-ask__row">
        <input id="ag-ask-q" type="search" name="q" value="${f.q ?? ''}" autocomplete="off" class="ag-ask__q"
          placeholder="e.g. find startups hiring in fintech, watch a page for changes, a morning news digest">
        <button type="submit" class="btn btn--primary">Find an agent</button>
      </div>
    </form>
  `;
}

/** sua's picks for the question: filled in by the page script when the finder answers. */
function renderFindPanel(q: string, find: NonNullable<AgentsListInput['find']>): SafeHtml {
  return html`
    <section class="ag-suggest" data-agent-find="${find.id}" data-agent-find-q="${q}" aria-live="polite">
      <div class="ag-suggest__head"><span class="ag-suggest__who" aria-hidden="true">sua</span><span>Asking sua which agents do “${q}”…</span><span class="ag-suggest__dot" aria-hidden="true"></span></div>
    </section>
  `;
}

/**
 * Filters (status, sort, Calls other agents, Feeds notebooks, Archived),
 * folded away: most visits are for finding an agent, which the box above
 * does. It opens by itself while a filter is on.
 */
function renderFilterBar(input: AgentsListInput): SafeHtml {
  const f = input.filter ?? {};
  const tab = input.tab ?? 'user';
  const selIf = (val: string, current?: string) => val === current ? ' selected' : '';
  const on = Boolean(f.status || f.sort || input.composedOnly || input.feedsOnly);
  return html`
    <details class="ag-filters"${on ? ' open' : ''}>
      <summary class="ag-filters__open">Filters${on ? ' (on)' : ''}</summary>
    <form method="GET" action="/agents" class="filters ag-filters__form">
      <input type="hidden" name="tab" value="${tab}">
      ${f.q ? html`<input type="hidden" name="q" value="${f.q}">` : html``}
      <select name="status" aria-label="Status">
        ${html`<option value="">All statuses</option>
        <option value="active"${selIf('active', f.status)}>active</option>
        <option value="paused"${selIf('paused', f.status)}>paused</option>
        <option value="draft"${selIf('draft', f.status)}>draft</option>
        <option value="archived"${selIf('archived', f.status)}>archived</option>`}
      </select>
      <select name="sort" aria-label="Sort">
        ${html`${f.sortEffective === 'relevance'
          ? html`<option value="relevance" selected>Sort: best match</option>`
          : html``}
        <option value="name"${selIf('name', f.sortEffective ?? f.sort)}>Sort: name</option>
        <option value="status"${selIf('status', f.sortEffective ?? f.sort)}>Sort: status</option>
        <option value="recent"${selIf('recent', f.sortEffective ?? f.sort)}>Sort: recently run</option>
        <option value="starred"${selIf('starred', f.sortEffective ?? f.sort)}>Sort: starred first</option>`}
      </select>
      <button type="submit" class="btn btn--sm">Filter</button>
      ${composedChip(input)}
      ${feedsChip(input)}
      ${(input.archivedCount ?? 0) > 0
        ? html`<a href="${agentBuildUrl({ ...(input.filter ?? {}), status: 'archived' }, input.limit ?? 12, 0, input.tab ?? 'user')}" class="badge badge--muted" style="text-decoration: none;" title="Archived agents are hidden here; open one to restore it">Archived (${String(input.archivedCount)})</a>`
        : html``}
      ${(f.q || f.status || f.sort || input.composedOnly || input.feedsOnly) ? html`<a href="${agentBuildUrl({}, 12, 0, tab)}" class="dim" style="font-size: var(--font-size-xs);">Reset</a>` : html``}
    </form>
    </details>
  `;
}

/**
 * A one-click way to see the agents that call other agents.
 *
 * sua has been able to compose agents since `agent-invoke` shipped, but
 * nothing in the product said so — you had to already know the node type
 * existed and go read the flow-control docs. This makes the working examples
 * one click from the list, and only appears when there are some.
 */
/** "Feeds notebooks (N)": narrows the list to agents that fill a notebook. */
function feedsChip(input: AgentsListInput): SafeHtml {
  const n = input.feedsCount ?? 0;
  if (n === 0) return html``;
  const base = agentBuildUrl({ ...(input.filter ?? {}), feeds: false }, input.limit ?? 12, 0, input.tab ?? 'user');
  const on = input.feedsOnly === true;
  const href = on ? base : `${base}${base.includes('?') ? '&' : '?'}feeds=1`;
  return html`
    <a href="${href}" class="badge ${on ? 'badge--info' : 'badge--muted'}" style="text-decoration: none;"
       title="Agents that search for a notebook or have filed into one">
      ${on ? '✓ ' : ''}Feeds notebooks (${String(n)})
    </a>
  `;
}

function composedChip(input: AgentsListInput): SafeHtml {
  const n = input.composedCount ?? 0;
  if (n === 0) return html``;
  const tab = input.tab ?? 'user';
  const on = input.composedOnly === true;
  const base = agentBuildUrl({ ...(input.filter ?? {}), composed: false }, input.limit ?? 12, 0, tab);
  const href = on ? base : `${base}${base.includes('?') ? '&' : '?'}composed=1`;
  return html`
    <a href="${href}" class="badge ${on ? 'badge--info' : 'badge--muted'}"
       style="text-decoration: none;"
       title="Agents that run other agents as part of their job">
      ${on ? '✓ ' : ''}Calls other agents (${String(n)})
    </a>
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
  // The two filter chips: paging or switching tabs keeps them on.
  if (f?.composed) params.set('composed', '1');
  if (f?.feeds) params.set('feeds', '1');
  if (limit !== 12) params.set('limit', String(limit));
  if (offset !== 0) params.set('offset', String(offset));
  const qs = params.toString();
  return qs ? `/agents?${qs}` : '/agents';
}

/**
 * Shown when a search matched nothing in the active tab.
 *
 * The cross-tab counts are free — `tabCounts` is already computed over the
 * whole store, so we can tell you "12 in Examples" without another query. That
 * one line answers the most common cause of an empty result: right search,
 * wrong tab.
 */
function renderNoMatches(input: AgentsListInput): SafeHtml {
  const q = input.filter?.q ?? '';
  const counts = input.tabCounts ?? { user: 0, examples: 0, community: 0 };
  const active = input.tab ?? 'user';
  const label: Record<'user' | 'examples' | 'community', string> = {
    user: 'User', examples: 'Examples', community: 'Community',
  };

  const elsewhere = (['user', 'examples', 'community'] as const)
    .filter((t) => t !== active && counts[t] > 0)
    .map((t) => html`<a href="${agentBuildUrl(input.filter, input.limit, 0, t)}">${String(counts[t])} in ${label[t]}</a>`);

  return html`
    <section class="card" style="padding: var(--space-6); margin-bottom: var(--space-6);">
      <p style="margin: 0 0 var(--space-2);">
        No agents match <strong>${q}</strong> in ${label[active]}.
      </p>
      ${elsewhere.length > 0
        ? html`<p class="dim" style="margin: 0 0 var(--space-3); font-size: var(--font-size-sm);">
            Found ${elsewhere as unknown as SafeHtml[]} instead.
          </p>`
        : html``}
      <p class="dim" style="margin: 0 0 var(--space-3); font-size: var(--font-size-sm);">
        Or hand it to sua as a request — it routes by intent rather than by keyword,
        so it can find an agent whose description never uses your words.
      </p>
      ${/* One click puts the query the operator ALREADY typed into the ask band.
           This is the most valuable chip on the site: they searched, got
           nothing, and the ranker that would have found it is one click away. */
        html`<button type="button" class="ask-chip ask-chip--lead" data-ask="${q}">
          Ask sua: <span class="ask-chip__q">${q}</span>
        </button>`}
    </section>
  `;
}

/**
 * This tab has nothing, but the install does. Mirrors `renderNoMatches` — the
 * reader's problem is identical (looking at an empty list) and so is the
 * answer (here is where they actually are), so it should read the same.
 */
function renderEmptyTab(input: AgentsListInput): SafeHtml {
  const counts = input.tabCounts ?? { user: 0, examples: 0, community: 0 };
  const active = input.tab ?? 'user';
  const label: Record<'user' | 'examples' | 'community', string> = {
    user: 'User', examples: 'Examples', community: 'Community',
  };
  const elsewhere = (['user', 'examples', 'community'] as const)
    .filter((t) => t !== active && counts[t] > 0)
    .map((t) => html`<a href="${agentBuildUrl(input.filter, input.limit, 0, t)}">${String(counts[t])} in ${label[t]}</a>`);

  return html`
    <section class="card" style="padding: var(--space-6); margin-bottom: var(--space-6);">
      <p style="margin: 0 0 var(--space-2);">
        No agents in <strong>${label[active]}</strong>.
      </p>
      ${elsewhere.length > 0
        ? html`<p class="dim" style="margin: 0 0 var(--space-3); font-size: var(--font-size-sm);">
            You have ${elsewhere as unknown as SafeHtml[]}.
          </p>`
        : html``}
      <p style="display: flex; gap: var(--space-2); margin: 0;">
        <a class="btn btn--primary btn--sm" href="/agents/new">New agent</a>
      </p>
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

/**
 * Card chips sit on one line; a long question would either wrap the card or
 * get clipped mid-word by CSS. Truncating in the template keeps the full text
 * available in `data-ask` and `title`, so the chip still fills the band with
 * the WHOLE question even though it displays an abbreviated one.
 */
const CARD_QUESTION_MAX = 52;
function truncateQuestion(q: string): string {
  const t = q.trim();
  if (t.length <= CARD_QUESTION_MAX) return t;
  const cut = t.slice(0, CARD_QUESTION_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).replace(/[),.;:!?-]+$/, '')}\u2026`;
}

/** When an agent was last used, and how much lately: "used 2h ago · 14 runs this month", or "not run yet". */
function usedLine(a: Agent, input: AgentsListInput, lastRun?: Run): SafeHtml {
  const at = input.lastRunAt?.get(a.id) ?? lastRun?.startedAt;
  if (!at) return html`<span class="ag-used dim">not run yet</span>`;
  const n = input.runCounts?.get(a.id) ?? 0;
  const failed = lastRun && lastRun.startedAt === at && lastRun.status === 'failed';
  return html`<span class="ag-used${failed ? ' is-failed' : ''}" title="${at}">${failed ? 'last run failed' : 'used'} ${formatAge(at)}${n > 1 ? ` · ${String(n)} runs this month` : ''}</span>`;
}

/** The agent's name, with its id beneath when the name doesn't just restate it ("Job Finder" for job-finder). */
function agentNames(a: Agent, cls: string): SafeHtml {
  const name = a.name.trim() || a.id;
  const same = name.toLowerCase().replace(/[\s_]+/g, '-') === a.id.toLowerCase();
  return html`<span class="${cls}"><a class="ag-name" href="/agents/${a.id}">${name}</a>${same ? html`` : html`<code class="ag-id">${a.id}</code>`}</span>`;
}

function starForm(a: Agent): SafeHtml {
  return html`<form method="POST" action="/agents/${a.id}/star" class="ag-star">
          <button type="submit" class="btn-star${a.starred ? ' is-starred' : ''}"
                  title="${a.starred ? 'Unstar' : 'Star'}"
                  aria-label="${a.starred ? 'Unstar' : 'Star'} ${a.id}">
            ${a.starred ? '\u2605' : '\u2606'}
          </button>
        </form>`;
}

/** What else is worth knowing at a glance: calls / used by / feeds / schedule / mcp / not active. */
function agentChips(a: Agent, input: AgentsListInput): SafeHtml {
  const calls = input.calleeCounts?.get(a.id) ?? 0;
  const usedBy = input.invokerCounts?.get(a.id) ?? 0;
  const feeds = input.feedCounts?.get(a.id) ?? 0;
  return html`${a.status !== 'active' ? html`<span class="ag-chip ag-chip--status">${a.status}</span>` : html``}${feeds > 0
      ? html`<span class="ag-chip" title="Searches for, or has filed into, ${String(feeds)} notebook${feeds === 1 ? '' : 's'}">feeds ${String(feeds)} notebook${feeds === 1 ? '' : 's'}</span>` : html``}${calls > 0
      ? html`<span class="ag-chip" title="Runs ${String(calls)} other agent${calls === 1 ? '' : 's'}">calls ${String(calls)}</span>` : html``}${usedBy > 0
      ? html`<span class="ag-chip">used by ${String(usedBy)}</span>` : html``}${a.schedule
      ? html`<span class="ag-chip" title="${a.schedule}">${cronToHuman(a.schedule)}</span>` : html``}${a.mcp ? html`<span class="ag-chip">mcp</span>` : html``}`;
}

/**
 * A slim card: what the agent is for (its name, what it does, one question
 * you can ask it), when you last used it, and Run. How it's built (nodes,
 * the DAG) is on its own page.
 */
function renderV2Card(a: Agent, input: AgentsListInput, lastRun?: Run): SafeHtml {
  // ONE sample question: enough to show questions are clickable; the agent's page has the rest.
  const firstQuestion = (a.sampleQuestions ?? []).find((q) => q.trim().length > 0);
  return html`
    <article class="agent-card ag-card">
      <div class="ag-card__top">
        ${starForm(a)}
        ${agentNames(a, 'ag-card__names')}
      </div>
      <p class="ag-card__desc" title="${a.description ?? ''}">${useForText(a, input) ?? 'No description.'}</p>
      ${firstQuestion ? html`<button type="button" class="ask-chip ask-chip--card" data-ask="${firstQuestion}" title="${firstQuestion}">${truncateQuestion(firstQuestion)}</button>` : html``}
      <div class="ag-card__chips">${agentChips(a, input)}</div>
      <div class="ag-card__foot">
        ${usedLine(a, input, lastRun)}
        <form method="POST" action="/agents/${a.id}/run" class="ag-run"><button type="submit" class="btn btn--sm">Run</button></form>
      </div>
    </article>
  `;
}

/** One line per agent, for the full list: name, what it does, when used, Run. */
function renderAgentRow(a: Agent, input: AgentsListInput, lastRun?: Run): SafeHtml {
  return html`
    <li class="ag-row">
      ${starForm(a)}
      ${agentNames(a, 'ag-row__names')}
      <span class="ag-row__desc" title="${a.description ?? ''}">${useForText(a, input) ?? ''}</span>
      <span class="ag-row__chips">${agentChips(a, input)}</span>
      ${usedLine(a, input, lastRun)}
      <form method="POST" action="/agents/${a.id}/run" class="ag-run"><button type="submit" class="btn btn--sm btn--ghost">Run</button></form>
    </li>
  `;
}

/**
 * The User tab, nothing filtered: the agents you reach for (starred and most
 * run), the ones you used lately, the ones that fill notebooks, the ones on a
 * schedule; then every agent as one line each; demos, tests and drafts you
 * never ran are folded away at the bottom.
 */
function renderShelves(input: AgentsListInput, sh: AgentShelves): SafeHtml {
  const last = new Map<string, Run>();
  for (const r of input.recentRuns) if (!last.has(r.agentName)) last.set(r.agentName, r);
  const shelf = (title: string, hint: string, agents: Agent[]) => agents.length ? html`
    <section class="ag-shelf">
      <h2 class="ag-shelf__title">${title} <span class="ag-shelf__hint">${hint}</span></h2>
      <div class="agent-grid ag-shelf__grid">${agents.map((a) => renderV2Card(a, input, last.get(a.id))) as unknown as SafeHtml[]}</div>
    </section>` : html``;
  return html`
    ${shelf('Your go-to', 'starred, and the ones you run most', sh.goTo)}
    ${shelf('Used lately', 'in the last week', sh.recent)}
    ${shelf('Fill notebooks', 'search for a notebook, or have filed into one', sh.feeds)}
    ${shelf('On a schedule', 'run by themselves', sh.scheduled)}
    ${input.sorting ? html`<p class="ag-sorting" data-catalog-sorting><span class="ag-suggest__dot" aria-hidden="true"></span> sua is sorting your agents by what they do…</p>` : html``}
    ${sh.groups.length ? html`
    <div class="ag-groups">
      <h2 class="ag-groups__title">By what they do <span class="ag-shelf__hint">sorted by sua</span></h2>
      ${sh.groups.map((g) => html`
      <section class="ag-shelf ag-shelf--group">
        <h3 class="ag-shelf__title">${g.name} <span class="ag-shelf__hint">${String(g.agents.length)}</span>${g.agents.length > GROUP_SHELF_CARDS
          ? html` <a class="ag-shelf__all" href="/agents?group=${encodeURIComponent(g.name)}">All ${String(g.agents.length)} →</a>` : html``}</h3>
        <div class="agent-grid ag-shelf__grid">${g.agents.slice(0, GROUP_SHELF_CARDS).map((a) => renderV2Card(a, input, last.get(a.id))) as unknown as SafeHtml[]}</div>
      </section>`) as unknown as SafeHtml[]}
      ${sh.unsorted.length ? html`
      <section class="ag-shelf ag-shelf--group">
        <h3 class="ag-shelf__title">Not sorted yet <span class="ag-shelf__hint">${String(sh.unsorted.length)}</span></h3>
        <ul class="ag-rows">${sh.unsorted.map((a) => renderAgentRow(a, input, last.get(a.id))) as unknown as SafeHtml[]}</ul>
      </section>` : html``}
    </div>` : html``}
    <section class="ag-shelf">
      <h2 class="ag-shelf__title">All agents <span class="ag-shelf__hint">${String(sh.all.length)}, by name</span></h2>
      <ul class="ag-rows">${sh.all.map((a) => renderAgentRow(a, input, last.get(a.id))) as unknown as SafeHtml[]}</ul>
    </section>
    ${sh.folded.length ? html`
    <details class="ag-folded">
      <summary>Demos, tests and drafts never run (${String(sh.folded.length)})</summary>
      <ul class="ag-rows">${sh.folded.map((a) => renderAgentRow(a, input, last.get(a.id))) as unknown as SafeHtml[]}</ul>
    </details>` : html``}
  `;
}

/** `?group=`: one group's agents, most used first, one line each. */
function renderGroupList(input: AgentsListInput, g: { name: string; agents: Agent[] }): SafeHtml {
  const last = new Map<string, Run>();
  for (const r of input.recentRuns) if (!last.has(r.agentName)) last.set(r.agentName, r);
  return html`
    <section class="ag-shelf">
      <p class="ag-back"><a href="/agents">← All agents</a></p>
      <h2 class="ag-shelf__title">${g.name} <span class="ag-shelf__hint">${String(g.agents.length)}, most used first</span></h2>
      ${g.agents.length
        ? html`<ul class="ag-rows">${g.agents.map((a) => renderAgentRow(a, input, last.get(a.id))) as unknown as SafeHtml[]}</ul>`
        : html`<p class="dim">No agents in this group now.</p>`}
    </section>
  `;
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
        These agents are written in sua’s older format. They still run, and everything on this page
        works with them. To bring them up to date, run <code>sua workflow import --apply</code> in
        your project directory.
      </p>
      ${table}
    `;
  }
  return html`
    <details style="margin-top: var(--space-6);">
      <summary>Show ${String(v1.length)} agent${v1.length === 1 ? '' : 's'} in the older format</summary>
      <p class="dim" style="margin-top: var(--space-2);">
        These still run as they are. To bring them up to date, run
        <code>sua workflow import --apply</code> in your project directory.
      </p>
      ${table}
    </details>
  `;
}
