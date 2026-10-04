/**
 * "Make this a rule?" (goal surfaces S4): after you pin, move or hide one
 * item by hand, offer the rule that would do the same for everything like it.
 * Returns the addRule op to send, or nothing when there's no clear rule (or
 * the surface already has it).
 */
import type { Item, SurfaceDoc, SurfaceOp, SurfaceRule } from '@some-useful-agents/core';

export interface RuleSuggestion {
  /** The question, e.g. "Always put failing agents first?" */
  question: string;
  op: Extract<SurfaceOp, { op: 'addRule' }>;
}

/** What kind of thing an item is, for a rule: its match, and a plural name. */
function likeThis(item: Item): { key: string; match: SurfaceRule['match']; name: string } | undefined {
  if (item.id.endsWith(':failing')) return { key: 'failing', match: { idPrefix: 'agent:', kinds: ['alert'] }, name: 'failing agents' };
  if (item.id.endsWith(':outcome')) return { key: 'outcomes', match: { idPrefix: 'agent:', kinds: ['alert'] }, name: 'missed outcomes' };
  if (item.id.endsWith(':draft')) return { key: 'drafts', match: { idPrefix: 'agent:', kinds: ['decision'] }, name: 'draft agents' };
  if (item.id.startsWith('board-build:')) return { key: 'builds', match: { idPrefix: 'board-build:' }, name: 'board builds' };
  if (item.kind === 'question') return { key: 'questions', match: { kinds: ['question'] }, name: 'questions' };
  if (item.kind === 'decision') return { key: 'approvals', match: { kinds: ['decision'] }, name: 'approvals' };
  if (item.id.startsWith('thread:') && item.kind === 'alert') return { key: 'failures', match: { idPrefix: 'thread:', kinds: ['alert'] }, name: 'failure threads' };
  return undefined;
}

export function suggestRule(gesture: SurfaceOp['op'] | 'up', item: Item, doc: SurfaceDoc): RuleSuggestion | undefined {
  let rule: SurfaceRule | undefined;
  let question = '';
  if (gesture === 'pin' || gesture === 'up' || (gesture === 'rank')) {
    const like = likeThis(item);
    if (!like) return undefined;
    rule = { id: `${like.key}-first`, type: 'promote', match: like.match, label: `${like.name} first` };
    question = `Always put ${like.name} first?`;
  } else if (gesture === 'hide') {
    if (item.subject.agentId && !item.id.endsWith(':draft')) {
      const id = item.subject.agentId;
      rule = { id: `hide-${id}`.slice(0, 40).replace(/-+$/, ''), type: 'hide', match: { agentIds: [id] }, label: `everything from ${id}` };
      question = `Always hide everything from ${id}?`;
    } else {
      // Never "hide all questions" from one conversation: only agent-made kinds generalize.
      const like = likeThis(item);
      if (!like || !['drafts', 'builds'].includes(like.key)) return undefined;
      rule = { id: `hide-${like.key}`, type: 'hide', match: like.match, label: like.name };
      question = `Always hide ${like.name}?`;
    }
  }
  if (!rule || doc.rules.some((r) => r.id === rule.id)) return undefined;
  return { question, op: { op: 'addRule', rule } };
}
