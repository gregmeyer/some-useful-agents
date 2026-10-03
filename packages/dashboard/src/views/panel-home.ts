import { html, type SafeHtml } from './html.js';
import { formatAge } from './components.js';
import { PANEL_TABS, PANEL_TAB_LABEL, type PanelFacets, type PanelFilters, type PanelList, type PanelRow } from '../lib/panel-inbox.js';

/** Starting points when the inbox is empty. Clicking one fills the box; nothing sends until you do. */
const SUGGESTIONS = [
  'What failed overnight?',
  'Build me a board for my mornings',
  'Which of my agents could help with my week?',
];

const EMPTY: Record<PanelList['tab'], string> = {
  needs: 'Nothing is waiting on you.',
  open: 'No open threads.',
  conversations: 'You haven’t asked sua anything yet.',
  done: 'Nothing finished yet.',
};

/**
 * The conversation panel with no thread open (`GET /panel/home`): your inbox.
 * A box to ask sua, then tabs (Needs you · Open · Conversations · Done), a
 * search and the threads. Picking one opens it in the panel; "← Inbox" comes
 * back here (inbox-modal.js.ts). The list part is also served alone
 * (`GET /panel/list`) for tab switches, search and "Show more".
 */
const SOURCE_LABEL: Record<string, string> = {
  'run-failure': 'Run failures',
  'outcome': 'Missed outcomes',
  'permission-request': 'Permissions',
  'cadence': 'Reminders',
  'manual': 'Your questions',
  'system-health': 'System health',
  'question': 'Questions from agents',
  'board': 'Boards',
};

/**
 * Home's full-width list adds a filter menu (source, agent, tag, starred,
 * sort) and a bar for acting on selected threads. Both sit outside the part
 * that re-renders, so an open menu or a selection survives a refresh.
 */
function renderFilters(f: PanelFilters, facets: PanelFacets): SafeHtml {
  const active = [f.source, f.agentId, f.tag, f.starred ? '1' : '', f.sort].filter(Boolean).length;
  const opt = (value: string, label: string, current?: string) =>
    html`<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`;
  return html`
    <details class="panel-filters" data-panel-filters>
      <summary class="panel-filters__summary">Filter and sort${active ? html` <span class="panel-tabs__count">${String(active)}</span>` : html``}</summary>
      <div class="panel-filters__body">
        <label class="panel-filters__field">From
          <select data-panel-filter="source">${opt('', 'Anywhere', f.source ?? '')}${facets.sources.map((s) => opt(s, SOURCE_LABEL[s] ?? s, f.source)) as unknown as SafeHtml[]}</select>
        </label>
        <label class="panel-filters__field">Agent
          <select data-panel-filter="agent">${opt('', 'Any agent', f.agentId ?? '')}${facets.agentIds.map((a) => opt(a, a, f.agentId)) as unknown as SafeHtml[]}</select>
        </label>
        ${facets.tags.length ? html`<label class="panel-filters__field">Tag
          <select data-panel-filter="tag">${opt('', 'Any tag', f.tag ?? '')}${facets.tags.map((g) => opt(g, g, f.tag)) as unknown as SafeHtml[]}</select>
        </label>` : html``}
        <label class="panel-filters__field">Sort
          <select data-panel-filter="sort">${opt('', 'Default', f.sort ?? '')}${opt('recent', 'Latest activity', f.sort)}${opt('oldest', 'Oldest first', f.sort)}${opt('priority', 'Priority', f.sort)}</select>
        </label>
        <label class="panel-filters__check"><input type="checkbox" data-panel-filter="starred" ${f.starred ? 'checked' : ''}> Starred only</label>
        <button type="button" class="btn btn--xs btn--ghost" data-panel-filter-clear>Clear</button>
      </div>
    </details>
    <div class="panel-bulk" data-panel-bulk hidden>
      <label class="panel-filters__check"><input type="checkbox" data-panel-select-all> <span data-panel-bulk-count>0 selected</span></label>
      <span class="panel-bulk__spacer"></span>
      <button type="button" class="btn btn--xs" data-panel-bulk-action="resolve">Resolve</button>
      <button type="button" class="btn btn--xs btn--ghost" data-panel-bulk-action="dismiss">Dismiss</button>
      <button type="button" class="btn btn--xs btn--ghost" data-panel-bulk-clear>Clear</button>
    </div>`;
}

export function renderPanelHome(list: PanelList, facets?: PanelFacets): SafeHtml {
  const total = Object.values(list.counts).reduce((a, b) => a + b, 0);
  return html`
    <div class="panel-home" data-panel-home>
      <form class="inbox-chatbar panel-home__composer" method="POST" action="/inbox/new" data-home-ask>
        <span class="inbox-chatbar__prompt" aria-hidden="true">you&nbsp;›</span>
        <textarea name="body" rows="1" required maxlength="8192" class="inbox-chatbar__input"
          placeholder="Ask sua to run, build, fix, or look something up…" aria-label="Ask sua" data-home-ask-input data-panel-composer></textarea>
        <button type="submit" class="btn btn--sm btn--primary inbox-chatbar__send" data-home-ask-send>Send ↵</button>
      </form>
      ${total === 0 && !list.q
        ? html`<div class="panel-home__chips">
            ${SUGGESTIONS.map((s) => html`<button type="button" class="panel-home__chip" data-panel-ask="${s}">${s}</button>`) as unknown as SafeHtml[]}
          </div>`
        : html``}
      <input type="search" class="panel-home__search" placeholder="Search your inbox" aria-label="Search your inbox"
        value="${list.q}" data-panel-search autocomplete="off">
      ${list.wide && facets ? renderFilters(list.filters, facets) : html``}
      <div data-panel-list>${renderPanelList(list)}</div>
    </div>`;
}

/** Tabs, rows and "Show more": the part that changes with tab, search and paging. */
export function renderPanelList(list: PanelList): SafeHtml {
  return html`
    <div class="panel-tabs" role="tablist" aria-label="Inbox" data-panel-tabs>
      ${PANEL_TABS.map((t) => html`
        <button type="button" role="tab" class="panel-tabs__tab" data-panel-tab="${t}" aria-selected="${t === list.tab ? 'true' : 'false'}">
          ${PANEL_TAB_LABEL[t]}${list.counts[t] > 0 ? html` <span class="panel-tabs__count ${t === 'needs' ? 'panel-tabs__count--needs' : ''}">${String(list.counts[t])}</span>` : html``}
        </button>`) as unknown as SafeHtml[]}
    </div>
    <ul class="panel-home__list" role="tabpanel" data-panel-rows data-tab="${list.tab}">
      ${list.rows.length === 0
        ? html`<li class="panel-home__empty">${list.q ? 'Nothing matches that search.' : EMPTY[list.tab]}</li>`
        : renderPanelRows(list.rows, list.wide)}
    </ul>
    ${list.hasMore
      ? html`<button type="button" class="btn btn--xs btn--ghost panel-home__more" data-panel-more data-offset="${String(list.offset + list.rows.length)}">Show more</button>`
      : html``}`;
}

export function renderPanelRows(rows: PanelRow[], wide = false): SafeHtml {
  return html`${rows.map(({ message: m, latest }) => html`
    <li class="${wide ? 'panel-home__row panel-home__row--wide' : 'panel-home__row'}">
      ${wide ? html`<input type="checkbox" class="panel-home__select" data-panel-select value="${m.id}" aria-label="Select “${m.title}”">` : html``}
      <button type="button" class="panel-home__thread ${m.status === 'awaiting_user' ? 'panel-home__thread--yours' : ''}" data-panel-thread-id="${m.id}">
        <span class="panel-home__thread-top">
          <span class="panel-home__thread-title">${m.title}</span>
          <span class="panel-home__thread-age">${formatAge(new Date(m.lastActivityAt ?? m.createdAt).toISOString())}</span>
        </span>
        <span class="panel-home__thread-meta">
          ${m.status === 'awaiting_user' ? html`<span class="panel-home__yours">Your turn</span>` : html``}
          ${m.agentId ? html`<span class="mono">${m.agentId}</span>` : html``}
          ${latest ? html`<span class="panel-home__latest"><span class="panel-home__who">${latest.who} ›</span> ${latest.text}</span>` : html``}
        </span>
      </button>
      ${wide
        ? html`<button type="button" class="panel-home__star ${m.starred ? 'is-on' : ''}" data-panel-star="${m.id}"
            aria-pressed="${m.starred ? 'true' : 'false'}" aria-label="Star “${m.title}”">★</button>`
        : m.starred ? html`<span class="panel-home__star is-on" title="Starred" aria-label="Starred">★</span>` : html``}
    </li>`) as unknown as SafeHtml[]}`;
}
