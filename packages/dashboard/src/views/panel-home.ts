import { html, type SafeHtml } from './html.js';
import { formatAge } from './components.js';
import { PANEL_TABS, PANEL_TAB_LABEL, type PanelFacets, type PanelFilters, type PanelList, type PanelRow } from '../lib/panel-inbox.js';

/** Starting points for a new conversation. Clicking one fills the box; nothing sends until you do. */
const SUGGESTIONS = [
  'What needs me today?',
  'What failed overnight?',
  'Build me a board for my evenings',
];

const EMPTY: Record<PanelList['tab'], string> = {
  needs: 'Nothing is waiting on you.',
  open: 'No open threads.',
  conversations: 'You haven’t asked sua anything yet.',
  done: 'Nothing finished yet.',
};

const TAB_SHORT: Record<PanelList['tab'], string> = { needs: 'Needs you', open: 'Open', conversations: 'Chats', done: 'Done' };
const KIND_TAG: Record<NonNullable<PanelRow['kind']>, string> = { approve: 'Approve', answer: 'Answer', fail: 'Failing' };

const SEARCH_ICON = html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path></svg>`;
const SEND_ICON = html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"></path></svg>`;

/**
 * The inbox in the drawer and on Home (`GET /panel/home`; mockup screen 15).
 * One field searches as you type and asks sua on Enter; a segmented control
 * picks the tab; rows are grouped by what they need from you. Picking a row
 * opens it; "+" starts a new conversation (`GET /panel/new`). The list part is
 * also served alone (`GET /panel/list`) for tab switches, search and paging.
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
  return html`
    <div class="panel-home" data-panel-home>
      <label class="panel-search">
        ${SEARCH_ICON}
        <input type="search" placeholder="Search or ask sua…" aria-label="Search your inbox, or press Enter to ask sua"
          value="${list.q}" data-panel-search autocomplete="off" enterkeyhint="send">
        <kbd class="panel-search__key" data-panel-key>⌘K</kbd>
      </label>
      <button type="button" class="panel-askrow" data-panel-askrow hidden>
        <span class="panel-askrow__label">Ask sua</span><span class="panel-askrow__text">“<span data-panel-askrow-text></span>”</span><kbd>↵</kbd>
      </button>
      ${list.wide && facets ? renderFilters(list.filters, facets) : html``}
      <div data-panel-list>${renderPanelList(list)}</div>
      ${list.wide ? html`` : html`<footer class="panel-home__foot"><span>Kept in your inbox · follows you between pages</span><a href="/">Open full inbox</a></footer>`}
    </div>`;
}

/** "+": a fresh conversation (mockup screen 18). The box posts to /inbox/new and opens the new thread here. */
export function renderPanelNew(): SafeHtml {
  return html`
    <div class="panel-new" data-panel-new-view>
      <div class="panel-new__intro">
        <p class="panel-new__title">What should sua do?</p>
        <p class="panel-new__sub">It can see the page you're on. Ask about it, or have sua run, build or fix something.</p>
        <div class="panel-new__starters">
          ${SUGGESTIONS.map((s) => html`<button type="button" class="panel-new__starter" data-panel-ask="${s}">${s}</button>`) as unknown as SafeHtml[]}
        </div>
      </div>
      <form class="panel-composer" method="POST" action="/inbox/new" data-home-ask>
        <textarea name="body" rows="2" required maxlength="8192" placeholder="Ask sua…" aria-label="Ask sua"
          class="panel-composer__input" data-home-ask-input data-panel-composer></textarea>
        <button type="submit" class="panel-composer__send" aria-label="Send" data-home-ask-send>${SEND_ICON}</button>
      </form>
    </div>`;
}

/** Tabs and rows: the part that changes with tab, search and paging. */
export function renderPanelList(list: PanelList): SafeHtml {
  return html`
    <div class="panel-tabs" role="tablist" aria-label="Inbox" data-panel-tabs>
      ${PANEL_TABS.map((t) => html`
        <button type="button" role="tab" class="panel-tabs__tab" data-panel-tab="${t}" aria-selected="${t === list.tab ? 'true' : 'false'}" title="${PANEL_TAB_LABEL[t]}">
          ${TAB_SHORT[t]}${list.counts[t] > 0 ? html`<span class="panel-tabs__count ${t === 'needs' ? 'panel-tabs__count--needs' : ''}">${String(list.counts[t])}</span>` : html``}
        </button>`) as unknown as SafeHtml[]}
    </div>
    <div class="panel-home__groups" role="tabpanel" data-panel-rows data-tab="${list.tab}">
      ${list.rows.length === 0
        ? html`<p class="panel-home__empty">${list.q ? 'Nothing matches. Press Enter to ask sua instead.' : EMPTY[list.tab]}</p>`
        : renderPanelRows(list.rows, list.wide, list.offset === 0 ? list.tab : undefined)}
    </div>
    ${list.hasMore
      ? html`<button type="button" class="btn btn--xs btn--ghost panel-home__more" data-panel-more data-offset="${String(list.offset + list.rows.length)}">Show more</button>`
      : html``}`;
}

/** Group headings: what a thread needs on Needs you, when it last moved on the others. */
function groupOf(row: PanelRow, tab: PanelList['tab'], now: number): string {
  if (tab === 'needs') return row.kind === 'fail' ? 'Keeps failing' : 'Waiting on you';
  const at = row.message.lastActivityAt ?? row.message.createdAt;
  return now - at < 24 * 3600_000 ? 'Today' : now - at < 7 * 24 * 3600_000 ? 'This week' : 'Earlier';
}

/** Rows, grouped under headings when `groupBy` is given (the first page); "Show more" appends bare rows. */
export function renderPanelRows(rows: PanelRow[], wide = false, groupBy?: PanelList['tab']): SafeHtml {
  const now = Date.now();
  const row = ({ message: m, latest, kind }: PanelRow) => html`
    <li class="panel-row ${wide ? 'panel-row--wide' : ''}">
      ${wide ? html`<input type="checkbox" class="panel-row__select" data-panel-select value="${m.id}" aria-label="Select “${m.title}”">` : html``}
      <button type="button" class="panel-row__main" data-panel-thread-id="${m.id}">
        <span class="panel-row__dot ${kind ? `panel-row__dot--${kind}` : ''}" aria-hidden="true"></span>
        <span class="panel-row__title ${kind ? 'is-strong' : ''}">${m.title}</span>
        <span class="panel-row__age">${formatAge(new Date(m.lastActivityAt ?? m.createdAt).toISOString())}</span>
        <span class="panel-row__latest">${latest ? html`${latest.who === 'you' ? 'You: ' : latest.who === 'sua' ? 'sua: ' : ''}${latest.text}` : html`${m.agentId ?? ''}`}</span>
        <span class="panel-row__tag ${kind ? `panel-row__tag--${kind}` : ''}">${kind ? KIND_TAG[kind] : ''}</span>
      </button>
      ${wide
        ? html`<button type="button" class="panel-home__star ${m.starred ? 'is-on' : ''}" data-panel-star="${m.id}"
            aria-pressed="${m.starred ? 'true' : 'false'}" aria-label="Star “${m.title}”">★</button>`
        : m.starred ? html`<span class="panel-home__star is-on" title="Starred" aria-label="Starred">★</span>` : html``}
    </li>`;
  if (!groupBy) return html`${rows.map(row) as unknown as SafeHtml[]}`;
  const groups: Array<{ label: string; rows: PanelRow[] }> = [];
  for (const r of rows) {
    const label = groupOf(r, groupBy, now);
    const g = groups.find((x) => x.label === label);
    if (g) g.rows.push(r); else groups.push({ label, rows: [r] });
  }
  return html`${groups.map((g) => html`
    <section class="panel-group">
      <h3 class="panel-group__label">${g.label}</h3>
      <ul class="panel-group__rows" data-panel-group>${g.rows.map(row) as unknown as SafeHtml[]}</ul>
    </section>`) as unknown as SafeHtml[]}`;
}
