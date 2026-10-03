import type { InboxMessage } from '@some-useful-agents/core';
import { html, type SafeHtml } from './html.js';
import { formatAge } from './components.js';

/** Starting points for an empty panel. Clicking one fills the box; nothing sends until you do. */
const SUGGESTIONS = [
  'What failed overnight?',
  'Build me a board for my mornings',
  'Which of my agents could help with my week?',
];

/**
 * The conversation panel with no thread open (`GET /panel/home`): a box to
 * ask sua something, a few starting points, and your recent threads. Asking
 * creates an inbox thread and opens it in the panel (inbox-modal.js.ts).
 */
export function renderPanelHome(args: { recent: InboxMessage[] }): SafeHtml {
  const recent = args.recent.length === 0
    ? html``
    : html`
      <section class="panel-home__recent">
        <h3 class="panel-home__label">Pick up where you left off</h3>
        <ul class="panel-home__list">
          ${args.recent.map((m) => html`
            <li>
              <button type="button" class="panel-home__thread" data-panel-thread-id="${m.id}">
                <span class="panel-home__thread-title">${m.title}</span>
                <span class="panel-home__thread-meta">
                  ${m.status === 'awaiting_user' ? html`<span class="panel-home__yours">Your turn</span> · ` : html``}${formatAge(new Date(m.lastActivityAt ?? m.createdAt).toISOString())}
                </span>
              </button>
            </li>`) as unknown as SafeHtml[]}
        </ul>
      </section>`;

  return html`
    <div class="panel-home">
      <h2 class="panel-home__title" id="inbox-modal-title">Ask sua</h2>
      <p class="panel-home__intro">Ask about anything you see, or have sua run, build or fix something. This stays open beside the page as you move around, and it's kept in your <a href="/inbox">inbox</a>.</p>
      <form class="inbox-chatbar panel-home__composer" method="POST" action="/inbox/new" data-home-ask>
        <span class="inbox-chatbar__prompt" aria-hidden="true">you&nbsp;›</span>
        <textarea name="body" rows="2" required maxlength="8192" class="inbox-chatbar__input"
          placeholder="Ask sua…" aria-label="Ask sua" data-home-ask-input data-panel-composer></textarea>
        <button type="submit" class="btn btn--sm btn--primary inbox-chatbar__send" data-home-ask-send>Send ↵</button>
      </form>
      <div class="panel-home__chips">
        ${SUGGESTIONS.map((s) => html`<button type="button" class="panel-home__chip" data-panel-ask="${s}">${s}</button>`) as unknown as SafeHtml[]}
      </div>
      ${recent}
    </div>`;
}
