import { html, type SafeHtml } from './html.js';
import { formatAge } from './components.js';

/**
 * The shared thread component: one message row and one list, used by the
 * inbox thread and the agent Chat tab (and, later, the side panel). Both
 * kinds of conversation live in the inbox store (ADR-0048); this is where
 * they look the same. The client twin is `thread.js.ts` (window.suaThread),
 * which builds the same markup for optimistic and streaming rows.
 *
 * Markup: `ul.inbox-timeline > li.inbox-timeline__entry > div.inbox-msg`, a
 * mono `sigil ›` speaker column and a body with a meta line. Consecutive
 * same-speaker rows group under one sigil.
 */
export interface ThreadMessage {
  /** Response id, for `data-msg-id` (the inbox modal tracks new rows by it). */
  id?: string;
  /** Speaker role: drives `inbox-msg--<role>` and the sigil color. */
  role: string;
  /** Short mono speaker name shown as `sigil ›`. */
  sigil: string;
  /** Accessible speaker name. */
  label: string;
  /** Epoch ms or ISO string. Omitted on a row still being written. */
  createdAt?: number | string;
  body: SafeHtml;
  /** Shown instead of the time while the row is in progress ("Working…"). */
  writing?: string;
  grouped?: boolean;
  /** Meta-line items before the time (badges). */
  metaBefore?: SafeHtml;
  /** Meta-line items after the time (run link). */
  metaAfter?: SafeHtml;
  /** Below the text (CTA buttons). */
  after?: SafeHtml;
  /** A Copy button for the text. Default on for finished rows. */
  copy?: boolean;
  classes?: string[];
}

export function renderThreadMessage(m: ThreadMessage): SafeHtml {
  const classes = ['inbox-msg', `inbox-msg--${m.role}`, m.grouped ? 'inbox-msg--grouped' : '', ...(m.classes ?? [])]
    .filter(Boolean).join(' ');
  const copy = m.copy ?? !m.writing;
  const time = m.writing
    ? html`<span class="inbox-msg__writing">${m.writing}</span>`
    : m.createdAt !== undefined
      ? html`<span class="inbox-msg__time">${formatAge(typeof m.createdAt === 'number' ? new Date(m.createdAt).toISOString() : m.createdAt)}</span>`
      : html``;
  return html`
    <div class="${classes}"${m.id ? html` data-msg-id="${m.id}"` : html``}>
      <div class="inbox-msg__avatar inbox-msg__avatar--${m.role}" aria-label="${m.label}">${m.sigil}</div>
      <div class="inbox-msg__body">
        <div class="inbox-msg__meta">
          ${m.metaBefore ?? html``}
          ${time}
          ${m.metaAfter ?? html``}
          ${copy ? html`<button type="button" class="inbox-msg__copy" data-inbox-copy
            aria-label="Copy ${m.label} message"
            title="Copy this message">
            <span data-inbox-copy-label>Copy</span>
          </button>` : html``}
        </div>
        <div class="inbox-msg__text" data-inbox-copy-source>${m.body}</div>
        ${m.after ?? html``}
      </div>
    </div>
  `;
}

/** Rows into the thread list. Each item is a rendered row (a message or a card). */
export function renderThread(items: SafeHtml[], opts: { className?: string } = {}): SafeHtml {
  return html`<ul class="inbox-timeline${opts.className ? ` ${opts.className}` : ''}">
    ${items.map((item) => html`<li class="inbox-timeline__entry">${item}</li>`) as unknown as SafeHtml[]}
  </ul>`;
}

/** Whether row `i` continues the previous row's speaker. */
export function isGrouped<T>(rows: readonly T[], i: number, speaker: (row: T) => string | undefined): boolean {
  if (i === 0) return false;
  const a = speaker(rows[i - 1]);
  return a !== undefined && a === speaker(rows[i]);
}
