/**
 * How you want Today's edition (ADR-0074, ADR-0076). The edition is made
 * fresh every time Pulse opens, so what you change about it can't be saved
 * as a page: it is kept as preferences the generator follows each day.
 * Which agent leads, what is left out or always shown, what needs the wide
 * column, whether the numbers band is drawn, whose top item is shown, and a
 * line of your own. Changed only by ops, from a suggestion you took or
 * something you asked for; one step of Undo.
 */
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

const Id = z.string().min(1).max(120);

export const editionPrefsSchema = z.object({
  /** The agent whose result leads the page (its headline, and first in its column). */
  lead: Id.optional(),
  /** Agents left out of the edition. */
  hidden: z.array(Id).max(200).default([]),
  /** Agents shown whenever they have a result, though they have no schedule or didn't run in the last day. */
  include: z.array(Id).max(50).default([]),
  /** Agents whose result gets the wide column, or the narrow one, whatever its view. */
  wide: z.array(Id).max(50).default([]),
  narrow: z.array(Id).max(50).default([]),
  /** False: no "By the numbers" band. */
  numbers: z.boolean().optional(),
  /** The agent whose top list item is shown, linked, under the headline. */
  topStory: Id.optional(),
  /** A line of yours under the masthead. */
  note: z.string().max(200).optional(),
}).strict();
export type EditionPrefs = z.infer<typeof editionPrefsSchema>;

export const EMPTY_EDITION_PREFS: EditionPrefs = { hidden: [], include: [], wide: [], narrow: [] };

/** One change to the edition. The same words for a suggestion you take and for what sua works out from an ask. */
export const editionOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('lead'), agentId: Id.nullable() }).strict(),
  z.object({ op: z.literal('hide'), agentId: Id }).strict(),
  z.object({ op: z.literal('show'), agentId: Id }).strict(),
  z.object({ op: z.literal('include'), agentId: Id }).strict(),
  z.object({ op: z.literal('width'), agentId: Id, width: z.enum(['wide', 'narrow', 'auto']) }).strict(),
  z.object({ op: z.literal('numbers'), on: z.boolean() }).strict(),
  z.object({ op: z.literal('top-story'), agentId: Id.nullable() }).strict(),
  z.object({ op: z.literal('note'), text: z.string().max(200) }).strict(),
  z.object({ op: z.literal('reset') }).strict(),
]);
export type EditionOp = z.infer<typeof editionOpSchema>;

export class EditionOpError extends Error {}

/**
 * The preferences after these ops. `known`: the agents that exist and have
 * something to show; an op naming any other agent is refused, so what is
 * saved always refers to something real. Pure.
 */
export function applyEditionOps(prefs: EditionPrefs, rawOps: readonly unknown[], known: ReadonlySet<string>): EditionPrefs {
  if (!rawOps.length) throw new EditionOpError('Nothing to change.');
  let next: EditionPrefs = structuredClone(prefs);
  const without = (list: string[], id: string) => list.filter((x) => x !== id);
  for (const [i, raw] of rawOps.entries()) {
    const parsed = editionOpSchema.safeParse(raw);
    if (!parsed.success) throw new EditionOpError(`Change ${String(i + 1)} isn't one the edition takes: ${parsed.error.issues[0]?.message ?? 'unknown shape'}.`);
    const op = parsed.data;
    if ('agentId' in op && op.agentId && !known.has(op.agentId)) throw new EditionOpError(`There's no agent "${op.agentId}" with a result to show.`);
    switch (op.op) {
      case 'lead':
        if (op.agentId) { next.lead = op.agentId; next.hidden = without(next.hidden, op.agentId); } else delete next.lead;
        break;
      case 'hide':
        next.hidden = [...without(next.hidden, op.agentId), op.agentId];
        next.include = without(next.include, op.agentId);
        if (next.lead === op.agentId) delete next.lead;
        if (next.topStory === op.agentId) delete next.topStory;
        break;
      case 'show':
        next.hidden = without(next.hidden, op.agentId);
        break;
      case 'include':
        next.include = [...without(next.include, op.agentId), op.agentId];
        next.hidden = without(next.hidden, op.agentId);
        break;
      case 'width':
        next.wide = without(next.wide, op.agentId);
        next.narrow = without(next.narrow, op.agentId);
        if (op.width === 'wide') next.wide.push(op.agentId);
        if (op.width === 'narrow') next.narrow.push(op.agentId);
        break;
      case 'numbers':
        if (op.on) delete next.numbers; else next.numbers = false;
        break;
      case 'top-story':
        if (op.agentId) next.topStory = op.agentId; else delete next.topStory;
        break;
      case 'note': {
        const text = op.text.replace(/\s+/g, ' ').trim();
        if (text) next.note = text; else delete next.note;
        break;
      }
      case 'reset':
        next = structuredClone(EMPTY_EDITION_PREFS);
        break;
    }
  }
  return editionPrefsSchema.parse(next);
}

/** Whether anything has been changed from the automatic edition. */
export function editionPrefsSet(p: EditionPrefs): boolean {
  return !!(p.lead || p.hidden.length || p.include.length || p.wide.length || p.narrow.length || p.numbers === false || p.topStory || p.note);
}

/** An op in plain words, for the card and the flash ("Lead with Markets"). `title`: an agent's name for people. Pure. */
export function describeEditionOp(op: EditionOp, title: (id: string) => string): string {
  switch (op.op) {
    case 'lead': return op.agentId ? `Lead with ${title(op.agentId)}` : 'Let the day decide what leads';
    case 'hide': return `Leave out ${title(op.agentId)}`;
    case 'show': return `Bring back ${title(op.agentId)}`;
    case 'include': return `Always show ${title(op.agentId)}`;
    case 'width': return op.width === 'auto' ? `Let ${title(op.agentId)} take the column that fits it` : `Put ${title(op.agentId)} in the ${op.width} column`;
    case 'numbers': return op.on ? 'Show the numbers band' : 'Drop the numbers band';
    case 'top-story': return op.agentId ? `Show the top item of ${title(op.agentId)} under the headline` : 'No top item under the headline';
    case 'note': return op.text.trim() ? `Add the line "${op.text.trim()}"` : 'Remove your line under the title';
    case 'reset': return 'Back to the automatic edition';
  }
}

/** Where the edition's preferences are kept: one row, with the one before it for Undo. */
export class EditionPrefsStore {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec('CREATE TABLE IF NOT EXISTS edition_prefs (id TEXT PRIMARY KEY, prefs_json TEXT NOT NULL, previous_json TEXT, updated_at INTEGER NOT NULL)');
  }

  private parse(raw: string | null | undefined): EditionPrefs | undefined {
    if (!raw) return undefined;
    try { const p = editionPrefsSchema.safeParse(JSON.parse(raw)); return p.success ? p.data : undefined; } catch { return undefined; }
  }

  get(): EditionPrefs {
    const row = this.db.prepare("SELECT prefs_json FROM edition_prefs WHERE id = 'today'").get() as { prefs_json: string } | undefined;
    return this.parse(row?.prefs_json) ?? structuredClone(EMPTY_EDITION_PREFS);
  }

  /** Whether there's a step to undo. */
  canUndo(): boolean {
    const row = this.db.prepare("SELECT previous_json FROM edition_prefs WHERE id = 'today'").get() as { previous_json: string | null } | undefined;
    return !!this.parse(row?.previous_json);
  }

  save(prefs: EditionPrefs, now = Date.now()): EditionPrefs {
    const clean = editionPrefsSchema.parse(prefs);
    this.db.prepare("INSERT INTO edition_prefs (id, prefs_json, previous_json, updated_at) VALUES ('today', ?, ?, ?) ON CONFLICT(id) DO UPDATE SET previous_json = prefs_json, prefs_json = excluded.prefs_json, updated_at = excluded.updated_at")
      .run(JSON.stringify(clean), JSON.stringify(EMPTY_EDITION_PREFS), now);
    return clean;
  }

  /** Put back the preferences from before the last change (Undo again redoes it). */
  undo(now = Date.now()): EditionPrefs | undefined {
    const row = this.db.prepare("SELECT prefs_json, previous_json FROM edition_prefs WHERE id = 'today'").get() as { prefs_json: string; previous_json: string | null } | undefined;
    const prev = this.parse(row?.previous_json);
    if (!row || !prev) return undefined;
    this.db.prepare("UPDATE edition_prefs SET prefs_json = ?, previous_json = ?, updated_at = ? WHERE id = 'today'").run(JSON.stringify(prev), row.prefs_json, now);
    return prev;
  }
}
