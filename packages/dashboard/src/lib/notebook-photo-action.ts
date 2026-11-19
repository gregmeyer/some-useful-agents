/**
 * sua's "Use this picture" card (`notebook-photo`) from a notebook's
 * conversation: the picture that leads the notebook's page, chosen in words
 * ("give me a different photo", "use this one"). IMAGE is the image's own
 * address (or a page whose preview picture it is); PAGE where it's from;
 * CREDIT who to credit; ALT what it shows. The image is fetched through
 * core's guarded fetch (a JPEG, PNG, GIF or WebP; never SVG) and kept in
 * the notebook, so the page never loads it from that site. CLEAR "1" goes
 * back to the sources' own photos.
 */
import { fetchImage as coreFetchImage, pagePreview as corePagePreview, type InboxActionMeta, type InboxActionStatus } from '@some-useful-agents/core';
import { notebooksOf } from './notebook-chat.js';
import type { getContext } from '../context.js';

type Ctx = ReturnType<typeof getContext>;

export interface PhotoDeps {
  fetchImage: (url: string) => Promise<{ bytes: Uint8Array; contentType: string }>;
  pagePreview: (url: string) => Promise<{ image?: string }>;
}
const defaultDeps: PhotoDeps = { fetchImage: (u) => coreFetchImage(u, { maxBytes: 5 * 1024 * 1024 }), pagePreview: (u) => corePagePreview(u) };

/** The image itself: the address as given, else the preview picture of that page (a Wikimedia file page, an article). */
async function imageAt(url: string, deps: PhotoDeps): Promise<{ bytes: Uint8Array; contentType: string; image: string } | { error: string }> {
  try { return { ...(await deps.fetchImage(url)), image: url }; } catch (first) {
    try {
      const preview = (await deps.pagePreview(url)).image;
      if (preview) return { ...(await deps.fetchImage(preview)), image: preview };
    } catch { /* the first reason says it */ }
    return { error: first instanceof Error ? first.message : String(first) };
  }
}

export async function executeNotebookPhoto(ctx: Ctx, meta: InboxActionMeta, deps: PhotoDeps = ctx.notebookPhotoDeps ?? defaultDeps): Promise<{ status: InboxActionStatus; summary?: string; refusalReason?: string }> {
  const store = notebooksOf(ctx);
  const nb = store.get(meta.inputs.NOTEBOOK ?? '');
  if (!nb) return { status: 'failed', refusalReason: 'That notebook is gone.' };
  const link = `[the notebook](/notebooks/${encodeURIComponent(nb.id)})`;
  if (meta.inputs.CLEAR === '1') {
    store.setChosenPhoto(nb.id, undefined);
    return { status: 'completed', summary: `${link} shows its sources' own photos again.` };
  }
  const url = (meta.inputs.IMAGE ?? '').trim();
  if (!/^https?:\/\//i.test(url)) return { status: 'failed', refusalReason: 'There was no picture address to use.' };
  const got = await imageAt(url, deps);
  if ('error' in got) return { status: 'failed', refusalReason: `That picture couldn't be fetched (${got.error}). Find another, or send its address.` };
  store.setChosenPhoto(nb.id, { ...got, ...(meta.inputs.PAGE ? { page: meta.inputs.PAGE } : {}), ...(meta.inputs.CREDIT ? { credit: meta.inputs.CREDIT } : {}), ...(meta.inputs.ALT ? { alt: meta.inputs.ALT } : {}) });
  return { status: 'completed', summary: `${link} leads with that picture now${meta.inputs.CREDIT ? `, credited "${meta.inputs.CREDIT}"` : ''}. Ask me to go back to its sources' photos any time.` };
}
