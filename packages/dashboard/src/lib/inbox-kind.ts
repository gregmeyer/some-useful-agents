/**
 * What an inbox row is, as a word (the inbox cleanup, DESIGN.md 2026-11-25):
 * each row and thread says its kind in a mono-caps eyebrow ("ANSWER", "DIGEST",
 * "CHAT · weather"), and its title is shown without the "Answer: " that
 * notebook conversations carry in their stored title. Pure; render-only (the
 * stored titles are unchanged, so search still matches them).
 */
import type { InboxMessage, Item } from '@some-useful-agents/core';

/** A title as shown: without the "Answer: " / "Notebook: " a notebook's conversation is stored with. */
export function displayTitle(title: string): string {
  return title.replace(/^(?:Answer|Notebook):\s*/, '');
}

const isAnswerTitle = (t: string) => /^(?:Answer|Notebook):\s/.test(t);
const isDigestTitle = (t: string) => /^Daily digest\b/.test(t);
const withAgent = (word: string, agentId?: string) => (agentId ? `${word} · ${agentId}` : word);

/** A thread's kind, from where it came from. */
export function eyebrowOf(m: Pick<InboxMessage, 'title' | 'source' | 'agentId' | 'contextJson'>): string {
  if (isAnswerTitle(m.title) || /"kind":"notebook"/.test(m.contextJson ?? '')) return 'ANSWER';
  if (isDigestTitle(m.title)) return 'DIGEST';
  switch (m.source) {
    case 'conversation': return withAgent('CHAT', m.agentId);
    case 'manual': return 'CHAT';
    case 'run-failure': return withAgent('FAILING', m.agentId);
    case 'outcome': return withAgent('MISSED', m.agentId);
    case 'permission-request': return withAgent('PERMISSION', m.agentId);
    case 'question': return withAgent('QUESTION', m.agentId);
    case 'cadence': return 'REMINDER';
    case 'system-health': return 'SYSTEM';
    case 'board': return 'BOARD';
    default: return 'CHAT';
  }
}

/** A Home item's kind (the Today tab's rows), from its id and subject. */
export function itemEyebrow(item: Pick<Item, 'id' | 'kind' | 'title' | 'subject'>): string {
  const agent = item.subject.agentId;
  if (item.id.startsWith('notebook:') || isAnswerTitle(item.title)) return 'ANSWER';
  if (isDigestTitle(item.title)) return 'DIGEST';
  if (item.id.endsWith(':failing')) return withAgent('FAILING', agent);
  if (item.id.endsWith(':outcome')) return withAgent('MISSED', agent);
  if (item.id.endsWith(':draft')) return withAgent('DRAFT', agent);
  if (item.id.startsWith('question:')) return withAgent('QUESTION', agent);
  if (item.kind === 'progress') return 'BUILDING';
  if (item.id.startsWith('thread:')) return item.kind === 'alert' ? withAgent('FAILING', agent) : 'CHAT';
  return item.kind.toUpperCase();
}

/**
 * A row's one-line preview: sua's words without "sua: " (you're in sua's
 * inbox), yours with "You: ", and a Done message as its counts
 * ("Done · 7 options · 4 sources · one step is yours").
 */
export function previewLine(latest: { who: 'you' | 'sua' | 'system'; text: string } | undefined): string {
  if (!latest) return '';
  if (latest.who === 'you') return `You: ${latest.text}`;
  const done = /^Done(?::\s*(.*?))?\.(\s*One step is yours: ([^.]+)\.)?/.exec(latest.text);
  if (done) {
    const counts = (done[1] ?? '').split(/,\s*/).filter(Boolean).map((c) => c.replace(/ found on (?:its|their) pages?/, ' found'));
    return ['Done', ...counts, ...(done[3] ? ['one step is yours'] : [])].join(' · ');
  }
  return latest.text;
}
