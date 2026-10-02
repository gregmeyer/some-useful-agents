/**
 * The shared thread component (thread.ts): the inbox thread and the agent
 * Chat tab render a message the same way.
 */
import { describe, it, expect } from 'vitest';
import { render } from './html.js';
import { renderInboxDetailFragment } from './inbox-detail.js';
import { renderChatTranscript, type AgentChatArgs } from './agent-detail/chat.js';
import type { InboxMessage, InboxResponse, SessionTurn } from '@some-useful-agents/core';

const T = Date.parse('2026-10-01T12:00:00.000Z');
const agent = { id: 'helper', name: 'Helper' } as AgentChatArgs['agent'];

const message: InboxMessage = {
  id: 'm1', createdAt: T, priority: 'medium', source: 'manual',
  title: 't', body: '(empty)', status: 'awaiting_user', starred: false, paused: false, autoResolved: false, tags: [],
};
const response = (id: string, role: InboxResponse['role'], body: string): InboxResponse =>
  ({ id, messageId: 'm1', createdAt: T, role, body });
const turn = (seq: number, role: SessionTurn['role'], text: string, extra: Partial<SessionTurn> = {}): SessionTurn =>
  ({ sessionId: 's1', seq, role, text, failed: false, createdAt: new Date(T).toISOString(), ...extra });

function transcript(turns: SessionTurn[], chat: Partial<AgentChatArgs['chat']> = {}): string {
  return render(renderChatTranscript(agent, { sessions: [], turns, pending: false, ...chat }));
}

/** The first `.inbox-msg` row, without its response id. */
function firstRow(out: string): string {
  const start = out.indexOf('<div class="inbox-msg ');
  const end = out.indexOf('</li>', start);
  return out.slice(start, end).replace(/ data-msg-id="[^"]*"/, '').replace(/\s+/g, ' ').trim();
}

describe('shared thread component', () => {
  it('renders your message identically in the inbox thread and the Chat tab', () => {
    const inbox = render(renderInboxDetailFragment({ message, responses: [response('r1', 'user', 'Is **this** fixed?')], inlineActionWidgets: {} }));
    const chat = transcript([turn(1, 'user', 'Is **this** fixed?')]);
    expect(firstRow(chat)).toBe(firstRow(inbox));
    expect(firstRow(chat)).toContain('<strong>this</strong>');
    expect(chat).toContain('<ul class="inbox-timeline agent-chat__transcript">');
  });

  it('gives agent replies their own speaker, run link and Copy, and groups a run of them', () => {
    const out = transcript([
      turn(1, 'user', 'hi', { runId: 'run-aaaaaaaa1' }),
      turn(2, 'agent', 'hello', { runId: 'run-aaaaaaaa1' }),
      turn(3, 'agent', 'and more', { runId: 'run-bbbbbbbb2' }),
    ]);
    expect(out).toContain('inbox-msg__avatar inbox-msg__avatar--agent" aria-label="Helper">agent');
    expect(out).toContain('href="/runs/run-aaaaaaaa1"');
    expect(out.match(/inbox-msg--grouped/g)).toHaveLength(1);
    expect(out.match(/data-inbox-copy\s/g)).toHaveLength(3);
  });

  it('shows a failed run as the reply, and the pending reply as a row being written', () => {
    const failed = transcript([turn(1, 'user', 'hi'), turn(2, 'agent', 'boom', { failed: true })]);
    expect(failed).toContain("The run didn't finish: boom");

    const pending = transcript([turn(1, 'user', 'hi', { runId: 'run-cccccccc3' })], { pending: true });
    expect(pending).toContain('<span class="inbox-msg__writing">Working…</span>');
    expect(pending).toContain('data-chat-live-text');
    expect(pending).toContain('watch run run-cccc');
    // Nothing to copy until it's written.
    expect(pending.match(/data-inbox-copy\s/g)).toHaveLength(1);
  });
});
