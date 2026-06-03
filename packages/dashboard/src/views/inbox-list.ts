import { markdownToText, type InboxMessage, type InboxPriority, type InboxResponseRole, type InboxSource, type InboxStatus } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { formatAge, humanizeTimestamps } from './components.js';
import { renderInboxModalShell } from './inbox-modal.js';

/**
 * /inbox — Linear-meets-Slack productivity surface.
 *
 * Layout:
 *   [page header — title + filter + "+ New conversation" button]
 *   [Suggested next actions banner — collapsible]
 *   [two-col grid]
 *     ├─ left rail (collapsible): starred threads, ordered by recency
 *     └─ main: priority-grouped list of gridded rows with inline preview
 *
 * Row click opens the existing modal (no nav). Chevron on each row
 * toggles an inline preview (body excerpt + "open thread") so the
 * operator can triage without leaving the page.
 */

// Sort keys are kept for backward compatibility — the route still
// parses them and the type union is referenced by the route file —
// but the redesigned list groups by priority and orders within groups
// by createdAt DESC, so the operator-visible sort is fixed.
export type InboxSortKey = 'priority' | 'source' | 'agent' | 'title' | 'age' | 'status';
export type InboxSortDir = 'asc' | 'desc';

export interface InboxListOptions {
  rows: InboxMessage[];
  sort: InboxSortKey;
  dir: InboxSortDir;
  flash?: { kind: 'error' | 'info' | 'ok'; message: string };
  filter?: { q: string; starred: boolean; tag: string };
  allTags?: string[];
  /**
   * Count of messages in terminal states (dismissed + resolved). Used
   * by the empty-state copy to acknowledge recent cleanup work and
   * to render the "View archive" footer link. Defaults to 0 when the
   * route doesn't pass it.
   */
  terminalCount?: number;
  /**
   * When set, the view is showing the archive (dismissed/resolved
   * rows) instead of the active inbox. The header renders a
   * "Showing <status> · ← Active inbox" chip + the empty state copy
   * changes. The list itself comes from the route's filtered query.
   */
  archiveView?: 'dismissed' | 'resolved';
  /**
   * Per-row preview payload, keyed by message id. Powers the
   * activity-strip preview in the row's expanded state — latest
   * conversation excerpt + count of proposed action cards. The
   * route computes these in one pass when rendering the list to
   * avoid N+1 from the view side. Rows without an entry get the
   * legacy "no replies yet" empty preview.
   */
  previewPayloads?: Map<string, InboxRowPreviewPayload>;
}

/** Compact preview-strip payload for one row. See renderRow. */
export interface InboxRowPreviewPayload {
  /** Most recent non-action response, or undefined when none exists. */
  latestResponse?: {
    role: InboxResponseRole;
    body: string;
    createdAt: number;
  };
  /**
   * Count + first-agent summary of proposed action cards on the
   * thread. Drives the "1 proposed action: agent-X" pill in the
   * preview strip.
   */
  proposedActions?: {
    count: number;
    firstAgentId?: string;
  };
}

export const INBOX_DEFAULT_SORT: { sort: InboxSortKey; dir: InboxSortDir } = {
  sort: 'priority',
  dir: 'asc',
};

const SOURCE_LABEL: Record<InboxSource, string> = {
  'run-failure': 'Run failure',
  'permission-request': 'Permission',
  'cadence': 'Cadence',
  'manual': 'Manual',
};

const PRIORITY_LABEL: Record<InboxPriority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const PRIORITY_BADGE: Record<InboxPriority, string> = {
  high: 'badge--warn',
  medium: 'badge--info',
  low: 'badge--muted',
};

/**
 * Role labels for the activity-strip preview. Matches the modal's
 * ROLE_LABEL in inbox-detail.ts but kept local to avoid an import
 * cycle. Action role intentionally omitted — the activity strip
 * excludes action-card responses; pending actions get their own
 * summary chip.
 */
const PREVIEW_ROLE_LABEL: Partial<Record<InboxResponseRole, string>> = {
  user: 'You',
  triage: 'Triage',
  system: 'System',
};

const PREVIEW_ROLE_AVATAR: Partial<Record<InboxResponseRole, string>> = {
  user: 'You',
  triage: 'Tri',
  system: 'Sys',
};

/** Max characters in the always-visible one-line row preview. */
const PREVIEW_LINE_CAP = 120;

/**
 * Reduce a (Markdown) message body to a clean one-line snippet for list
 * previews: strip Markdown to plain text, humanize bare ISO timestamps, then
 * truncate at a word boundary. Keeps the inbox skimmable without raw `**`/`](`
 * syntax leaking through.
 */
function cleanSnippet(body: string, cap: number): string {
  return excerpt(humanizeTimestamps(markdownToText(body)), cap);
}

/**
 * Human labels for the inbox-status enum. The raw snake_case values
 * (e.g. `awaiting_user`) read as database values, not UI copy —
 * operators are skimming, not parsing. "Your turn" is the
 * load-bearing label: it's the only status that demands action, so
 * it gets distinct copy + the loudest badge variant.
 */
const STATUS_LABEL: Record<InboxStatus, string> = {
  open: 'Open',
  triaged: 'Triaged',
  awaiting_user: 'Your turn',
  verifying: 'Verifying',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
};

/**
 * Visual hierarchy: "Your turn" is the row that needs a click, so it
 * gets the warn (amber) chip. Verifying gets info (blue) so the
 * operator can spot in-flight work. Everything else is muted — the
 * eye sweeps past them. Terminal statuses (resolved/dismissed) get
 * the ok green if they ever land on this list.
 */
const STATUS_BADGE: Record<InboxStatus, string> = {
  open: 'badge--muted',
  triaged: 'badge--muted',
  awaiting_user: 'badge--warn',
  verifying: 'badge--info',
  resolved: 'badge--ok',
  dismissed: 'badge--muted',
};

/**
 * Lightweight rules for the suggested-actions banner. Pure functions
 * over the loaded rows — no LLM call, no I/O. Deterministic so
 * operators can predict what they'll see.
 */
function buildSuggestions(rows: InboxMessage[]): Array<{ label: string; count: number; href?: string; tag: string }> {
  const out: Array<{ label: string; count: number; href?: string; tag: string }> = [];
  const open = rows.filter((r) => r.status === 'open' || r.status === 'triaged');
  const highOpen = open.filter((r) => r.priority === 'high');
  const untriaged = open.filter((r) => r.status === 'open');
  const awaiting = rows.filter((r) => r.status === 'awaiting_user');

  if (highOpen.length > 0) {
    out.push({
      label: `Resolve high-priority items`,
      count: highOpen.length,
      tag: 'high-priority',
      href: highOpen[0] ? `#row-${highOpen[0].id}` : undefined,
    });
  }
  if (untriaged.length > 0) {
    out.push({
      label: `Triage untriaged messages`,
      count: untriaged.length,
      tag: 'untriaged',
      href: untriaged[0] ? `#row-${untriaged[0].id}` : undefined,
    });
  }
  if (awaiting.length > 0) {
    out.push({
      label: `Reply to triage`,
      count: awaiting.length,
      tag: 'awaiting',
      href: awaiting[0] ? `#row-${awaiting[0].id}` : undefined,
    });
  }
  return out;
}

export function renderInboxList(opts: InboxListOptions): string {
  const rows = opts.rows;
  const filter = opts.filter ?? { q: '', starred: false, tag: '' };
  const allTags = opts.allTags ?? [];
  const terminalCount = opts.terminalCount ?? 0;
  const archiveView = opts.archiveView;

  const starredAll = rows.filter((r) => r.starred);
  const suggestions = archiveView ? [] : buildSuggestions(rows);
  const previewPayloads = opts.previewPayloads ?? new Map<string, InboxRowPreviewPayload>();

  const filterBar = renderFilterBar(filter, allTags);
  const suggestBanner = archiveView
    ? renderArchiveHeader(archiveView, rows.length)
    : renderSuggestBanner(suggestions, rows.length, terminalCount);
  const rail = renderRail(starredAll);
  const main = renderMain(rows, opts.sort, opts.dir, filter, previewPayloads);
  const archiveLink = !archiveView && terminalCount > 0
    ? html`
      <div class="inbox-archive-footer">
        <a href="/inbox?status=dismissed" class="inbox-archive-footer__link">
          View ${terminalCount} dismissed / resolved →
        </a>
      </div>
    `
    : html``;

  const body = html`
    <div class="inbox-page-head">
      <div>
        <h1 style="margin: 0; font-family: var(--font-mono); font-size: var(--font-size-xl);">Inbox</h1>
        <p class="dim" style="margin: var(--space-1) 0 0; font-size: var(--font-size-sm);">
          Conversations that need your attention. Click a row to open, or the chevron for full detail.
        </p>
      </div>
      <div class="inbox-page-head__actions">
        ${filterBar}
        <button type="button" id="inbox-new-conversation" class="btn btn--primary inbox-new-btn">
          <span aria-hidden="true">+</span> New conversation
        </button>
      </div>
    </div>

    ${suggestBanner}

    <div class="inbox-shell" id="inbox-shell">
      ${rail}
      <div class="inbox-main">
        ${main}
        ${archiveLink}
      </div>
    </div>

    ${renderInboxModalShell()}
  `;

  return render(layout({ title: 'Inbox', activeNav: 'inbox', flash: opts.flash }, body));
}

/**
 * Archive view header: replaces the suggested-actions banner when the
 * operator is browsing dismissed / resolved rows. Includes a back link
 * to the active inbox and a row count.
 */
function renderArchiveHeader(status: 'dismissed' | 'resolved', count: number): SafeHtml {
  const label = status === 'dismissed' ? 'Dismissed' : 'Resolved';
  return html`
    <div class="inbox-suggest inbox-suggest--archive" id="inbox-suggest">
      <div class="inbox-suggest__head">
        <span class="inbox-suggest__title">${label}</span>
        <a href="/inbox" class="inbox-archive-back">← Active inbox</a>
      </div>
      <div class="inbox-suggest__items">
        <span style="font-size: var(--font-size-sm); color: var(--color-text-muted);">
          ${count === 0
            ? html`No ${status} messages.`
            : html`Showing ${count} ${status} message${count === 1 ? '' : 's'}. These are read-only — reopen by replying from the modal.`}
        </span>
      </div>
    </div>
  `;
}

function renderFilterBar(filter: { q: string; starred: boolean; tag: string }, allTags: string[]): SafeHtml {
  const tagOptions = allTags.map((t) => html`
    <option value="${t}" ${filter.tag === t ? 'selected' : ''}>#${t}</option>
  `);
  const hasFilter = !!filter.q || filter.starred || !!filter.tag;
  // Inline toolbar: chips for Starred + Tag, search with inline clear,
  // autosubmit on change/Enter. No card border, no Apply button — the
  // form posts itself via JS (see inbox-modal.js.ts toolbar handler).
  return html`
    <form class="inbox-toolbar" method="GET" action="/inbox" role="search" data-inbox-toolbar>
      <div class="inbox-toolbar__search">
        <span class="inbox-toolbar__search-icon" aria-hidden="true">⌕</span>
        <input type="text" name="q" value="${filter.q}" placeholder="Search messages…"
          class="inbox-toolbar__q" data-inbox-toolbar-q>
        ${filter.q ? html`<button type="button" class="inbox-toolbar__clear" data-inbox-toolbar-clear aria-label="Clear search">×</button>` : html``}
      </div>
      <label class="inbox-chip ${filter.starred ? 'inbox-chip--active' : ''}" data-inbox-chip>
        <input type="checkbox" name="starred" value="1" ${filter.starred ? 'checked' : ''} data-inbox-toolbar-submit>
        <span aria-hidden="true">★</span> Starred
      </label>
      <label class="inbox-chip inbox-chip--select ${filter.tag ? 'inbox-chip--active' : ''}">
        <span class="inbox-chip__icon" aria-hidden="true">#</span>
        <select name="tag" class="inbox-chip__select" data-inbox-toolbar-submit>
          <option value="">tags</option>
          ${tagOptions as unknown as SafeHtml[]}
        </select>
      </label>
      ${hasFilter ? html`<a class="inbox-toolbar__reset" href="/inbox" aria-label="Clear all filters">Reset</a>` : html``}
    </form>
  `;
}

function renderSuggestBanner(suggestions: Array<{ label: string; count: number; href?: string; tag: string }>, totalRows: number, terminalCount: number): SafeHtml {
  if (totalRows === 0) {
    // When the active inbox is empty AND there's a terminal-state
    // history, acknowledge the cleanup so the operator can see "yes,
    // your dismiss landed" and offers a path back to the archive.
    // Without terminal history this is a truly empty inbox — show
    // the original "Nothing in your inbox" copy.
    if (terminalCount > 0) {
      return html`
        <div class="inbox-suggest inbox-suggest--clean" id="inbox-suggest">
          <div class="inbox-suggest__head">
            <span class="inbox-suggest__title">Inbox cleared ✨</span>
          </div>
          <div class="inbox-suggest__items">
            <span style="font-size: var(--font-size-sm); color: var(--color-text-muted);">
              Nothing active. ${terminalCount} message${terminalCount === 1 ? '' : 's'} in your archive —
              <a href="/inbox?status=dismissed" class="inbox-archive-back">view archive</a>
              or <strong>+ New conversation</strong> to start fresh.
            </span>
          </div>
        </div>
      `;
    }
    return html`
      <div class="inbox-suggest inbox-suggest--clean" id="inbox-suggest">
        <div class="inbox-suggest__head">
          <span class="inbox-suggest__title">All clear ✨</span>
        </div>
        <div class="inbox-suggest__items">
          <span style="font-size: var(--font-size-sm); color: var(--color-text-muted);">
            Nothing in your inbox. Click <strong>+ New conversation</strong> to start one with the triage agent.
          </span>
        </div>
      </div>
    `;
  }
  if (suggestions.length === 0) {
    return html`
      <div class="inbox-suggest inbox-suggest--clean" id="inbox-suggest">
        <div class="inbox-suggest__head">
          <span class="inbox-suggest__title">Nothing pressing</span>
          <button type="button" class="inbox-suggest__toggle" data-inbox-suggest-toggle aria-expanded="true">Hide</button>
        </div>
        <div class="inbox-suggest__items">
          <span style="font-size: var(--font-size-sm); color: var(--color-text-muted);">
            All ${totalRows} items are resolved or dismissed. Browse below if you want to revisit.
          </span>
        </div>
      </div>
    `;
  }
  const items = suggestions.map((s) => html`
    <a class="inbox-suggest__item" href="${s.href ?? '#'}" data-inbox-suggest-tag="${s.tag}">
      <span class="inbox-suggest__count">${s.count}</span>
      <span>${s.label}</span>
    </a>
  `);
  return html`
    <div class="inbox-suggest" id="inbox-suggest">
      <div class="inbox-suggest__head">
        <span class="inbox-suggest__title">⚡ Suggested next actions</span>
        <button type="button" class="inbox-suggest__toggle" data-inbox-suggest-toggle aria-expanded="true">Hide</button>
      </div>
      <div class="inbox-suggest__items">
        ${items as unknown as SafeHtml[]}
      </div>
    </div>
  `;
}

function renderRail(starred: InboxMessage[]): SafeHtml {
  const items = starred.length === 0
    ? html`<div class="inbox-rail__empty">No starred threads yet. Star a thread to pin it here.</div>`
    : html`
      <div class="inbox-rail__items">
        ${starred.map((m) => html`
          <a class="inbox-rail__item" href="/inbox/${m.id}" data-inbox-rail-id="${m.id}">
            <div class="inbox-rail__item-title">${m.title}</div>
            <div class="inbox-rail__item-meta">
              <span class="badge ${PRIORITY_BADGE[m.priority]}" style="font-size: 10px; padding: 1px 4px;">${m.priority}</span>
              <span>${formatAge(new Date(m.createdAt).toISOString())}</span>
            </div>
          </a>
        `) as unknown as SafeHtml[]}
      </div>
    ` as unknown as SafeHtml;

  return html`
    <aside class="inbox-rail" id="inbox-rail" aria-label="Favorited threads">
      <div class="inbox-rail__head">
        <span>★ Favorited</span>
        <button type="button" class="inbox-rail__toggle" data-inbox-rail-toggle aria-label="Collapse rail">‹</button>
      </div>
      ${items}
    </aside>
  `;
}

function renderMain(rows: InboxMessage[], sort: InboxSortKey, dir: InboxSortDir, filter: { q: string; starred: boolean; tag: string }, previewPayloads: Map<string, InboxRowPreviewPayload>): SafeHtml {
  if (rows.length === 0) {
    return html`
      <div class="card" style="padding: var(--space-6); text-align: center; color: var(--color-text-muted);">
        <p style="margin: 0 0 var(--space-2);">No matches.</p>
        <p style="margin: 0; font-size: var(--font-size-sm);">
          Adjust the filter, clear it, or start a fresh conversation with the + button above.
        </p>
      </div>
    `;
  }
  // Flat sortable list. The priority-group cards are gone — the
  // priority dot on each row + the (sorted) order carry the
  // urgency cue without the structural overhead.
  return html`
    <div class="inbox-list" role="table">
      ${renderListHeader(sort, dir, filter)}
      ${rows.map((m) => renderRow(m, previewPayloads.get(m.id))) as unknown as SafeHtml[]}
    </div>
  `;
}

/**
 * Sticky column header for the flat list. Each column is a sort link
 * that flips direction on click; the active column shows an arrow
 * indicator. The grid template mirrors the row's so the labels sit
 * directly above their cells.
 *
 * The chevron and star columns get no label (they're per-row
 * affordances, not data dimensions).
 */
function renderListHeader(sort: InboxSortKey, dir: InboxSortDir, filter: { q: string; starred: boolean; tag: string }): SafeHtml {
  const link = (key: InboxSortKey, label: string, defaultDir: InboxSortDir = 'desc'): SafeHtml => {
    const isActive = sort === key;
    // Active column: click flips direction. Inactive: jump to the
    // column's natural direction (desc for priority/age/status,
    // asc for title/agent so the alphabetical sort feels intuitive).
    const nextDir: InboxSortDir = isActive ? (dir === 'desc' ? 'asc' : 'desc') : defaultDir;
    const params = new URLSearchParams();
    params.set('sort', key);
    params.set('dir', nextDir);
    if (filter.q) params.set('q', filter.q);
    if (filter.starred) params.set('starred', '1');
    if (filter.tag) params.set('tag', filter.tag);
    const href = `/inbox?${params.toString()}`;
    const arrow = isActive
      ? (dir === 'desc' ? html`<span class="inbox-list__sort-arrow" aria-hidden="true">↓</span>` : html`<span class="inbox-list__sort-arrow" aria-hidden="true">↑</span>`)
      : html``;
    return html`<a class="inbox-list__sort ${isActive ? 'inbox-list__sort--active' : ''}" href="${href}" data-inbox-row-stop>${label}${arrow}</a>`;
  };
  return html`
    <div class="inbox-list__header" role="row">
      <span></span>
      <span role="columnheader">${link('priority', 'Priority', 'asc')}</span>
      <span role="columnheader" class="inbox-list__header-title">${link('title', 'Title', 'asc')}</span>
      <span role="columnheader">${link('agent', 'Agent', 'asc')}</span>
      <span role="columnheader">${link('status', 'Status', 'asc')}</span>
      <span role="columnheader">${link('age', 'Age', 'desc')}</span>
      <span></span>
      <span></span>
    </div>
  `;
}

/**
 * One row in the flat list.
 *
 * Left side: priority dot + title (+ inline tag chips).
 * Right side: agent · status · age · star · chevron.
 *
 * Operators read content on the left and act on the right — the
 * star and chevron sit next to the metadata that informs their
 * decisions. Removed the "—" placeholder for missing agents: empty
 * space reads as "no agent" without adding ink.
 *
 * The expanded preview replaces the old body-only excerpt with an
 * activity strip that shows the most recent triage/user/system
 * reply + a pending-actions summary. See renderPreview.
 */
function renderRow(m: InboxMessage, preview: InboxRowPreviewPayload | undefined): SafeHtml {
  const tagChips = m.tags.length === 0
    ? html``
    : html`<span class="inbox-row2__tags">${m.tags.map((t) => html`<span class="inbox-tag-chip">${t}</span>`) as unknown as SafeHtml[]}</span>`;
  // Agent + run link, rendered only when present. Mono is reserved
  // for ids; the cell is empty (zero-width) when no agent.
  const agentRunCell = (m.agentId || m.runId)
    ? html`
      <span class="inbox-row2__agent">
        ${m.agentId ? html`<a href="/agents/${m.agentId}" class="inbox-modal__link mono" data-inbox-row-stop>${m.agentId}</a>` : html``}
        ${m.agentId && m.runId ? html`<span class="inbox-modal__sep">·</span>` : html``}
        ${m.runId ? html`<a href="/runs/${m.runId}" class="inbox-modal__link mono" data-inbox-row-stop>${m.runId.slice(0, 8)}</a>` : html``}
      </span>
    `
    : html`<span class="inbox-row2__agent" aria-hidden="true"></span>`;
  // Age cell uses lastActivityAt when present; falls back to
  // createdAt for rows where the store didn't compute the join
  // (e.g. single-message reads). The hover title shows both so the
  // operator can disambiguate "old thread, recently bumped" vs
  // "old thread, untouched."
  const ageAt = m.lastActivityAt ?? m.createdAt;
  const ageTitle = m.lastActivityAt && m.lastActivityAt !== m.createdAt
    ? `created ${formatAge(new Date(m.createdAt).toISOString())} · last activity ${formatAge(new Date(m.lastActivityAt).toISOString())}`
    : `created ${formatAge(new Date(m.createdAt).toISOString())}`;
  return html`
    <div class="inbox-row2" data-inbox-row-id="${m.id}" id="row-${m.id}" role="row" data-inbox-status="${m.status}">
      <span class="inbox-modal__priority inbox-modal__priority--${m.priority}" title="${m.priority} priority"></span>
      <span class="inbox-row2__title" role="cell">
        <a href="/inbox/${m.id}" data-inbox-row-link class="inbox-row2__title-text">${m.title}</a>
        ${tagChips}
      </span>
      ${agentRunCell}
      <span class="inbox-row2__status" role="cell">
        <span class="badge ${STATUS_BADGE[m.status]}">${STATUS_LABEL[m.status]}</span>
      </span>
      <span class="inbox-row2__age dim" role="cell" title="${ageTitle}">${formatAge(new Date(ageAt).toISOString())}</span>
      <form method="POST" action="/inbox/${m.id}/star" data-inbox-row-stop data-inbox-star-form style="margin: 0;">
        <input type="hidden" name="starred" value="${m.starred ? '0' : '1'}">
        <button type="submit" class="inbox-star ${m.starred ? 'inbox-star--on' : ''}" aria-label="${m.starred ? 'Unstar' : 'Star'}">★</button>
      </form>
      <button type="button" class="inbox-row2__chevron" data-inbox-row-chevron
        aria-label="Toggle details" aria-expanded="false">›</button>

      ${renderPreviewLine(m, preview)}
      ${renderPreview(m, preview)}
    </div>
  `;
}

/**
 * Expanded preview — the "activity strip." Replaces the old
 * body-only excerpt with the actual conversation signal:
 *
 *   1. Latest non-action response (triage / user / system) with
 *      avatar + role + first ~160 chars.
 *   2. Pending-actions summary when triage has proposed something.
 *   3. Context payload disclosure (only when present).
 *   4. Tag chips moved here from the collapsed row.
 *   5. Right-aligned footer: Open thread → · Source · age.
 *
 * Empty cases:
 *   - Manual conversation with no replies → italic "No replies yet"
 *     hint + Open thread CTA. The "(empty)" body sentinel from the
 *     store's NOT NULL workaround is suppressed (mirrors the modal
 *     fragment renderer in inbox-detail.ts).
 *   - Body that isn't "(empty)" but no responses → fall back to the
 *     legacy body excerpt so producers that seed real body text
 *     still get a useful preview.
 */
/**
 * Always-visible one-line activity preview under the row title. Shows the
 * latest non-action response (avatar + role + clean snippet); falls back to a
 * proposed-action hint, then a muted "no replies" note. Lets the operator skim
 * the whole inbox without expanding each row.
 */
function renderPreviewLine(m: InboxMessage, preview: InboxRowPreviewPayload | undefined): SafeHtml {
  const latest = preview?.latestResponse;
  const proposed = preview?.proposedActions;
  if (latest) {
    return html`
      <div class="inbox-row2__preview-line" role="cell">
        <span class="inbox-msg__avatar inbox-msg__avatar--${latest.role} inbox-row2__preview-avatar">${PREVIEW_ROLE_AVATAR[latest.role] ?? latest.role.slice(0, 3)}</span>
        <span class="inbox-row2__preview-role">${PREVIEW_ROLE_LABEL[latest.role] ?? latest.role}</span>
        <span class="inbox-row2__preview-snippet">${cleanSnippet(latest.body, PREVIEW_LINE_CAP)}</span>
      </div>
    `;
  }
  if (proposed && proposed.count > 0) {
    return html`
      <div class="inbox-row2__preview-line inbox-row2__preview-line--hint" role="cell">
        <span class="inbox-row2__preview-snippet dim">▸ ${proposed.count} proposed action${proposed.count === 1 ? '' : 's'}${proposed.firstAgentId ? html` · <span class="mono">${proposed.firstAgentId}</span>` : html``}</span>
      </div>
    `;
  }
  const trimmedBody = m.body.trim();
  const hasMeaningfulBody = trimmedBody.length > 0 && trimmedBody !== '(empty)';
  const text = hasMeaningfulBody ? cleanSnippet(m.body, PREVIEW_LINE_CAP) : 'No replies yet';
  return html`
    <div class="inbox-row2__preview-line inbox-row2__preview-line--hint" role="cell">
      <span class="inbox-row2__preview-snippet dim">${text}</span>
    </div>
  `;
}

function renderPreview(m: InboxMessage, preview: InboxRowPreviewPayload | undefined): SafeHtml {
  const latest = preview?.latestResponse;
  const proposed = preview?.proposedActions;

  // The latest-response snippet is now shown always-on in the row preview line
  // (renderPreviewLine); the expanded panel carries the "extras" — full
  // timestamp on the latest entry, proposed actions, context payload, tags, and
  // the Open-thread CTA. When there are no replies at all, surface a hint.
  const activityBlock = latest
    ? html`
      <div class="inbox-row2__activity-meta">
        <span class="inbox-row2__activity-role">${PREVIEW_ROLE_LABEL[latest.role] ?? latest.role}</span>
        <span class="dim">${formatAge(new Date(latest.createdAt).toISOString())}</span>
      </div>
    `
    : html`<div class="inbox-row2__no-activity dim">No replies yet. Open the thread to start the conversation.</div>`;

  const actionsBlock = proposed && proposed.count > 0
    ? html`
      <div class="inbox-row2__action-summary">
        <span class="inbox-row2__action-summary-icon" aria-hidden="true">▸</span>
        ${proposed.count} proposed action${proposed.count === 1 ? '' : 's'}${proposed.firstAgentId ? html`: <span class="mono">${proposed.firstAgentId}</span>` : html``}
      </div>
    `
    : html``;

  const contextBlock = m.contextJson
    ? html`
      <details class="inbox-row2__context">
        <summary>Context payload</summary>
        <pre class="mono">${tryPretty(m.contextJson)}</pre>
      </details>
    `
    : html``;

  const tagsBlock = m.tags.length > 0
    ? html`
      <div class="inbox-row2__preview-tags">
        ${m.tags.map((t) => html`<span class="inbox-tag-chip">${t}</span>`) as unknown as SafeHtml[]}
      </div>
    `
    : html``;

  return html`
    <div class="inbox-row2__preview" data-inbox-row-preview>
      ${activityBlock}
      ${actionsBlock}
      ${contextBlock}
      <div class="inbox-row2__preview-footer">
        ${tagsBlock}
        <span class="inbox-row2__preview-footer-spacer"></span>
        <a href="/inbox/${m.id}" class="btn btn--sm btn--primary" data-inbox-row-link>Open thread →</a>
        <span class="dim inbox-row2__preview-source">${SOURCE_LABEL[m.source]}</span>
      </div>
    </div>
  `;
}

/** Truncate to N chars at a word boundary; appends ellipsis when cut. */
function excerpt(raw: string, cap: number): string {
  const s = raw.trim();
  if (s.length <= cap) return s;
  const cut = s.slice(0, cap);
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = lastSpace > cap * 0.6 ? cut.slice(0, lastSpace) : cut;
  return trimmed + '…';
}

function tryPretty(raw: string): string {
  try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
}
