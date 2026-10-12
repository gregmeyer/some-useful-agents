/**
 * Notebook photos (notebooks step 1b): keep a copy of each option's photo, so
 * a card shows the actual car (or flat, or product) and still does after the
 * listing is gone. The photo comes from the option's image field, else from
 * its listing page's own preview photo, and only when that page is the
 * listing (an id in its address, and a title naming the option). Every fetch
 * goes through core's guarded fetchers: no private addresses, JPEG / PNG /
 * GIF / WebP only, size-capped. A failed address is remembered, not retried.
 */
import {
  fetchImage as coreFetchImage, pagePreview as corePagePreview, looksLikeOneListing, previewMatchesOption,
  type NotebookStore, type FetchedImage,
} from '@some-useful-agents/core';

export interface PhotoDeps {
  fetchImage: (url: string) => Promise<Pick<FetchedImage, 'bytes' | 'contentType'>>;
  pagePreview: (url: string) => Promise<{ image?: string; title?: string }>;
}

const defaultDeps: PhotoDeps = { fetchImage: (u) => coreFetchImage(u), pagePreview: (u) => corePagePreview(u) };

/** Try photos for up to `limit` options, three at a time. Returns how many were kept. */
export async function keepPhotos(store: NotebookStore, notebookId: string, opts: { limit?: number; deps?: PhotoDeps } = {}): Promise<{ kept: number; tried: number }> {
  const deps = opts.deps ?? defaultDeps;
  const queue = store.photoCandidates(notebookId, opts.limit ?? 8);
  let kept = 0;
  const work = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      let source = c.image;
      try {
        if (!source && c.link) {
          source = c.link;
          if (!looksLikeOneListing(c.link)) throw new Error('The link is a page of results, not one listing.');
          const preview = await deps.pagePreview(c.link);
          if (!preview.image) throw new Error('The listing page has no preview photo.');
          if (!preview.title || !previewMatchesOption(preview.title, c.entry.title)) throw new Error("The listing page doesn't look like this option.");
          source = preview.image;
        }
        if (!source) continue;
        const img = await deps.fetchImage(source);
        store.savePhoto(notebookId, c.entry.id, c.image ?? c.link ?? source, { contentType: img.contentType, bytes: img.bytes });
        kept++;
      } catch (err) {
        store.savePhoto(notebookId, c.entry.id, c.image ?? c.link ?? source ?? '', { error: err instanceof Error ? err.message : String(err) });
      }
    }
  };
  const tried = queue.length;
  await Promise.all([work(), work(), work()]);
  return { kept, tried };
}

/**
 * In the background, once per notebook at a time: try listing photos for
 * options that don't have one (each address is tried once). Returns whether it started.
 */
export function startListingPhotos(ctx: { notebookListingPhotos?: Set<string> }, store: NotebookStore, notebookId: string): boolean {
  if (store.photoCandidates(notebookId, 1).length === 0) return false;
  ctx.notebookListingPhotos ??= new Set();
  if (ctx.notebookListingPhotos.has(notebookId)) return false;
  ctx.notebookListingPhotos.add(notebookId);
  void keepPhotos(store, notebookId).catch(() => { /* a nicety */ }).finally(() => ctx.notebookListingPhotos?.delete(notebookId));
  return true;
}
