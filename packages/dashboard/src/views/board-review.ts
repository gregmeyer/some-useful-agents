/**
 * "sua suggests" (ADR-0075): a board's latest review, on the board. While a
 * round is going it says so (and the page checks back); when it's ready, a
 * goal to take if the board had none, then each suggestion with its reason
 * and the one button that applies it, Skip, Add all, and Look again.
 */
import type { BoardGoal, BoardReview, StoredBoardSuggestion } from '@some-useful-agents/core';
import { html, unsafeHtml, type SafeHtml } from './html.js';
import { working } from './working.js';

export interface BoardReviewCard {
  review?: BoardReview;
  /** A draft started from a suggestion: being written, waiting for your approval, or failed. */
  draft?: { buildId: string; state: 'drafting' | 'approve' | 'failed'; detail: string; agents: Array<{ id: string; name: string; purpose: string }>; error?: string };
  goal?: BoardGoal;
  /** An agent's name for people (its tile's title), by id. */
  title: (agentId: string) => string;
  /** sua is redrawing the board's page after a change. */
  redrawing?: boolean;
}

/** A content suggestion, as its row says it. */
const CONTENT_WHAT: Record<string, (from: string) => string> = {
  headline: (from) => `Lead with the day's headline${from ? ` from ${from}` : ''}`,
  numbers: () => 'Add a numbers band: the lead figure by day, and the others with their trends',
  'top-story': (from) => `Show the top item${from ? ` of ${from}` : ''}, linked`,
  note: () => 'Add a line of context',
};

function suggestion(boardId: string, review: BoardReview, s: StoredBoardSuggestion, title: (id: string) => string): SafeHtml {
  const base = `/boards/${encodeURIComponent(boardId)}/review/${encodeURIComponent(review.id)}`;
  const add = s.type !== 'remove';
  const what = s.type === 'draft' ? `Draft a new agent: ${s.suggestedName ?? s.purpose}` : s.type === 'content' ? CONTENT_WHAT[s.kind](s.from ? title(s.from) : '') : s.type === 'add-agent' ? `Add ${title(s.agentId)}` : `Leave out ${title(s.agentId)}`;
  const state = s.state === 'applied' ? (s.type === 'draft' ? 'Sent to be drafted' : s.type === 'content' ? 'Drawn' : add ? 'Added' : 'Left out') : s.state === 'skipped' ? 'Skipped' : '';
  const why = s.type === 'draft' && s.suggestedName ? `${s.purpose.replace(/[.\s]+$/, '')}. ${s.why}` : s.why;
  return html`
    <li class="board-review__item${s.state !== 'open' ? ' is-done' : ''}" data-review-suggestion="${s.key}">
      <span class="board-review__sign" aria-hidden="true">${s.type === 'draft' ? '?' : add ? '+' : '−'}</span>
      <div class="board-review__text"><span class="board-review__what">${what}</span><span class="board-review__why">${why}</span></div>
      ${s.state === 'open' ? html`<div class="board-review__acts">
        <form method="POST" action="${base}/apply" style="margin: 0;"><input type="hidden" name="key" value="${s.key}"><button type="submit" class="btn btn--sm" aria-label="${what}">${s.type === 'draft' ? 'Draft it' : s.type === 'content' ? 'Draw it' : add ? 'Add' : 'Leave out'}</button></form>
        <form method="POST" action="${base}/skip" style="margin: 0;"><input type="hidden" name="key" value="${s.key}"><button type="submit" class="board-review__skip" aria-label="Skip: ${what}" title="Don't suggest this again for this board">Skip</button></form>
      </div>` : html`<span class="board-review__state">${state}</span>`}
    </li>`;
}

/**
 * What's running for a board, said plainly at the top of its page and kept
 * current: sua reviewing, drafting or redrawing, and any of its agents
 * mid-run. It checks back every few seconds, shows a job that starts while
 * you're on the page, and redraws the page when something sua was doing
 * ends (an agent's tile updates itself). Hidden when nothing is running.
 */
export function boardRunningStrip(boardId: string, items: ReadonlyArray<{ kind: string; text: string; since?: string }>): SafeHtml {
  const line = (x: { text: string }) => html`<li>${x.text}</li>`;
  return html`<div class="board-running" data-board-running="${boardId}" data-sua="${items.some((x) => x.kind !== 'agent') ? '1' : ''}" role="status" aria-live="polite"${unsafeHtml(items.length ? '' : ' hidden')}>
    <span class="working__spin" aria-hidden="true"></span>
    <strong class="board-running__label">Running now</strong>
    <ul class="board-running__list" data-board-running-list>${items.map(line) as unknown as SafeHtml[]}</ul>
    <span class="board-running__time" data-board-running-time></span>
    ${unsafeHtml(`<script>(function(){var el=document.querySelector('[data-board-running]');if(!el)return;var id=el.getAttribute('data-board-running');var list=el.querySelector('[data-board-running-list]');var time=el.querySelector('[data-board-running-time]');var sua=el.getAttribute('data-sua')==='1';var since=null;
function clock(){if(!since||el.hidden){time.textContent='';return;}var s=Math.max(0,Math.round((Date.now()-since)/1000));time.textContent=s<60?s+'s':Math.floor(s/60)+'m '+(s%60)+'s';}
function tick(){fetch('/boards/'+encodeURIComponent(id)+'/activity.json',{headers:{Accept:'application/json'},credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){var items=(j&&j.running)||[];var nowSua=items.some(function(x){return x.kind!=='agent'});
if(sua&&!nowSua){location.reload();return;}sua=nowSua;
list.textContent='';items.forEach(function(x){var li=document.createElement('li');li.textContent=x.text;list.appendChild(li);});
var first=items.map(function(x){return x.since?Date.parse(x.since):NaN}).filter(function(t){return !isNaN(t)}).sort()[0];since=first||null;
el.hidden=!items.length;clock();setTimeout(tick,items.length?3000:6000);}).catch(function(){setTimeout(tick,8000);});}
setInterval(clock,1000);setTimeout(tick,${items.length ? '3000' : '6000'});})();</script>`)}
  </div>`;
}

/**
 * A board's goal, what sua suggests for it, and its layout tools, as ONE
 * part of the page that folds to a row: the goal, a word on what needs you,
 * and "Improve this board" (which keeps that name however many times it
 * has run). It opens by itself when something needs you (a goal to take,
 * open suggestions, an agent to approve); otherwise it stays as you left
 * it. Inside: what needs you, then Edit goal and the layout tools.
 */
export function boardGoalCard(boardId: string, c: BoardReviewCard & { label?: string; extra?: SafeHtml; what?: string }): SafeHtml {
  const r = c.review;
  const id = encodeURIComponent(boardId);
  const running = r?.status === 'running';
  const open = r?.status === 'ready' ? r.suggestions.filter((s) => s.state === 'open').length : 0;
  const needsGoal = r?.status === 'ready' && !c.goal && !!r.goal;
  const approve = c.draft?.state === 'approve';
  // What needs you, in a word, on the folded row.
  const needs = approve ? `Approve ${String(c.draft!.agents.length)} new agent${c.draft!.agents.length === 1 ? '' : 's'}` : needsGoal ? 'A goal to confirm' : open ? `${String(open)} suggestion${open === 1 ? '' : 's'}` : r?.status === 'failed' ? "The review didn't finish" : '';
  const by = c.goal?.by === 'sua' ? 'suggested by sua' : c.goal?.by === 'request' ? 'from what you asked for' : '';
  const improve = html`<form method="POST" action="/boards/${id}/review" class="board-review__start" style="margin: 0;">
    <button type="submit" class="btn btn--sm btn--primary"${unsafeHtml(running ? ' disabled' : '')} title="sua looks at this against its goal and suggests an agent you have, or a new one, that helps you meet it. Nothing changes until you press a suggestion's button.">${c.label ?? 'Improve this board'}</button>
  </form>`;
  return html`<details class="board-goal-card" data-board-goal-card="${boardId}" data-needs="${needs ? '1' : ''}"${unsafeHtml(needs ? ' open' : '')}>
    <summary class="board-goal-card__top">
      <span class="board-goal__label">Goal</span>
      ${c.goal ? html`<span class="board-goal__text">${c.goal.text}</span>` : html`<span class="board-goal__text board-goal__text--none">Say what ${c.what ?? 'this board'} is for, so sua can tell what's missing.</span>`}
      ${needs ? html`<span class="board-goal-card__needs">${needs}</span>` : html``}
      ${improve}
    </summary>
    ${draftBlock(boardId, c.draft)}
    ${reviewBody(boardId, c)}
    <details class="board-goal" data-board-goal>
      <summary class="board-goal__edit">${c.goal ? 'Edit goal' : 'Add a goal'}${by ? html` <span class="board-goal__by">${by}</span>` : html``}</summary>
      <form method="POST" action="/boards/${id}/goal" class="board-goal__form">
        <textarea name="goal" rows="2" aria-label="What ${c.what ?? 'this board'} is for" maxlength="280" placeholder="e.g. Know what matters on Hacker News each morning, without reading it all">${c.goal?.text ?? ''}</textarea>
        <div class="board-goal__acts">
          <button type="submit" class="btn btn--sm btn--primary">Save goal</button>
          <span class="board-goal__hint">One sentence. sua uses it when it reviews this and draws its page.</span>
        </div>
      </form>
    </details>
    ${c.extra ?? html``}
    ${unsafeHtml(`<script>(function(){var d=document.querySelector('[data-board-goal-card]');if(!d)return;var key='sua.boardcard.'+d.getAttribute('data-board-goal-card');try{if(d.getAttribute('data-needs')!=='1'&&localStorage.getItem(key)==='open')d.open=true;}catch(e){}d.addEventListener('toggle',function(){try{localStorage.setItem(key,d.open?'open':'closed');}catch(e){}});})();</script>`)}
  </details>`;
}

/**
 * A new agent sua is drafting for this board, where you asked for it: a
 * working line while it's written (the page checks back and redraws when
 * it's ready), then the agent with Approve and Decline right here. The
 * inbox has the same approval; this is so you don't have to go looking.
 */
function draftBlock(boardId: string, d: BoardReviewCard['draft']): SafeHtml {
  if (!d) return html``;
  if (d.state === 'drafting') {
    return html`<div class="board-review board-draft" data-board-draft-running="${boardId}" role="status" aria-live="polite">
      ${working({ text: `${d.detail || 'sua is drafting a new agent for this board.'} It usually takes a minute or two; the button to approve it appears here.` })}
      ${unsafeHtml(`<script>(function(){var el=document.querySelector('[data-board-draft-running]');if(!el)return;var id=el.getAttribute('data-board-draft-running');function tick(){fetch('/boards/'+encodeURIComponent(id)+'/build.json',{headers:{Accept:'application/json'},credentials:'same-origin'}).then(function(r){return r.json()}).then(function(b){if(b&&b.phase&&b.phase!=='drafting'&&b.phase!=='planning'){location.reload();return;}setTimeout(tick,3000);}).catch(function(){setTimeout(tick,5000);});}setTimeout(tick,3000);})();</script>`)}
    </div>`;
  }
  if (d.state === 'failed') return html`<div class="board-review board-draft"><p class="board-review__note"><strong>sua couldn't draft that agent.</strong> ${d.error ?? d.detail}</p></div>`;
  const base = `/boards/builds/${encodeURIComponent(d.buildId)}`;
  return html`<div class="board-review board-draft board-draft--ready" data-board-draft-ready>
    <p class="board-review__label">Ready for you to approve</p>
    <ul class="board-review__list">${d.agents.map((a) => html`<li class="board-review__item">
      <span class="board-review__sign" aria-hidden="true">+</span>
      <div class="board-review__text"><span class="board-review__what">${a.name}</span><span class="board-review__why">${a.purpose} It's a draft and hasn't run. <a href="/agents/${encodeURIComponent(a.id)}">Look at it first</a></span></div>
    </li>`) as unknown as SafeHtml[]}</ul>
    <div class="board-review__foot">
      <form method="POST" action="${base}/approve" style="margin: 0;"><button type="submit" class="btn btn--sm btn--primary">Approve and add to the board</button></form>
      <form method="POST" action="${base}/decline" style="margin: 0;"><button type="submit" class="board-review__skip" title="Delete the draft; nothing has run">Decline</button></form>
    </div>
  </div>`;
}

function reviewBody(boardId: string, c: BoardReviewCard): SafeHtml {
  const r = c.review;
  const id = encodeURIComponent(boardId);
  if (!r) return html``;
  if (r.status === 'running') {
    return html`<div class="board-review" data-board-review-running="${boardId}">
      ${working({ text: 'sua is looking at this against its goal: what its agents return, and what else you have or could build.' })}
      ${unsafeHtml(`<script>(function(){var el=document.querySelector('[data-board-review-running]');if(!el)return;var id=el.getAttribute('data-board-review-running');function tick(){fetch('/boards/'+encodeURIComponent(id)+'/review.json',{headers:{Accept:'application/json'},credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){if(j&&j.status&&j.status!=='running'){location.reload();return;}setTimeout(tick,3000);}).catch(function(){setTimeout(tick,5000);});}setTimeout(tick,3000);})();</script>`)}
    </div>`;
  }
  if (r.status === 'failed') return html`<div class="board-review"><p class="board-review__note"><strong>The review didn't finish.</strong> ${r.error ?? ''}</p></div>`;
  const open = r.suggestions.filter((s) => s.state === 'open');
  const handledOnes = r.suggestions.filter((s) => s.state !== 'open');
  const needsGoal = !c.goal && !!r.goal;
  const handled = handledOnes.length ? html`<details class="board-review__handled">
      <summary>${String(handledOnes.length)} already handled</summary>
      <ul class="board-review__list">${handledOnes.map((s) => suggestion(boardId, r, s, c.title)) as unknown as SafeHtml[]}</ul>
    </details>` : html``;
  return html`<div class="board-review" aria-label="sua suggests">
    ${needsGoal ? html`
      <form method="POST" action="/boards/${id}/goal" class="board-review__goal">
        <label for="board-review-goal">First, what is this for? sua's reading of it:</label>
        <textarea id="board-review-goal" name="goal" rows="2" maxlength="280">${r.goal ?? ''}</textarea>
        <input type="hidden" name="proposed" value="${r.goal ?? ''}">
        <div class="board-review__acts"><button type="submit" class="btn btn--sm btn--primary">Use this goal</button><span class="board-review__why">Change the words first if they're off. The suggestions below assume it.</span></div>
      </form>` : html``}
    ${open.length ? html`
      <p class="board-review__label">sua suggests</p>
      <ul class="board-review__list">${open.map((s) => suggestion(boardId, r, s, c.title)) as unknown as SafeHtml[]}</ul>` : html``}
    ${r.note ? html`<p class="board-review__note">${r.note}</p>` : html``}
    ${!open.length ? html`<p class="board-review__note"><strong>${r.suggestions.length ? 'That was all of them.' : 'Nothing more to suggest for this goal.'}</strong></p>` : html``}
    ${open.length > 1 ? html`<div class="board-review__foot">
      <form method="POST" action="/boards/${id}/review/${encodeURIComponent(r.id)}/apply" style="margin: 0;"><button type="submit" class="btn btn--sm">Apply all ${String(open.length)}</button></form>
    </div>` : html``}
    ${handled}
  </div>`;
}
