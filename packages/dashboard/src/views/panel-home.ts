import { html, type SafeHtml } from './html.js';
import { formatAge } from './components.js';
import { PANEL_TABS, PANEL_TAB_LABEL, type PanelList, type PanelRow } from '../lib/panel-inbox.js';

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
export function renderPanelHome(list: PanelList): SafeHtml {
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
        : renderPanelRows(list.rows)}
    </ul>
    ${list.hasMore
      ? html`<button type="button" class="btn btn--xs btn--ghost panel-home__more" data-panel-more data-offset="${String(list.offset + list.rows.length)}">Show more</button>`
      : html``}`;
}

export function renderPanelRows(rows: PanelRow[]): SafeHtml {
  return html`${rows.map(({ message: m, latest }) => html`
    <li>
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
    </li>`) as unknown as SafeHtml[]}`;
}
