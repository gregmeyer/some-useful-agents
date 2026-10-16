/**
 * sua's picks for "What do you want to do?" on /agents (lib/agent-find.ts):
 * its one-line recommendation, then each pick with why it fits, a question
 * you can ask it, and Open / Run. When nothing fits, an offer to build one.
 */
import type { Agent } from '@some-useful-agents/core';
import { html, render, type SafeHtml } from './html.js';
import type { AgentFind } from '../lib/agent-find.js';

export function renderFindAnswer(find: AgentFind, agents: ReadonlyMap<string, Agent>): string {
  const build = `Build an agent that can: ${find.question}`;
  const head = (text: string) => html`<div class="ag-suggest__head"><span class="ag-suggest__who" aria-hidden="true">sua</span><span>${text}</span></div>`;
  if (find.status === 'failed') {
    return render(html`${head("sua couldn't look just now. The keyword matches are below.")}
      <p class="ag-suggest__none"><button type="button" class="ask-chip ask-chip--lead" data-ask="Which agent can ${find.question}?">Ask sua in a conversation</button></p>`);
  }
  const picks = (find.picks ?? []).map((p) => ({ p, a: agents.get(p.agentId) })).filter((x): x is { p: typeof x.p; a: Agent } => !!x.a);
  if (!picks.length) {
    return render(html`${head(find.recommendation || 'None of your agents does that yet.')}
      <p class="ag-suggest__none">Nothing here does that yet.
        <button type="button" class="ask-chip ask-chip--lead" data-ask="${build}">Ask sua to build one</button></p>`);
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
    <p class="ag-suggest__more">Not quite? <button type="button" class="ask-chip" data-ask="${build}">Ask sua to build one</button></p>`);
}
