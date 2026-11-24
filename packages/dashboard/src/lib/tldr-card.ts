/**
 * The TL;DR card when you ask for it (ADR-0093): a page you have sua redraw
 * to show the TL;DR picture (Make the page lead with… the TL;DR picture, or
 * in your own words) keeps it, whatever Auto would decide. Pure but for the
 * store.
 */
import type { NotebookLayout, NotebookStore } from '@some-useful-agents/core';

/** Whether a layout has the TL;DR picture: a Picture part bound to the notebook's picture. */
export function hasTldrPicture(layout: NotebookLayout | undefined): boolean {
  return !!layout?.components.some((c) => {
    if (c.component !== 'Picture') return false;
    const p = c.picture as { path?: unknown; '@path'?: unknown } | undefined;
    return p?.path === '/notebook/picture' || p?.['@path'] === '/notebook/picture';
  });
}

/** After a page change you asked for: one that adds the TL;DR picture sets its card to Always, unless you've chosen. */
export function keepAskedTldrCard(store: Pick<NotebookStore, 'get' | 'setTldrCard'>, notebookId: string, before: NotebookLayout | undefined, after: NotebookLayout | undefined): void {
  const nb = store.get(notebookId);
  if (!nb || nb.tldrCard || hasTldrPicture(before) || !hasTldrPicture(after)) return;
  store.setTldrCard(notebookId, 'always');
}
