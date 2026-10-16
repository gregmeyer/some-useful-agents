/**
 * sua's picks for "What do you want to do?" on /agents (lib/agent-find.ts):
 * its one-line recommendation, then each pick with why it fits, a question
 * you can ask it, and Open / Run. When nothing fits, an offer to build one.
 * Every answer can become a conversation: Talk it through with sua opens one
 * whose first message is your question and what the finder found, so sua
 * carries on from it (compare the picks, change one, or build one).
 */
import type { Agent } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import type { AgentFind } from '../lib/agent-find.js';

/** The first message of the conversation: the question, and what the finder found (so sua needn't search again). Pure. */
export function talkMessage(find: AgentFind, picks: ReadonlyArray<{ agentId: string; why: string }>): string {
  const asked = `I asked the agent catalog: “${find.question}”.`;
  if (find.status === 'failed') return `${asked} The agent finder couldn't answer. Which of my agents can do this, or should we build one?`;
  if (!picks.length) return `${asked} Nothing fit${find.recommendation ? ` (${find.recommendation})` : ''}. Should we build an agent for this?`;
  return `${asked} It suggested:\n${picks.map((p) => `- ${p.agentId}${p.why ? `: ${p.why}` : ''}`).join('\n')}\nHelp me choose, or tell me if I should build a new agent for this.`;
}

/** Talk it through with sua: a new conversation, started with the question and the picks. */
function talkForm(find: AgentFind, picks: ReadonlyArray<{ agentId: string; why: string }>, primary = false): SafeHtml {
  return html`<form method="POST" action="/inbox/new" class="ag-talk">
      <input type="hidden" name="body" value="${talkMessage(find, picks)}">
      <input type="hidden" name="title" value="${`Which agent: ${find.question}`.slice(0, 120)}">
      <input type="hidden" name="page" value="/agents">
      <input type="hidden" name="pageTitle" value="Agents">
      <button type="submit" class="btn btn--sm${primary ? ' btn--primary' : ''}" title="Opens a conversation with your question and these picks, so sua carries on from here">Talk it through with sua →</button>
    </form>`;
}

export function renderFindAnswer(find: AgentFind, agents: ReadonlyMap<string, Agent>): string {
  const build = `Build an agent that can: ${find.question}`;
  const head = (text: string) => html`<div class="ag-suggest__head"><span class="ag-suggest__who" aria-hidden="true">sua</span><span>${text}</span></div>`;
  if (find.status === 'failed') {
    return render(html`${head("sua couldn't look just now. The keyword matches are below.")}
      <div class="ag-suggest__none">${talkForm(find, [], true)}</div>`);
  }
  const picks = (find.picks ?? []).map((p) => ({ p, a: agents.get(p.agentId) })).filter((x): x is { p: typeof x.p; a: Agent } => !!x.a);
  if (!picks.length) {
    return render(html`${head(find.recommendation || 'None of your agents does that yet.')}
      <div class="ag-suggest__none">Nothing here does that yet.
        ${talkForm(find, [], true)}
        <button type="button" class="ask-chip" data-ask="${build}">Ask sua to build one</button></div>`);
  }
  return render(html`${head(find.recommendation || 'These look like the right ones.')}
    <ol class="ag-picks">
      ${picks.map(({ p, a }, i) => {
        const q = (a.sampleQuestions ?? []).find((x) => x.trim());
        return html`<li class="ag-pick${i === 0 ? ' is-best' : ''}">
          <div class="ag-pick__main">
            <a class="ag-name" href="/agents/${a.id}">${a.name || a.id}</a>${i === 0 ? html` <span class="ag-chip ag-chip--best">best fit</span>` : html``}
            ${p.why ? html`<p class="ag-pick__why">${p.why}</p>` : html``}
            ${q ? html`<button type="button" class="ask-chip ask-chip--card" data-ask="${q}" title="${q}">${q.length > 60 ? `${q.slice(0, 59)}…` : q}</button>` : html``}
          </div>
          <form method="POST" action="/agents/${a.id}/run" class="ag-run"><button type="submit" class="btn btn--sm${i === 0 ? ' btn--primary' : ''}">Run</button></form>
        </li>`;
      }) as unknown as SafeHtml[]}
    </ol>
    <div class="ag-suggest__more">${talkForm(find, picks.map(({ p }) => p))} <span>Not quite?</span> <button type="button" class="ask-chip" data-ask="${build}">Ask sua to build one</button></div>`);
}
