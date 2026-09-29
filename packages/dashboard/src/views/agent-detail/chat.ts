import type { HumanQuestion, Session, SessionTurn } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from '../html.js';
import { formatAge } from '../components.js';
import { mdBody } from '../inbox-detail.js';
import { agentPageShell, type AgentDetailArgs } from './shell.js';

export interface AgentChatArgs extends AgentDetailArgs {
  chat: {
    sessions: Array<Session & { turns: number }>;
    active?: Session;
    turns: SessionTurn[];
    /** The latest message is still being answered. */
    pending: boolean;
    /** The run behind the pending message is waiting on this question. */
    waitingQuestion?: HumanQuestion;
    /** The input a message fills, or why the agent can't take one. */
    chatInput?: string;
    notConversational?: string;
  };
}

/**
 * Chat tab: a conversation with this agent. Each message is one run; the
 * agent sees the conversation so far (docs/conversations.md). Reuses the
 * inbox thread's message and chat-bar styles.
 */
export function renderAgentChat(args: AgentChatArgs): string {
  const { agent, chat } = args;
  const base = `/agents/${encodeURIComponent(agent.id)}/chat`;

  const sessionList = html`
    <aside class="agent-chat__sessions">
      <a href="${base}" class="btn btn--sm ${chat.active ? 'btn--ghost' : 'btn--primary'}" style="width: 100%; justify-content: center;">New conversation</a>
      ${chat.sessions.length === 0
        ? html`<p class="dim" style="font-size: var(--font-size-xs); margin-top: var(--space-3);">No conversations yet.</p>`
        : html`<ul class="agent-chat__session-list">
            ${chat.sessions.map((s) => html`
              <li>
                <a href="${base}?session=${encodeURIComponent(s.id)}" class="${chat.active?.id === s.id ? 'is-active' : ''}">
                  <span class="agent-chat__session-title">${s.title}</span>
                  <span class="dim agent-chat__session-meta">${String(s.turns)} message${s.turns === 1 ? '' : 's'} · ${formatAge(s.updatedAt)}</span>
                </a>
              </li>`) as unknown as SafeHtml[]}
          </ul>`}
    </aside>
  `;

  const turnRow = (t: SessionTurn, prev: SessionTurn | undefined): SafeHtml => {
    const grouped = !!prev && prev.role === t.role;
    const who = t.role === 'user' ? 'you' : 'agent';
    return html`
      <li class="inbox-msg ${grouped ? 'inbox-msg--grouped' : ''}">
        <span class="inbox-msg__avatar ${t.role === 'user' ? 'inbox-msg__avatar--user' : 'inbox-msg__avatar--triage'}">${who}</span>
        <div class="inbox-msg__body">
          <div class="inbox-msg__meta">
            <span class="inbox-msg__time">${formatAge(t.createdAt)}</span>
            ${t.role === 'agent' && t.runId ? html`<a href="/runs/${encodeURIComponent(t.runId)}" class="mono">run ${t.runId.slice(0, 8)}</a>` : html``}
          </div>
          ${t.role === 'agent' && t.failed
            ? html`<p class="inbox-msg__text" style="color: var(--color-err); margin: 0;">The run didn't finish: ${t.text}</p>`
            : t.role === 'agent'
              ? mdBody(t.text)
              : html`<p class="inbox-msg__text" style="margin: 0;">${t.text}</p>`}
        </div>
      </li>`;
  };

  const lastUser = [...chat.turns].reverse().find((t) => t.role === 'user');
  const transcript = chat.turns.length === 0
    ? html`<p class="dim" style="font-size: var(--font-size-sm);">
        Ask ${agent.name} something. Each message is a run of this agent, and it sees the conversation so far${chat.chatInput ? html` (your message fills its <code>${chat.chatInput}</code> input)` : html``}.
      </p>`
    : html`<ul class="agent-chat__transcript">
        ${chat.turns.map((t, i) => turnRow(t, chat.turns[i - 1])) as unknown as SafeHtml[]}
        ${chat.pending ? html`
          <li class="inbox-msg">
            <span class="inbox-msg__avatar inbox-msg__avatar--triage">agent</span>
            <div class="inbox-msg__body">${chat.waitingQuestion
              ? html`<span class="inbox-msg__writing">Waiting for an answer:</span> ${chat.waitingQuestion.question}
                  ${chat.waitingQuestion.inboxMessageId ? html` <a href="/inbox/${encodeURIComponent(chat.waitingQuestion.inboxMessageId)}">Answer in the inbox</a>` : html``}`
              : html`<span class="inbox-msg__writing">Working…</span>`}
              ${lastUser?.runId ? html` <a href="/runs/${encodeURIComponent(lastUser.runId)}" class="mono dim" style="font-size: var(--font-size-xs);">watch run ${lastUser.runId.slice(0, 8)}</a>` : html``}
            </div>
          </li>` : html``}
      </ul>`;

  const composer = chat.notConversational
    ? html`<div class="card" style="padding: var(--space-3);">
        <p style="margin: 0;">${chat.notConversational}</p>
        <p class="dim" style="margin: var(--space-2) 0 0; font-size: var(--font-size-xs);">Change it on the <a href="/agents/${encodeURIComponent(agent.id)}/yaml">YAML</a> tab.</p>
      </div>`
    : html`
      <form method="POST" action="${base}" class="inbox-chatbar" id="agent-chat-form">
        ${chat.active ? html`<input type="hidden" name="session" value="${chat.active.id}">` : html``}
        <span class="inbox-chatbar__prompt" aria-hidden="true">you&nbsp;›</span>
        <textarea name="message" rows="1" required maxlength="8192" class="inbox-chatbar__input"
          placeholder="${chat.active ? 'Follow up…' : `Ask ${agent.name}…`}" aria-label="Message to ${agent.name}"
          ${chat.pending ? 'disabled' : ''}></textarea>
        <button type="submit" class="btn btn--sm btn--primary inbox-chatbar__send" ${chat.pending ? 'disabled' : ''}>
          ${chat.pending ? 'Waiting…' : 'Send ↵'}
        </button>
      </form>
      <div class="inbox-composer__aux">
        ${chat.active
          ? html`<form method="POST" action="${base}/${encodeURIComponent(chat.active.id)}/delete" style="margin: 0;">
              <button type="submit" class="btn btn--xs btn--ghost">Delete this conversation</button>
            </form>`
          : html`<span></span>`}
        <span class="inbox-composer__hint" aria-hidden="true">↵ send · ⇧↵ newline</span>
      </div>`;

  // Enter sends (Shift+Enter is a newline); while a reply is pending, reload
  // until it lands. The page is server-rendered, so this is the whole client.
  const script = unsafeHtml(`<script>
(() => {
  const form = document.getElementById('agent-chat-form');
  const input = form && form.querySelector('textarea');
  if (input) {
    input.focus();
    const grow = () => { input.style.height = 'auto'; input.style.height = input.scrollHeight + 'px'; };
    input.addEventListener('input', grow);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (input.value.trim()) form.requestSubmit();
      }
    });
  }
  ${chat.pending && !chat.waitingQuestion ? "setTimeout(() => location.reload(), 3000);" : ''}
  const t = document.querySelector('.agent-chat__transcript');
  if (t) t.lastElementChild && t.lastElementChild.scrollIntoView({ block: 'end' });
})();
</script>`);

  const content = html`
    <section class="agent-chat">
      ${sessionList}
      <div class="agent-chat__main">
        ${chat.active ? html`<h2 style="margin-top: 0;">${chat.active.title}</h2>` : html``}
        ${transcript}
        ${composer}
      </div>
    </section>
    ${script}
  `;
  return agentPageShell({ ...args, activeTab: 'chat' }, content);
}
