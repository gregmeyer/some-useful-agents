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

  it("says what a run already filed in the notebook, so sua doesn't offer to file it again", () => {
    const out = formatConversationSnapshot([
      response('action', 'Recheck warranties', JSON.stringify({ kind: 'action', agentId: 'research-fanout', status: 'completed', resultSummary: '8 of 8 researched.', notebookFiled: 'research-fanout: 0 new, 8 updated' })),
    ]);
    expect(out).toBe('[action] Recheck warranties (status=completed; result=8 of 8 researched.; already filed in the notebook: research-fanout: 0 new, 8 updated)');
  });

  it('says why an action failed, and what an approved one waits for', () => {
    const out = formatConversationSnapshot([
      response('action', 'Apply the correction', JSON.stringify({ kind: 'action', agentId: 'notebook-correct-apply', status: 'failed', refusalReason: "That rule has changed since this was worked out. Ask again." })),
      response('action', 'Apply another', JSON.stringify({ kind: 'action', agentId: 'notebook-correct-apply', status: 'proposed', waitingFor: 'Check topics and sources' })),
    ], undefined, 0);
    expect(out).toBe([
      '[action] Apply the correction (status=failed; why=That rule has changed since this was worked out. Ask again.; just now)',
      '[action] Apply another (status=proposed; approved, waiting for Check topics and sources)',
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

describe('a failure before the latest ask is history, not news', () => {
  const H = 3_600_000;
  const at = (role: InboxResponse['role'], body: string, createdAt: number, meta?: object): InboxResponse =>
    ({ id: `t${createdAt}`, messageId: 'm', createdAt, role, body, ...(meta ? { metaJson: JSON.stringify(meta) } : {}) });

  it('a failed or refused action says how long ago, and that it came before what they last asked', () => {
    const now = 10 * H;
    const out = formatConversationSnapshot([
      at('user', 'add a photo', 1 * H),
      at('action', 'Use this picture', 2 * H, { kind: 'action', agentId: 'notebook-photo', status: 'failed', refusalReason: "That picture couldn't be fetched (HTTP 429)." }),
      at('action', 'Find another', 3 * H, { kind: 'action', agentId: 'starter-goal', status: 'completed', resultSummary: 'found one' }),
      at('user', 'add a photo, please', 9 * H),
      at('action', 'Use that one', now - 5 * 60_000, { kind: 'action', agentId: 'notebook-photo', status: 'refused', refusalReason: 'No address.' }),
    ], undefined, now);
    expect(out).toContain("(status=failed; why=That picture couldn't be fetched (HTTP 429).; 8h ago; before your latest ask)");
    // A completed one says neither; one after the ask says only how long ago.
    expect(out).toContain('(status=completed; result=found one)');
    expect(out).toContain('(status=refused; why=No address.; 5m ago)');
  });

  it('says ages in plain units', async () => {
    const { howLongAgo, latestAskAt } = await import('./inbox-shared.js');
    expect(howLongAgo(0, 20_000)).toBe('just now');
    expect(howLongAgo(0, 12 * 60_000)).toBe('12m ago');
    expect(howLongAgo(0, 7 * H)).toBe('7h ago');
    expect(howLongAgo(0, 72 * H)).toBe('3d ago');
    expect(latestAskAt([at('user', 'a', 5), at('triage', 'b', 9), at('user', 'c', 7)])).toBe(7);
    expect(latestAskAt([at('triage', 'b', 9)])).toBeUndefined();
  });
});
