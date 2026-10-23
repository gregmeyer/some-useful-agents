import { html, type SafeHtml } from './html.js';
import type { SuggestedAsk } from '../lib/home-suggestions.js';

/**
 * Questions for sua as pills: one click starts the conversation and opens it in the panel
 * (`[data-ask-send]`, inbox-modal.js.ts). Without JS each is a form that posts the question.
 */
export function renderAskPills(asks: readonly SuggestedAsk[]): SafeHtml {
  if (!asks.length) return html``;
  return html`<div class="ask-pills" role="group" aria-label="Ask sua">${asks.map((a) => html`
    <form method="POST" action="/inbox/new" class="ask-pills__form">
      <input type="hidden" name="body" value="${a.text}">
      <button type="submit" class="ask-pill" data-ask-send="${a.text}" title="${a.text}">${a.label}</button>
    </form>`) as unknown as SafeHtml[]}</div>`;
}
