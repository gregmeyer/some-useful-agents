import { markdownToText, type InboxMessage, type InboxStore, type ListMessagesOpts } from '@some-useful-agents/core';
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

export interface PanelRow {
  message: InboxMessage;
  /** The latest reply, as one line of plain text. */
  latest?: { who: 'you' | 'sua' | 'system'; text: string };
}

export interface PanelList {
  tab: PanelTab;
  q: string;
  counts: Record<PanelTab, number>;
  rows: PanelRow[];
  offset: number;
  hasMore: boolean;
}

export function buildPanelList(store: InboxStore, args: { tab?: PanelTab; q?: string; offset?: number }): PanelList {
  const q = (args.q ?? '').trim().slice(0, 200);
  const counts = Object.fromEntries(PANEL_TABS.map((t) => [t, store.count({ ...tabQuery(t), q: q || undefined })])) as Record<PanelTab, number>;
  // No tab asked for: Needs you when something is waiting, else Open.
  const tab = args.tab ?? (counts.needs > 0 ? 'needs' : 'open');
  const offset = Math.max(0, Math.floor(args.offset ?? 0));
  const page = store.listPage({ ...tabQuery(tab), q: q || undefined, limit: PANEL_PAGE_SIZE, offset });
  const rows = page.rows
    // An empty "New conversation" stub isn't worth a row.
    .filter((m) => !(m.source === 'manual' && m.body === '(empty)' && m.title === 'New conversation' && !m.lastActivityAt))
    .map((message) => {
      const latest = buildRowPreview(store, message.id).latestResponse;
      return {
        message,
        latest: latest ? { who: latest.role === 'user' ? 'you' as const : latest.role === 'triage' ? 'sua' as const : 'system' as const, text: oneLine(latest.body) } : undefined,
      };
    });
  return { tab, q, counts, rows, offset, hasMore: page.hasMore };
}

function oneLine(markdown: string): string {
  return markdownToText(markdown.replace(/<plan>[\s\S]*?<\/plan>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 140);
}
