import type { HumanQuestion, Session, SessionTurn } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from '../html.js';
import { formatAge } from '../components.js';
import { mdBody } from '../inbox-detail.js';
import { renderThreadMessage, renderThread, isGrouped } from '../thread.js';
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
    /** The agent's A2UI view for each reply, by run id (lib/a2ui-surface.ts). */
    views?: Record<string, SafeHtml>;
    /** The input a message fills, or why the agent can't take one. */
    chatInput?: string;
    notConversational?: string;
  };
}

/**
 * Chat tab: a conversation with this agent. Each message is one run; the
 * agent sees the conversation so far (docs/conversations.md). Messages use
 * the shared thread component (thread.ts); the composer reuses the inbox
 * chat bar.
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

  const transcript = renderChatTranscript(agent, chat);
  const composer = chat.notConversational
    ? html`<div class="card" style="padding: var(--space-3);">
        <p style="margin: 0;">${chat.notConversational}</p>
        <p class="dim" style="margin: var(--space-2) 0 0; font-size: var(--font-size-xs);">Change it on the <a href="/agents/${encodeURIComponent(agent.id)}/yaml">YAML</a> tab.</p>
      </div>`
    : html`
      <form method="POST" action="${base}" class="inbox-chatbar" id="agent-chat-form"
        data-chat-live data-agent-id="${agent.id}" data-session-id="${chat.active?.id ?? ''}"
        data-pending-run="${chat.pending ? ([...chat.turns].reverse().find((t) => t.role === 'user')?.runId ?? '') : ''}">
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
  // Fallback while a reply is pending: reload until it lands. The live
  // client (agent-chat.js.ts) cancels this once the socket is connected.
  ${chat.pending && !chat.waitingQuestion ? "window.__suaChatReload = setTimeout(() => location.reload(), 3000);" : ''}
  const t = document.querySelector('.agent-chat__transcript');
  if (t) t.lastElementChild && t.lastElementChild.scrollIntoView({ block: 'end' });
})();
</script>`);

  const content = html`
    <section class="agent-chat">
      ${sessionList}
      <div class="agent-chat__main">
        ${chat.active ? html`<h2 style="margin-top: 0;">${chat.active.title}</h2>` : html``}
        <div id="agent-chat-transcript">${transcript}</div>
        ${composer}
      </div>
    </section>
    ${script}
  `;
  return agentPageShell({ ...args, activeTab: 'chat' }, content);
}

/**
 * The conversation's messages, plus the in-progress reply. Also served alone
 * (`?fragment=transcript`) so the live client can re-render it from source
 * when a turn ends.
 */
export function renderChatTranscript(agent: AgentChatArgs['agent'], chat: AgentChatArgs['chat']): SafeHtml {
  const runLink = (runId: string, label: string) =>
    html`<a href="/runs/${encodeURIComponent(runId)}" class="mono">${label} ${runId.slice(0, 8)}</a>`;
  const agentBody = (t: SessionTurn): SafeHtml => {
    if (t.failed) return html`<p style="color: var(--color-err); margin: 0;">The run didn't finish: ${t.text}</p>`;
    const view = t.runId ? chat.views?.[t.runId] : undefined;
    // A rendered widget is the reply; the raw text stays one click away.
    if (view && String(view).includes('data-a2ui-surface')) {
      return html`${view}<details class="agent-chat__raw"><summary class="dim">Show the raw reply</summary>${mdBody(t.text)}</details>`;
    }
    return html`${mdBody(t.text)}${view ?? html``}`;
  };
  const rows = chat.turns.map((t, i) => renderThreadMessage({
    role: t.role,
    sigil: t.role === 'user' ? 'you' : 'agent',
    label: t.role === 'user' ? 'You' : agent.name,
    createdAt: t.createdAt,
    grouped: isGrouped(chat.turns, i, (x) => x.role),
    metaAfter: t.role === 'agent' && t.runId ? runLink(t.runId, 'run') : undefined,
    body: t.role === 'agent' ? agentBody(t) : mdBody(t.text),
  }));

  if (chat.pending) {
    const lastUser = [...chat.turns].reverse().find((t) => t.role === 'user');
    const q = chat.waitingQuestion;
    rows.push(renderThreadMessage({
      role: 'agent',
      sigil: 'agent',
      label: agent.name,
      writing: q ? 'Waiting for an answer' : 'Working…',
      metaAfter: lastUser?.runId ? runLink(lastUser.runId, 'watch run') : undefined,
      body: q
        ? html`${q.question}${q.inboxMessageId ? html` <a href="/inbox/${encodeURIComponent(q.inboxMessageId)}">Answer in the inbox</a>` : html``}`
        : html`<ul class="agent-chat__live-tools" data-chat-live-tools></ul><div class="agent-chat__live-text" data-chat-live-text></div>`,
    }));
  }

  return chat.turns.length === 0
    ? html`<p class="dim" style="font-size: var(--font-size-sm);">
        Ask ${agent.name} something. Each message is a run of this agent, and it sees the conversation so far${chat.chatInput ? html` (your message fills its <code>${chat.chatInput}</code> input)` : html``}.
      </p>`
    : renderThread(rows, { className: 'agent-chat__transcript' });
}
