/**
 * Lightweight count endpoint for the global inbox badge. Mounted BEFORE
 * inboxRouter so `/inbox/needs-you-count` isn't shadowed by `/inbox/:id`.
 * Returns the number of threads awaiting an operator reply so the nav badge
 * can show "the inbox needs you" on every page without threading a count
 * through every page's layout() render.
 */
import { Router, type Request, type Response } from 'express';
import { getContext } from '../context.js';
import { readHomeSurface } from '../lib/home-surface.js';
import { needsYouCount } from '../views/home-surface.js';

export const inboxCountRouter: Router = Router();

inboxCountRouter.get('/inbox/needs-you-count', (req: Request, res: Response) => {
  const ctx = getContext(req.app.locals);
  // What Today shows as needing you, so the pill and the page it opens agree; the raw thread count if Today can't be read.
  let count: number;
  try { count = needsYouCount(readHomeSurface(ctx)); } catch { count = ctx.inboxStore ? ctx.inboxStore.countNeedsYou() : 0; }
  const done = recentDone(ctx);
  res.json({ count, ...(done ? { done } : {}) });
});

/** How long a finished answer is named on the pill. */
const DONE_FRESH_MS = 30 * 60_000;

/**
 * The answer that finished most recently (its conversation's last message is
 * sua's "Done…", in the last half hour, and still waiting on you): the pill
 * names it and goes straight to it. None otherwise.
 */
export function recentDone(ctx: ReturnType<typeof getContext>, now = Date.now()): { title: string; href: string } | undefined {
  if (!ctx.inboxStore) return undefined;
  try {
    for (const m of ctx.inboxStore.list({ status: 'awaiting_user', limit: 20 })) {
      const last = ctx.inboxStore.listResponses(m.id).at(-1);
      if (!last || last.role !== 'triage' || !last.body.startsWith('Done') || now - last.createdAt > DONE_FRESH_MS) continue;
      const href = /\[Open the answer →\]\((\/notebooks\/[^)\s]+)\)/.exec(last.body)?.[1];
      if (!href) continue;
      return { title: m.title.replace(/^(?:Answer|Notebook):\s*/, ''), href };
    }
  } catch { /* the pill just counts */ }
  return undefined;
}
