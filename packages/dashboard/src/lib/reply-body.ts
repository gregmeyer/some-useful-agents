import { parseInlineWidget, prepareViewForRender, splitReply, viewToMessages } from '@some-useful-agents/core';
import { renderSurfaceHost } from './a2ui-surface.js';
import { html, type SafeHtml } from '../views/html.js';
import { mdBody } from '../views/inbox-detail.js';

/**
 * An agent's reply with its inline widgets drawn in place (docs/a2ui-views.md,
 * "In chat"): the agent's Chat tab and the same conversation in the sua panel
 * or on Home. A widget that can't be read says so, with its source one click
 * away; the rest of the reply still shows. `idBase` keeps surface ids unique.
 */
export function renderReplyBody(text: string, idBase: string, imgHosts: string[] = []): SafeHtml {
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
    return renderSurfaceHost(id, viewToMessages(id, prepareViewForRender(w.components, model), model), { label: 'Widget in the reply' });
  }) as unknown as SafeHtml[]}`;
}
