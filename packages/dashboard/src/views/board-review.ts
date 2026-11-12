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
  const state = s.state === 'applied' ? (s.type === 'draft' ? 'Drafted: approve it to add it' : s.type === 'content' ? 'Drawn' : add ? 'Added' : 'Left out') : s.state === 'skipped' ? 'Skipped' : '';
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
 * A board's goal and what sua suggests for it, as ONE card (the page had a
 * goal line, a toolbar button and a suggestions box). Top row: the goal
 * (with Edit) and "Improve this board", which keeps that name however many
 * times it has run. Under it, only what needs you now: a goal to take, open
 * suggestions with their buttons, or one line on how the last look went.
 * What you've already handled is folded away.
 */
export function boardGoalCard(boardId: string, c: BoardReviewCard & { goalLine: SafeHtml; label?: string; extra?: SafeHtml }): SafeHtml {
  const r = c.review;
  const id = encodeURIComponent(boardId);
  const running = r?.status === 'running';
  const improve = html`<form method="POST" action="/boards/${id}/review" class="board-review__start" style="margin: 0;">
    <button type="submit" class="btn btn--sm btn--primary"${unsafeHtml(running ? ' disabled' : '')} title="sua looks at this against its goal and suggests an agent you have, or a new one, that helps you meet it. Nothing changes until you press a suggestion's button.">${c.label ?? 'Improve this board'}</button>
  </form>`;
  return html`<section class="board-goal-card" data-board-goal-card>
    <div class="board-goal-card__top">${c.goalLine}${improve}</div>
    ${reviewBody(boardId, c)}
    ${c.extra ?? html``}
  </section>`;
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
    ${c.redrawing ? html`<p class="board-review__note" role="status"><span class="working__spin" aria-hidden="true"></span>sua is redrawing this board's page with the change.</p>` : html``}
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
