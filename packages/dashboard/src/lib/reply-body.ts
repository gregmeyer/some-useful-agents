import { parseInlineWidget, prepareViewForRender, splitReply, viewToMessages, type ViewComponent } from '@some-useful-agents/core';
import { renderSurfaceHost } from './a2ui-surface.js';
import { html, type SafeHtml } from '../views/html.js';
import { mdBody } from '../views/inbox-detail.js';

/**
 * A reply that was answered: its Buttons are spent. The one whose message
 * is what you said next reads "✓ …" so you can see which you picked.
 */
export function markAnswered(components: ViewComponent[], answer: string): ViewComponent[] {
  const said = answer.trim();
  const picked = new Set<string>();
  for (const c of components) {
    if (c.component !== 'Button') continue;
    const msg = ((c.action as { event?: { context?: { message?: unknown } } } | undefined)?.event?.context?.message);
    if (typeof msg === 'string' && msg.trim() === said && typeof c.child === 'string') picked.add(c.child);
  }
  if (!picked.size) return components;
  return components.map((c) => (picked.has(c.id) && c.component === 'Text' && typeof c.text === 'string' ? { ...c, text: `✓ ${c.text}` } : c));
}

/**
 * A reply with its inline widgets drawn in place (docs/a2ui-views.md, "In
 * chat"): the agent's Chat tab, and every conversation in the sua panel or on
 * Home, sua's own replies too. A widget that can't be read says so, with its
 * source one click away; the rest of the reply still shows. `idBase` keeps
 * surface ids unique. `answered` (what the person said next) marks a widget
 * whose buttons were already used: drawn quieter, its pick ticked.
 */
export function renderReplyBody(text: string, idBase: string, imgHosts: string[] = [], opts: { answered?: string } = {}): SafeHtml {
  const parts = splitReply(text);
  if (!parts.some((p) => p.kind === 'widget')) return mdBody(text);
  let n = 0;
  return html`${parts.map((p) => {
    if (p.kind === 'text') return mdBody(p.text.trim()); // the blank lines around a block aren't content
    const i = n++;
    const w = parseInlineWidget(p.raw, imgHosts);
    if ('error' in w) {
      return html`<details class="agent-chat__raw"><summary class="dim">A widget in this reply couldn't be shown</summary><p class="dim">${w.error.slice(0, 300)}</p><pre class="mono">${p.raw}</pre></details>`;
    }
    const model = { data: w.data };
    const id = `${idBase}-w${String(i)}`;
    const answered = opts.answered !== undefined && w.components.some((c) => c.component === 'Button');
    const components = answered ? markAnswered(w.components, opts.answered!) : w.components;
    const host = renderSurfaceHost(id, viewToMessages(id, prepareViewForRender(components, model), model), { label: 'Widget in the reply' });
    return answered ? html`<div class="reply-widget is-answered" title="Already answered">${host}</div>` : host;
  }) as unknown as SafeHtml[]}`;
}
