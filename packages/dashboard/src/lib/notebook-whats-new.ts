/**
 * What's new since the last run, for a briefing (a notebook with a profile
 * or write step): each part against its own previous run. Facts about them
 * (and their competitors, their other companies) against the profile step's
 * run before; what was found against the find step's; what sua wrote against
 * the version it replaced. Only what the latest run did counts: a fact you
 * settled since, or points you edited, aren't "new". Pure.
 */
import type { Notebook, NotebookEntry, NotebookPass, NotebookStepKind, NotebookWrittenBefore } from '@some-useful-agents/core';

type Pass = Pick<NotebookPass, 'startedAt' | 'finishedAt' | 'stepId'>;

export interface WhatsNew {
  /** When the run before finished (what it's new since). */
  since: string;
  /** When the latest run finished. */
  at: string;
  facts: { new: string[]; changed: Array<{ label: string; was: string; now: string }> };
  competitors: string[];
  affiliations: string[];
  /** What the latest find added (sources, themes: the notebook's options). */
  sources: number;
  /** Talking points, findings or plan items: new ones and ones it dropped. */
  points: { new: number; dropped: number };
  /** Nothing changed: a recheck that found nothing new. */
  empty: boolean;
  /** A fact's mark on the page ("person:role" → new, or changed with what it was). */
  marks: Record<string, { mark: 'new' | 'changed'; was?: string }>;
}

interface Window { start: string; end: string; since: string }

/** The latest finished run of these steps, and when the one before finished; none without one before. */
function rerun(nb: Pick<Notebook, 'steps'>, passes: readonly Pass[], kinds: readonly NotebookStepKind[]): Window | undefined {
  const ids = new Set((nb.steps ?? []).filter((s) => kinds.includes(s.kind)).map((s) => s.id));
  if (!ids.size) return undefined;
  const done = passes.filter((p) => p.stepId && ids.has(p.stepId) && p.finishedAt).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (done.length < 2) return undefined;
  return { start: done[0].startedAt, end: done[0].finishedAt!, since: done[1].finishedAt ?? done[1].startedAt };
}

const inside = (t: string | undefined, w: Window) => !!t && t >= w.start && t <= w.end;
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

function writtenItems(nb: Notebook): { at: string; items: string[]; previous?: NotebookWrittenBefore } | undefined {
  if (nb.briefing) return { at: nb.briefing.at, items: nb.briefing.points.map((p) => p.text), previous: nb.briefing.previous };
  if (nb.answer) return { at: nb.answer.at, items: nb.answer.findings.map((f) => f.text), previous: nb.answer.previous };
  if (nb.plan) return { at: nb.plan.at, items: nb.plan.items.map((i) => i.title), previous: nb.plan.previous };
  return undefined;
}

export function whatsNew(nb: Notebook, entries: readonly NotebookEntry[], passes: readonly Pass[]): WhatsNew | undefined {
  const profile = rerun(nb, passes, ['profile']);
  const find = rerun(nb, passes, ['find']);
  const write = rerun(nb, passes, ['write']);
  if (!profile && !find && !write) return undefined;

  const out: WhatsNew = { since: '', at: '', facts: { new: [], changed: [] }, competitors: [], affiliations: [], sources: 0, points: { new: 0, dropped: 0 }, empty: true, marks: {} };
  if (profile) {
    for (const who of ['person', 'company'] as const) {
      const one = nb.about?.[who];
      if (!one) continue;
      for (const f of one.facts) {
        if (inside(f.changedAt, profile) && f.was && norm(f.was.value) !== norm(f.value)) {
          out.facts.changed.push({ label: f.label, was: f.was.value, now: f.value });
          out.marks[`${who}:${f.key}`] = { mark: 'changed', was: f.was.value };
        } else if (inside(f.firstAt, profile)) {
          out.facts.new.push(f.label);
          out.marks[`${who}:${f.key}`] = { mark: 'new' };
        }
      }
      for (const c of one.competitors ?? []) if (inside(c.firstAt, profile)) out.competitors.push(c.name);
      for (const a of one.affiliations ?? []) if (inside(a.firstAt, profile)) out.affiliations.push(a.name);
    }
  }
  if (find) out.sources = entries.filter((e) => e.kind === 'option' && inside(e.createdAt, find)).length;
  const w = writtenItems(nb);
  if (write && w?.previous && inside(w.at, write)) {
    const before = new Set(w.previous.items.map(norm));
    const now = new Set(w.items.map(norm));
    out.points = { new: w.items.filter((x) => !before.has(norm(x))).length, dropped: w.previous.items.filter((x) => !now.has(norm(x))).length };
  }
  const windows = [profile, find, write].filter((x): x is Window => !!x);
  out.at = windows.map((x) => x.end).sort().at(-1)!;
  out.since = windows.map((x) => x.since).sort().at(-1)!;
  out.empty = !out.facts.new.length && !out.facts.changed.length && !out.competitors.length && !out.affiliations.length && !out.sources && !out.points.new && !out.points.dropped;
  return out;
}

/** "Oct 28": the band's and the conversation's dates. */
export const shortDay = (iso: string): string => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** What's new, as a conversation message: the band's lines, or that nothing changed. */
export function whatsNewSummary(w: WhatsNew): string {
  const lines = whatsNewLines(w);
  return lines.length ? `**What's new since ${shortDay(w.since)}:**\n${lines.map((l) => `- ${l}`).join('\n')}` : `Nothing new since ${shortDay(w.since)}.`;
}

/** The band's lines, in words ("2 new facts: Revenue, Headquarters"). Empty when nothing changed. */
export function whatsNewLines(w: WhatsNew): string[] {
  const n = (k: number, one: string, many = `${one}s`) => `${String(k)} ${k === 1 ? one : many}`;
  const names = (xs: readonly string[]) => (xs.length > 4 ? `${xs.slice(0, 4).join(', ')} and ${String(xs.length - 4)} more` : xs.join(', '));
  const lines: string[] = [];
  if (w.facts.new.length) lines.push(`${n(w.facts.new.length, 'new fact')}: ${names(w.facts.new)}`);
  for (const c of w.facts.changed.slice(0, 3)) lines.push(`Changed: ${c.label}, ${c.was} → ${c.now}`);
  if (w.facts.changed.length > 3) lines.push(`${n(w.facts.changed.length - 3, 'more changed fact')}`);
  if (w.competitors.length) lines.push(`${n(w.competitors.length, 'new competitor')}: ${names(w.competitors)}`);
  if (w.affiliations.length) lines.push(`${n(w.affiliations.length, 'new other company', 'new other companies')}: ${names(w.affiliations)}`);
  if (w.sources) lines.push(`${n(w.sources, 'new finding')} from the search`);
  if (w.points.new || w.points.dropped) lines.push(`Rewritten: ${[w.points.new ? `${String(w.points.new)} new` : '', w.points.dropped ? `${String(w.points.dropped)} dropped` : ''].filter(Boolean).join(', ')}`);
  return lines;
}
