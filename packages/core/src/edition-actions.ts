/**
 * Things sua may offer to DO for Today's edition beside changing how it's
 * made (edition-prefs ops): run a part again. These cost a run, so they are
 * never part of "Apply all": each has its own button the person presses.
 * Checked against the edition as it is (pure).
 */
import { z } from 'zod';

const Id = z.string().min(1).max(120);

export const editionActionSchema = z.discriminatedUnion('do', [
  /** Run a part again with its last inputs: only one that's older than a day or whose newest run failed. */
  z.object({ do: z.literal('rerun'), agentId: Id }).strict(),
]);
export type EditionAction = z.infer<typeof editionActionSchema>;

/** What the check needs to know about a part of the edition. */
export interface EditionPartFacts {
  /** Hours since its result. */
  ageHours: number;
  /** Its newest run failed after that result. */
  failed: boolean;
  /** It can run again now (active, and its last inputs are enough). */
  canRunAgain: boolean;
}

/** At most this many actions in one answer. */
export const EDITION_ACTIONS_MAX = 4;

/**
 * The actions that can be offered, or why one can't: a rerun names a part
 * that's showing, is over a day old or failed, and can run again. Pure.
 */
export function checkEditionActions(raw: readonly unknown[], parts: ReadonlyMap<string, EditionPartFacts>): { actions: EditionAction[] } | { error: string } {
  const out: EditionAction[] = [];
  for (const [i, r] of raw.slice(0, EDITION_ACTIONS_MAX).entries()) {
    const p = editionActionSchema.safeParse(r);
    if (!p.success) return { error: `Action ${String(i + 1)} isn't one sua can offer here.` };
    const a = p.data;
    const f = parts.get(a.agentId);
    if (!f) return { error: `"${a.agentId}" isn't on the edition, so it can't be run again from here.` };
    if (!f.failed && f.ageHours <= 24) return { error: `"${a.agentId}" is from the last day; there's nothing to run again.` };
    if (!f.canRunAgain) return { error: `"${a.agentId}" needs inputs before it can run; that's done on its page.` };
    if (!out.some((x) => x.agentId === a.agentId)) out.push(a);
  }
  return { actions: out };
}

/** An action in plain words, with why ("Run Weather again: its result is 15 days old"). Pure. */
export function describeEditionAction(a: EditionAction, title: (id: string) => string, parts: ReadonlyMap<string, EditionPartFacts>): string {
  const f = parts.get(a.agentId);
  const why = !f ? '' : f.failed ? ': its last run failed' : `: its result is ${f.ageHours >= 48 ? `${String(Math.floor(f.ageHours / 24))} days` : `${String(Math.round(f.ageHours))} hours`} old`;
  return `Run ${title(a.agentId)} again${why}`;
}
