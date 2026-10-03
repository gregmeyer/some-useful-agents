import { INBOX_SOURCES, markdownToText, type InboxMessage, type InboxSource, type InboxStore, type ListMessagesOpts } from '@some-useful-agents/core';
import { buildRowPreview } from '../routes/inbox-shared.js';

/**
 * The inbox as the conversation panel shows it (phase 3, conversations plan):
 * four tabs by what you need to do, a search, and pages of rows. The same
 * list will back /inbox at full width.
 */
export const PANEL_TABS = ['needs', 'open', 'conversations', 'done'] as const;
export type PanelTab = typeof PANEL_TABS[number];
export const PANEL_PAGE_SIZE = 25;

export const PANEL_TAB_LABEL: Record<PanelTab, string> = {
  needs: 'Needs you',
  open: 'Open',
  conversations: 'Conversations',
  done: 'Done',
};

/** What each tab lists. Conversations = threads you started with sua (agent chats join in 3c). */
function tabQuery(tab: PanelTab): ListMessagesOpts {
  switch (tab) {
    case 'needs': return { status: 'awaiting_user', sort: 'age', dir: 'asc' };
    // Statuses spelled out: a search otherwise spans finished threads too.
    case 'open': return { statuses: ['open', 'triaged', 'awaiting_user', 'verifying'], sort: 'age', dir: 'desc' };
    case 'conversations': return { sources: ['manual'], statuses: ['open', 'triaged', 'awaiting_user', 'verifying', 'resolved'], sort: 'age', dir: 'desc' };
    case 'done': return { statuses: ['resolved', 'dismissed'], sort: 'age', dir: 'desc' };
  }
}

export function parsePanelTab(raw: unknown): PanelTab | undefined {
  return typeof raw === 'string' && (PANEL_TABS as readonly string[]).includes(raw) ? raw as PanelTab : undefined;
}

/** What a thread needs from you, for its row's dot and one-word tag. */
export type PanelRowKind = 'approve' | 'answer' | 'fail';

export interface PanelRow {
  message: InboxMessage;
  kind?: PanelRowKind;
  /** The latest reply, as one line of plain text. */
  latest?: { who: 'you' | 'sua' | 'system'; text: string };
}

/** Narrowing and ordering, on Home's full-width list only (phase 3b-2). */
export interface PanelFilters {
  source?: InboxSource;
  agentId?: string;
  tag?: string;
  starred?: boolean;
  sort?: PanelSort;
}
export const PANEL_SORTS = ['recent', 'oldest', 'priority'] as const;
export type PanelSort = typeof PANEL_SORTS[number];

/** What the filter menus offer: only values that occur in the inbox. */
export interface PanelFacets {
  sources: InboxSource[];
  agentIds: string[];
  tags: string[];
}

export interface PanelList {
  tab: PanelTab;
  q: string;
  filters: PanelFilters;
  /** Home's full-width list: filters, stars and selection show. */
  wide: boolean;
  counts: Record<PanelTab, number>;
  rows: PanelRow[];
  offset: number;
  hasMore: boolean;
}

/** Read filters from a request query, keeping only values the store knows. */
export function parsePanelFilters(query: Record<string, unknown>): PanelFilters {
  const str = (k: string) => (typeof query[k] === 'string' ? (query[k] as string).trim() : '');
  const source = str('source');
  const sort = str('sort');
  return {
    source: (INBOX_SOURCES as readonly string[]).includes(source) && source !== 'conversation' ? source as InboxSource : undefined,
    agentId: str('agent') || undefined,
    tag: str('tag').toLowerCase() || undefined,
    starred: query.starred === '1' || undefined,
    sort: (PANEL_SORTS as readonly string[]).includes(sort) ? sort as PanelSort : undefined,
  };
}

/** The tab's query narrowed by the filters, or null when nothing can match. */
function withFilters(base: ListMessagesOpts, f: PanelFilters): ListMessagesOpts | null {
  const out: ListMessagesOpts = { ...base };
  if (f.source) {
    // Inside Conversations, a source filter can only keep a conversation source.
    if (out.sources && !out.sources.includes(f.source)) return null;
    delete out.sources;
    out.source = f.source;
  }
  if (f.agentId) out.agentId = f.agentId;
  if (f.tag) out.tag = f.tag;
  if (f.starred) out.starred = true;
  if (f.sort === 'recent') { out.sort = 'age'; out.dir = 'desc'; }
  else if (f.sort === 'oldest') { out.sort = 'age'; out.dir = 'asc'; }
  else if (f.sort === 'priority') { out.sort = 'priority'; out.dir = 'asc'; }
  return out;
}

export function panelFacets(store: InboxStore): PanelFacets {
  const present = new Set(store.list({ statuses: ['open', 'triaged', 'awaiting_user', 'verifying', 'resolved', 'dismissed'], limit: 1000 }).map((m) => m.source));
  return {
    sources: INBOX_SOURCES.filter((s) => s !== 'conversation' && present.has(s)),
    agentIds: store.listAllAgentIds(),
    tags: store.listAllTags(),
  };
}

export function buildPanelList(store: InboxStore, args: { tab?: PanelTab; q?: string; offset?: number; filters?: PanelFilters; wide?: boolean }): PanelList {
  const q = (args.q ?? '').trim().slice(0, 200);
  const filters = args.wide ? (args.filters ?? {}) : {};
  const query = (t: PanelTab): ListMessagesOpts | null => {
    const narrowed = withFilters(tabQuery(t), filters);
    return narrowed && { ...narrowed, q: q || undefined };
  };
  const counts = Object.fromEntries(PANEL_TABS.map((t) => {
    const qy = query(t);
    return [t, qy ? store.count(qy) : 0];
  })) as Record<PanelTab, number>;
  // No tab asked for: Needs you when something is waiting, else Open.
  const tab = args.tab ?? (counts.needs > 0 ? 'needs' : 'open');
  const offset = Math.max(0, Math.floor(args.offset ?? 0));
  const tabQ = query(tab);
  const page = tabQ ? store.listPage({ ...tabQ, limit: PANEL_PAGE_SIZE, offset }) : { rows: [], hasMore: false };
  const rows = page.rows
    // An empty "New conversation" stub isn't worth a row.
    .filter((m) => !(m.source === 'manual' && m.body === '(empty)' && m.title === 'New conversation' && !m.lastActivityAt))
    .map((message) => {
      const preview = buildRowPreview(store, message.id);
      const latest = preview.latestResponse;
      const kind: PanelRowKind | undefined =
        message.status === 'resolved' || message.status === 'dismissed' ? undefined
        : message.source === 'run-failure' || message.source === 'outcome' ? 'fail'
        : preview.proposedActions || (message.source === 'board' && message.status === 'awaiting_user') ? 'approve'
        : message.source === 'question' || message.status === 'awaiting_user' ? 'answer'
        : undefined;
      return {
        message,
        ...(kind ? { kind } : {}),
        latest: latest ? { who: latest.role === 'user' ? 'you' as const : latest.role === 'triage' ? 'sua' as const : 'system' as const, text: oneLine(latest.body) } : undefined,
      };
    });
  return { tab, q, filters, wide: Boolean(args.wide), counts, rows, offset, hasMore: page.hasMore };
}

function oneLine(markdown: string): string {
  return markdownToText(markdown.replace(/<plan>[\s\S]*?<\/plan>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 140);
}
