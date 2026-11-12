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

/** The button in the board's toolbar. */
export function improveBoardButton(boardId: string, review: BoardReview | undefined): SafeHtml {
  const running = review?.status === 'running';
  return html`<form method="POST" action="/boards/${encodeURIComponent(boardId)}/review" class="board-review__start" style="margin: 0;">
    <button type="submit" class="btn btn--sm btn--primary"${unsafeHtml(running ? ' disabled' : '')} title="sua looks at this board against its goal and suggests what to add or leave out. Nothing changes until you press a suggestion's button.">${review ? 'Look again' : 'Improve this board'}</button>
  </form>`;
}

function suggestion(boardId: string, review: BoardReview, s: StoredBoardSuggestion, title: (id: string) => string): SafeHtml {
  const base = `/boards/${encodeURIComponent(boardId)}/review/${encodeURIComponent(review.id)}`;
  const add = s.type === 'add-agent';
  const what = add ? `Add ${title(s.agentId)}` : `Leave out ${title(s.agentId)}`;
  const state = s.state === 'applied' ? (add ? 'Added' : 'Left out') : s.state === 'skipped' ? 'Skipped' : '';
  return html`
    <li class="board-review__item${s.state !== 'open' ? ' is-done' : ''}" data-review-suggestion="${s.key}">
      <span class="board-review__sign" aria-hidden="true">${add ? '+' : '−'}</span>
      <div class="board-review__text"><span class="board-review__what">${what}</span><span class="board-review__why">${s.why}</span></div>
      ${s.state === 'open' ? html`<div class="board-review__acts">
        <form method="POST" action="${base}/apply" style="margin: 0;"><input type="hidden" name="key" value="${s.key}"><button type="submit" class="btn btn--sm" aria-label="${what}">${add ? 'Add' : 'Leave out'}</button></form>
        <form method="POST" action="${base}/skip" style="margin: 0;"><input type="hidden" name="key" value="${s.key}"><button type="submit" class="board-review__skip" aria-label="Skip: ${what}" title="Don't suggest this again for this board">Skip</button></form>
      </div>` : html`<span class="board-review__state">${state}</span>`}
    </li>`;
}

export function boardReviewCard(boardId: string, c: BoardReviewCard): SafeHtml {
  const r = c.review;
  if (!r) return html``;
  const id = encodeURIComponent(boardId);
  if (r.status === 'running') {
    return html`<section class="board-review" aria-label="sua suggests" data-board-review-running="${boardId}">
      ${working({ size: 'panel', title: 'sua is looking at this board', text: 'Reading what its agents return and what else you have, against what the board is for.', since: new Date(r.createdAt).toISOString() })}
      ${unsafeHtml(`<script>(function(){var el=document.querySelector('[data-board-review-running]');if(!el)return;var id=el.getAttribute('data-board-review-running');function tick(){fetch('/boards/'+encodeURIComponent(id)+'/review.json',{headers:{Accept:'application/json'},credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){if(j&&j.status&&j.status!=='running'){location.reload();return;}setTimeout(tick,3000);}).catch(function(){setTimeout(tick,5000);});}setTimeout(tick,3000);})();</script>`)}
    </section>`;
  }
  if (r.status === 'failed') {
    return html`<section class="board-review" aria-label="sua suggests">
      <p class="board-review__note"><strong>The review didn't finish.</strong> ${r.error ?? ''}</p>
    </section>`;
  }
  const open = r.suggestions.filter((s) => s.state === 'open');
  const needsGoal = !c.goal && !!r.goal;
  return html`<section class="board-review" aria-labelledby="board-review-title">
    <div class="board-review__head">
      <h2 class="board-review__title" id="board-review-title">sua suggests</h2>
      <span class="board-review__round">round ${String(r.round)}</span>
    </div>
    ${needsGoal ? html`
      <form method="POST" action="/boards/${id}/goal" class="board-review__goal">
        <label for="board-review-goal">First, what is this board for? sua's reading of it:</label>
        <textarea id="board-review-goal" name="goal" rows="2" maxlength="280">${r.goal ?? ''}</textarea>
        <input type="hidden" name="proposed" value="${r.goal ?? ''}">
        <div class="board-review__acts"><button type="submit" class="btn btn--sm btn--primary">Use this goal</button><span class="board-review__why">Change the words first if they're off. The suggestions below assume it.</span></div>
      </form>` : html``}
    ${c.redrawing ? html`<p class="board-review__note" role="status"><span class="working__spin" aria-hidden="true"></span>sua is redrawing this board's page with the change.</p>` : html``}
    ${r.suggestions.length ? html`<ul class="board-review__list">${r.suggestions.map((s) => suggestion(boardId, r, s, c.title)) as unknown as SafeHtml[]}</ul>` : html``}
    ${r.note ? html`<p class="board-review__note">${r.note}</p>` : html``}
    ${!open.length ? html`<p class="board-review__note"><strong>${r.suggestions.length ? 'That was all of them.' : 'Nothing more to suggest for this goal.'}</strong>${r.suggestions.length ? ' Look again for another round.' : ''}</p>` : html``}
    ${open.length > 1 ? html`<div class="board-review__foot">
      <form method="POST" action="/boards/${id}/review/${encodeURIComponent(r.id)}/apply" style="margin: 0;"><button type="submit" class="btn btn--sm">Apply all ${String(open.length)}</button></form>
    </div>` : html``}
  </section>`;
}
