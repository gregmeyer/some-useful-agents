/**
 * "sua is working on it": the one way the dashboard shows that it heard you
 * and has started (DESIGN.md "Working"). Two sizes:
 *  - inline: a small spinning ring and a line ("Drafting…" in a button, a
 *    status line on a page);
 *  - panel: a large ring, a title, what you asked in your words, what it's
 *    doing, and how long it's been (counted in the page, never guessed).
 * The same markup comes from the browser (window.suaWorking, WORKING_JS), so
 * a page drawn by the server and one drawn by a script look the same.
 */
import { html, type SafeHtml } from './html.js';

export interface WorkingOpts {
  /** The line it says (inline), or under the title (panel). */
  text: string;
  size?: 'inline' | 'panel';
  /** panel: what it's doing, as a heading ("sua heard you and is drafting your notebook"). */
  title?: string;
  /** panel: what you asked, in your words (shown quoted). */
  said?: string;
  /** When it started (ISO): the panel counts up from it. */
  since?: string;
}

export function working(o: WorkingOpts): SafeHtml {
  if (o.size !== 'panel') return html`<span class="working" role="status"><span class="working__spin" aria-hidden="true"></span><span class="working__text">${o.text}</span></span>`;
  return html`<div class="working working--panel" role="status">
    <span class="working__spin" aria-hidden="true"></span>
    <div class="working__body">
      ${o.title ? html`<p class="working__title">${o.title}</p>` : html``}
      ${o.said ? html`<p class="working__said">“${o.said}”</p>` : html``}
      <p class="working__text">${o.text}</p>
      ${o.since ? html`<p class="working__time" data-working-since="${o.since}" aria-hidden="true"></p>` : html``}
    </div>
  </div>`;
}

/**
 * In the browser: window.suaWorking(opts) gives the same markup as working()
 * (for scripts that draw a working state), and every panel's time counts up
 * ("12s", "1m 05s") from its data-working-since.
 */
export const WORKING_JS = `
(function () {
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  window.suaWorking = function (o) {
    o = o || {};
    if (o.size !== 'panel') return '<span class="working" role="status"><span class="working__spin" aria-hidden="true"></span><span class="working__text">' + esc(o.text) + '</span></span>';
    return '<div class="working working--panel" role="status"><span class="working__spin" aria-hidden="true"></span><div class="working__body">'
      + (o.title ? '<p class="working__title">' + esc(o.title) + '</p>' : '')
      + (o.said ? '<p class="working__said">\\u201c' + esc(o.said) + '\\u201d</p>' : '')
      + '<p class="working__text">' + esc(o.text) + '</p>'
      + (o.since ? '<p class="working__time" data-working-since="' + esc(o.since) + '" aria-hidden="true"></p>' : '')
      + '</div></div>';
  };
  function tick() {
    var els = document.querySelectorAll('[data-working-since]');
    for (var i = 0; i < els.length; i++) {
      var t = Date.parse(els[i].getAttribute('data-working-since'));
      if (isNaN(t)) continue;
      var s = Math.max(0, Math.round((Date.now() - t) / 1000));
      els[i].textContent = s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's';
    }
  }
  tick();
  setInterval(tick, 1000);
})();
`;
