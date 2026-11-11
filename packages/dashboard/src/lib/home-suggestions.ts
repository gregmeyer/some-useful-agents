/**
 * Home's Ask sua card: ways to start a notebook (your templates, the kinds
 * you make), and what makes an agent runnable in one click (used by Next
 * up, lib/home-next.ts, which is where things to run and fix are offered).
 */
import { NotebookStore, notebookPurpose, type Agent, type Notebook, type NotebookTemplate } from '@some-useful-agents/core';
import { perItemInputs } from './notebook-pipeline.js';
import type { getContext } from '../context.js';

type Ctx = ReturnType<typeof getContext>;

export interface SuggestedAsk {
  label: string;
  text: string;
  /** A page to open instead of filling the box (New notebook with the sentence started). */
  href?: string;
}
/** Home's Ask sua card: starters; a pill fills the box (you finish it). */
export type StarterVerb = 'Start';
export interface AskStarters { verb: StarterVerb; pills: SuggestedAsk[] }
export interface HomeSuggestions { starters: AskStarters[] }

/** An input it can't run without: required (the resolver's default) and no default. */
export function needsInputs(agent: Pick<Agent, 'inputs'>): boolean {
  return Object.values(agent.inputs ?? {}).some((spec) => spec.default === undefined && spec.required !== false);
}

/**
 * Worth one click: every input already has a real value. An empty default ("" for a page to read,
 * a list to research) runs but does nothing useful, and a page reader is a helper for notebooks.
 */
export function runsAsIs(agent: Pick<Agent, 'inputs'>): boolean {
  if (perItemInputs(agent)) return false;
  return Object.values(agent.inputs ?? {}).every((spec) => spec.default !== undefined && String(spec.default).trim() !== '' && String(spec.default).trim() !== '[]');
}

/**
 * Run it, in words, with what it's about set to its defaults (not settings
 * such as how many or where it writes): Home's Run pill fills the box with
 * it, so you can change them before it runs. None when there's nothing to
 * change. Pure.
 */
export function runFill(agent: Pick<Agent, 'name' | 'inputs'>): string | undefined {
  const what = Object.entries(agent.inputs ?? {}).filter(([key, spec]) => !SETTING_RE.test(key) && spec.type !== 'boolean');
  if (!what.length) return undefined;
  return `Run ${agent.name} with ${what.map(([key, spec]) => `${inputLabel(key)}: ${spec.default === undefined ? '' : String(spec.default)}`).join('; ')}`;
}

/** An input's key in words: TARGET_URL → "target URL". */
export function inputLabel(key: string): string {
  return key.toLowerCase().split('_').filter(Boolean).map((w) => (/^(url|api|id|csv|json|rss)$/.test(w) ? w.toUpperCase() : w)).join(' ');
}

/** A setting rather than what it's about: where it writes, how many, how long. */
const SETTING_RE = /(^|_)(DIR|PATH|FILE|COUNT|LIMIT|MAX|MIN|TIMEOUT|SECONDS|MODEL|FORMAT|MODE|DAYS|HOURS)($|_)/i;

/** Kinds of notebook, each a sentence to finish: what they're for, as you'd say it. */
const NOTEBOOK_KINDS = [
  { kind: 'meeting', label: 'Meeting with …', text: 'Prepare for a meeting with ' },
  { kind: 'report', label: 'Report on …', text: 'Research a report on ' },
  { kind: 'plan', label: 'Plan …', text: 'Plan ' },
  { kind: 'choose', label: 'Choose …', text: 'Help me choose ' },
] as const;
type NotebookKind = typeof NOTEBOOK_KINDS[number]['kind'];

/** What a notebook is for, from its page, steps and title (core notebookPurpose). Pure. */
export function notebookKind(nb: Pick<Notebook, 'title' | 'layout' | 'steps' | 'statement'>): NotebookKind {
  return notebookPurpose(nb);
}

/**
 * Ways to start a notebook, for Home's Ask sua (a Start row): your templates
 * first (the 2 most used; one that changes each time ends where you say
 * who or what, and sua starts it from the template), then the kinds of
 * notebook you've made that no template covers, then a meeting and a
 * report, up to `max`. A kind opens New notebook with its sentence
 * started. Pure.
 */
export function notebookStartPills(templates: readonly Pick<NotebookTemplate, 'name' | 'setup' | 'uses' | 'archivedAt'>[], notebooks: readonly Pick<Notebook, 'title' | 'layout' | 'steps' | 'statement' | 'archivedAt'>[], max = 4): SuggestedAsk[] {
  const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t);
  const pills: SuggestedAsk[] = [];
  const covered = new Set<NotebookKind>();
  for (const t of [...templates].filter((t) => !t.archivedAt).sort((a, b) => b.uses - a.uses).slice(0, 2)) {
    const kind = notebookKind({ title: t.name, statement: t.setup.statement, layout: t.setup.layout, steps: t.setup.steps });
    // Choosing only when it ranks its options (a price, a score, a measure): otherwise it says nothing about the kind.
    if (kind !== 'choose' || (t.setup.fields ?? []).some((f) => f.role === 'price' || f.role === 'score' || f.role === 'measure')) covered.add(kind);
    pills.push(t.setup.subject
      ? { label: `${clip(t.name, 22)} for …`, text: `Start a new notebook from my “${t.name}” template for ` }
      : { label: clip(t.name, 26), text: `Start a new notebook from my “${t.name}” template.` });
  }
  const made = [...new Set(notebooks.filter((n) => !n.archivedAt).map(notebookKind))];
  const kinds = [...made, 'meeting', 'report'].filter((k, i, all): k is NotebookKind => all.indexOf(k) === i && !covered.has(k as NotebookKind));
  for (const k of kinds) {
    if (pills.length >= max) break;
    const spec = NOTEBOOK_KINDS.find((x) => x.kind === k)!;
    pills.push({ label: spec.label, text: spec.text, href: `/notebooks/new?text=${encodeURIComponent(spec.text)}` });
  }
  return pills.slice(0, max);
}

/** Home's Ask sua starters, from the stores. Never throws. */
export function homeSuggestions(ctx: Ctx): HomeSuggestions {
  try {
    const nbs = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
    // A few more than are shown: Home leaves out any that Next up already offers.
    const pills = notebookStartPills(nbs.listTemplates(), nbs.list(), 5);
    return { starters: pills.length ? [{ verb: 'Start', pills }] : [] };
  } catch {
    return { starters: [] };
  }
}
