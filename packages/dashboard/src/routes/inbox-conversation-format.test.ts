/**
 * formatConversationSnapshot — the thread replayed into triage and the
 * learning extractor. Used to be unbounded; now keeps the most recent
 * entries within CONVERSATION_PROMPT_BUDGET and says what was left out.
 */
import { describe, it, expect } from 'vitest';
import type { InboxResponse } from '@some-useful-agents/core';
import {
  formatConversationSnapshot,
  CONVERSATION_PROMPT_BUDGET,
  CONVERSATION_ENTRY_MAX_CHARS,
} from './inbox-shared.js';

let n = 0;
const response = (role: InboxResponse['role'], body: string, metaJson?: string): InboxResponse =>
  ({ id: `r${++n}`, messageId: 'm', createdAt: n, role, body, metaJson });

describe('formatConversationSnapshot', () => {
  it('renders a short thread whole, oldest first, with action status', () => {
    const out = formatConversationSnapshot([
      response('user', 'why did the digest fail?'),
      response('triage', 'The fetch node timed out.'),
      response('action', 'Re-run digest', JSON.stringify({ kind: 'action', agentId: 'digest', status: 'completed', resultSummary: 'ok, 12 items' })),
    ]);
    expect(out).toBe([
      '[user] why did the digest fail?',
      '[triage] The fetch node timed out.',
      '[action] Re-run digest (status=completed; result=ok, 12 items)',
    ].join('\n'));
  });

  it('keeps a long thread within budget: most recent kept, a note for the rest', () => {
    const thread = Array.from({ length: 120 }, (_, i) => response(i % 2 ? 'triage' : 'user', `turn ${i} ${'x'.repeat(300)}`));
    const out = formatConversationSnapshot(thread);
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(CONVERSATION_PROMPT_BUDGET);
    expect(out).toMatch(/^\(\d+ earlier entries left out for length\)\n/);
    expect(out).toContain('turn 119 ');
    expect(out).not.toContain('turn 0 ');
    expect(out.trimEnd().endsWith('x')).toBe(true);
  });

  it('cuts one oversized entry instead of letting it take the budget', () => {
    const out = formatConversationSnapshot([response('user', 'a'.repeat(CONVERSATION_ENTRY_MAX_CHARS * 3)), response('triage', 'short reply')]);
    expect(out).toContain('…(cut)');
    expect(out).toContain('[triage] short reply');
  });

  it('honours a smaller budget', () => {
    const out = formatConversationSnapshot(Array.from({ length: 10 }, (_, i) => response('user', `m${i} ${'y'.repeat(100)}`)), 400);
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(400);
    expect(out).toContain('m9 ');
  });
});
