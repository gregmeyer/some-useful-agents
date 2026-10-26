/**
 * Edit the talking points sua wrote for a notebook (its write step): each
 * point's sentence, why it matters and its question, in any order, some
 * dropped, new ones added; then the questions to ask and what to watch
 * for, a line each. The themes a point rests on are kept as they are (they
 * hold its quotes and sources) and shown, not edited.
 */
import type { Notebook, NotebookEntry } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { pageHeader } from './page-header.js';

export function renderTalkingPointsEdit(args: { nb: Notebook; entries: readonly NotebookEntry[]; flash?: { kind: 'error' | 'info' | 'ok'; message: string } }): string {
  const { nb } = args;
  const id = encodeURIComponent(nb.id);
  const b = nb.briefing ?? { points: [], questions: [], watch: [], at: '', by: '' };
  const names = new Map(args.entries.filter((e) => e.kind === 'option').map((e) => [e.id, e.title]));
  const row = (p: { text: string; why?: string; ask?: string; from: string[] }, i: number, fresh = false) => html`
    <li class="tpe-point" data-tp-row>
      <input type="hidden" name="point_uid" value="${fresh ? 'new' : `p${String(i)}`}">
      <input type="hidden" name="point_from" value="${p.from.join(',')}">
      <div class="tpe-point__head">
        <span class="tpe-point__n" aria-hidden="true">${fresh ? '+' : String(i + 1)}</span>
        <textarea name="point_text" rows="2" class="form-field tpe-point__text" aria-label="${fresh ? 'A new point' : `Point ${String(i + 1)}`}" placeholder="${fresh ? 'Add a point to raise' : ''}">${p.text}</textarea>
        ${fresh ? html`` : html`<span class="tpe-point__acts">
          <button type="button" class="btn btn--sm btn--ghost" data-tp-up aria-label="Move point ${String(i + 1)} up">↑</button>
          <button type="button" class="btn btn--sm btn--ghost" data-tp-down aria-label="Move point ${String(i + 1)} down">↓</button>
          <label class="tpe-point__drop"><input type="checkbox" name="point_drop" value="p${String(i)}"> Remove</label>
        </span>`}
      </div>
      <label class="tpe-field"><span>Why it matters to them</span><textarea name="point_why" rows="2" class="form-field">${p.why ?? ''}</textarea></label>
      <label class="tpe-field"><span>Question to ask</span><input type="text" name="point_ask" class="form-field" value="${p.ask ?? ''}"></label>
      ${p.from.length ? html`<p class="tpe-point__from">From what they said: ${p.from.map((f, k) => html`${k ? ', ' : ''}<a href="/notebooks/${id}/entries/${encodeURIComponent(f)}">${names.get(f) ?? 'a theme since removed'}</a>`) as unknown as SafeHtml[]}</p>` : html``}
    </li>`;
  return render(layout({ title: `Talking points: ${nb.title}`, activeNav: 'notebooks', flash: args.flash }, html`
    <div class="tpe">
      ${pageHeader({
        crumbs: [{ label: 'Home', href: '/' }, { label: 'Notebooks', href: '/notebooks' }, { label: nb.title, href: `/notebooks/${id}` }, { label: 'Talking points' }],
        title: 'Edit the talking points',
        description: 'Change what to raise, why it matters and what to ask; reorder, remove or add points. The quotes behind a point stay as they are. The briefing and its brief show what you save.',
      })}
      ${b.points.length ? html`` : html`<p class="tpe-none">sua hasn't written talking points for this notebook yet. Run its write step first, or add your own below.</p>`}
      <form method="POST" action="/notebooks/${id}/talking-points" class="tpe-form">
        <ol class="tpe-points" data-tp-list>
          ${b.points.map((p, i) => row(p, i)) as unknown as SafeHtml[]}
          ${row({ text: '', from: [] }, b.points.length, true)}
        </ol>
        <label class="tpe-field tpe-field--list"><span>More questions to ask <em>one a line</em></span><textarea name="questions" rows="${String(Math.max(3, b.questions.length + 1))}" class="form-field">${b.questions.join('\n')}</textarea></label>
        <label class="tpe-field tpe-field--list"><span>Watch out for <em>one a line</em></span><textarea name="watch" rows="${String(Math.max(2, b.watch.length + 1))}" class="form-field">${b.watch.join('\n')}</textarea></label>
        <div class="tpe-foot">
          <button type="submit" class="btn btn--primary btn--sm">Save</button>
          <a class="btn btn--sm btn--ghost" href="/notebooks/${id}">Cancel</a>
          ${b.by && b.by !== 'you' ? html`<span class="tpe-foot__note">Written by sua${b.at ? ` on ${new Date(b.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}. Write again replaces what you save here.</span>` : b.by === 'you' ? html`<span class="tpe-foot__note">You edited these. Write again replaces them.</span>` : html``}
        </div>
      </form>
      ${unsafeHtml(`<script>(function () {
        // Move a point up or down (the new-point row stays last); the numbers follow.
        var list = document.querySelector('[data-tp-list]');
        if (!list) return;
        var isNew = function (li) { return li && li.querySelector('input[name=point_uid]').value === 'new'; };
        list.addEventListener('click', function (e) {
          var up = e.target.closest('[data-tp-up]'), down = e.target.closest('[data-tp-down]');
          if (!up && !down) return;
          var li = e.target.closest('[data-tp-row]');
          if (up && li.previousElementSibling) list.insertBefore(li, li.previousElementSibling);
          if (down && li.nextElementSibling && !isNew(li.nextElementSibling)) list.insertBefore(li.nextElementSibling, li);
          var n = 0;
          list.querySelectorAll('.tpe-point__n').forEach(function (s) { if (s.textContent !== '+') { n++; s.textContent = String(n); } });
        });
      })();</script>`)}
    </div>
  `));
}
