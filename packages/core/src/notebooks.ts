/**
 * Notebooks (goal surfaces track G1): a goal you keep over time. A notebook
 * states what it's for, the parameters it works within, the criteria that say
 * it's done, the agents in its pipeline and how often they run, and it closes
 * with a decision. Everything it learns is an entry: a note, an option, a
 * piece of evidence, or a decision, each with who added it.
 *
 * Its page is drawn from its own surface (`notebook:<id>`, see surfaces/),
 * from items projected out of its entries.
 */
import { checkNotebookLayout, cleanLayout, type NotebookLayout } from './notebook-layout.js';
import { imageShape, type ImageShape } from './image-size.js';
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { openStoreDb } from './sqlite-open.js';
import type { Item } from './items/types.js';

export type NotebookStatus = 'active' | 'decided' | 'stopped';
export const NOTEBOOK_ENTRY_KINDS = ['note', 'option', 'evidence', 'decision'] as const;
export type NotebookEntryKind = typeof NOTEBOOK_ENTRY_KINDS[number];

/** What a field holds, so widgets can format it ($4,023 · 149,652 mi · a link). */
export const NOTEBOOK_FIELD_TYPES = ['money', 'number', 'text', 'url', 'image', 'date'] as const;
export type NotebookFieldType = typeof NOTEBOOK_FIELD_TYPES[number];
/**
 * What a field means across notebooks, so a widget can be reused: a shortlist
 * shows the `price` big, a map plots `price` against `measure`, a card shows
 * the `image`, a button opens the `link`, a list groups by `org` (the company
 * or seller).
 */
/**
 * What a field means. `score` is how well an option fits (an ICP fit, a match
 * score): when a notebook has one, options rank by it instead of by price.
 */
/**
 * What a field means, so one widget works for any notebook: `quote` is what
 * someone said or what suggests it (a briefing's evidence), `ask` a question
 * to raise about the option (a talking point's question).
 */
export const NOTEBOOK_FIELD_ROLES = ['price', 'measure', 'place', 'link', 'image', 'when', 'org', 'score', 'quote', 'ask'] as const;
export type NotebookFieldRole = typeof NOTEBOOK_FIELD_ROLES[number];

/** Where a kept picture came from: the listing, a representative one found for it, or a drawing. */
/** A listing's own photo, an example photo of what it is, a company's logo, or a drawing. */
export type NotebookPhotoKind = 'listing' | 'representative' | 'logo' | 'illustration';

/** One site or source a search reached, and what it got there. */
/** How a pass started: the notebook's pipeline, a run filed from its conversation, or Add to notebook. */
export type NotebookPassKind = 'pipeline' | 'conversation' | 'added';

export interface NotebookPass {
  id: string;
  notebookId: string;
  kind: NotebookPassKind;
  startedAt: string;
  finishedAt?: string;
  /** What it did, in a line ("7 new entries · car-sweep: 7 new"). */
  note?: string;
  /** The runs it made or filed, in order (failed ones too). */
  runIds: string[];
  /** Started by the notebook's schedule, not by someone pressing Run. */
  scheduled?: boolean;
}

export interface NotebookSearchSource {
  name: string;
  found: number;
  status: 'found' | 'none' | 'blocked' | 'skipped';
  note?: string;
}

/** Keep only well-formed sources (at most 12). */
export function cleanSources(list: unknown): NotebookSearchSource[] {
  const out: NotebookSearchSource[] = [];
  for (const s of Array.isArray(list) ? list : []) {
    const x = s as Partial<Record<keyof NotebookSearchSource, unknown>>;
    const name = typeof x.name === 'string' ? x.name.trim().slice(0, 40) : '';
    if (!name) continue;
    const found = Math.max(0, Math.round(Number(x.found) || 0));
    const status = (['found', 'none', 'blocked', 'skipped'] as const).find((v) => v === x.status) ?? (found > 0 ? 'found' : 'none');
    out.push({ name, found, status, ...(typeof x.note === 'string' && x.note.trim() ? { note: x.note.trim().slice(0, 160) } : {}) });
    if (out.length === 12) break;
  }
  return out;
}

/** Who a notebook is about: a person, their company (or a company alone). */
export type NotebookAboutWho = 'person' | 'company';
export const NOTEBOOK_ABOUT_WHO: readonly NotebookAboutWho[] = ['person', 'company'];

/** One thing learned about them, with where it came from. */
export interface NotebookAboutFact {
  /** lowercase_snake: role, organization, location, what_they_do… */
  key: string;
  label: string;
  value: string;
  /** The page it came from (http/https). */
  source?: string;
  /** The words on that page that say it. */
  quote?: string;
  /** When it was learned. */
  at: string;
}

export interface NotebookAboutOne {
  name: string;
  facts: NotebookAboutFact[];
  /** What was looked for and not found (labels). */
  notFound?: string[];
  /** A sentence on who they are. */
  summary?: string;
  /** Pictures you said aren't them (Not them): never kept again. */
  rejectedPhotos?: string[];
  updatedAt: string;
}

export type NotebookAbout = Partial<Record<NotebookAboutWho, NotebookAboutOne>>;

const ABOUT_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * Facts about someone, merged: a later sighting of a fact wins (its value
 * and source), facts not seen again stay, and what's found leaves "not
 * found". Pure.
 */
export function mergeAbout(was: NotebookAboutOne | undefined, next: { name?: string; facts?: readonly unknown[]; notFound?: readonly unknown[]; summary?: unknown }, now: string): NotebookAboutOne {
  const facts = [...(was?.facts ?? [])];
  for (const raw of next.facts ?? []) {
    const f = (raw ?? {}) as Partial<Record<keyof NotebookAboutFact, unknown>>;
    const key = typeof f.key === 'string' ? f.key.trim().toLowerCase() : '';
    const value = typeof f.value === 'string' || typeof f.value === 'number' ? String(f.value).replace(/\s+/g, ' ').trim().slice(0, 300) : '';
    if (!ABOUT_KEY_RE.test(key) || !value) continue;
    const source = typeof f.source === 'string' && /^https?:\/\//i.test(f.source.trim()) ? f.source.trim().slice(0, 500) : undefined;
    const quote = typeof f.quote === 'string' && f.quote.trim() ? f.quote.replace(/\s+/g, ' ').trim().slice(0, 300) : undefined;
    const label = typeof f.label === 'string' && f.label.trim() ? f.label.trim().slice(0, 40) : key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
    const fact: NotebookAboutFact = { key, label, value, ...(source ? { source } : {}), ...(quote ? { quote } : {}), at: now };
    const i = facts.findIndex((x) => x.key === key);
    if (i >= 0) facts[i] = fact; else facts.push(fact);
  }
  const have = new Set(facts.map((f) => f.label.toLowerCase()).concat(facts.map((f) => f.key)));
  const notFound = [...new Set([...(was?.notFound ?? []), ...(next.notFound ?? []).filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean)])]
    .filter((x) => !have.has(x.toLowerCase()) && !have.has(x.toLowerCase().replace(/\s+/g, '_')))
    .slice(0, 12);
  const name = (typeof next.name === 'string' && next.name.trim() ? next.name.trim() : was?.name ?? '').slice(0, 80);
  const summary = typeof next.summary === 'string' && next.summary.trim() ? next.summary.replace(/\s+/g, ' ').trim().slice(0, 300) : was?.summary;
  return { name, facts: facts.slice(0, 24), ...(notFound.length ? { notFound } : {}), ...(summary ? { summary } : {}), ...(was?.rejectedPhotos?.length ? { rejectedPhotos: was.rejectedPhotos } : {}), updatedAt: now };
}

/** One fact every option in a notebook has: a car's price or miles, a flat's rent. */
export interface NotebookField {
  /** lowercase_snake, e.g. `price`, `miles`, `listing_url`. */
  key: string;
  label: string;
  type: NotebookFieldType;
  /** For numbers: "mi", "sq ft". */
  unit?: string;
  role?: NotebookFieldRole;
  /** For money and numbers: which way is better (a price is lower, a salary or a rating higher). */
  better?: 'higher' | 'lower';
  /** For money and numbers: values may be a range ("$150k–$180k"). */
  range?: boolean;
}

/** A value given as a span: a salary band, a price "from … to …". */
export interface NotebookRange { min: number; max: number }

export type NotebookFieldValue = string | number | NotebookRange;

export function isRange(v: unknown): v is NotebookRange {
  return !!v && typeof v === 'object' && typeof (v as NotebookRange).min === 'number' && typeof (v as NotebookRange).max === 'number';
}

/** A number to sort or plot by: a range counts as its midpoint. */
export function fieldNumber(v: NotebookFieldValue | undefined): number | undefined {
  if (typeof v === 'number') return v;
  if (isRange(v)) return (v.min + v.max) / 2;
  return undefined;
}

export interface NotebookCriterion {
  text: string;
  met: boolean;
  /** Set by hand (you, or sua when you said so): the notebook doesn't tick or untick it for you. */
  held?: boolean;
}

/** One talking point sua wrote: what to raise, why it matters to them, and the options it rests on. */
export interface NotebookBriefingPoint {
  /** What to raise, as a sentence ("Ask how they decide when to hand work to AI"). */
  text: string;
  /** Why it matters to them, from what they said. */
  why?: string;
  /** A question to ask about it. */
  ask?: string;
  /** The options (what they said) it rests on, by entry id: their quotes and sources are shown as they are. */
  from: string[];
}

/** What a write step wrote: the talking points, more questions, what to watch for. */
export interface NotebookBriefing {
  points: NotebookBriefingPoint[];
  questions: string[];
  watch: string[];
  at: string;
  /** The agent that wrote it. */
  by: string;
}

/** One finding behind an answer, resting on the options (sources) it came from, by entry id. */
export interface NotebookAnswerFinding {
  text: string;
  from: string[];
}

/** What a write step wrote when the notebook answers a question: the answer, how sure, what it rests on, what's still open. */
export interface NotebookAnswer {
  /** The question, as the notebook asks it. */
  question: string;
  /** The answer, 1–4 sentences (may use **bold**). */
  text: string;
  confidence: 'high' | 'medium' | 'low';
  /** Why that confidence, in a sentence. */
  basis?: string;
  findings: NotebookAnswerFinding[];
  /** What's still open: questions it couldn't settle, or what to do next. */
  open: string[];
  at: string;
  by: string;
}

/** One thing in a plan: when, what, and the options (places, things found) it uses, by entry id. */
export interface NotebookPlanItem {
  /** Its day or slot, as the plan groups them ("Day 1", "Sat Oct 31", "Week 2", "Morning"). */
  when: string;
  title: string;
  detail?: string;
  from: string[];
}

/** What a write step wrote when the notebook makes a plan (a trip, a week, a project): the plan in order, what to do first, what's open. */
export interface NotebookPlan {
  /** The plan in a sentence or two (may use **bold**). */
  summary: string;
  items: NotebookPlanItem[];
  /** To book, buy or do before it starts. */
  before: string[];
  open: string[];
  at: string;
  by: string;
}

export interface Notebook {
  id: string;
  title: string;
  /** What it's for, in a sentence: "Find a reliable used SUV and decide by Oct 15". */
  statement: string;
  /** The bounds it works within: "under $26,000", "AWD". */
  params: string[];
  /** Done when every one is met. */
  criteria: NotebookCriterion[];
  /** Agent ids that gather for it, in order. */
  pipeline: string[];
  /** What each option records (empty until sua or you set them). */
  fields: NotebookField[];
  /** The steps an option goes through, in order: Found → Applied → Interview → Offer. */
  stages: string[];
  /** When sua last set up its fields and stages (so it's tried once, not on every visit). */
  setupAt?: string;
  /** What to check on an option before deciding ("Still listed", "Clean title"). */
  checks: string[];
  /** Five-field cron for the pipeline, or empty for "only when asked". */
  cadence: string;
  status: NotebookStatus;
  /** Set when it closes with a decision. */
  decision?: string;
  decidedAt?: string;
  /** When the pipeline last ran, and what it added (one line). */
  lastRunAt?: string;
  lastRunNote?: string;
  /** The last cadence slot (cron fire time) its schedule has handled. */
  cadenceFiredAt?: string;
  /** Its conversation with sua (an inbox thread id). */
  conversationId?: string;
  /** Set when archived: hidden from the notebooks list, Home, Today and schedules; kept whole and restorable. */
  archivedAt?: string;
  /**
   * Short labels for a long text fact's values, by field key, so a filter chip
   * reads "Office-of-CFO suite" rather than the sentence each option has
   * (the dashboard's notebook-facets agent groups them).
   */
  facets?: Record<string, NotebookFacet>;
  /** The work in steps, in order (absent: it just runs its pipeline). */
  steps?: NotebookStep[];
  /** Its page, as an A2UI document (absent: the shortlist; notebook-layout.ts). */
  layout?: NotebookLayout;
  /**
   * Who set its page last: `notebook` (it decided itself, from what it's
   * for), `sua` (a card you approved), `you` (Edit: undo, back to the
   * shortlist), `template`. None: never set. Only a page it decided itself is
   * decided again.
   */
  layoutBy?: string;
  /** Who it's about, when it's about someone (a profile step learns it): the person, their company. */
  about?: NotebookAbout;
  /** What sua wrote from it (a write step): for a meeting, the talking points. */
  briefing?: NotebookBriefing;
  /** The answer a write step wrote (a notebook that answers a question). */
  answer?: NotebookAnswer;
  /** The plan a write step wrote (a notebook that makes a plan). */
  plan?: NotebookPlan;
  createdAt: string;
  updatedAt: string;
}

/** One field's short labels: each value (as shown) → its label; `failedAt` when grouping last failed. */
export interface NotebookFacet { labels: Record<string, string>; at: string; failedAt?: string }

/**
 * A step of the work a notebook does, in order (not an option's stage):
 * find options, source their facts, check them, decide. Each has a goal the
 * notebook can check without a model (stepProgress), and the agent that
 * works toward it; it's given the job in its inputs, never edited for it.
 */
/** profile: learn about who the notebook is about (a person, their company), not its options. */
export type NotebookStepKind = 'profile' | 'find' | 'source' | 'check' | 'narrow' | 'decide' | 'write';
export const NOTEBOOK_STEP_KINDS: readonly NotebookStepKind[] = ['profile', 'find', 'source', 'check', 'narrow', 'decide', 'write'];
/** todo → running → met (waits for Continue) → done; stuck when it ran out of tries short of its goal. */
export type NotebookStepStatus = 'todo' | 'running' | 'met' | 'stuck' | 'done';
export interface NotebookStep {
  id: string;
  /** "Find 10 companies". */
  title: string;
  kind: NotebookStepKind;
  /** The agent that works on it (a check step without one uses sua's checker). */
  agentId?: string;
  /** find: options wanted in the running; decide: how many make the final set. */
  target?: number;
  /**
   * source: the facts it looks up (field keys), so a step whose agent finds
   * revenue, employees and founding year isn't held up by facts it never
   * looks for. None: every fact the notebook tracks.
   */
  facts?: string[];
  /** source / check: only the best `top` options in the running count (and get worked on). None: all of them. */
  top?: number;
  /** profile: who to learn about ("Dana Reyes", "Acme Robotics"). None: from what the notebook is for. */
  subject?: string;
  /** write: what it writes. "answer": the answer to the question the notebook is for; "plan": a plan in order (a trip, a week); else talking points for a meeting. */
  shape?: 'answer' | 'plan';
  status: NotebookStepStatus;
  /** Runs toward its goal so far. */
  tries: number;
  /** One line on how it went ("8 of 10 companies"). */
  note?: string;
  /**
   * stuck because a run got it no closer: its agent may not be able to do
   * the rest, so Move on is offered first (else it ran out of tries while
   * still getting closer, and Try again is).
   */
  stalled?: boolean;
  /** done because you moved on from it short of its goal, keeping what it found. */
  movedOn?: boolean;
  /**
   * Why it came out short, in plain words ("Searched Craigslist and OfferUp:
   * neither had a new match"): set when it stops stuck, kept when you move
   * on, gone when it runs again.
   */
  why?: string;
  doneAt?: string;
}
export const MAX_STEPS = 6;
const STEP_STATUSES: readonly NotebookStepStatus[] = ['todo', 'running', 'met', 'stuck', 'done'];

export interface NotebookEntry {
  id: string;
  notebookId: string;
  kind: NotebookEntryKind;
  title: string;
  body: string;
  /** `you`, or `agent:<id>` / `run:<id>`. */
  by: string;
  /** The run it came from, when an agent added it. */
  runId?: string;
  /** An option's facts, by field key. */
  data?: Record<string, NotebookFieldValue>;
  /** Where a fact came from and whether it's an estimate, by field key (facts given as {value, source, estimate}). */
  factMeta?: Record<string, NotebookFactMeta>;
  /** What makes an option the same one next time (a listing address, a VIN). */
  fingerprint?: string;
  /** The last run that found it again (first seen is `createdAt`). */
  lastSeenAt?: string;
  /** An option's stage (one of the notebook's stages) and when it got there. */
  stage?: string;
  stageAt?: string;
  /** Set when it's out: why, when, by whom, and at which stage. It stays in the notebook. */
  ruledOut?: { reason: string; at: string; by: string; stage?: string; gone?: boolean };
  /** The notebook's checks ticked for this option. */
  checked?: string[];
  /** Checks it failed that didn't rule it out (it's chosen, so that's your call), with why: check → reason. */
  failedChecks?: Record<string, string>;
  /** When it was picked in the notebook's decision. */
  chosenAt?: string;
  /** When sua recommended it for the decision (its latest picks). */
  suggestedAt?: string;
  createdAt: string;
}

/** An option an agent found: new, or one the notebook already has, seen again. */
export interface NewOption {
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  fingerprint?: string;
  by: string;
  runId?: string;
  /** Facts come from an agent's own code (a directly filed block): a "checked" quote is believed. */
  trustedFacts?: boolean;
}

export interface NewNotebook {
  title: string;
  statement?: string;
  params?: string[];
  criteria?: string[];
  pipeline?: string[];
  cadence?: string;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;

/** "Buy a used car" → "buy-a-used-car" (unique-ified by the store). */
export function notebookSlug(title: string): string {
  const s = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return s || 'notebook';
}

const clean = (list: readonly string[] | undefined, max = 20) =>
  (list ?? []).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, max);

/** A new notebook being drafted, as stored. */
export interface NotebookDraftRecord { id: string; status: string; text: string; draft?: unknown; error?: string; createdAt: string; updatedAt: string }

function draftRecord(r: Record<string, unknown>): NotebookDraftRecord {
  let draft: unknown;
  try { draft = r.draft_json ? JSON.parse(String(r.draft_json)) : undefined; } catch { draft = undefined; }
  return {
    id: String(r.id), status: String(r.status), text: String(r.text),
    ...(draft !== undefined ? { draft } : {}), ...(r.error ? { error: String(r.error) } : {}),
    createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  };
}

/**
 * A notebook's setup, kept to start new ones like it (a "job search"
 * template): what it's for, its limits, its done-whens, the facts it notes,
 * its checks and stages, its steps (with their agents), its schedule and
 * pipeline. Never its options, notes, decision or history: every notebook
 * made from it starts empty.
 */
export interface NotebookTemplateSetup {
  statement: string;
  params: string[];
  /** The done-whens' texts (all start unmet). */
  criteria: string[];
  fields: NotebookField[];
  checks: string[];
  stages: string[];
  /** Fresh: to do, no tries, no notes. */
  steps: NotebookStep[];
  cadence: string;
  pipeline: string[];
  /** Its page's layout, when it isn't the default. */
  layout?: NotebookLayout;
  /**
   * What changes each time ("Who you're meeting"): its texts say
   * `{subject}` where it goes, and starting one fills it in (fillSubject).
   */
  subject?: NotebookTemplateSubject;
}

export interface NotebookTemplateSubject {
  /** The question it answers, as a label ("Who you're meeting (a person or company)"). */
  label: string;
  /** What it was in the notebook it was saved from ("Dana Reyes"). */
  example: string;
}

/** Where a template's subject goes in its texts. */
export const TEMPLATE_SUBJECT = '{subject}';

/** What you changed before saving a template (Save as a template's page). */
export interface NotebookTemplateEdits {
  statement?: string;
  params?: readonly string[];
  criteria?: readonly string[];
  checks?: readonly string[];
  /** Step titles, by step id. */
  stepTitles?: Readonly<Record<string, string>>;
  /** What each option notes, relabelled, by field key. */
  fieldLabels?: Readonly<Record<string, string>>;
  subject?: NotebookTemplateSubject;
}

export interface NotebookTemplate {
  /** A slug of its name: saving the same name again replaces it. */
  id: string;
  name: string;
  /** What it sets up, in a line ("8 fields · 4 steps · 5 checks"). */
  description: string;
  setup: NotebookTemplateSetup;
  /** The notebook it was saved from. */
  fromNotebook?: string;
  uses: number;
  createdAt: string;
  updatedAt: string;
  usedAt?: string;
  /** Archived: kept, but not offered (New notebook, sua). */
  archivedAt?: string;
}

/** A notebook's setup as a template keeps it (see NotebookTemplateSetup). */
export function templateFromNotebook(nb: Notebook): NotebookTemplateSetup {
  return {
    statement: nb.statement,
    params: [...nb.params],
    criteria: nb.criteria.map((c) => c.text),
    fields: cleanFields(nb.fields),
    checks: [...nb.checks],
    stages: [...nb.stages],
    steps: cleanSteps((nb.steps ?? []).map(({ id, title, kind, agentId, target, facts, top }) => ({ id, title, kind, agentId, target, facts, top, status: 'todo', tries: 0 }))),
    cadence: nb.cadence,
    pipeline: [...nb.pipeline],
    ...(nb.layout ? { layout: nb.layout } : {}),
  };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Swap `example` for `{subject}` in a text, as a whole phrase, any case:
 * "Dana Reyes's" keeps its "'s". No example: the text as it is.
 */
export function subjectOut(text: string, example: string): string {
  const ex = example.replace(/\s+/g, ' ').trim();
  if (!ex) return text;
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(ex).replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])`, 'giu'), TEMPLATE_SUBJECT);
}

/** Fill a template text's `{subject}` with this time's ("Acme Corp"). Nothing given: it stays. */
export function fillSubject(text: string, value: string): string {
  const v = value.replace(/\s+/g, ' ').trim();
  return v ? text.split(TEMPLATE_SUBJECT).join(v) : text;
}

/**
 * A guess at what a notebook is about that would change next time: the
 * longest of its limits that its title also says, as written ("Dana
 * Reyes" in "Prepare for meeting with Dana Reyes"). Short, generic ones
 * (under two words or 4 letters) don't count.
 */
export function templateSubjectGuess(nb: Pick<Notebook, 'title' | 'params'>): string {
  const title = nb.title.toLowerCase();
  const hits = nb.params
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length >= 4 && p.length <= 60 && subjectOut(title, p.toLowerCase()) !== title);
  return hits.sort((a, b) => b.length - a.length)[0] ?? '';
}

/**
 * Clip a text to `max` characters on a word boundary, so a check or limit
 * never ends mid-word ("…not someone with a simila").
 */
export function clipWords(text: string, max: number): string {
  const s = text.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
  const at = cut.lastIndexOf(' ');
  return (at > max / 2 ? cut.slice(0, at) : s.slice(0, max)).replace(/[\s,;:–—-]+$/, '');
}

/** The longest a check may be. */
export const CHECK_MAX = 120;

/**
 * A notebook's setup with what you changed on Save as a template: the edited
 * texts and fact labels (cleaned like a notebook's own), then the subject
 * swapped for `{subject}` wherever it's named.
 */
export function templateWithEdits(nb: Notebook, edits: NotebookTemplateEdits = {}): NotebookTemplateSetup {
  const base = templateFromNotebook(nb);
  const list = (given: readonly string[] | undefined, was: string[], max: number, n: number) => {
    if (!given) return was;
    const out: string[] = [];
    for (const g of given) {
      const t = clipWords(g, max);
      if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    }
    return out.slice(0, n);
  };
  const label = edits.subject?.label.replace(/\s+/g, ' ').trim().slice(0, 80) ?? '';
  const example = edits.subject?.example.replace(/\s+/g, ' ').trim().slice(0, 80) ?? '';
  const sub = (t: string) => subjectOut(t, example);
  const setup: NotebookTemplateSetup = {
    ...base,
    statement: sub(edits.statement !== undefined ? edits.statement.trim().slice(0, 500) : base.statement),
    params: list(edits.params, base.params, 200, 20).map(sub),
    criteria: list(edits.criteria, base.criteria, 200, 10).map(sub),
    checks: list(edits.checks, base.checks, CHECK_MAX, 8).map(sub),
    fields: base.fields.map((f) => {
      const l = edits.fieldLabels?.[f.key]?.replace(/\s+/g, ' ').trim();
      return l ? { ...f, label: sub(l.slice(0, 40)) } : f;
    }),
    steps: base.steps.map((st) => {
      const t = edits.stepTitles?.[st.id];
      return { ...st, title: sub(t !== undefined && t.trim() ? clipWords(t, 60) : st.title) };
    }),
  };
  if (label && example) setup.subject = { label, example };
  return setup;
}

/** "8 fields · 4 steps · 5 checks": what a template sets up. */
export function describeTemplateSetup(t: NotebookTemplateSetup): string {
  const n = (k: number, one: string) => (k ? `${String(k)} ${one}${k === 1 ? '' : 's'}` : '');
  return [n(t.fields.length, 'field'), n(t.steps.length, 'step'), n(t.checks.length, 'check'), n(t.params.length, 'limit')].filter(Boolean).join(' · ') || 'no setup yet';
}

function templateRecord(r: Record<string, unknown>): NotebookTemplate | undefined {
  let setup: NotebookTemplateSetup;
  try { setup = JSON.parse(String(r.setup_json)) as NotebookTemplateSetup; } catch { return undefined; }
  return {
    id: String(r.id), name: String(r.name), description: String(r.description ?? ''), setup,
    ...(r.from_notebook ? { fromNotebook: String(r.from_notebook) } : {}),
    uses: Number(r.uses ?? 0), createdAt: String(r.created_at), updatedAt: String(r.updated_at),
    ...(r.used_at ? { usedAt: String(r.used_at) } : {}),
    ...(r.archived_at ? { archivedAt: String(r.archived_at) } : {}),
  };
}

export class NotebookStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = openStoreDb(dbPath);
    this.ensureSchema();
  }

  static fromHandle(db: DatabaseSync): NotebookStore {
    const store = Object.create(NotebookStore.prototype) as NotebookStore;
    (store as unknown as { db: DatabaseSync }).db = db;
    store.ensureSchema();
    return store;
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notebooks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        statement TEXT NOT NULL DEFAULT '',
        params_json TEXT NOT NULL DEFAULT '[]',
        criteria_json TEXT NOT NULL DEFAULT '[]',
        pipeline_json TEXT NOT NULL DEFAULT '[]',
        cadence TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        decision TEXT,
        decided_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notebook_entries (
        id TEXT PRIMARY KEY,
        notebook_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS notebook_entries_by_notebook ON notebook_entries (notebook_id, created_at);
      -- Each time a search saw an option, with what it said then (price history).
      CREATE TABLE IF NOT EXISTS notebook_sightings (
        entry_id TEXT NOT NULL,
        notebook_id TEXT NOT NULL,
        run_id TEXT,
        at TEXT NOT NULL,
        data_json TEXT
      );
      CREATE INDEX IF NOT EXISTS notebook_sightings_by_entry ON notebook_sightings (entry_id, at);
      -- Each search whose results went into the notebook: which agent, and how many options it found.
      CREATE TABLE IF NOT EXISTS notebook_searches (
        notebook_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        run_id TEXT,
        at TEXT NOT NULL,
        found INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS notebook_searches_by_notebook ON notebook_searches (notebook_id, agent_id, at);
      -- Runs of its agents you said don't belong here: no longer offered to add.
      CREATE TABLE IF NOT EXISTS notebook_skipped_runs (
        notebook_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        at TEXT NOT NULL,
        PRIMARY KEY (notebook_id, run_id)
      );
      -- A pass: one go at filling the notebook (a pipeline run of all its agents,
      -- or one run filed from a conversation or Add to notebook), and its runs.
      CREATE TABLE IF NOT EXISTS notebook_passes (
        id TEXT PRIMARY KEY,
        notebook_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        note TEXT,
        run_ids_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS notebook_passes_by_notebook ON notebook_passes (notebook_id, started_at);
      -- A copy of each option's photo (listings disappear; the page never loads from the seller's site).
      CREATE TABLE IF NOT EXISTS notebook_photos (
        entry_id TEXT PRIMARY KEY,
        notebook_id TEXT NOT NULL,
        source_url TEXT NOT NULL,
        content_type TEXT,
        bytes BLOB,
        fetched_at TEXT NOT NULL,
        error TEXT
      );
      -- A new notebook being drafted (dashboard lib/notebook-draft.ts): kept until it's
      -- started or discarded, so leaving the page or a restart doesn't lose it.
      CREATE TABLE IF NOT EXISTS notebook_drafts (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        text TEXT NOT NULL,
        draft_json TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      -- Layouts a change replaced, newest last, to undo to (setLayout).
      CREATE TABLE IF NOT EXISTS notebook_layout_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        notebook_id TEXT NOT NULL,
        layout_json TEXT,
        replaced_at TEXT NOT NULL,
        by TEXT
      );
      CREATE INDEX IF NOT EXISTS notebook_layout_history_nb ON notebook_layout_history(notebook_id, id);
      -- A copy of the picture of who a notebook is about (a person's photo, a company's logo).
      CREATE TABLE IF NOT EXISTS notebook_about_photos (
        notebook_id TEXT NOT NULL,
        who TEXT NOT NULL,
        source_url TEXT NOT NULL,
        content_type TEXT NOT NULL,
        bytes BLOB NOT NULL,
        kind TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (notebook_id, who)
      );
      -- A notebook's setup, kept to start new ones like it (NotebookTemplate).
      CREATE TABLE IF NOT EXISTS notebook_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        setup_json TEXT NOT NULL,
        from_notebook TEXT,
        uses INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        used_at TEXT
      );
    `);
    // G2 columns, added to tables created before them.
    for (const [table, col] of [
      ['notebook_entries', 'run_id TEXT'], ['notebooks', 'last_run_at TEXT'], ['notebooks', 'last_run_note TEXT'], ['notebooks', 'cadence_fired_at TEXT'], ['notebook_passes', 'trigger TEXT'], ['notebooks', 'conversation_id TEXT'],
      ['notebooks', "fields_json TEXT NOT NULL DEFAULT '[]'"], ['notebook_entries', 'data_json TEXT'], ['notebook_entries', 'fingerprint TEXT'], ['notebook_entries', 'last_seen_at TEXT'],
      ['notebooks', "stages_json TEXT NOT NULL DEFAULT '[]'"], ['notebook_entries', 'stage TEXT'], ['notebook_entries', 'stage_at TEXT'],
      ['notebook_entries', 'ruled_out_at TEXT'], ['notebook_entries', 'ruled_out_reason TEXT'], ['notebook_entries', 'ruled_out_by TEXT'], ['notebook_entries', 'ruled_out_stage TEXT'],
      ['notebooks', 'setup_at TEXT'], ['notebooks', "checks_json TEXT NOT NULL DEFAULT '[]'"], ['notebook_entries', 'checked_json TEXT'], ['notebook_entries', 'failed_checks_json TEXT'],
      ['notebook_searches', 'sources_json TEXT'], ['notebook_entries', 'ruled_out_gone INTEGER'], ['notebook_entries', 'fact_meta_json TEXT'],
      ['notebook_photos', "kind TEXT NOT NULL DEFAULT 'listing'"], ['notebook_photos', 'what TEXT'], ['notebook_entries', 'picture_tried_at TEXT'],
      ['notebook_sightings', 'corrected_by TEXT'], ['notebooks', 'archived_at TEXT'], ['notebook_photos', 'tried_url TEXT'], ['notebooks', 'facets_json TEXT'],
      ['notebooks', 'steps_json TEXT'], ['notebook_entries', 'chosen_at TEXT'], ['notebook_entries', 'suggested_at TEXT'],
      ['notebook_templates', 'archived_at TEXT'], ['notebooks', 'layout_json TEXT'], ['notebooks', 'about_json TEXT'], ['notebooks', 'layout_by TEXT'], ['notebooks', 'briefing_json TEXT'], ['notebooks', 'answer_json TEXT'], ['notebooks', 'plan_json TEXT'], ['notebook_about_photos', 'page_url TEXT'], ['notebook_about_photos', 'why TEXT'],
    ] as const) {
      try { this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`); } catch { /* already there */ }
    }
  }

  /**
   * Set the stages an option moves through. Options at a stage that's gone
   * move to the first one (matched by name, ignoring case).
   */
  setStages(id: string, list: readonly unknown[]): Notebook {
    this.mustGet(id);
    const stages: string[] = [];
    for (const s of list) {
      const name = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, 30) : '';
      if (name && !stages.some((x) => x.toLowerCase() === name.toLowerCase())) stages.push(name);
      if (stages.length === 8) break;
    }
    const now = new Date().toISOString();
    this.db.prepare('UPDATE notebooks SET stages_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(stages), now, id);
    for (const e of this.entries(id, 1000)) {
      if (e.kind !== 'option') continue;
      const same = stages.find((s) => s.toLowerCase() === (e.stage ?? '').toLowerCase());
      const to = same ?? stages[0] ?? null;
      if (to !== (e.stage ?? null)) this.db.prepare('UPDATE notebook_entries SET stage = ?, stage_at = COALESCE(stage_at, ?) WHERE id = ?').run(to, now, e.id);
    }
    return this.mustGet(id);
  }

  /** An option by id, fingerprint, or title (exact, then the only one containing it). */
  findOption(notebookId: string, ref: string): NotebookEntry | undefined {
    const options = this.entries(notebookId, 1000).filter((e) => e.kind === 'option');
    const r = ref.trim();
    const key = entryKey(r);
    if (!key) return undefined;
    const hit = options.find((e) => e.id === r || e.fingerprint === r.toLowerCase() || entryKey(e.title) === key);
    if (hit) return hit;
    const partial = options.filter((e) => entryKey(e.title).includes(key));
    return partial.length === 1 ? partial[0] : undefined;
  }

  /** Move an option to one of the notebook's stages (reinstating it if it was ruled out). */
  moveOption(notebookId: string, entryId: string, stage: string): NotebookEntry {
    const nb = this.mustGet(notebookId);
    const to = nb.stages.find((s) => s.toLowerCase() === stage.trim().toLowerCase());
    if (!to) throw new Error(`"${stage}" isn't one of this notebook's stages${nb.stages.length ? ` (${nb.stages.join(', ')})` : ''}.`);
    const e = this.mustGetOption(notebookId, entryId);
    const now = new Date().toISOString();
    this.db.prepare('UPDATE notebook_entries SET stage = ?, stage_at = ?, ruled_out_at = NULL, ruled_out_reason = NULL, ruled_out_by = NULL, ruled_out_stage = NULL, ruled_out_gone = NULL WHERE id = ?').run(to, now, e.id);
    this.db.prepare('UPDATE notebooks SET updated_at = ? WHERE id = ?').run(now, notebookId);
    return this.mustGetOption(notebookId, entryId);
  }

  /**
   * Rule an option out, with why. It stays (for the funnel and the history);
   * searches won't bring it back. `gone`: it isn't available any more (sold,
   * filled, taken down), rather than turned down.
   */
  ruleOut(notebookId: string, entryId: string, reason: string, by = 'you', opts: { gone?: boolean } = {}): NotebookEntry {
    const e = this.mustGetOption(notebookId, entryId);
    const why = reason.replace(/\s+/g, ' ').trim().slice(0, 200) || (opts.gone ? 'No longer available' : 'ruled out');
    const now = new Date().toISOString();
    this.db.prepare('UPDATE notebook_entries SET ruled_out_at = ?, ruled_out_reason = ?, ruled_out_by = ?, ruled_out_stage = ?, ruled_out_gone = ? WHERE id = ?').run(now, why, by, e.stage ?? null, opts.gone ? 1 : null, e.id);
    this.db.prepare('UPDATE notebooks SET updated_at = ? WHERE id = ?').run(now, notebookId);
    return this.mustGetOption(notebookId, entryId);
  }

  /**
   * Record that a search ran and how many options it found, so an option a
   * later search didn't find can be told apart from one nobody looked for.
   */
  recordSearch(notebookId: string, agentId: string, runId: string | undefined, found: number, at = new Date().toISOString(), sources?: readonly NotebookSearchSource[]): void {
    // `at` is when the search's results arrived, before its options were updated, so it never counts as a miss for them.
    this.db.prepare('INSERT INTO notebook_searches (notebook_id, agent_id, run_id, at, found, sources_json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(notebookId, agentId, runId ?? null, at, found, sources?.length ? JSON.stringify(sources) : null);
  }

  /** Searches that went into the notebook, newest first. */
  searches(notebookId: string, limit = 20): Array<{ agentId: string; runId?: string; at: string; found: number; sources: NotebookSearchSource[] }> {
    return (this.db.prepare('SELECT * FROM notebook_searches WHERE notebook_id = ? ORDER BY at DESC LIMIT ?').all(notebookId, limit) as Array<Record<string, unknown>>).map((r) => ({
      agentId: String(r.agent_id), ...(r.run_id ? { runId: String(r.run_id) } : {}), at: String(r.at), found: Number(r.found),
      sources: (() => { try { return r.sources_json ? JSON.parse(String(r.sources_json)) as NotebookSearchSource[] : []; } catch { return []; } })(),
    }));
  }

  /**
   * Where a notebook's results come from: the agents that have filled it
   * (its pipeline, its searches, and "agent:<id>" on its entries), and the
   * runs already in it.
   */
  runSources(notebookId: string): { agents: string[]; runIds: string[] } {
    const nb = this.mustGet(notebookId);
    const agents = new Set<string>(nb.pipeline);
    const runIds = new Set<string>();
    for (const r of this.db.prepare('SELECT agent_id, run_id FROM notebook_searches WHERE notebook_id = ?').all(notebookId) as Array<{ agent_id: string; run_id: string | null }>) {
      agents.add(r.agent_id);
      if (r.run_id) runIds.add(r.run_id);
    }
    for (const r of this.db.prepare('SELECT DISTINCT by, run_id FROM notebook_entries WHERE notebook_id = ?').all(notebookId) as Array<{ by: string | null; run_id: string | null }>) {
      if (r.by?.startsWith('agent:')) agents.add(r.by.slice('agent:'.length));
      if (r.run_id) runIds.add(r.run_id);
    }
    // Runs the notebook made itself (a step's or the pipeline's) are in it,
    // even ones that only set facts on options it has (a page reader's).
    for (const id of this.passRunIds(notebookId)) runIds.add(id);
    return { agents: [...agents].sort(), runIds: [...runIds] };
  }

  /** You said these runs don't belong in this notebook: stop offering them. */
  skipRuns(notebookId: string, runIds: readonly string[]): void {
    const ins = this.db.prepare('INSERT OR IGNORE INTO notebook_skipped_runs (notebook_id, run_id, at) VALUES (?, ?, ?)');
    const at = new Date().toISOString();
    for (const id of runIds) ins.run(notebookId, id, at);
  }

  /** The runs you skipped for this notebook. */
  skippedRunIds(notebookId: string): string[] {
    return (this.db.prepare('SELECT run_id FROM notebook_skipped_runs WHERE notebook_id = ?').all(notebookId) as Array<{ run_id: string }>).map((r) => r.run_id);
  }

  /**
   * Which notebooks each agent feeds: in its pipeline, or has filed into it.
   * sua's own steps (setup, the keeper and friends) aren't listed.
   */
  notebooksByAgent(skip: ReadonlySet<string> = new Set()): Map<string, Array<{ id: string; title: string; status: Notebook['status'] }>> {
    const out = new Map<string, Array<{ id: string; title: string; status: Notebook['status'] }>>();
    for (const nb of this.list()) { // archived ones aren't shown as fed
      for (const agentId of this.runSources(nb.id).agents) {
        if (agentId === 'notebook-setup' || skip.has(agentId)) continue;
        const list = out.get(agentId) ?? [];
        list.push({ id: nb.id, title: nb.title, status: nb.status });
        out.set(agentId, list);
      }
    }
    return out;
  }

  /**
   * Each run that put something in the notebook, with what it left: how many
   * options its search found, entries by kind, and options it saw again.
   */
  runFootprints(notebookId: string): Map<string, { at: string; found?: number; kinds: Partial<Record<NotebookEntryKind, number>>; seenAgain: number }> {
    const out = new Map<string, { at: string; found?: number; kinds: Partial<Record<NotebookEntryKind, number>>; seenAgain: number }>();
    const at = (runId: string, when: string) => {
      const f = out.get(runId) ?? { at: when, kinds: {}, seenAgain: 0 };
      if (when < f.at) f.at = when;
      out.set(runId, f);
      return f;
    };
    for (const r of this.db.prepare('SELECT run_id, at, found FROM notebook_searches WHERE notebook_id = ? AND run_id IS NOT NULL').all(notebookId) as Array<{ run_id: string; at: string; found: number }>) {
      const f = at(r.run_id, r.at);
      f.found = (f.found ?? 0) + r.found;
    }
    for (const r of this.db.prepare('SELECT run_id, kind, COUNT(*) AS n, MIN(created_at) AS at FROM notebook_entries WHERE notebook_id = ? AND run_id IS NOT NULL GROUP BY run_id, kind').all(notebookId) as Array<{ run_id: string; kind: NotebookEntryKind; n: number; at: string }>) {
      const f = at(r.run_id, r.at);
      f.kinds[r.kind] = (f.kinds[r.kind] ?? 0) + r.n;
    }
    for (const r of this.db.prepare('SELECT run_id, COUNT(*) AS n, MIN(at) AS at FROM notebook_sightings WHERE notebook_id = ? AND run_id IS NOT NULL GROUP BY run_id').all(notebookId) as Array<{ run_id: string; n: number; at: string }>) {
      at(r.run_id, r.at).seenAgain += r.n;
    }
    return out;
  }

  /** Start a pass; add its runs as they go, then finish it. */
  startPass(notebookId: string, kind: NotebookPassKind, at = new Date().toISOString(), opts: { scheduled?: boolean } = {}): string {
    this.mustGet(notebookId);
    const id = randomUUID();
    this.db.prepare('INSERT INTO notebook_passes (id, notebook_id, kind, started_at, trigger) VALUES (?, ?, ?, ?, ?)').run(id, notebookId, kind, at, opts.scheduled ? 'schedule' : null);
    return id;
  }

  /** Its schedule has handled this slot (a cron fire time): it won't run for it again. */
  markCadenceFired(notebookId: string, slot: string): void {
    this.db.prepare('UPDATE notebooks SET cadence_fired_at = ? WHERE id = ?').run(slot, notebookId);
  }

  /** Every run in the notebook's passes. */
  passRunIds(notebookId: string): string[] {
    const ids = new Set<string>();
    for (const r of this.db.prepare('SELECT run_ids_json FROM notebook_passes WHERE notebook_id = ?').all(notebookId) as Array<{ run_ids_json: string }>) {
      try { for (const id of JSON.parse(r.run_ids_json) as unknown[]) if (typeof id === 'string') ids.add(id); } catch { /* a bad row has no runs */ }
    }
    return [...ids];
  }

  addRunToPass(passId: string, runId: string): void {
    const row = this.db.prepare('SELECT run_ids_json FROM notebook_passes WHERE id = ?').get(passId) as { run_ids_json: string } | undefined;
    if (!row) return;
    const ids = JSON.parse(row.run_ids_json) as string[];
    if (!ids.includes(runId)) ids.push(runId);
    this.db.prepare('UPDATE notebook_passes SET run_ids_json = ? WHERE id = ?').run(JSON.stringify(ids), passId);
  }

  finishPass(passId: string, note?: string, at = new Date().toISOString()): void {
    this.db.prepare('UPDATE notebook_passes SET finished_at = ?, note = ? WHERE id = ?').run(at, note ? note.slice(0, 300) : null, passId);
  }

  /** The notebook's passes, newest first. */
  passes(notebookId: string, limit = 30): NotebookPass[] {
    return (this.db.prepare('SELECT * FROM notebook_passes WHERE notebook_id = ? ORDER BY started_at DESC LIMIT ?').all(notebookId, limit) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id), notebookId: String(r.notebook_id), kind: String(r.kind) as NotebookPassKind, startedAt: String(r.started_at),
      ...(r.finished_at ? { finishedAt: String(r.finished_at) } : {}), ...(r.note ? { note: String(r.note) } : {}),
      runIds: (() => { try { return JSON.parse(String(r.run_ids_json)) as string[]; } catch { return []; } })(),
      ...(r.trigger === 'schedule' ? { scheduled: true } : {}),
    }));
  }

  /** The notebooks these runs filed into (searches, entries or sightings), for a run's page. */
  notebooksForRuns(runIds: readonly string[]): Array<{ notebookId: string; title: string; runId: string }> {
    if (runIds.length === 0) return [];
    const marks = runIds.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT DISTINCT n.id AS notebook_id, n.title AS title, x.run_id AS run_id FROM (
        SELECT notebook_id, run_id FROM notebook_searches WHERE run_id IN (${marks})
        UNION SELECT notebook_id, run_id FROM notebook_entries WHERE run_id IN (${marks})
        UNION SELECT notebook_id, run_id FROM notebook_sightings WHERE run_id IN (${marks})
        UNION SELECT p.notebook_id, j.value FROM notebook_passes p, json_each(p.run_ids_json) j WHERE j.value IN (${marks})
      ) x JOIN notebooks n ON n.id = x.notebook_id`).all(...runIds, ...runIds, ...runIds, ...runIds) as Array<{ notebook_id: string; title: string; run_id: string }>;
    return rows.map((r) => ({ notebookId: r.notebook_id, title: r.title, runId: r.run_id }));
  }

  /** The notebooks an agent works for: it's in their pipeline, it searched for them, or it filed into them. */
  notebooksFedBy(agentId: string): string[] {
    const rows = this.db.prepare(`
      SELECT notebook_id FROM notebook_searches WHERE agent_id = ?
      UNION SELECT notebook_id FROM notebook_entries WHERE by = ?
      UNION SELECT id FROM notebooks WHERE EXISTS (SELECT 1 FROM json_each(COALESCE(pipeline_json, '[]')) WHERE value = ?)`).all(agentId, `agent:${agentId}`, agentId) as Array<{ notebook_id: string }>;
    return rows.map((r) => r.notebook_id);
  }

  /**
   * How the notebook's page is laid out: a preset id ("shortlist") or an
   * A2UI document (notebook-layout.ts). Null: back to the default.
   */
  /** Learned about who it's about (a profile step): merged with what's known (mergeAbout). */
  setAbout(id: string, who: NotebookAboutWho, next: { name?: string; facts?: readonly unknown[]; notFound?: readonly unknown[]; summary?: unknown }, now = new Date().toISOString()): Notebook {
    const nb = this.get(id);
    if (!nb) throw new Error(`No notebook "${id}".`);
    const about: NotebookAbout = { ...(nb.about ?? {}), [who]: mergeAbout(nb.about?.[who], next, now) };
    this.db.prepare('UPDATE notebooks SET about_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(about), now, id);
    return this.get(id)!;
  }

  /** Keep a copy of their picture (a person's photo, a company's logo). */
  /** `from`: the page it's on and why it's taken to be them (a person's photo). */
  /** Keep the plan a write step wrote (none: forget it). */
  setPlan(id: string, plan: NotebookPlan | undefined): Notebook {
    this.mustGet(id);
    this.db.prepare('UPDATE notebooks SET plan_json = ?, updated_at = ? WHERE id = ?').run(plan ? JSON.stringify(plan) : null, new Date().toISOString(), id);
    return this.mustGet(id);
  }

  /** Keep the answer a write step wrote (none: forget it). */
  setAnswer(id: string, answer: NotebookAnswer | undefined): Notebook {
    this.mustGet(id);
    this.db.prepare('UPDATE notebooks SET answer_json = ?, updated_at = ? WHERE id = ?').run(answer ? JSON.stringify(answer) : null, new Date().toISOString(), id);
    return this.mustGet(id);
  }

  /** Keep what a write step wrote (none: forget it). */
  setBriefing(id: string, briefing: NotebookBriefing | undefined): Notebook {
    this.mustGet(id);
    this.db.prepare('UPDATE notebooks SET briefing_json = ?, updated_at = ? WHERE id = ?').run(briefing ? JSON.stringify(briefing) : null, new Date().toISOString(), id);
    return this.mustGet(id);
  }

  saveAboutPhoto(id: string, who: NotebookAboutWho, sourceUrl: string, image: { contentType: string; bytes: Uint8Array }, kind: 'photo' | 'logo', from?: { page?: string; why?: string }): void {
    this.db.prepare(`INSERT INTO notebook_about_photos (notebook_id, who, source_url, content_type, bytes, kind, fetched_at, page_url, why) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(notebook_id, who) DO UPDATE SET source_url = excluded.source_url, content_type = excluded.content_type, bytes = excluded.bytes, kind = excluded.kind, fetched_at = excluded.fetched_at, page_url = excluded.page_url, why = excluded.why`)
      .run(id, who, sourceUrl, image.contentType, image.bytes, kind, new Date().toISOString(), from?.page ?? null, from?.why ?? null);
  }

  aboutPhoto(id: string, who: NotebookAboutWho): { contentType: string; bytes: Uint8Array; kind: 'photo' | 'logo'; sourceUrl: string; page?: string; why?: string } | undefined {
    const r = this.db.prepare('SELECT content_type, bytes, kind, source_url, page_url, why FROM notebook_about_photos WHERE notebook_id = ? AND who = ?').get(id, who) as { content_type: string; bytes: Uint8Array; kind: string; source_url: string; page_url: string | null; why: string | null } | undefined;
    return r ? { contentType: r.content_type, bytes: r.bytes, kind: r.kind === 'logo' ? 'logo' : 'photo', sourceUrl: r.source_url, ...(r.page_url ? { page: r.page_url } : {}), ...(r.why ? { why: r.why } : {}) } : undefined;
  }

  /** Not them: the picture goes, and is never kept for them again. */
  rejectAboutPhoto(id: string, who: NotebookAboutWho): boolean {
    const nb = this.get(id);
    const photo = this.aboutPhoto(id, who);
    if (!nb || !photo) return false;
    const one = nb.about?.[who];
    if (one) {
      const about: NotebookAbout = { ...nb.about, [who]: { ...one, rejectedPhotos: [...new Set([...(one.rejectedPhotos ?? []), photo.sourceUrl])].slice(-20) } };
      this.db.prepare('UPDATE notebooks SET about_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(about), new Date().toISOString(), id);
    }
    this.db.prepare('DELETE FROM notebook_about_photos WHERE notebook_id = ? AND who = ?').run(id, who);
    return true;
  }

  /** Which of them have a picture kept. */
  aboutPhotos(id: string): Set<NotebookAboutWho> {
    return new Set((this.db.prepare('SELECT who FROM notebook_about_photos WHERE notebook_id = ?').all(id) as Array<{ who: string }>).map((r) => r.who as NotebookAboutWho));
  }

  setLayout(id: string, layout: unknown, by?: string): Notebook {
    const was = this.mustGet(id);
    const clean = layout == null ? undefined : cleanLayout(layout);
    if (layout != null && !clean) {
      const why = layout && typeof layout === 'object' && 'components' in layout ? checkNotebookLayout((layout as { components: unknown }).components) : undefined;
      throw new Error(`That layout can't be drawn${why && !why.ok ? `: ${why.errors.slice(0, 3).join('; ')}` : ''}.`);
    }
    const now = new Date().toISOString();
    // The one it replaces, to undo to (the last 20).
    if (JSON.stringify(was.layout ?? null) !== JSON.stringify(clean ?? null)) {
      this.db.prepare('INSERT INTO notebook_layout_history (notebook_id, layout_json, replaced_at, by) VALUES (?, ?, ?, ?)').run(id, was.layout ? JSON.stringify(was.layout) : null, now, by ?? null);
      this.db.prepare('DELETE FROM notebook_layout_history WHERE notebook_id = ? AND id NOT IN (SELECT id FROM notebook_layout_history WHERE notebook_id = ? ORDER BY id DESC LIMIT 20)').run(id, id);
    }
    this.db.prepare('UPDATE notebooks SET layout_json = ?, layout_by = ?, updated_at = ? WHERE id = ?').run(clean ? JSON.stringify(clean) : null, by ?? null, now, id);
    return this.mustGet(id);
  }

  /** How many layout changes can be undone. */
  layoutUndos(id: string): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM notebook_layout_history WHERE notebook_id = ?').get(id) as { n: number }).n);
  }

  /** Put back the layout the last change replaced; false when there's nothing to undo. */
  undoLayout(id: string): boolean {
    this.mustGet(id);
    const r = this.db.prepare('SELECT id, layout_json FROM notebook_layout_history WHERE notebook_id = ? ORDER BY id DESC LIMIT 1').get(id) as { id: number; layout_json: string | null } | undefined;
    if (!r) return false;
    // Undone by you: the notebook doesn't decide it again.
    this.db.prepare('UPDATE notebooks SET layout_json = ?, layout_by = ?, updated_at = ? WHERE id = ?').run(r.layout_json, 'you', new Date().toISOString(), id);
    this.db.prepare('DELETE FROM notebook_layout_history WHERE id = ?').run(r.id);
    return true;
  }

  /** What to check on each option before deciding (at most 8). */
  setChecks(id: string, list: readonly unknown[]): Notebook {
    this.mustGet(id);
    const checks: string[] = [];
    for (const c of list) {
      const s = typeof c === 'string' ? clipWords(c, CHECK_MAX) : '';
      if (s && !checks.some((x) => x.toLowerCase() === s.toLowerCase())) checks.push(s);
      if (checks.length === 8) break;
    }
    this.db.prepare('UPDATE notebooks SET checks_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(checks), new Date().toISOString(), id);
    return this.mustGet(id);
  }

  /**
   * Set the notebook's steps (at most 6; an empty list removes them). A step
   * keeps its status and tries when its id is kept.
   */
  setSteps(id: string, list: readonly unknown[]): Notebook {
    const nb = this.mustGet(id);
    // A source step's facts, by key or label, as the notebook's field keys (unknown ones dropped).
    const steps = cleanSteps(list, nb.steps).map((step) => {
      if (!step.facts) return step;
      const keys = [...new Set(step.facts.map((f) => nb.fields.find((x) => x.key.toLowerCase() === f.toLowerCase() || x.label.toLowerCase() === f.toLowerCase())?.key).filter((k): k is string => !!k))];
      const { facts: _f, ...rest } = step;
      return keys.length ? { ...rest, facts: keys } : rest;
    });
    this.db.prepare('UPDATE notebooks SET steps_json = ?, updated_at = ? WHERE id = ?').run(steps.length ? JSON.stringify(steps) : null, new Date().toISOString(), id);
    return this.mustGet(id);
  }

  /** Change one step's status, tries or note. */
  updateStep(id: string, stepId: string, patch: Partial<Pick<NotebookStep, 'status' | 'tries' | 'note' | 'agentId' | 'stalled' | 'movedOn' | 'top' | 'why'>>, now = new Date().toISOString()): Notebook {
    const nb = this.mustGet(id);
    const steps = (nb.steps ?? []).map((s) => {
      if (s.id !== stepId) return s;
      const next: NotebookStep = { ...s, ...patch };
      if (patch.status === 'done') next.doneAt = now;
      else if (patch.status) delete next.doneAt;
      // A new status starts clean unless the patch says otherwise.
      if (patch.status && patch.stalled === undefined) delete next.stalled;
      if (patch.status && patch.movedOn === undefined) delete next.movedOn;
      // Why it came out short stays while it's stuck or moved on from; it goes when it runs again.
      if (patch.status && patch.why === undefined && !(patch.status === 'done' && next.movedOn)) delete next.why;
      return next;
    });
    if (!steps.some((s) => s.id === stepId)) throw new Error(`No step "${stepId}".`);
    this.db.prepare('UPDATE notebooks SET steps_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(cleanSteps(steps)), now, id);
    return patch.status === 'done' ? this.autoMeetCriteria(id).nb : this.mustGet(id);
  }

  /**
   * Keep short labels for a field's values (merged into what it has: a value
   * already labelled keeps its label). Labels are trimmed to 24 characters.
   */
  setFacetLabels(id: string, key: string, labels: Record<string, string>, now = new Date().toISOString()): Notebook {
    const nb = this.mustGet(id);
    const cur = nb.facets?.[key]?.labels ?? {};
    const clean: Record<string, string> = { ...cur };
    for (const [v, l] of Object.entries(labels)) {
      const t = typeof l === 'string' ? l.replace(/\s+/g, ' ').trim().slice(0, 24).trim() : '';
      if (v && t && !clean[v]) clean[v] = t;
    }
    const facets = { ...(nb.facets ?? {}), [key]: { labels: clean, at: now } };
    this.db.prepare('UPDATE notebooks SET facets_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(facets), now, id);
    return this.mustGet(id);
  }

  /** Grouping a field's values failed: not tried again for a while. */
  markFacetsFailed(id: string, key: string, now = new Date().toISOString()): void {
    const nb = this.mustGet(id);
    const prev = nb.facets?.[key] ?? { labels: {}, at: now };
    const facets = { ...(nb.facets ?? {}), [key]: { ...prev, failedAt: now } };
    this.db.prepare('UPDATE notebooks SET facets_json = ? WHERE id = ?').run(JSON.stringify(facets), id);
  }

  /** Tick (or untick) one of the notebook's checks for an option. */
  checkOption(notebookId: string, entryId: string, item: string, done: boolean): NotebookEntry {
    const e = this.mustGetOption(notebookId, entryId);
    const set = new Set(e.checked ?? []);
    if (done) set.add(item); else set.delete(item);
    const now = new Date().toISOString();
    this.db.prepare('UPDATE notebook_entries SET checked_json = ? WHERE id = ?').run(JSON.stringify([...set]), e.id);
    this.db.prepare('UPDATE notebooks SET updated_at = ? WHERE id = ?').run(now, notebookId);
    return this.mustGetOption(notebookId, entryId);
  }

  /**
   * A check an option failed that doesn't rule it out (you chose it): kept
   * with the reason, so the check counts as done. False when it was already
   * recorded.
   */
  failCheck(notebookId: string, entryId: string, check: string, reason: string): boolean {
    const e = this.mustGetOption(notebookId, entryId);
    const failed = { ...(e.failedChecks ?? {}) };
    if (Object.keys(failed).some((c) => c.toLowerCase() === check.toLowerCase())) return false;
    failed[check] = reason.slice(0, 300);
    this.db.prepare('UPDATE notebook_entries SET failed_checks_json = ? WHERE id = ?').run(JSON.stringify(failed), e.id);
    this.db.prepare('UPDATE notebooks SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), notebookId);
    return true;
  }

  /** What searches said about an option over time, oldest first; a correction says who made it (`correctedBy`). */
  sightings(entryId: string): Array<{ at: string; runId?: string; correctedBy?: string; data: Record<string, NotebookFieldValue> }> {
    return (this.db.prepare('SELECT * FROM notebook_sightings WHERE entry_id = ? ORDER BY at').all(entryId) as Array<Record<string, unknown>>).map((r) => ({
      at: String(r.at), ...(r.run_id ? { runId: String(r.run_id) } : {}), ...(r.corrected_by ? { correctedBy: String(r.corrected_by) } : {}),
      data: (() => { try { return JSON.parse(String(r.data_json ?? '{}')) as Record<string, NotebookFieldValue>; } catch { return {}; } })(),
    }));
  }

  /**
   * How many searches by the agent that found an option have run since it
   * was last seen, and found other options but not this one.
   */
  missedSearches(notebookId: string, e: Pick<NotebookEntry, 'by' | 'lastSeenAt' | 'createdAt'>): number {
    if (!e.by.startsWith('agent:')) return 0;
    const r = this.db.prepare('SELECT COUNT(*) AS n FROM notebook_searches WHERE notebook_id = ? AND agent_id = ? AND at > ? AND found > 0')
      .get(notebookId, e.by.slice('agent:'.length), e.lastSeenAt ?? e.createdAt) as { n: number };
    return Number(r.n);
  }

  /**
   * When the last run that found options started: the newest time an agent
   * found or re-found one, taken back to the start of the pass it was part of
   * (a step or pipeline run of several agents counts as one), else of its
   * search. A run that only filed notes, or an option you added, doesn't
   * count. Undefined before any agent found one.
   */
  lastFindAt(notebookId: string): string | undefined {
    const r = this.db.prepare("SELECT MAX(COALESCE(last_seen_at, created_at)) AS at FROM notebook_entries WHERE notebook_id = ? AND kind = 'option' AND by LIKE 'agent:%'")
      .get(notebookId) as { at: string | null } | undefined;
    const at = r?.at ?? undefined;
    if (!at) return undefined;
    const p = this.db.prepare('SELECT started_at FROM notebook_passes WHERE notebook_id = ? AND started_at <= ? AND (finished_at IS NULL OR finished_at >= ?) ORDER BY started_at DESC LIMIT 1')
      .get(notebookId, at, at) as { started_at: string } | undefined;
    if (p) return p.started_at;
    const sr = this.db.prepare('SELECT at FROM notebook_searches WHERE notebook_id = ? AND at <= ? ORDER BY at DESC LIMIT 1').get(notebookId, at) as { at: string } | undefined;
    return sr?.at ?? at;
  }

  /** An option's kept picture, if there is one: its own photo, a representative one, or an illustration. */
  photo(entryId: string): { contentType: string; bytes: Uint8Array; sourceUrl: string; kind: NotebookPhotoKind; what?: string; fetchedAt: string } | undefined {
    const r = this.db.prepare('SELECT * FROM notebook_photos WHERE entry_id = ? AND bytes IS NOT NULL').get(entryId) as Record<string, unknown> | undefined;
    return r ? { contentType: String(r.content_type), bytes: r.bytes as Uint8Array, sourceUrl: String(r.source_url), kind: (String(r.kind ?? 'listing') as NotebookPhotoKind), ...(r.what ? { what: String(r.what) } : {}), fetchedAt: String(r.fetched_at) } : undefined;
  }

  /**
   * The picture that stands for a notebook: an option still in the running
   * with a kept picture, its own photo before a representative one before a
   * drawing, newest first. Undefined when none has one.
   */
  coverPhoto(notebookId: string): { entryId: string; kind: NotebookPhotoKind; shape?: ImageShape } | undefined {
    const r = this.db.prepare(`SELECT e.id AS id, p.kind AS kind FROM notebook_entries e JOIN notebook_photos p ON p.entry_id = e.id AND p.bytes IS NOT NULL
      WHERE e.notebook_id = ? AND e.kind = 'option' AND e.ruled_out_at IS NULL
      ORDER BY CASE p.kind WHEN 'listing' THEN 0 WHEN 'representative' THEN 1 WHEN 'logo' THEN 1 ELSE 2 END, e.created_at DESC LIMIT 1`).get(notebookId) as { id: string; kind: string } | undefined;
    if (!r) return undefined;
    const kind = (r.kind ?? 'listing') as NotebookPhotoKind;
    const shape = kind === 'logo' ? this.photoShape(r.id) : undefined;
    return { entryId: r.id, kind, ...(shape ? { shape } : {}) };
  }

  /** A kept picture's shape from its header (a wordmark logo is wide), when it says. */
  photoShape(entryId: string): ImageShape | undefined {
    const r = this.db.prepare('SELECT substr(bytes, 1, 65536) AS head FROM notebook_photos WHERE entry_id = ? AND bytes IS NOT NULL').get(entryId) as { head?: Uint8Array } | undefined;
    return r?.head ? imageShape(r.head) : undefined;
  }

  /** What kind of picture an option has, if any. */
  photoKind(entryId: string): NotebookPhotoKind | undefined {
    const r = this.db.prepare('SELECT kind FROM notebook_photos WHERE entry_id = ? AND bytes IS NOT NULL').get(entryId) as { kind?: string } | undefined;
    return r ? (String(r.kind ?? 'listing') as NotebookPhotoKind) : undefined;
  }

  /** Options with no picture yet (or only an illustration, retried daily), not ruled out. */
  pictureCandidates(notebookId: string, limit = 8): NotebookEntry[] {
    // No picture and never tried; or only an illustration, last tried over a day ago (a real photo may fetch now).
    const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
    const rows = this.db.prepare(`SELECT e.* FROM notebook_entries e LEFT JOIN notebook_photos p ON p.entry_id = e.id AND p.bytes IS NOT NULL
      WHERE e.notebook_id = ? AND e.kind = 'option' AND e.ruled_out_at IS NULL
        AND ((p.entry_id IS NULL AND e.picture_tried_at IS NULL) OR (p.kind = 'illustration' AND (e.picture_tried_at IS NULL OR e.picture_tried_at < ?)))
      ORDER BY e.created_at DESC LIMIT ?`).all(notebookId, dayAgo, limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.toEntry(r));
  }

  /** Example photos that are a company's logo (the picture agent said so), kept as logos. Returns how many. */
  relabelLogos(notebookId: string): number {
    return Number(this.db.prepare("UPDATE notebook_photos SET kind = 'logo' WHERE notebook_id = ? AND kind = 'representative' AND bytes IS NOT NULL AND lower(coalesce(what, '')) LIKE '%logo%'").run(notebookId).changes);
  }

  /** Note that a representative picture was tried for these options. */
  markPictureTried(entryIds: readonly string[]): void {
    const now = new Date().toISOString();
    const st = this.db.prepare('UPDATE notebook_entries SET picture_tried_at = ? WHERE id = ?');
    for (const id of entryIds) st.run(now, id);
  }

  hasPhoto(entryId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM notebook_photos WHERE entry_id = ? AND bytes IS NOT NULL').get(entryId);
  }

  /** Keep a photo (or remember that this address didn't give one, so it isn't tried again). */
  savePhoto(notebookId: string, entryId: string, sourceUrl: string, result: { contentType: string; bytes: Uint8Array } | { error: string }, opts: { kind?: NotebookPhotoKind; what?: string } = {}): void {
    const ok = 'bytes' in result;
    // A listing that gave no photo never replaces a picture it already has (an
    // example photo or a drawing): just remember that address was tried.
    if (!ok) {
      const had = this.db.prepare('SELECT kind FROM notebook_photos WHERE entry_id = ? AND bytes IS NOT NULL').get(entryId) as { kind: string } | undefined;
      if (had && had.kind !== 'listing') {
        this.db.prepare('UPDATE notebook_photos SET tried_url = ?, error = ? WHERE entry_id = ?').run(sourceUrl, result.error.slice(0, 200), entryId);
        return;
      }
    }
    this.db.prepare(`INSERT INTO notebook_photos (entry_id, notebook_id, source_url, content_type, bytes, fetched_at, error, kind, what, tried_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(entry_id) DO UPDATE SET source_url = excluded.source_url, content_type = excluded.content_type, bytes = excluded.bytes, fetched_at = excluded.fetched_at, error = excluded.error, kind = excluded.kind, what = excluded.what, tried_url = excluded.tried_url`)
      .run(entryId, notebookId, sourceUrl, ok ? result.contentType : null, ok ? result.bytes : null, new Date().toISOString(), ok ? null : result.error.slice(0, 200), opts.kind ?? 'listing', opts.what?.slice(0, 160) ?? null);
  }

  /**
   * Options worth a photo try: no listing photo yet (an example photo or a
   * drawing doesn't count), and not already tried at this address (its image
   * field, else its listing link). Ruled-out options are skipped.
   */
  photoCandidates(notebookId: string, limit = 12): Array<{ entry: NotebookEntry; image?: string; link?: string }> {
    const nb = this.mustGet(notebookId);
    const imageKey = nb.fields.find((f) => f.role === 'image')?.key;
    const tried = new Map((this.db.prepare('SELECT entry_id, source_url, kind, tried_url, bytes IS NOT NULL AS ok FROM notebook_photos WHERE notebook_id = ?').all(notebookId) as Array<{ entry_id: string; source_url: string; kind: string; tried_url: string | null; ok: number }>)
      .map((r) => [r.entry_id, r]));
    const out: Array<{ entry: NotebookEntry; image?: string; link?: string }> = [];
    for (const e of this.entries(notebookId, 1000)) {
      if (e.kind !== 'option' || e.ruledOut) continue;
      const image = imageKey && typeof e.data?.[imageKey] === 'string' ? String(e.data[imageKey]) : undefined;
      const link = optionLink(nb.fields, e.data);
      const source = image ?? link;
      if (!source) continue;
      const t = tried.get(e.id);
      if (t && ((t.ok && t.kind === 'listing') || t.source_url === source || t.tried_url === source)) continue;
      out.push({ entry: e, ...(image ? { image } : {}), ...(link ? { link } : {}) });
      if (out.length === limit) break;
    }
    return out;
  }

  /** Bring a ruled-out option back, at the stage it was at. */
  reinstate(notebookId: string, entryId: string): NotebookEntry {
    const e = this.mustGetOption(notebookId, entryId);
    this.db.prepare('UPDATE notebook_entries SET ruled_out_at = NULL, ruled_out_reason = NULL, ruled_out_by = NULL, ruled_out_stage = NULL, ruled_out_gone = NULL WHERE id = ?').run(e.id);
    this.db.prepare('UPDATE notebooks SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), notebookId);
    return this.mustGetOption(notebookId, entryId);
  }

  /**
   * Pick one option (or take the pick back) without closing the notebook:
   * "I bought this one", while you keep looking. The open decide step is
   * done once there are as many picks as it wants, and open again when a
   * pick taken back leaves it short.
   */
  choose(notebookId: string, entryId: string, on = true): NotebookEntry {
    const e = this.mustGetOption(notebookId, entryId);
    if (on && e.ruledOut) throw new Error(`${e.title} was ruled out. Bring it back first.`);
    const now = new Date().toISOString();
    this.db.prepare('UPDATE notebook_entries SET chosen_at = ? WHERE id = ?').run(on ? (e.chosenAt ?? now) : null, e.id);
    this.db.prepare('UPDATE notebooks SET updated_at = ? WHERE id = ?').run(now, notebookId);
    const nb = this.mustGet(notebookId);
    const options = this.entries(notebookId, 1000).filter((x) => x.kind === 'option' && !x.ruledOut);
    const picks = options.filter((x) => x.chosenAt).length;
    const step = nb.status === 'active' ? nb.steps?.find((s) => s.kind === 'decide') : undefined;
    if (step) {
      const want = step.target ?? Math.min(options.length, 5);
      if (step.status !== 'done' && picks >= Math.max(1, want)) this.updateStep(notebookId, step.id, { status: 'done', note: `${String(picks)} chosen` }, now);
      else if (step.status === 'done' && picks < Math.max(1, want)) this.updateStep(notebookId, step.id, { status: 'todo', note: picks ? `${String(picks)} chosen` : undefined }, now);
    }
    return this.mustGetOption(notebookId, entryId);
  }

  private addSighting(entryId: string, notebookId: string, runId: string | undefined, at: string, data: Record<string, NotebookFieldValue>): void {
    if (Object.keys(data).length === 0) return;
    this.db.prepare('INSERT INTO notebook_sightings (entry_id, notebook_id, run_id, at, data_json) VALUES (?, ?, ?, ?, ?)')
      .run(entryId, notebookId, runId ?? null, at, JSON.stringify(data));
  }

  private mustGetOption(notebookId: string, entryId: string): NotebookEntry {
    const row = this.db.prepare("SELECT * FROM notebook_entries WHERE id = ? AND notebook_id = ? AND kind = 'option'").get(entryId, notebookId) as Record<string, unknown> | undefined;
    if (!row) throw new Error('No such option in this notebook.');
    return this.toEntry(row);
  }

  /** Mark the notebook changed (so an open page redraws). */
  touch(id: string): void {
    this.db.prepare('UPDATE notebooks SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  }

  /** Note that setup ran (or was tried) for this notebook. */
  markSetup(id: string): void {
    this.db.prepare('UPDATE notebooks SET setup_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  }

  /** Does it need setting up: options to compare, but no fields yet, and setup not tried? */
  needsSetup(id: string): boolean {
    const nb = this.get(id);
    if (!nb || nb.fields.length > 0 || nb.setupAt) return false;
    return !!this.db.prepare("SELECT 1 FROM notebook_entries WHERE notebook_id = ? AND kind = 'option' LIMIT 1").get(id);
  }

  /**
   * Give an option it already has its facts (and a fingerprint if it has
   * none), e.g. when the notebook gets its fields. Known facts are kept unless
   * a new value is given.
   */
  setOptionFacts(notebookId: string, entryId: string, data: Record<string, unknown>, fingerprint?: string): NotebookEntry | undefined {
    const nb = this.mustGet(notebookId);
    const row = this.db.prepare("SELECT * FROM notebook_entries WHERE id = ? AND notebook_id = ? AND kind = 'option'").get(entryId, notebookId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const e = this.toEntry(row);
    // Facts that contradict what the option's own text says belong to another
    // option (a model can mix up ids): keep only what the text states.
    const facts = splitFacts(data);
    const given = cleanData(facts.values, nb.fields);
    const stated = withoutTextLink(readOptionText(`${e.title}\n${e.body}`, nb.fields), nb.fields, { ...(e.data ?? {}), ...given });
    // When they agree, the text's figure wins (rounded or not), except over a
    // range it falls in: "from $170k" doesn't replace $170k–$200k.
    const clean = contradicts(given, stated) ? stated : { ...given, ...Object.fromEntries(Object.entries(stated).filter(([k, v]) => !(isRange(given[k]) && !isRange(v)))) };
    const merged = { ...(e.data ?? {}), ...clean };
    // A fact the option's own text states needs no source; a given one keeps its own.
    const meta = cleanFactMeta(facts.meta, Object.fromEntries(Object.entries(clean).filter(([k]) => !(k in stated))));
    const mergedMeta = mergeFactMeta(e.factMeta, clean, meta);
    const fp = e.fingerprint ?? optionFingerprint(fingerprint, merged, nb.fields);
    this.db.prepare('UPDATE notebook_entries SET data_json = ?, fact_meta_json = ?, fingerprint = ? WHERE id = ?')
      .run(Object.keys(merged).length ? JSON.stringify(merged) : null, mergedMeta ? JSON.stringify(mergedMeta) : null, fp ?? null, e.id);
    return { ...e, ...(Object.keys(merged).length ? { data: merged } : {}), ...(mergedMeta ? { factMeta: mergedMeta } : { factMeta: undefined }), ...(fp ? { fingerprint: fp } : {}) };
  }

  /**
   * Correct an option's facts on someone's word ("the price is $136.64"):
   * the given facts replace what it has (their sources and estimate marks
   * go, unless given), and the correction is kept in its history, so it
   * wins over the option's own text and over what searches said before.
   * Returns the option and the facts that changed, with their old values.
   */
  correctOption(notebookId: string, entryId: string, data: Record<string, unknown>, by = 'you'): { entry: NotebookEntry; changed: Array<{ key: string; from?: NotebookFieldValue; to: NotebookFieldValue }> } {
    const nb = this.mustGet(notebookId);
    const e = this.mustGetOption(notebookId, entryId);
    const facts = splitFacts(data);
    const values = cleanData(facts.values, nb.fields);
    const prev = e.data ?? {};
    const changed = Object.entries(values)
      .filter(([k, v]) => JSON.stringify(prev[k]) !== JSON.stringify(v))
      .map(([key, to]) => ({ key, ...(prev[key] !== undefined ? { from: prev[key] } : {}), to }));
    if (!changed.length) return { entry: e, changed };
    const merged = { ...prev, ...values };
    const meta = mergeFactMeta(e.factMeta, values, cleanFactMeta(facts.meta, values));
    const now = new Date().toISOString();
    this.db.prepare('UPDATE notebook_entries SET data_json = ?, fact_meta_json = ? WHERE id = ?').run(JSON.stringify(merged), meta ? JSON.stringify(meta) : null, e.id);
    this.db.prepare('INSERT INTO notebook_sightings (entry_id, notebook_id, run_id, at, data_json, corrected_by) VALUES (?, ?, NULL, ?, ?, ?)')
      .run(e.id, notebookId, now, JSON.stringify(Object.fromEntries(changed.map((c) => [c.key, c.to]))), by);
    this.db.prepare('UPDATE notebooks SET updated_at = ? WHERE id = ?').run(now, notebookId);
    return { entry: this.mustGetOption(notebookId, entryId), changed };
  }

  /**
   * Repair options whose facts contradict their own text (the year, price or
   * measure it states): the text wins, unless a later search found this same
   * option again and saw newer facts (a price change): those win over the
   * text it was filed with. Returns how many were repaired.
   */
  reconcileOptionFacts(notebookId: string): number {
    const nb = this.mustGet(notebookId);
    if (nb.fields.length === 0) return 0;
    let n = 0;
    for (const e of this.entries(notebookId, 1000)) {
      if (e.kind !== 'option' || !e.data) continue;
      const stated = readOptionText(`${e.title}\n${e.body}`, nb.fields);
      // The first sighting is the filing the text describes; later ones matched this option by its fingerprint.
      // A correction (you, or sua on your word) always counts.
      const later = this.sightings(e.id).filter((x, i) => i > 0 || x.correctedBy).reduce<Record<string, NotebookFieldValue>>((acc, x) => ({ ...acc, ...cleanData(x.data, nb.fields) }), {});
      const expected = { ...stated, ...later };
      if (!contradicts(e.data, expected)) {
        // Facts an earlier repair took away by mistake (a salary range read as its
        // first number "contradicted" the range): the filing had them, and they
        // agree with the text, so they come back.
        // Only that case: what's left is just what the text states, with a
        // range field cut to one number.
        const data = e.data;
        const cut = nb.fields.some((f) => f.range && typeof data[f.key] === 'number')
          && Object.keys(data).every((k) => k in stated);
        const filed = cut ? this.sightings(e.id)[0] : undefined;
        const full = filed && !filed.correctedBy ? { ...cleanData(filed.data, nb.fields), ...later } : undefined;
        if (full && Object.keys(full).length > Object.keys(data).length && !contradicts(full, expected)
          && nb.fields.some((f) => f.range && isRange(full[f.key]) && typeof data[f.key] === 'number')
          && Object.entries(data).every(([k, v]) => full[k] !== undefined && (agrees(full[k], v) || agrees(v, full[k])))) {
          this.db.prepare('UPDATE notebook_entries SET data_json = ? WHERE id = ?').run(JSON.stringify(full), e.id);
          n++;
        }
        continue;
      }
      const linkKey = nb.fields.find((f) => f.role === 'link')?.key;
      const keep = linkKey && expected[linkKey] === undefined && e.data[linkKey] !== undefined && typeof e.data[linkKey] === 'string' && `${e.title} ${e.body}`.includes(String(e.data[linkKey])) ? { [linkKey]: e.data[linkKey] } : {};
      this.db.prepare('UPDATE notebook_entries SET data_json = ? WHERE id = ?').run(JSON.stringify({ ...keep, ...expected }), e.id);
      n++;
    }
    return n;
  }

  /** Replace what options record. Invalid fields are dropped; at most 12. */
  setFields(id: string, fields: readonly unknown[]): Notebook {
    this.mustGet(id);
    this.db.prepare('UPDATE notebooks SET fields_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(cleanFields(fields)), new Date().toISOString(), id);
    return this.mustGet(id);
  }

  /**
   * Add an option, or, when one with the same fingerprint is already here,
   * refresh its facts and when it was last seen instead of adding it twice.
   */
  /**
   * The option a new one is, by name, when the notebook's options are
   * organizations: each option's title begins with its org fact ("Motive:
   * planning and forecasting" with company Motive), so the same company is
   * the same option. A notebook of listings or jobs (where two "2008 Subaru
   * Forester" or two Stripe postings are different) never matches this way.
   * Only one option may match.
   */
  findOrgOption(notebookId: string, input: Pick<NewOption, 'title' | 'data'>): NotebookEntry | undefined {
    const nb = this.mustGet(notebookId);
    const orgF = nb.fields.find((f) => f.role === 'org');
    if (!orgF) return undefined;
    const lead = (t: string) => t.split(/\s*(?::|\s[-–—]\s|,|\()\s*/)[0] ?? '';
    const own = input.data?.[orgF.key];
    const org = entryKey(typeof own === 'string' && own.trim() ? own : lead(input.title));
    // The new one must itself be the organization (its title begins with it).
    if (!org || !entryKey(input.title).startsWith(org)) return undefined;
    const hits = this.entries(notebookId, 1000).filter((e) => {
      if (e.kind !== 'option') return false;
      const v = e.data?.[orgF.key];
      const k = typeof v === 'string' ? entryKey(v) : '';
      return !!k && k === org && entryKey(e.title).startsWith(k);
    });
    // Copies kept before this matched: the one still in the running, if only one is.
    const live = hits.filter((e) => !e.ruledOut);
    return hits.length === 1 ? hits[0] : live.length === 1 ? live[0] : undefined;
  }

  /**
   * An option at the same address in the notebook's link field (sameAddress)
   * that is the same thing: a search-results page several listings point at
   * isn't one, so the year in the title, the main measure (within 5%) and
   * the organization must agree. Exactly one such, else none.
   */
  findByLink(notebookId: string, nb: Pick<Notebook, 'fields'>, data: Record<string, NotebookFieldValue>, title = ''): NotebookEntry | undefined {
    const linkF = nb.fields.find((f) => f.role === 'link');
    const v = linkF ? data[linkF.key] : undefined;
    const want = typeof v === 'string' && !isListPage(v) ? sameAddress(v) : undefined;
    if (!linkF || !want) return undefined;
    const all = this.entries(notebookId, 1000).filter((e) => {
      const u = e.kind === 'option' ? e.data?.[linkF.key] : undefined;
      return typeof u === 'string' && sameAddress(u) === want;
    });
    const hits = all.filter((e) => sameThing(nb, { title, data }, { title: e.title, data: e.data ?? {} }));
    return hits.length === 1 ? hits[0] : hits.filter((e) => !e.ruledOut).length === 1 ? hits.find((e) => !e.ruledOut) : undefined;
  }

  upsertOption(notebookId: string, input: NewOption): { entry: NotebookEntry; seenAgain: boolean; ruledOut?: boolean } {
    const nb = this.mustGet(notebookId);
    const facts = splitFacts(input.data, { trusted: input.trustedFacts });
    const data = cleanData(facts.values, nb.fields);
    const meta = cleanFactMeta(facts.meta, data);
    const fingerprint = optionFingerprint(input.fingerprint, data, nb.fields);
    const now = new Date().toISOString();
    // The notebook's options are organizations: the same one, by name, when
    // there's no link or id to go by, or the one given matches nothing (agents
    // key a company differently: "pigment.com", "pigment", "lever:pigment").
    const vinFp = fingerprint?.startsWith('vin|') ? fingerprint.slice(4) : undefined;
    const byFingerprint = fingerprint ? this.db.prepare("SELECT 1 FROM notebook_entries WHERE notebook_id = ? AND kind = 'option' AND fingerprint IN (?, ?, ?, ?) LIMIT 1").get(notebookId, fingerprint, vinFp ? `vin:${vinFp}` : fingerprint, vinFp ?? fingerprint, vinFp ? `vin ${vinFp}` : fingerprint) : undefined;
    const byOrg = byFingerprint ? undefined : this.findOrgOption(notebookId, { title: input.title, data });
    if (byOrg) {
      const merged = { ...(byOrg.data ?? {}), ...data };
      const mergedMeta = mergeFactMeta(byOrg.factMeta, data, meta);
      this.db.prepare('UPDATE notebook_entries SET data_json = ?, fact_meta_json = ?, last_seen_at = ?, run_id = COALESCE(?, run_id) WHERE id = ?')
        .run(JSON.stringify(merged), mergedMeta ? JSON.stringify(mergedMeta) : null, now, input.runId ?? null, byOrg.id);
      this.addSighting(byOrg.id, notebookId, input.runId, now, data);
      return { entry: { ...byOrg, data: merged, ...(mergedMeta ? { factMeta: mergedMeta } : {}), lastSeenAt: now, ...(input.runId ? { runId: input.runId } : {}) }, seenAgain: true, ...(byOrg.ruledOut ? { ruledOut: true } : {}) };
    }
    if (fingerprint) {
      // A VIN kept in another form before ("vin:…", the bare VIN): the same car, and its key takes the one form.
      const vin = fingerprint.startsWith('vin|') ? fingerprint.slice(4) : undefined;
      const row = (this.db.prepare("SELECT * FROM notebook_entries WHERE notebook_id = ? AND kind = 'option' AND fingerprint = ? LIMIT 1").get(notebookId, fingerprint)
        ?? (vin ? this.db.prepare("SELECT * FROM notebook_entries WHERE notebook_id = ? AND kind = 'option' AND fingerprint IN (?, ?, ?) LIMIT 1").get(notebookId, `vin:${vin}`, vin, `vin ${vin}`) : undefined)) as Record<string, unknown> | undefined;
      if (row && vin && row.fingerprint !== fingerprint) this.db.prepare('UPDATE notebook_entries SET fingerprint = ? WHERE id = ?').run(fingerprint, String(row.id));
      // An option kept before fingerprints existed: the same title, or its text holds this listing's address.
      const legacy = row ? undefined : (this.db.prepare("SELECT * FROM notebook_entries WHERE notebook_id = ? AND kind = 'option' AND fingerprint IS NULL").all(notebookId) as Array<Record<string, unknown>>)
        .find((r) => entryKey(String(r.title)) === entryKey(input.title) || String(r.body ?? '').toLowerCase().replace(/https?:\/\/(www\.)?/g, '').includes(fingerprint));
      if (legacy) this.db.prepare('UPDATE notebook_entries SET fingerprint = ? WHERE id = ?').run(fingerprint, String(legacy.id));
      const match = row ?? legacy;
      if (match) {
        const prev = this.toEntry(match);
        const merged = { ...(prev.data ?? {}), ...data };
        const mergedMeta = mergeFactMeta(prev.factMeta, data, meta);
        this.db.prepare('UPDATE notebook_entries SET data_json = ?, fact_meta_json = ?, last_seen_at = ?, run_id = COALESCE(?, run_id) WHERE id = ?')
          .run(JSON.stringify(merged), mergedMeta ? JSON.stringify(mergedMeta) : null, now, input.runId ?? null, prev.id);
        this.addSighting(prev.id, notebookId, input.runId, now, data);
        // Ruled out stays ruled out: a search finding it again only notes when it was seen.
        return { entry: { ...prev, data: merged, ...(mergedMeta ? { factMeta: mergedMeta } : {}), lastSeenAt: now, ...(input.runId ? { runId: input.runId } : {}) }, seenAgain: true, ...(prev.ruledOut ? { ruledOut: true } : {}) };
      }
    }
    // The same address (its listing, posting or website) is the same option,
    // however an agent keyed it: CarGurus and an agent's VIN, say.
    const byLink = this.findByLink(notebookId, nb, data, input.title);
    if (byLink) {
      const merged = { ...(byLink.data ?? {}), ...data };
      const mergedMeta = mergeFactMeta(byLink.factMeta, data, meta);
      this.db.prepare('UPDATE notebook_entries SET data_json = ?, fact_meta_json = ?, last_seen_at = ?, run_id = COALESCE(?, run_id) WHERE id = ?')
        .run(JSON.stringify(merged), mergedMeta ? JSON.stringify(mergedMeta) : null, now, input.runId ?? null, byLink.id);
      this.addSighting(byLink.id, notebookId, input.runId, now, data);
      return { entry: { ...byLink, data: merged, ...(mergedMeta ? { factMeta: mergedMeta } : {}), lastSeenAt: now, ...(input.runId ? { runId: input.runId } : {}) }, seenAgain: true, ...(byLink.ruledOut ? { ruledOut: true } : {}) };
    }
    const entry = this.addEntry(notebookId, { kind: 'option', title: input.title, body: input.body, by: input.by, runId: input.runId });
    const stage = nb.stages[0];
    this.db.prepare('UPDATE notebook_entries SET data_json = ?, fact_meta_json = ?, fingerprint = ?, last_seen_at = ?, stage = ?, stage_at = ? WHERE id = ?')
      .run(Object.keys(data).length ? JSON.stringify(data) : null, Object.keys(meta).length ? JSON.stringify(meta) : null, fingerprint ?? null, now, stage ?? null, stage ? now : null, entry.id);
    this.addSighting(entry.id, notebookId, input.runId, now, data);
    return { entry: { ...entry, ...(Object.keys(data).length ? { data } : {}), ...(Object.keys(meta).length ? { factMeta: meta } : {}), ...(fingerprint ? { fingerprint } : {}), lastSeenAt: now, ...(stage ? { stage, stageAt: now } : {}) }, seenAgain: false };
  }

  /**
   * Options kept before the notebook had fields: read what's unambiguous in
   * their text (price, the main measure, the year, the listing link) into
   * data, so they compare and chart with the rest. Returns how many changed.
   */
  backfillOptions(id: string): number {
    const nb = this.mustGet(id);
    if (nb.fields.length === 0) return 0;
    let n = 0;
    for (const e of this.entries(id, 1000)) {
      if (e.kind !== 'option' || (e.data && Object.keys(e.data).length > 0)) continue;
      const data = readOptionText(`${e.title}\n${e.body}`, nb.fields);
      if (Object.keys(data).length === 0) continue;
      const fp = e.fingerprint ?? optionFingerprint(undefined, data, nb.fields);
      this.db.prepare('UPDATE notebook_entries SET data_json = ?, fingerprint = COALESCE(fingerprint, ?) WHERE id = ?').run(JSON.stringify(data), fp ?? null, e.id);
      n++;
    }
    return n;
  }

  /** Link the notebook to its conversation with sua. */
  setConversation(id: string, threadId: string): void {
    this.db.prepare('UPDATE notebooks SET conversation_id = ? WHERE id = ?').run(threadId, id);
  }

  /** Add parameters / criteria (skipping ones it has), e.g. from the conversation. */
  extend(id: string, add: { params?: readonly string[]; criteria?: readonly string[] }): Notebook {
    const nb = this.mustGet(id);
    const has = (list: readonly string[], s: string) => list.some((x) => x.toLowerCase() === s.toLowerCase());
    const params = [...nb.params];
    for (const p of clean(add.params)) if (!has(params, p)) params.push(p);
    const criteria = [...nb.criteria];
    for (const c of clean(add.criteria, 10)) if (!has(criteria.map((x) => x.text), c)) criteria.push({ text: c, met: false });
    this.db.prepare('UPDATE notebooks SET params_json = ?, criteria_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(params.slice(0, 20)), JSON.stringify(criteria.slice(0, 10)), new Date().toISOString(), id);
    return this.mustGet(id);
  }

  /** Record a pipeline run's outcome (one line) on the notebook. */
  noteRun(id: string, note: string): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE notebooks SET last_run_at = ?, last_run_note = ?, updated_at = ? WHERE id = ?').run(now, note.slice(0, 300), now, id);
  }

  create(input: NewNotebook): Notebook {
    const title = input.title.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!title) throw new Error('A notebook needs a title.');
    let id = notebookSlug(title);
    for (let n = 2; this.get(id); n++) id = `${notebookSlug(title).slice(0, 44)}-${String(n)}`;
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO notebooks (id, title, statement, params_json, criteria_json, pipeline_json, cadence, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`).run(
      id, title, (input.statement ?? '').trim().slice(0, 500),
      JSON.stringify(clean(input.params)),
      JSON.stringify(clean(input.criteria, 10).map((text) => ({ text, met: false }))),
      JSON.stringify(clean(input.pipeline, 10).filter((a) => ID_RE.test(a))),
      (input.cadence ?? '').trim(), now, now,
    );
    return this.get(id)!;
  }

  /** Save a draft's state (insert or replace); `draft` is the caller's own shape, kept as JSON. */
  saveDraft(id: string, d: { status: string; text: string; draft?: unknown; error?: string }, now = new Date().toISOString()): void {
    this.db.prepare(`INSERT INTO notebook_drafts (id, status, text, draft_json, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, text = excluded.text, draft_json = excluded.draft_json, error = excluded.error, updated_at = excluded.updated_at`)
      .run(id, d.status, d.text, d.draft === undefined ? null : JSON.stringify(d.draft), d.error ?? null, now, now);
  }

  getDraft(id: string): NotebookDraftRecord | undefined {
    const r = this.db.prepare('SELECT * FROM notebook_drafts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? draftRecord(r) : undefined;
  }

  /** Drafts not started yet, newest first (not changes to a notebook you're making on its Edit page: `edit:<id>`). */
  listDrafts(limit = 10): NotebookDraftRecord[] {
    return (this.db.prepare("SELECT * FROM notebook_drafts WHERE id NOT LIKE 'edit:%' ORDER BY updated_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>).map(draftRecord);
  }

  deleteDraft(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM notebook_drafts WHERE id = ?').run(id).changes) > 0;
  }

  /**
   * Keep a notebook's setup as a template named `name` (a slug of it is its
   * id: the same name again replaces it). Its options and history aren't kept.
   */
  saveTemplate(name: string, notebookId: string, now = new Date().toISOString(), edits?: NotebookTemplateEdits): NotebookTemplate {
    const nb = this.mustGet(notebookId);
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!clean) throw new Error('A template needs a name.');
    const id = notebookSlug(clean);
    const setup = edits ? templateWithEdits(nb, edits) : templateFromNotebook(nb);
    this.db.prepare(`INSERT INTO notebook_templates (id, name, description, setup_json, from_notebook, uses, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, setup_json = excluded.setup_json, from_notebook = excluded.from_notebook, updated_at = excluded.updated_at, archived_at = NULL`)
      .run(id, clean, describeTemplateSetup(setup), JSON.stringify(setup), nb.id, now, now);
    return this.getTemplate(id)!;
  }

  getTemplate(id: string): NotebookTemplate | undefined {
    const r = this.db.prepare('SELECT * FROM notebook_templates WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? templateRecord(r) : undefined;
  }

  /**
   * Your templates, the most used first, then the newest. Archived ones are
   * left out unless asked for (`archived: 'only'` lists just them).
   */
  listTemplates(limit = 50, opts: { archived?: 'exclude' | 'include' | 'only' } = {}): NotebookTemplate[] {
    const where = opts.archived === 'include' ? '' : opts.archived === 'only' ? 'WHERE archived_at IS NOT NULL' : 'WHERE archived_at IS NULL';
    return (this.db.prepare(`SELECT * FROM notebook_templates ${where} ORDER BY uses DESC, updated_at DESC LIMIT ?`).all(limit) as Array<Record<string, unknown>>)
      .map(templateRecord).filter((t): t is NotebookTemplate => !!t);
  }

  /** Archive a template (kept, not offered) or, with `archived` false, restore it. */
  archiveTemplate(id: string, archived = true, now = new Date().toISOString()): boolean {
    return Number(this.db.prepare('UPDATE notebook_templates SET archived_at = ? WHERE id = ?').run(archived ? now : null, id).changes) > 0;
  }

  deleteTemplate(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM notebook_templates WHERE id = ?').run(id).changes) > 0;
  }

  /** A notebook was started from it. */
  markTemplateUsed(id: string, now = new Date().toISOString()): void {
    this.db.prepare('UPDATE notebook_templates SET uses = uses + 1, used_at = ? WHERE id = ?').run(now, id);
  }

  /** Drop drafts untouched since `before` (ISO). */
  pruneDrafts(before: string): number {
    return Number(this.db.prepare('DELETE FROM notebook_drafts WHERE updated_at < ?').run(before).changes);
  }

  get(id: string): Notebook | undefined {
    const r = this.db.prepare('SELECT * FROM notebooks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? this.toNotebook(r) : undefined;
  }

  /**
   * Active first, then most recently changed. Archived notebooks are left
   * out unless `archived` is 'include' (everything) or 'only'.
   */
  list(opts: { status?: NotebookStatus; archived?: 'include' | 'only' } = {}): Notebook[] {
    const where = [
      ...(opts.status ? ['status = ?'] : []),
      ...(opts.archived === 'only' ? ['archived_at IS NOT NULL'] : opts.archived === 'include' ? [] : ['archived_at IS NULL']),
    ];
    const rows = this.db.prepare(`SELECT * FROM notebooks ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC`)
      .all(...(opts.status ? [opts.status] : [])) as Array<Record<string, unknown>>;
    return rows.map((r) => this.toNotebook(r));
  }

  /** Hide a notebook from lists, Home, Today and schedules. Nothing in it is deleted. */
  archive(id: string): Notebook {
    this.mustGet(id);
    this.db.prepare('UPDATE notebooks SET archived_at = ? WHERE id = ?').run(new Date().toISOString(), id);
    return this.mustGet(id);
  }

  /** Bring an archived notebook back. */
  unarchive(id: string): Notebook {
    this.mustGet(id);
    // Its schedule starts fresh: it waits for its next slot rather than catching up on the archived time.
    this.db.prepare('UPDATE notebooks SET archived_at = NULL, cadence_fired_at = NULL WHERE id = ?').run(id);
    return this.mustGet(id);
  }

  /**
   * Delete a notebook and everything in it (entries, sightings, searches,
   * passes, kept photos). Its conversation and the runs that fed it stay.
   * Returns how many entries went with it, or undefined if there was none.
   */
  delete(id: string): { entries: number } | undefined {
    if (!this.get(id)) return undefined;
    const entries = (this.db.prepare('SELECT COUNT(*) AS n FROM notebook_entries WHERE notebook_id = ?').get(id) as { n: number }).n;
    this.db.exec('BEGIN');
    try {
      for (const table of ['notebook_sightings', 'notebook_searches', 'notebook_passes', 'notebook_photos', 'notebook_entries', 'notebook_layout_history', 'notebook_about_photos']) {
        this.db.prepare(`DELETE FROM ${table} WHERE notebook_id = ?`).run(id);
      }
      this.db.prepare('DELETE FROM notebooks WHERE id = ?').run(id);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return { entries };
  }

  update(id: string, patch: Partial<Pick<NewNotebook, 'title' | 'statement' | 'params' | 'pipeline' | 'cadence'>>): Notebook {
    const nb = this.mustGet(id);
    const next = {
      title: patch.title !== undefined ? patch.title.replace(/\s+/g, ' ').trim().slice(0, 120) || nb.title : nb.title,
      statement: patch.statement !== undefined ? patch.statement.trim().slice(0, 500) : nb.statement,
      params: patch.params !== undefined ? clean(patch.params) : nb.params,
      pipeline: patch.pipeline !== undefined ? clean(patch.pipeline, 10).filter((a) => ID_RE.test(a)) : nb.pipeline,
      cadence: patch.cadence !== undefined ? patch.cadence.trim() : nb.cadence,
    };
    this.db.prepare('UPDATE notebooks SET title = ?, statement = ?, params_json = ?, pipeline_json = ?, cadence = ?, updated_at = ? WHERE id = ?')
      .run(next.title, next.statement, JSON.stringify(next.params), JSON.stringify(next.pipeline), next.cadence, new Date().toISOString(), id);
    // A new schedule starts fresh: it waits for its next slot rather than running for one already past.
    if (next.cadence !== nb.cadence) this.db.prepare('UPDATE notebooks SET cadence_fired_at = NULL WHERE id = ?').run(id);
    return this.mustGet(id);
  }

  /** Replace the criteria, keeping "met" for any whose text is unchanged. */
  setCriteria(id: string, texts: readonly string[]): Notebook {
    const nb = this.mustGet(id);
    const was = new Map(nb.criteria.map((c) => [c.text, c]));
    const criteria = clean(texts, 10).map((text): NotebookCriterion => ({ text, met: was.get(text)?.met ?? false, ...(was.get(text)?.held ? { held: true } : {}) }));
    this.db.prepare('UPDATE notebooks SET criteria_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(criteria), new Date().toISOString(), id);
    return this.mustGet(id);
  }

  markCriterion(id: string, index: number, met: boolean): Notebook {
    const nb = this.mustGet(id);
    if (!nb.criteria[index]) throw new Error(`There's no criterion ${String(index + 1)}.`);
    const criteria = nb.criteria.map((c, i) => (i === index ? { ...c, met, held: true } : c));
    this.db.prepare('UPDATE notebooks SET criteria_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(criteria), new Date().toISOString(), id);
    return this.mustGet(id);
  }

  /**
   * Tick the done-whens the notebook's own work now meets (criterionMet):
   * a decision, enough options, a source step that reached its goal, a check
   * every pick passes. Only ticks; one you set by hand is left alone.
   * Returns the notebook, and the ones it ticked.
   */
  autoMeetCriteria(id: string): { nb: Notebook; ticked: string[] } {
    const nb = this.mustGet(id);
    const entries = this.entries(id, 1000);
    const ticked: string[] = [];
    const criteria = nb.criteria.map((c) => {
      if (c.met || c.held || !criterionMet(nb, entries, c.text)) return c;
      ticked.push(c.text);
      return { ...c, met: true };
    });
    if (!ticked.length) return { nb, ticked };
    this.db.prepare('UPDATE notebooks SET criteria_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(criteria), new Date().toISOString(), id);
    return { nb: this.mustGet(id), ticked };
  }

  /**
   * Close with a decision: recorded as an entry too, so the history reads in
   * one place. `chosen`: the options picked (ids of options still in the
   * running), marked chosen; the rest are unmarked. With picks, why is
   * optional ("Chose A and B." says it); the decide step, if any, is done.
   */
  decide(id: string, decision: string, by = 'you', chosen: readonly string[] = []): Notebook {
    const nb = this.mustGet(id);
    const options = this.entries(id, 1000).filter((e) => e.kind === 'option');
    const picks = [...new Set(chosen)].map((c) => {
      const o = options.find((e) => e.id === c);
      if (!o) throw new Error('One of the picks isn\'t in this notebook any more. Reload and pick again.');
      if (o.ruledOut) throw new Error(`${o.title} was ruled out. Bring it back first, or leave it out.`);
      return o;
    });
    const why = decision.trim();
    const names = picks.map((o) => o.title);
    const said = names.length ? `Chose ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`}.` : '';
    const text = [said, why].filter(Boolean).join(' ').slice(0, 2000);
    if (!text) throw new Error('Pick what you chose, or say what you decided.');
    const now = new Date().toISOString();
    this.db.prepare("UPDATE notebooks SET status = 'decided', decision = ?, decided_at = ?, updated_at = ? WHERE id = ?").run(text, now, now, id);
    if (picks.length) {
      this.db.prepare('UPDATE notebook_entries SET chosen_at = NULL WHERE notebook_id = ?').run(id);
      const mark = this.db.prepare('UPDATE notebook_entries SET chosen_at = ? WHERE id = ?');
      for (const o of picks) mark.run(now, o.id);
    }
    this.addEntry(id, { kind: 'decision', title: 'Decided', body: text, by });
    for (const s of nb.steps ?? []) {
      if (s.kind === 'decide' && s.status !== 'done') this.updateStep(id, s.id, { status: 'done', note: picks.length ? `${String(picks.length)} chosen` : 'decided' }, now);
    }
    return this.autoMeetCriteria(id).nb;
  }

  /**
   * Narrow the list: keep these options in the running and rule out the rest
   * (why, or "Not kept at <step>"). The notebook stays open; the first open
   * narrow step, if any, is done ("kept 6 of 21").
   */
  narrow(id: string, keep: readonly string[], why = '', by = 'you'): Notebook {
    const nb = this.mustGet(id);
    const active = this.entries(id, 1000).filter((e) => e.kind === 'option' && !e.ruledOut);
    const kept = new Set(keep);
    if (![...kept].some((k) => active.some((e) => e.id === k))) throw new Error('Pick at least one to keep.');
    for (const k of kept) if (!active.some((e) => e.id === k)) throw new Error('One of those isn\'t in the running any more. Reload and pick again.');
    const step = nb.steps?.find((s) => s.kind === 'narrow' && s.status !== 'done');
    const reason = why.trim() || `Not kept at "${step?.title ?? 'Narrow'}"`;
    const out = active.filter((e) => !kept.has(e.id));
    for (const e of out) this.ruleOut(id, e.id, reason, by);
    const note = `kept ${String(kept.size)} of ${String(active.length)}`;
    this.addEntry(id, { kind: 'decision', title: `Kept ${String(kept.size)}, ruled out ${String(out.length)}`, body: `${step ? `${step.title}: ` : ''}${note}.${why.trim() ? ` ${why.trim()}` : ''}`.slice(0, 2000), by });
    if (step) this.updateStep(id, step.id, { status: 'done', note });
    return this.autoMeetCriteria(id).nb;
  }

  /**
   * sua's picks for the decision: these options (still in the running)
   * replace its earlier picks. Decide… can tick them in one go. Returns the
   * ones marked.
   */
  suggestPicks(id: string, entryIds: readonly string[]): NotebookEntry[] {
    this.mustGet(id);
    const active = this.entries(id, 1000).filter((e) => e.kind === 'option' && !e.ruledOut);
    // In sua's order.
    const picks = [...new Set(entryIds)].flatMap((id) => active.filter((e) => e.id === id));
    if (!picks.length) return [];
    const now = new Date().toISOString();
    this.db.prepare('UPDATE notebook_entries SET suggested_at = NULL WHERE notebook_id = ?').run(id);
    const mark = this.db.prepare('UPDATE notebook_entries SET suggested_at = ? WHERE id = ?');
    for (const e of picks) mark.run(now, e.id);
    this.db.prepare('UPDATE notebooks SET updated_at = ? WHERE id = ?').run(now, id);
    return picks;
  }

  setStatus(id: string, status: NotebookStatus): Notebook {
    this.mustGet(id);
    this.db.prepare('UPDATE notebooks SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), id);
    return this.mustGet(id);
  }

  addEntry(notebookId: string, input: { kind: NotebookEntryKind; title: string; body?: string; by: string; runId?: string }): NotebookEntry {
    this.mustGet(notebookId);
    if (!(NOTEBOOK_ENTRY_KINDS as readonly string[]).includes(input.kind)) throw new Error(`Not an entry kind: ${input.kind}.`);
    const title = input.title.replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!title) throw new Error('An entry needs a line of text.');
    const entry: NotebookEntry = {
      id: randomUUID(), notebookId, kind: input.kind, title, body: (input.body ?? '').trim().slice(0, 8000), by: input.by,
      ...(input.runId ? { runId: input.runId } : {}), createdAt: new Date().toISOString(),
    };
    this.db.prepare('INSERT INTO notebook_entries (id, notebook_id, kind, title, body, by, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(entry.id, notebookId, entry.kind, entry.title, entry.body, entry.by, entry.runId ?? null, entry.createdAt);
    this.db.prepare('UPDATE notebooks SET updated_at = ? WHERE id = ?').run(entry.createdAt, notebookId);
    return entry;
  }

  /** Newest first. */
  entries(notebookId: string, limit = 200): NotebookEntry[] {
    return (this.db.prepare('SELECT * FROM notebook_entries WHERE notebook_id = ? ORDER BY created_at DESC LIMIT ?').all(notebookId, limit) as Array<Record<string, unknown>>)
      .map((r) => this.toEntry(r));
  }

  /**
   * Merge copies of one option into `keepId`: it keeps its own facts and
   * fills gaps from the copies (their sources with them); checks ticked on
   * any count; chosen or sua's pick on any carries over; their sightings
   * (and a picture, if it has none) move to it; the copies are removed. Its
   * stage and whether it's ruled out stay its own. Returns how many merged.
   */
  mergeOptions(notebookId: string, keepId: string, copyIds: readonly string[]): number {
    const keep = this.mustGetOption(notebookId, keepId);
    const copies = [...new Set(copyIds)].filter((id) => id !== keepId).map((id) => this.mustGetOption(notebookId, id));
    if (!copies.length) return 0;
    let data: Record<string, NotebookFieldValue> = { ...(keep.data ?? {}) };
    let meta: Record<string, NotebookFactMeta> = { ...(keep.factMeta ?? {}) };
    const checked = [...(keep.checked ?? [])];
    let chosen = keep.chosenAt; let suggested = keep.suggestedAt;
    for (const c of copies) {
      for (const [k, v] of Object.entries(c.data ?? {})) {
        if (data[k] !== undefined && data[k] !== '') continue;
        data = { ...data, [k]: v };
        if (c.factMeta?.[k]) meta = { ...meta, [k]: c.factMeta[k] };
      }
      for (const x of c.checked ?? []) if (!checked.some((y) => y.toLowerCase() === x.toLowerCase())) checked.push(x);
      chosen ??= c.chosenAt; suggested ??= c.suggestedAt;
    }
    const hasPhoto = !!this.db.prepare('SELECT 1 FROM notebook_photos WHERE entry_id = ?').get(keep.id);
    for (const c of copies) {
      this.db.prepare('UPDATE notebook_sightings SET entry_id = ? WHERE entry_id = ?').run(keep.id, c.id);
      if (!hasPhoto) this.db.prepare('UPDATE notebook_photos SET entry_id = ? WHERE entry_id = ? AND NOT EXISTS (SELECT 1 FROM notebook_photos WHERE entry_id = ?)').run(keep.id, c.id, keep.id);
      this.removeEntry(notebookId, c.id);
    }
    this.db.prepare('UPDATE notebook_entries SET data_json = ?, fact_meta_json = ?, checked_json = ?, chosen_at = ?, suggested_at = ? WHERE id = ?')
      .run(Object.keys(data).length ? JSON.stringify(data) : null, Object.keys(meta).length ? JSON.stringify(meta) : null, checked.length ? JSON.stringify(checked) : null, chosen ?? null, suggested ?? null, keep.id);
    this.db.prepare('UPDATE notebooks SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), notebookId);
    return copies.length;
  }

  removeEntry(notebookId: string, entryId: string): boolean {
    const r = this.db.prepare('DELETE FROM notebook_entries WHERE id = ? AND notebook_id = ?').run(entryId, notebookId);
    if (Number(r.changes) === 1) {
      this.db.prepare('DELETE FROM notebook_sightings WHERE entry_id = ?').run(entryId);
      this.db.prepare('DELETE FROM notebook_photos WHERE entry_id = ?').run(entryId);
    }
    return Number(r.changes) === 1;
  }

  private mustGet(id: string): Notebook {
    const nb = this.get(id);
    if (!nb) throw new Error(`No notebook "${id}".`);
    return nb;
  }

  // Methods, not arrow fields: fromHandle skips field initializers.
  private toNotebook(r: Record<string, unknown>): Notebook {
    const parse = <T>(v: unknown, d: T): T => { try { return JSON.parse(String(v)) as T; } catch { return d; } };
    return {
      id: String(r.id),
      title: String(r.title),
      statement: String(r.statement ?? ''),
      params: parse<string[]>(r.params_json, []),
      criteria: parse<NotebookCriterion[]>(r.criteria_json, []),
      pipeline: parse<string[]>(r.pipeline_json, []),
      fields: cleanFields(parse<NotebookField[]>(r.fields_json, [])),
      stages: parse<string[]>(r.stages_json, []),
      ...(r.setup_at ? { setupAt: String(r.setup_at) } : {}),
      checks: parse<string[]>(r.checks_json, []),
      cadence: String(r.cadence ?? ''),
      status: String(r.status) as NotebookStatus,
      ...(r.decision ? { decision: String(r.decision) } : {}),
      ...(r.decided_at ? { decidedAt: String(r.decided_at) } : {}),
      ...(r.last_run_at ? { lastRunAt: String(r.last_run_at) } : {}),
      ...(r.last_run_note ? { lastRunNote: String(r.last_run_note) } : {}),
      ...(r.cadence_fired_at ? { cadenceFiredAt: String(r.cadence_fired_at) } : {}),
      ...(r.archived_at ? { archivedAt: String(r.archived_at) } : {}),
      ...(r.facets_json ? { facets: parse<Record<string, NotebookFacet>>(r.facets_json, {}) } : {}),
      ...(r.conversation_id ? { conversationId: String(r.conversation_id) } : {}),
      ...(r.steps_json ? { steps: cleanSteps(parse<unknown[]>(r.steps_json, [])) } : {}),
      // Checked when it was set (setLayout); read as stored.
      ...((): { layout?: NotebookLayout } => { const l = r.layout_json ? parse<NotebookLayout | null>(r.layout_json, null) : null; return l && Array.isArray(l.components) ? { layout: l } : {}; })(),
      ...(r.about_json ? { about: parse<NotebookAbout>(r.about_json, {}) } : {}),
      ...(r.layout_by ? { layoutBy: String(r.layout_by) } : {}),
      ...(r.briefing_json ? { briefing: parse<NotebookBriefing>(r.briefing_json, { points: [], questions: [], watch: [], at: '', by: '' }) } : {}),
      ...(r.plan_json ? { plan: parse<NotebookPlan>(r.plan_json, { summary: '', items: [], before: [], open: [], at: '', by: '' }) } : {}),
      ...(r.answer_json ? { answer: parse<NotebookAnswer>(r.answer_json, { question: '', text: '', confidence: 'low', findings: [], open: [], at: '', by: '' }) } : {}),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  private toEntry(r: Record<string, unknown>): NotebookEntry {
    return {
      id: String(r.id), notebookId: String(r.notebook_id), kind: String(r.kind) as NotebookEntryKind,
      title: String(r.title), body: String(r.body ?? ''), by: String(r.by),
      ...(r.run_id ? { runId: String(r.run_id) } : {}),
      ...(r.data_json ? { data: (() => { try { return JSON.parse(String(r.data_json)) as Record<string, NotebookFieldValue>; } catch { return {}; } })() } : {}),
      ...(r.fact_meta_json ? { factMeta: (() => { try { return JSON.parse(String(r.fact_meta_json)) as Record<string, NotebookFactMeta>; } catch { return {}; } })() } : {}),
      ...(r.fingerprint ? { fingerprint: String(r.fingerprint) } : {}),
      ...(r.last_seen_at ? { lastSeenAt: String(r.last_seen_at) } : {}),
      ...(r.stage ? { stage: String(r.stage) } : {}),
      ...(r.checked_json ? { checked: (() => { try { return JSON.parse(String(r.checked_json)) as string[]; } catch { return []; } })() } : {}),
      ...(r.failed_checks_json ? { failedChecks: (() => { try { return JSON.parse(String(r.failed_checks_json)) as Record<string, string>; } catch { return {}; } })() } : {}),
      ...(r.stage_at ? { stageAt: String(r.stage_at) } : {}),
      ...(r.ruled_out_at ? { ruledOut: { reason: String(r.ruled_out_reason ?? ''), at: String(r.ruled_out_at), by: String(r.ruled_out_by ?? 'you'), ...(r.ruled_out_stage ? { stage: String(r.ruled_out_stage) } : {}), ...(r.ruled_out_gone ? { gone: true } : {}) } } : {}),
      ...(r.chosen_at ? { chosenAt: String(r.chosen_at) } : {}),
      ...(r.suggested_at ? { suggestedAt: String(r.suggested_at) } : {}),
      createdAt: String(r.created_at),
    };
  }
}

/** How many criteria are met, e.g. { met: 2, total: 3 }. */
export function notebookProgress(nb: Pick<Notebook, 'criteria'>): { met: number; total: number } {
  return { met: nb.criteria.filter((c) => c.met).length, total: nb.criteria.length };
}

const ENTRY_KIND: Record<NotebookEntryKind, Item['kind']> = { note: 'fact', option: 'collection', evidence: 'evidence', decision: 'decision' };

/** A notebook's entries as items, for its own surface (`notebook:<id>`). */
export function notebookEntryItems(nb: Notebook, entries: readonly NotebookEntry[]): Item[] {
  return entries.map((e) => ({
    id: `nbentry:${e.id}`,
    kind: ENTRY_KIND[e.kind],
    title: e.title,
    ...(e.body ? { summary: e.body.replace(/\s+/g, ' ').slice(0, 160) } : {}),
    urgency: e.kind === 'decision' ? 'high' as const : 'normal' as const,
    state: 'ok' as const,
    subject: {},
    value: e.kind,
    actions: [],
    evidence: [],
    provenance: { source: 'agents' as const, producedBy: e.by === 'you' ? 'system' : e.by, at: e.createdAt },
    href: `/notebooks/${encodeURIComponent(nb.id)}#entry-${e.id}`,
  }));
}

/** A title reduced for "have we seen this?": lowercase letters and digits only. */
export function entryKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

/** Units read from a field's name when it has none ("miles" → "mi"). */
const UNIT_FROM_KEY: Array<[RegExp, string]> = [[/^(miles|mileage|odometer)$/, 'mi'], [/^(km|kilometers|kilometres)$/, 'km'], [/^(sq_?ft|square_feet|size_sqft)$/, 'sq ft'], [/^(commute|commute_min(utes)?)$/, 'min']];

/** The role a field without one most likely plays, from its key and type. */
function inferRole(key: string, type: NotebookFieldType): NotebookFieldRole | undefined {
  if (type === 'money' && /^(price|cost|asking(_price)?|salary|pay|rent|total(_cost)?)$/.test(key)) return 'price';
  if (type === 'number' && UNIT_FROM_KEY.some(([re]) => re.test(key))) return 'measure';
  if (type === 'number' && /^(fit|fit_score|icp_fit|icp_score|match|match_score|score)$/.test(key)) return 'score';
  if (type === 'number' && /^(rating|stars)$/.test(key)) return 'measure';
  if (type === 'url' && /(listing|posting|product|url|link)/.test(key)) return 'link';
  if (type === 'image' || /^(photo|image|picture|logo)(_url)?$/.test(key)) return 'image';
  if (/^(location|city|place|neighborhood|area)$/.test(key)) return 'place';
  if (/^(seller|dealer|company|employer|store|retailer|org)$/.test(key)) return 'org';
  if (type === 'date' && /^(posted|listed|date|when|deadline)/.test(key)) return 'when';
  if (type === 'text' && /^(evidence|quotes?|excerpt|(what_)?(they|he|she)_said|in_their_words)$|_(quote|evidence)$/.test(key)) return 'quote';
  if (type === 'text' && /(^|_)(questions?|ask|to_ask)(_|$)/.test(key)) return 'ask';
  return undefined;
}

/** Keep only well-formed fields, one per key and at most one per role. */
export function cleanFields(list: readonly unknown[]): NotebookField[] {
  const out: NotebookField[] = [];
  const roles = new Set<string>();
  for (const f of list) {
    const x = f as Partial<Record<keyof NotebookField, unknown>>;
    const key = typeof x.key === 'string' ? x.key.trim() : '';
    if (!FIELD_KEY_RE.test(key) || out.some((o) => o.key === key)) continue;
    let type = (NOTEBOOK_FIELD_TYPES as readonly string[]).includes(String(x.type)) ? x.type as NotebookFieldType : 'text';
    if (type === 'text' && /^(photo|image|picture|logo)(_url)?$/.test(key)) type = 'image';
    // A field without a role gets the one its name implies (price, miles, listing_url…).
    const asked = (NOTEBOOK_FIELD_ROLES as readonly string[]).includes(String(x.role)) ? x.role as NotebookFieldRole : inferRole(key, type);
    const role = asked && !roles.has(asked) ? asked : undefined;
    if (role) roles.add(role);
    const label = typeof x.label === 'string' && x.label.trim() ? x.label.trim().slice(0, 40) : key.replace(/_/g, ' ');
    const unit = typeof x.unit === 'string' && x.unit.trim() ? x.unit.trim().slice(0, 12) : (type === 'number' ? UNIT_FROM_KEY.find(([re]) => re.test(key))?.[1] : undefined);
    const numeric = type === 'money' || type === 'number';
    // A price is better lower unless the notebook says otherwise (a salary is a price that's better higher).
    const better = numeric && (x.better === 'higher' || x.better === 'lower') ? x.better : numeric && role === 'price' ? 'lower' as const : numeric && role === 'score' ? 'higher' as const : undefined;
    const range = numeric && x.range === true;
    out.push({ key, label, type, ...(unit ? { unit } : {}), ...(role ? { role } : {}), ...(better ? { better } : {}), ...(range ? { range: true } : {}) });
    if (out.length === 12) break;
  }
  return out;
}

/** "$150k–$180k", "150,000 - 180,000", "150-180k" → { min, max }. */
function toRange(v: unknown): NotebookRange | number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (isRange(v)) return v.min <= v.max ? { min: v.min, max: v.max } : { min: v.max, max: v.min };
  if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n))) return toRange({ min: v[0], max: v[1] });
  if (typeof v !== 'string') return undefined;
  const parts = [...v.replace(/\s/g, '').matchAll(/(\d[\d,]*(?:\.\d+)?)(k)?/gi)].slice(0, 2);
  if (parts.length === 0) return undefined;
  const vals = parts.map((m) => ({ n: Number(m[1].replace(/,/g, '')), k: !!m[2] }));
  // "150-180k": the k on the second number applies to a bare first one.
  if (vals.length === 2 && vals[1].k && !vals[0].k && vals[0].n < 1000) vals[0].k = true;
  const nums = vals.map((x) => (x.k ? x.n * 1000 : x.n));
  if (nums.some((n) => !Number.isFinite(n))) return undefined;
  return nums.length === 1 ? nums[0] : toRange({ min: nums[0], max: nums[1] });
}

/** "$4,023" → 4023, "149,652 mi" → 149652; anything else as trimmed text. */
function toValue(v: unknown, type: NotebookFieldType, range = false): NotebookFieldValue | undefined {
  if (range && (type === 'money' || type === 'number')) return toRange(v);
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!s) return undefined;
  if (type === 'money' || type === 'number') {
    const m = /-?\d[\d,]*(?:\.\d+)?/.exec(s.replace(/\s/g, ''));
    if (!m) return undefined;
    let n = Number(m[0].replace(/,/g, ''));
    if (/^\$?\d+(?:\.\d+)?k$/i.test(s.replace(/[\s,]/g, ''))) n *= 1000;
    return Number.isFinite(n) ? n : undefined;
  }
  if (type === 'url' || type === 'image') return /^https?:\/\//i.test(s) ? s.slice(0, 2000) : undefined;
  return s.slice(0, 200);
}

/** An option's facts, keyed and typed by the notebook's fields (unknown keys dropped). */
export function cleanData(data: Record<string, unknown> | undefined, fields: readonly NotebookField[]): Record<string, NotebookFieldValue> {
  const out: Record<string, NotebookFieldValue> = {};
  if (!data || typeof data !== 'object') return out;
  for (const f of fields) {
    const v = toValue(data[f.key], f.type, f.range);
    if (v !== undefined) out[f.key] = v;
  }
  return out;
}

/**
 * Whether two options at one address are the same thing, not two listings
 * on one results page: the year in their titles, their main measure (miles,
 * sq ft; within 5%) and their organization don't disagree. Price may (a
 * relisted car drops its price).
 */
export function sameThing(nb: Pick<Notebook, 'fields'>, a: { title: string; data: Record<string, NotebookFieldValue> }, b: { title: string; data: Record<string, NotebookFieldValue> }): boolean {
  const year = (t: string) => /\b(19|20)\d{2}\b/.exec(t)?.[0];
  const ya = year(a.title); const yb = year(b.title);
  if (ya && yb && ya !== yb) return false;
  const m = nb.fields.find((f) => f.role === 'measure');
  const ma = m ? fieldNumber(a.data[m.key]) : undefined; const mb = m ? fieldNumber(b.data[m.key]) : undefined;
  if (ma !== undefined && mb !== undefined && Math.abs(ma - mb) > 0.05 * Math.max(Math.abs(ma), Math.abs(mb))) return false;
  const o = nb.fields.find((f) => f.role === 'org');
  const oa = o ? a.data[o.key] : undefined; const ob = o ? b.data[o.key] : undefined;
  if (typeof oa === 'string' && typeof ob === 'string' && entryKey(oa) !== entryKey(ob)) return false;
  return true;
}

/** Query keys a search or results page carries ("?q=forester&zip=98101"). */
const SEARCH_KEYS = /^(q|query|keyword|keywords|search|searchterm|search_query|k|zip|zipcode|postal|distance|radius|sort|page)$/i;

/**
 * Whether an address looks like a search or results page (many items) rather
 * than one item's own page: a /search or /results path, search parameters,
 * or a known site's list pages (CarGurus /Cars/l-…, Edmunds /used-2011-…-wa,
 * Craigslist /search/). Conservative: unknown shapes count as an item's own.
 */
export function isListPage(url: string): boolean {
  let u: URL;
  try { u = new URL(url.trim()); } catch { return false; }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const path = u.pathname.toLowerCase();
  if (/(^|\/)(search|results|s|browse|find)(\/|$)/.test(path)) return true;
  if ([...u.searchParams.keys()].some((k) => SEARCH_KEYS.test(k)) && !/\d{4,}/.test(path)) return true;
  // CarGurus list pages: /Cars/l-Used-… (by place) and /Cars/s-Used-… (by price or style).
  if (host.endsWith('cargurus.com') && /^\/cars\/[ls]-/.test(path)) return true;
  if (host.endsWith('edmunds.com') && /^\/used-[a-z0-9-]+$/.test(path.replace(/\/$/, '')) && !/vin/.test(path)) return true;
  if (host.endsWith('craigslist.org') && /\/search\//.test(path)) return true;
  return false;
}

/** Query parameters that only say where a click came from. */
const TRACKING = /^(utm_\w+|ref|ref_src|referrer|source|gclid|fbclid|mc_cid|mc_eid|cmpid|campaign|trk|si)$/i;

/**
 * A web address as the thing it points at: no scheme, "www.", trailing
 * slash, fragment or tracking parameters ("https://www.cars.com/vehicle/123/?utm_source=x"
 * and "http://cars.com/vehicle/123" are the same). Undefined if it isn't one.
 */
export function sameAddress(url: string): string | undefined {
  let u: URL;
  try { u = new URL(url.trim()); } catch { return undefined; }
  if (!/^https?:$/.test(u.protocol)) return undefined;
  const q = [...u.searchParams].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  return `${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '')}${q ? `?${q}` : ''}`;
}

/**
 * What makes an option the same one next run: the fingerprint the agent gave
 * (a VIN, a listing id), else the option's link without tracking bits.
 */
/**
 * A key that is just a vehicle's VIN, however an agent wrote it ("vin|…",
 * "vin:…", "VIN …", or the bare 17 characters): the VIN, lower case. Else undefined.
 */
export function vinKey(key: string): string | undefined {
  const m = /^\s*(?:vin\s*[:|#=\-]?\s*)?([a-hj-npr-z0-9]{17})\s*$/i.exec(key);
  // A VIN has letters and digits both (not a 17-letter word).
  return m && /\d/.test(m[1]) && /[a-z]/i.test(m[1]) ? m[1].toLowerCase() : undefined;
}

export function optionFingerprint(given: string | undefined, data: Record<string, NotebookFieldValue>, fields: readonly NotebookField[]): string | undefined {
  const g = typeof given === 'string' ? given.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  // One form for a VIN, so "vin:JF1…" and "vin|jf1…" from two runs are one car.
  const vin = g ? vinKey(g) : undefined;
  if (vin) return `vin|${vin}`;
  if (g) return g;
  const link = fields.find((f) => f.role === 'link');
  const url = link ? data[link.key] : undefined;
  if (typeof url !== 'string') return undefined;
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch { return undefined; }
}

/** An option as widgets see it: its facts by key, plus the role-mapped ones. */
export interface NotebookViewOption {
  id: string;
  title: string;
  /** A short name for cards: the title up to its first comma ("2010 Toyota RAV4 Sport 4WD"). */
  name: string;
  /** The notebook's checks ticked for it. */
  checked: string[];
  /** Checks it failed but stays in for (you chose it): checked, not ticked. */
  failed: string[];
  body: string;
  /** The option's facts by field key. */
  fields: Record<string, NotebookFieldValue>;
  /** For sorting and plotting; a range counts as its midpoint (the span is in `fields`). */
  price?: number;
  /** How well it fits (the notebook's score field), when it has one. */
  score?: number;
  /** Where its facts came from and which are estimates, by field key. */
  factMeta?: Record<string, NotebookFactMeta>;
  measure?: number;
  place?: string;
  org?: string;
  link?: string;
  image?: string;
  when?: string;
  by: string;
  runId?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  /** The seller's photo address, when the kept copy (`image`) came from one. */
  imageSource?: string;
  /** What the picture is: the listing's own photo, a representative one, or an illustration. */
  imageKind?: NotebookPhotoKind;
  /** A logo's shape (a wordmark is wide, an app icon square), so it's sized to read. */
  imageShape?: ImageShape;
  /** The price over time (oldest first), and how it moved since first seen. */
  priceHistory: Array<{ at: string; value: number }>;
  priceChange?: { from: number; to: number; since: string };
  /** Searches by the agent that found it, since it was last seen, that found others but not this one. */
  missedSearches: number;
  /** Missed the last 2 or more of those searches: likely sold, filled or taken down. */
  notSeenLately: boolean;
  /** Against the last run that found options: first found by it, found again by it, or neither. */
  added?: NotebookAddedIn;
  /** Its stage, and its place in the funnel (0 = the first; with steps, the furthest step it got through). */
  stage?: string;
  stageIndex: number;
  ruledOut?: { reason: string; at: string; by: string; stage?: string; gone?: boolean };
  /** Picked in the notebook's decision. */
  chosen?: boolean;
  /** One of sua's latest picks for the decision. */
  suggested?: boolean;
  /** Its link is a search or results page (several options share it, or it looks like one), not its own. */
  linkIsList?: boolean;
}

/** One stage of the funnel: how many got this far, are here now, or were ruled out here (and why). */
export interface NotebookFunnelStage {
  stage: string;
  reached: number;
  here: number;
  ruledOut: number;
  reasons: Array<{ reason: string; count: number }>;
}

export interface NotebookViewEntry { id: string; kind: NotebookEntryKind; title: string; body: string; by: string; runId?: string; at: string }

/**
 * The data a notebook's widgets bind to, under `/notebook`: the same shape for
 * every notebook, so a shortlist or a price map built for one works on any.
 */
export interface NotebookViewData {
  notebook: {
    id: string;
    title: string;
    statement: string;
    status: NotebookStatus;
    decision?: string;
    limits: string[];
    criteria: NotebookCriterion[];
    progress: { met: number; total: number };
    fields: NotebookField[];
    stages: string[];
    /** Options still in the running, then the ruled-out ones. */
    options: NotebookViewOption[];
    /** Per stage, in order; empty when the notebook has no stages. */
    funnel: NotebookFunnelStage[];
    active: number;
    ruledOutCount: number;
    notes: NotebookViewEntry[];
    evidence: NotebookViewEntry[];
    decisions: NotebookViewEntry[];
    /** Everything, newest first. */
    history: NotebookViewEntry[];
    lastRunAt?: string;
    lastRunNote?: string;
  };
}

/** How an option stands against the last run that found options. */
export type NotebookAddedIn = 'new' | 'again' | 'earlier';

/** New (first found at or after `since`), seen again then, or from before; undefined with no run to compare to. */
export function addedIn(e: Pick<NotebookEntry, 'createdAt' | 'lastSeenAt'>, since: string | undefined): NotebookAddedIn | undefined {
  if (!since) return undefined;
  if (e.createdAt >= since) return 'new';
  return (e.lastSeenAt ?? '') >= since ? 'again' : 'earlier';
}

/** Searches in a row an option can miss before it reads as "not seen lately". */
export const NOT_SEEN_AFTER_MISSES = 2;

/** History for the view, read from the store (omit for a view without it). */
export interface NotebookViewHistory {
  sightings(entryId: string): Array<{ at: string; correctedBy?: string; data: Record<string, NotebookFieldValue> }>;
  missedSearches(notebookId: string, e: NotebookEntry): number;
  /** When the last run that found options started (NotebookStore.lastFindAt). */
  lastFindAt?(notebookId: string): string | undefined;
  hasPhoto?(entryId: string): boolean;
  photoKind?(entryId: string): NotebookPhotoKind | undefined;
  photoShape?(entryId: string): ImageShape | undefined;
}

/** Where the dashboard serves an option's kept photo. */
export function notebookPhotoPath(notebookId: string, entryId: string): string {
  return `/notebooks/${encodeURIComponent(notebookId)}/entries/${encodeURIComponent(entryId)}/photo`;
}

export function notebookViewData(nb: Notebook, entries: readonly NotebookEntry[], history?: NotebookViewHistory): NotebookViewData {
  const byRole = new Map(nb.fields.filter((f) => f.role).map((f) => [f.role!, f.key]));
  const pick = (data: Record<string, NotebookFieldValue>, role: NotebookFieldRole) => {
    const key = byRole.get(role);
    return key === undefined ? undefined : data[key];
  };
  const view = (e: NotebookEntry): NotebookViewEntry => ({ id: e.id, kind: e.kind, title: e.title, body: e.body, by: e.by, ...(e.runId ? { runId: e.runId } : {}), at: e.createdAt });
  const since = history?.lastFindAt?.(nb.id);
  const options = entries.filter((e) => e.kind === 'option').map((e): NotebookViewOption => {
    const data = e.data ?? {};
    const added = addedIn(e, since);
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    const price = fieldNumber(pick(data, 'price'));
    const measure = fieldNumber(pick(data, 'measure'));
    const score = fieldNumber(pick(data, 'score'));
    const org = str(pick(data, 'org'));
    const place = str(pick(data, 'place'));
    const link = optionLink(nb.fields, data);
    // The kept copy when there is one; never the seller's address directly.
    const imageSource = str(pick(data, 'image'));
    const image = history?.hasPhoto?.(e.id) ? notebookPhotoPath(nb.id, e.id) : undefined;
    const imageKind = image ? history?.photoKind?.(e.id) : undefined;
    const imageShape = imageKind === 'logo' ? history?.photoShape?.(e.id) : undefined;
    const when = pick(data, 'when');
    return {
      id: e.id, title: e.title, name: shortName(e.title), checked: e.checked ?? [], failed: Object.keys(e.failedChecks ?? {}), body: e.body, fields: data,
      ...(e.factMeta && Object.keys(e.factMeta).length ? { factMeta: e.factMeta } : {}),
      ...(price !== undefined ? { price } : {}), ...(measure !== undefined ? { measure } : {}), ...(score !== undefined ? { score } : {}),
      ...(place ? { place } : {}), ...(org ? { org } : {}), ...(link ? { link } : {}), ...(image ? { image } : {}), ...(imageKind ? { imageKind } : {}), ...(imageShape ? { imageShape } : {}), ...(imageSource ? { imageSource } : {}),
      ...(when !== undefined ? { when: String(when) } : {}),
      by: e.by, ...(e.runId ? { runId: e.runId } : {}),
      firstSeenAt: e.createdAt, lastSeenAt: e.lastSeenAt ?? e.createdAt,
      ...priceTrend(e, byRole.get('price'), history),
      ...(() => { const m = history ? history.missedSearches(nb.id, e) : 0; return { missedSearches: m, notSeenLately: m >= NOT_SEEN_AFTER_MISSES }; })(),
      ...(added ? { added } : {}),
      ...(e.stage ? { stage: e.stage } : {}),
      stageIndex: Math.max(0, nb.stages.findIndex((s) => s === (e.ruledOut?.stage ?? e.stage))),
      ...(e.ruledOut ? { ruledOut: e.ruledOut } : {}),
      ...(e.chosenAt ? { chosen: true } : {}),
      ...(e.suggestedAt ? { suggested: true } : {}),
    };
  });
  options.sort((a, b) => Number(!!a.ruledOut) - Number(!!b.ruledOut));
  // A link several options share, or one shaped like a search page, isn't any one option's own.
  const linkF = nb.fields.find((f) => f.role === 'link');
  if (linkF) {
    const addr = (o: NotebookViewOption) => { const v = o.fields[linkF.key]; return typeof v === 'string' ? sameAddress(v) : undefined; };
    const count = new Map<string, number>();
    for (const o of options) { const a = addr(o); if (a) count.set(a, (count.get(a) ?? 0) + 1); }
    for (const o of options) {
      const v = o.fields[linkF.key]; const a = addr(o);
      if (a && ((count.get(a) ?? 0) > 1 || (typeof v === 'string' && isListPage(v)))) o.linkIsList = true;
    }
  }
  // With steps, the funnel is the steps: how far each option got through them
  // (found, facts sourced, checked, chosen), not the stages it was moved to by hand.
  const steps = optionSteps(nb.steps ?? []);
  const funnelStages = steps.length > 1 ? stepFunnelLabels(steps) : nb.stages;
  if (steps.length > 1) {
    for (const o of options) {
      let i = 0;
      while (i + 1 < steps.length && optionPassesStep(nb, o, steps[i + 1])) i++;
      o.stageIndex = i;
    }
  }
  const funnel: NotebookFunnelStage[] = funnelStages.map((stage, i) => {
    const out = options.filter((o) => o.ruledOut && o.stageIndex === i);
    const reasons = new Map<string, number>();
    for (const o of out) { const r = o.ruledOut!.reason.toLowerCase(); reasons.set(r, (reasons.get(r) ?? 0) + 1); }
    // Chosen is what you picked, whatever the steps before it got to.
    if (steps.length > 1 && steps[i]?.kind === 'decide') {
      const picked = options.filter((o) => o.chosen && !o.ruledOut).length;
      return { stage, reached: picked, here: picked, ruledOut: out.length, reasons: [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason, count]) => ({ reason, count })) };
    }
    return {
      stage,
      reached: options.filter((o) => o.stageIndex >= i).length,
      here: options.filter((o) => !o.ruledOut && o.stageIndex === i).length,
      ruledOut: out.length,
      reasons: [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason, count]) => ({ reason, count })),
    };
  });
  return {
    notebook: {
      id: nb.id, title: nb.title, statement: nb.statement, status: nb.status,
      ...(nb.decision ? { decision: nb.decision } : {}),
      limits: nb.params, criteria: nb.criteria, progress: notebookProgress(nb), fields: nb.fields, stages: nb.stages,
      options, funnel,
      active: options.filter((o) => !o.ruledOut).length,
      ruledOutCount: options.filter((o) => o.ruledOut).length,
      notes: entries.filter((e) => e.kind === 'note').map(view),
      evidence: entries.filter((e) => e.kind === 'evidence').map(view),
      decisions: entries.filter((e) => e.kind === 'decision').map(view),
      history: entries.map(view),
      ...(nb.lastRunAt ? { lastRunAt: nb.lastRunAt } : {}),
      ...(nb.lastRunNote ? { lastRunNote: nb.lastRunNote } : {}),
    },
  };
}

/**
 * An option's listing link: its link field, else a link-typed field, else
 * the first fact holding a web address ("Availability: https://…"), so a
 * notebook whose fields don't name a link still gets photos and a Listing button.
 */
export function optionLink(fields: readonly NotebookField[], data: Record<string, NotebookFieldValue> | undefined): string | undefined {
  const url = (v: unknown) => (typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim()) ? v.trim() : undefined);
  const byRole = fields.find((f) => f.role === 'link');
  if (byRole) return url(data?.[byRole.key]);
  for (const f of fields.filter((x) => x.type === 'url' && x.role !== 'image')) { const u = url(data?.[f.key]); if (u) return u; }
  for (const f of fields.filter((x) => x.role !== 'image' && x.type !== 'image')) { const u = url(data?.[f.key]); if (u) return u; }
  return undefined;
}

/**
 * Every number a text states, read the ways people write them: "$4,023",
 * "4023", "136.64", "4.9k", "157k mi", "1.2M", "18 million", and ranges
 * like "125-175k" (the suffix applies to both ends).
 */
export function numbersInText(text: string): number[] {
  const out: number[] = [];
  const mult = (s: string | undefined) => {
    const w = (s ?? '').toLowerCase();
    return w === 'k' || w === 'thousand' ? 1e3 : w === 'm' || w === 'mm' || w === 'million' ? 1e6 : w === 'b' || w === 'billion' ? 1e9 : 1;
  };
  const num = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)';
  const suffix = '(?:\\s?(k|m|mm|b|thousand|million|billion)\\b)?';
  const re = new RegExp(`${num}${suffix}(?:\\s?(?:-|–|—|to)\\s?\\$?${num}${suffix})?`, 'gi');
  for (const m of text.matchAll(re)) {
    const a = Number(m[1].replace(/,/g, ''));
    const b = m[3] !== undefined ? Number(m[3].replace(/,/g, '')) : undefined;
    const ma = mult(m[2]); const mb = mult(m[4]);
    out.push(a, a * ma);
    // "125-175k": the second end's suffix is the first's too.
    if (b !== undefined) out.push(b, b * mb, a * mb);
  }
  // Small counts are often words: "two hooks", "a dozen".
  const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12, single: 1, double: 2, pair: 2 };
  for (const m of text.toLowerCase().matchAll(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen|single|double|pair)\b/g)) out.push(WORDS[m[1]]);
  return out.filter((n) => Number.isFinite(n));
}

/**
 * Keep only the numbers a source actually states: each numeric fact (a range
 * by both ends) must match a number in `text` (within 1%, so "157k" covers
 * 156,870). Text facts are kept. Returns what's kept and what was left out.
 */
export function groundFacts(data: Record<string, unknown> | undefined, text: string): { data: Record<string, unknown>; dropped: Array<{ key: string; value: unknown }> } {
  const found = numbersInText(text);
  const stated = (n: number) => found.some((x) => Math.abs(x - n) <= Math.max(0.005, Math.abs(n) * 0.01));
  const kept: Record<string, unknown> = {};
  const dropped: Array<{ key: string; value: unknown }> = [];
  for (const [key, raw] of Object.entries(data ?? {})) {
    // A fact may come as {value, source, …}.
    const v = raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in (raw as object) ? (raw as { value: unknown }).value : raw;
    const nums = typeof v === 'number' ? [v]
      : isRange(v) ? [v.min, v.max]
        : typeof v === 'string' && /^\s*\$?\s*[\d,.]+\s*[km]?\s*$/i.test(v) ? (() => { const r = numbersInText(v); return [r[1] ?? r[0]]; })()
          : [];
    if (nums.length && !nums.every(stated)) { dropped.push({ key, value: v }); continue; }
    kept[key] = raw;
  }
  return { data: kept, dropped };
}

/**
 * The unambiguous facts in an option's text, for the notebook's fields: a
 * dollar amount for the price, a number with the measure's unit ("157k mi"),
 * a leading year for a `year` field, the first web address for the link.
 */
export function readOptionText(text: string, fields: readonly NotebookField[]): Record<string, NotebookFieldValue> {
  const out: Record<string, NotebookFieldValue> = {};
  const num = (s: string) => { const k = /k$/i.test(s); const v = Number(s.replace(/[k,]/gi, '')); return Number.isFinite(v) ? (k ? v * 1000 : v) : undefined; };
  for (const f of fields) {
    if (f.role === 'price' && f.type === 'money') {
      // A span ("$150k–$160k", a salary) is a range, not its first number.
      const r = f.range ? /\$\s?(\d[\d,]*(?:\.\d+)?k?)\s*(?:-|–|—|to)\s*\$?\s?(\d[\d,]*(?:\.\d+)?k?)/i.exec(text) : null;
      const lo = r ? num(/k$/i.test(r[2]) && !/k$/i.test(r[1]) && Number(r[1].replace(/,/g, '')) < 1000 ? `${r[1]}k` : r[1]) : undefined;
      const hi = r ? num(r[2]) : undefined;
      if (lo !== undefined && hi !== undefined && hi >= lo) { out[f.key] = { min: lo, max: hi }; continue; }
      const m = /\$\s?(\d[\d,]*(?:\.\d+)?k?)/i.exec(text);
      const v = m ? num(m[1]) : undefined;
      if (v !== undefined) out[f.key] = v;
    } else if (f.role === 'measure' && f.unit) {
      const unit = f.unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?k?)\\s*${unit}\\b`, 'i').exec(text);
      const v = m ? num(m[1]) : undefined;
      if (v !== undefined) out[f.key] = v;
    } else if (f.key === 'year' && f.type === 'number') {
      const m = /^\s*((?:19|20)\d{2})\b/.exec(text);
      if (m) out[f.key] = Number(m[1]);
    } else if (f.role === 'link') {
      const m = /https?:\/\/[^\s<>"'()]+/.exec(text);
      if (m) out[f.key] = m[0].replace(/[.,;:!?]+$/, '');
    }
  }
  return out;
}

/** An option's price over its sightings, and the change from the first to the latest. */
function priceTrend(e: NotebookEntry, priceKey: string | undefined, history?: NotebookViewHistory): Pick<NotebookViewOption, 'priceHistory' | 'priceChange'> {
  if (!priceKey || !history) return { priceHistory: [] };
  const all = history.sightings(e.id);
  // A corrected price replaces what came before it: the wrong one isn't a price move.
  const from = all.reduce((at, s, i) => (s.correctedBy && s.data[priceKey] !== undefined ? i : at), 0);
  const points = all.slice(from)
    .map((s) => ({ at: s.at, value: fieldNumber(s.data[priceKey]) }))
    .filter((p): p is { at: string; value: number } => p.value !== undefined);
  // Only changes count: the same price seen five times is one point.
  const priceHistory = points.filter((p, i) => i === 0 || p.value !== points[i - 1].value);
  const first = priceHistory[0];
  const last = priceHistory[priceHistory.length - 1];
  return { priceHistory, ...(first && last && first.value !== last.value ? { priceChange: { from: first.value, to: last.value, since: first.at } } : {}) };
}

const TITLE_STOP = new Set(['the', 'and', 'for', 'with', 'used', 'sale', 'new', 'near', 'from', 'car', 'cars', 'listing', 'listings', 'search', 'results']);

/**
 * Is this page about this option? A listing's own page names it; a results
 * page ("Used Subaru Forester for sale in Seattle") usually doesn't carry the
 * year and model together. A year in the option's title must appear, and so
 * must one other distinctive word.
 */
export function previewMatchesOption(pageTitle: string, optionTitle: string): boolean {
  const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length >= 3 && !TITLE_STOP.has(w));
  const page = new Set(words(pageTitle));
  const opt = words(optionTitle);
  const years = opt.filter((w) => /^(19|20)\d{2}$/.test(w));
  if (years.length && !years.some((y) => page.has(y))) return false;
  const rest = opt.filter((w) => !/^\d+$/.test(w));
  return rest.some((w) => page.has(w)) && (years.length > 0 || rest.filter((w) => page.has(w)).length >= 2);
}

/**
 * Does this address look like one listing (it carries an id: five or more
 * digits in its path or query) rather than a page of search results?
 */
export function looksLikeOneListing(url: string): boolean {
  try {
    const u = new URL(url);
    if (/\/l-used-|searchresults|\/search\b|\/results\b/i.test(u.pathname)) return false;
    return /\d{5,}/.test(u.pathname + u.search);
  } catch { return false; }
}

/**
 * "2016 Toyota Corolla iM, 81,300 mi, $9,800, Fairview" → "2016 Toyota Corolla iM".
 * Only when what follows is facts (numbers, a price): "Staff Engineer, Stripe" stays whole.
 */
export function shortName(title: string): string {
  // Commas inside brackets ("Director, Accounting (Remote, US)") don't end a part.
  const m = /^((?:[^,(]|\([^)]*\))+?)(?:,|\s[—–-]\s)(.*)$/.exec(title);
  if (!m) return title;
  const head = m[1].trim();
  if (!(head.length >= 4 && /[\d$]/.test(m[2]))) return title;
  // One word ("Director, Accounting Operations, $192k–$300k") says too little: keep the next part too.
  if (!/\s/.test(head)) {
    const next = /^\s*((?:[^,(]|\([^)]*\))+?)(?:,|\s[—–-]\s|$)/.exec(m[2])?.[1]?.trim();
    if (next && !/[\d$]/.test(next)) return `${head}, ${next}`;
  }
  return head;
}

/**
 * Do two values of a number agree? Rounded text ("157k mi") still agrees
 * with 157,000 or 156,870; a number agrees with a range it falls in ("from
 * $150k" with $150k–$160k), and two ranges when both ends do.
 */
function agrees(x: NotebookFieldValue, v: NotebookFieldValue): boolean {
  const tol = (n: number) => Math.max(1, Math.abs(n) * 0.01);
  const near = (p: number, q: number) => Math.abs(p - q) <= tol(q);
  const within = (n: number, r: { min: number; max: number }) => n >= r.min - tol(r.min) && n <= r.max + tol(r.max);
  if (isRange(x) && isRange(v)) return near(x.min, v.min) && near(x.max, v.max);
  if (isRange(x) && typeof v === 'number') return within(v, x);
  if (typeof x === 'number' && isRange(v)) return within(x, v);
  const nx = fieldNumber(x); const nv = fieldNumber(v);
  return nx === undefined || nv === undefined || near(nx, nv);
}

/** Do two sets of facts disagree on a number both state (year, price, the measure)? */
function contradicts(a: Record<string, NotebookFieldValue>, b: Record<string, NotebookFieldValue>): boolean {
  for (const [k, v] of Object.entries(b)) {
    const x = a[k];
    if (x === undefined) continue;
    if (!agrees(x, v)) return true;
    // Text (a link especially) isn't evidence of a mix-up: an option's text
    // often cites another page, a source or the post it's quoted from.
  }
  return false;
}

/**
 * The first link in an option's text only stands in for its link when it
 * has none: the text may cite a source, not the option's own page.
 */
function withoutTextLink(stated: Record<string, NotebookFieldValue>, fields: readonly NotebookField[], known: Record<string, unknown>): Record<string, NotebookFieldValue> {
  const linkKey = fields.find((f) => f.role === 'link')?.key;
  if (!linkKey || stated[linkKey] === undefined || known[linkKey] === undefined) return stated;
  const { [linkKey]: _cited, ...rest } = stated;
  return rest;
}

/**
 * What decides the best option: the notebook's score field when it has one
 * (higher is better unless it says otherwise), else its price field (lower
 * is better unless it says otherwise, as for a salary).
 */
export function rankBy(nb: Pick<Notebook, 'fields'>): { field?: NotebookField; by: 'score' | 'price'; better: 'higher' | 'lower' } {
  const score = nb.fields.find((f) => f.role === 'score');
  if (score) return { field: score, by: 'score', better: score.better ?? 'higher' };
  const price = nb.fields.find((f) => f.role === 'price');
  return { field: price, by: 'price', better: price?.better ?? 'lower' };
}

/**
 * Steps as given (an agent, a sentence, a form): known kinds, a title, a
 * valid agent id, a whole-number target; at most MAX_STEPS. `prior` keeps a
 * step's status and tries when its id is kept.
 */
export function cleanSteps(list: readonly unknown[], prior: readonly NotebookStep[] = []): NotebookStep[] {
  const out: NotebookStep[] = [];
  const given = new Set((Array.isArray(list) ? list : []).map((x) => (x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string' ? (x as { id: string }).id : '')).filter(Boolean));
  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || typeof raw !== 'object') continue;
    const x = raw as Record<string, unknown>;
    const kind = NOTEBOOK_STEP_KINDS.find((k) => k === x.kind);
    const title = typeof x.title === 'string' ? x.title.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    if (!kind || !title) continue;
    let id = typeof x.id === 'string' && ID_RE.test(x.id) ? x.id : '';
    // A new step never takes an id another step in the list already has (a step added in front doesn't renumber the rest).
    if (!id || out.some((s) => s.id === id)) { let n = out.length + 1; while (out.some((s) => s.id === `s${String(n)}`) || given.has(`s${String(n)}`)) n++; id = `s${String(n)}`; }
    const was = prior.find((s) => s.id === id && s.kind === kind);
    const status = STEP_STATUSES.find((v) => v === x.status) ?? was?.status ?? 'todo';
    const target = typeof x.target === 'number' && Number.isFinite(x.target) ? Math.min(100, Math.max(1, Math.round(x.target))) : undefined;
    const top = typeof x.top === 'number' && Number.isFinite(x.top) ? Math.min(50, Math.max(1, Math.round(x.top))) : undefined;
    const tries = typeof x.tries === 'number' && x.tries >= 0 ? Math.floor(x.tries) : was?.tries ?? 0;
    const note = typeof x.note === 'string' && x.note.trim() ? x.note.trim().slice(0, 200) : was?.note;
    const doneAt = typeof x.doneAt === 'string' ? x.doneAt : was?.doneAt;
    const stalled = typeof x.stalled === 'boolean' ? x.stalled : was?.status === status ? was?.stalled : undefined;
    const movedOn = typeof x.movedOn === 'boolean' ? x.movedOn : was?.status === status ? was?.movedOn : undefined;
    const why = typeof x.why === 'string' && x.why.trim() ? x.why.replace(/\s+/g, ' ').trim().slice(0, 300) : was?.status === status ? was?.why : undefined;
    const facts = kind === 'source' && Array.isArray(x.facts)
      ? [...new Set(x.facts.filter((f): f is string => typeof f === 'string').map((f) => f.trim()).filter(Boolean))].slice(0, 12)
      : [];
    out.push({
      id, title, kind, status, tries,
      ...(typeof x.agentId === 'string' && ID_RE.test(x.agentId) ? { agentId: x.agentId } : {}),
      ...((kind === 'find' || kind === 'narrow' || kind === 'decide' || kind === 'write') && target !== undefined ? { target } : {}),
      ...(facts.length ? { facts } : {}),
      ...((kind === 'source' || kind === 'check') && top !== undefined ? { top } : {}),
      ...(kind === 'profile' && typeof x.subject === 'string' && x.subject.trim() ? { subject: x.subject.replace(/\s+/g, ' ').trim().slice(0, 80) } : {}),
      ...(kind === 'write' && (x.shape === 'answer' || x.shape === 'plan') ? { shape: x.shape } : {}),
      ...(note ? { note } : {}),
      ...(status === 'stuck' && stalled ? { stalled: true } : {}),
      ...(status === 'done' && movedOn ? { movedOn: true } : {}),
      ...(why && (status === 'stuck' || (status === 'done' && movedOn)) ? { why } : {}),
      ...(status === 'done' && doneAt ? { doneAt } : {}),
    });
    if (out.length === MAX_STEPS) break;
  }
  return out;
}

/** The facts worth looking up for an option: not its link or picture (it has one or doesn't), not its fit score (sua gives it). */
export function trackedFacts(nb: Pick<Notebook, 'fields'>): NotebookField[] {
  return nb.fields.filter((f) => f.role !== 'link' && f.role !== 'image' && f.role !== 'score' && f.type !== 'image' && f.type !== 'url');
}

/** The facts a source step looks up: the ones it names that the notebook tracks, else all it tracks. */
export function stepFacts(nb: Pick<Notebook, 'fields'>, step: Pick<NotebookStep, 'facts'>): NotebookField[] {
  const tracked = trackedFacts(nb);
  // Named, a step may also look up each option's own page (the link field).
  const named = step.facts?.length ? nb.fields.filter((f) => step.facts!.includes(f.key) && (tracked.includes(f) || f.role === 'link')) : [];
  return named.length ? named : tracked;
}

/** How far a step is toward its goal: `have` of `want`, and what's still missing (one line each). */
export interface NotebookStepProgress { met: boolean; have: number; want: number; missing: string[] }

/**
 * Whether a step has met its goal, from the notebook alone (no model):
 * find, enough options in the running; source, every one has the facts the
 * step looks up (counted fact by fact); check, every one has each check ticked (a failed one is ruled out,
 * so it's no longer in the running); decide, only when you've confirmed it.
 */
/** A profile step is met with this many facts learned about who the notebook is about. */
export const PROFILE_FACTS_WANTED = 4;
/** A write step with no target is met with this many talking points. */
export const BRIEFING_POINTS_WANTED = 3;

export function stepProgress(nb: Notebook, entries: readonly NotebookEntry[], step: Pick<NotebookStep, 'kind' | 'target' | 'status' | 'facts' | 'top'> & { shape?: NotebookStep['shape'] }): NotebookStepProgress {
  const ranked = rankOptions(nb, notebookViewData(nb, entries).notebook.options);
  // A source or check step on the top N counts only those.
  const options = (step.kind === 'source' || step.kind === 'check') && step.top ? ranked.slice(0, step.top) : ranked;
  if (step.kind === 'profile') {
    // About who it's about, not its options: a few facts learned about them (person and company together).
    const facts = [...(nb.about?.person?.facts ?? []), ...(nb.about?.company?.facts ?? [])];
    const want = PROFILE_FACTS_WANTED;
    const have = Math.min(want, facts.length);
    const missing = have >= want ? [] : [...new Set([...(nb.about?.person?.notFound ?? []), ...(nb.about?.company?.notFound ?? [])])].slice(0, 6);
    return { met: have >= want, have, want, missing: have >= want ? [] : missing.length ? missing : ['who they are'] };
  }
  if (step.kind === 'write' && step.shape === 'plan') {
    // About the notebook, not its options: the plan written.
    const have = nb.plan?.items.length ? 1 : 0;
    return { met: have === 1, have, want: 1, missing: have ? [] : ['the plan'] };
  }
  if (step.kind === 'write' && step.shape === 'answer') {
    // About the notebook, not its options: the answer written.
    const have = nb.answer?.text ? 1 : 0;
    return { met: have === 1, have, want: 1, missing: have ? [] : ['the answer'] };
  }
  if (step.kind === 'write') {
    // About the notebook, not its options: enough talking points written.
    const want = step.target ?? BRIEFING_POINTS_WANTED;
    const have = Math.min(want, nb.briefing?.points.length ?? 0);
    return { met: have >= want, have, want, missing: have >= want ? [] : ['the talking points'] };
  }
  if (step.kind === 'find') {
    const want = step.target ?? 5;
    const have = options.length;
    return { met: have >= want, have, want, missing: have >= want ? [] : [`${String(want - have)} more`] };
  }
  if (step.kind === 'source') {
    const tracked = stepFacts(nb, step);
    const gaps = options.map((o) => ({ o, gaps: missingFacts(nb, o, step) }));
    const missing = gaps.filter((x) => x.gaps.length).map((x) => `${x.o.name} — ${x.gaps.map((f) => f.label.toLowerCase()).join(', ')}`);
    // Fact by fact, so each one found shows (a company with 2 of its 3 facts isn't 0).
    const want = options.length * tracked.length;
    const have = want - gaps.reduce((n, x) => n + x.gaps.length, 0);
    return { met: options.length > 0 && tracked.length > 0 && !missing.length, have, want, missing };
  }
  if (step.kind === 'check') {
    const missing = nb.checks.length ? options.map((o) => ({ o, left: checksLeft(nb, o) }))
      .filter((x) => x.left.length).map((x) => `${x.o.name} — ${x.left.join(', ')}`) : [];
    const want = options.length;
    // No checks yet: nothing is checked (the step waits for some).
    return { met: want > 0 && nb.checks.length > 0 && !missing.length, have: nb.checks.length ? want - missing.length : 0, want, missing };
  }
  if (step.kind === 'narrow') {
    // Yours: done when you keep some. Before then, how many are in the running against how many to keep.
    const want = step.target ?? options.length;
    return { met: step.status === 'done', have: step.status === 'done' ? options.length : 0, want: step.status === 'done' ? options.length : want, missing: [] };
  }
  const want = step.target ?? Math.min(options.length, 5);
  const chosen = options.filter((o) => o.chosen).length;
  return { met: step.status === 'done', have: chosen || (step.status === 'done' ? want : 0), want, missing: [] };
}

/**
 * A writer's <briefing> as one to keep, against the options it may cite: each
 * point's `from` only names options the notebook has (the rest are dropped,
 * so a quote shown is always one an option has), at most 8 points, 8
 * questions and 4 things to watch for. Pure.
 */
export function cleanBriefing(raw: unknown, optionIds: ReadonlySet<string>, by: string, at = new Date().toISOString()): NotebookBriefing | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const v = raw as Record<string, unknown>;
  // Long ones end at a word, with "…".
  const line = (x: unknown, n: number) => {
    const t = typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : '';
    if (t.length <= n) return t;
    const cut = t.slice(0, n - 1);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), n - 40)).replace(/[\s,;:.—-]+$/, '')}…`;
  };
  const points = (Array.isArray(v.points) ? v.points : []).map((p): NotebookBriefingPoint | undefined => {
    const o = (typeof p === 'string' ? { text: p } : p ?? {}) as Record<string, unknown>;
    const text = line(o.text ?? o.point, 240);
    if (!text) return undefined;
    const from = (Array.isArray(o.from) ? o.from : []).filter((id): id is string => typeof id === 'string' && optionIds.has(id));
    const why = line(o.why, 300);
    const ask = line(o.ask, 240);
    return { text, ...(why ? { why } : {}), ...(ask ? { ask } : {}), from: [...new Set(from)].slice(0, 4) };
  }).filter((p): p is NotebookBriefingPoint => !!p).slice(0, 8);
  if (!points.length) return undefined;
  const lines = (x: unknown, n: number) => (Array.isArray(x) ? x : []).map((q) => line(q, 240)).filter(Boolean).slice(0, n);
  return { points, questions: lines(v.questions, 8), watch: (Array.isArray(v.watch) ? v.watch : []).map((q) => line(q, 320)).filter(Boolean).slice(0, 4), at, by };
}

/**
 * A writer's <answer> as one to keep, against the options it may cite: an
 * answer is required; each finding's `from` only names options the notebook
 * has; at most 6 findings and 5 open questions; confidence is high, medium
 * or low (else low). Pure.
 */
export function cleanAnswer(raw: unknown, optionIds: ReadonlySet<string>, question: string, by: string, at = new Date().toISOString()): NotebookAnswer | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const v = raw as Record<string, unknown>;
  const line = (x: unknown, n: number) => {
    const t = typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : '';
    if (t.length <= n) return t;
    const cut = t.slice(0, n - 1);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), n - 40)).replace(/[\s,;:.—-]+$/, '')}…`;
  };
  const text = line(v.answer ?? v.text, 900);
  if (!text) return undefined;
  const confidence = (['high', 'medium', 'low'] as const).find((c) => c === String(v.confidence ?? '').toLowerCase()) ?? 'low';
  const basis = line(v.basis ?? v.why, 300);
  const findings = (Array.isArray(v.findings) ? v.findings : []).map((f): NotebookAnswerFinding | undefined => {
    const o = (typeof f === 'string' ? { text: f } : f ?? {}) as Record<string, unknown>;
    const t = line(o.text ?? o.finding, 320);
    if (!t) return undefined;
    const from = (Array.isArray(o.from) ? o.from : []).filter((id): id is string => typeof id === 'string' && optionIds.has(id));
    return { text: t, from: [...new Set(from)].slice(0, 4) };
  }).filter((f): f is NotebookAnswerFinding => !!f).slice(0, 6);
  const open = (Array.isArray(v.open) ? v.open : []).map((q) => line(q, 240)).filter(Boolean).slice(0, 5);
  return { question: line(question, 240), text, confidence, ...(basis ? { basis } : {}), findings, open, at, by };
}

/**
 * A writer's <plan> as one to keep, against the options it may use: items
 * need a title (a missing "when" joins the one before it, else "Anytime");
 * `from` only names options the notebook has; at most 40 items, 8 things to
 * do before and 5 open questions. Pure.
 */
export function cleanPlan(raw: unknown, optionIds: ReadonlySet<string>, by: string, at = new Date().toISOString()): NotebookPlan | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const v = raw as Record<string, unknown>;
  const line = (x: unknown, n: number) => {
    const t = typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : '';
    return t.length <= n ? t : `${t.slice(0, n - 1).replace(/[\s,;:.—-]+$/, '')}…`;
  };
  let last = 'Anytime';
  const items = (Array.isArray(v.items) ? v.items : []).map((it): NotebookPlanItem | undefined => {
    const o = (it ?? {}) as Record<string, unknown>;
    const title = line(o.title ?? o.what, 200);
    if (!title) return undefined;
    const when = line(o.when ?? o.day, 40) || last;
    last = when;
    const detail = line(o.detail ?? o.note, 300);
    const from = (Array.isArray(o.from) ? o.from : []).filter((id): id is string => typeof id === 'string' && optionIds.has(id));
    return { when, title, ...(detail ? { detail } : {}), from: [...new Set(from)].slice(0, 4) };
  }).filter((i): i is NotebookPlanItem => !!i).slice(0, 40);
  if (!items.length) return undefined;
  const lines = (x: unknown, n: number) => (Array.isArray(x) ? x : []).map((q) => line(q, 240)).filter(Boolean).slice(0, n);
  return { summary: line(v.summary, 600), items, before: lines(v.before, 8), open: lines(v.open, 5), at, by };
}

/** The facts a source step looks up that an option doesn't have yet. */
function missingFacts(nb: Pick<Notebook, 'fields'>, o: Pick<NotebookViewOption, 'fields' | 'linkIsList'>, step: Pick<NotebookStep, 'facts'>): NotebookField[] {
  // A link to a search page isn't the option's own page yet.
  return stepFacts(nb, step).filter((f) => o.fields[f.key] === undefined || o.fields[f.key] === '' || (f.role === 'link' && !!o.linkIsList));
}

/**
 * A source step's work, option by option: the options it covers (best first,
 * the top N when it has one; not ruled out) that still lack some of its
 * facts, each with its own page (none when its link is a search page) and
 * the facts it lacks. For an agent that reads one item's page per run.
 */
export function sourceJobs(nb: Notebook, entries: readonly NotebookEntry[], step: Pick<NotebookStep, 'facts' | 'top'>): Array<{ entryId: string; name: string; link?: string; missing: NotebookField[] }> {
  const ranked = rankOptions(nb, notebookViewData(nb, entries).notebook.options).filter((o) => !o.ruledOut);
  const options = step.top ? ranked.slice(0, step.top) : ranked;
  return options
    .map((o) => ({ entryId: o.id, name: o.name, ...(o.linkIsList ? {} : { link: optionLink(nb.fields, o.fields) }), missing: missingFacts(nb, o, step).filter((f) => f.role !== 'link') }))
    .map((j) => (j.link ? j : { entryId: j.entryId, name: j.name, missing: j.missing }))
    .filter((j) => j.missing.length > 0);
}

/** The notebook's checks not yet ticked for an option. */
/** The notebook's checks an option still needs: not ticked, and not failed (a failed one on an option you kept is done). */
export function checksLeft(nb: Pick<Notebook, 'checks'>, o: Pick<NotebookViewOption, 'checked'> & { failed?: string[] }): string[] {
  const done = [...o.checked, ...(o.failed ?? [])].map((d) => d.toLowerCase());
  return nb.checks.filter((c) => !done.includes(c.toLowerCase()));
}

/**
 * Whether one option got through a step: found (it's here), its facts
 * sourced, every check ticked, or picked in the decision.
 */
export function optionPassesStep(nb: Pick<Notebook, 'fields' | 'checks'>, o: Pick<NotebookViewOption, 'fields' | 'checked' | 'chosen' | 'ruledOut' | 'linkIsList'> & { failed?: string[] }, step: Pick<NotebookStep, 'kind' | 'facts'> & { status?: NotebookStep['status'] }): boolean {
  if (step.kind === 'find') return true;
  if (step.kind === 'profile' || step.kind === 'write') return true;
  // Kept when you narrowed (a narrow step not done yet has kept nothing).
  if (step.kind === 'narrow') return step.status === 'done' && !o.ruledOut;
  if (step.kind === 'source') return stepFacts(nb, step).length > 0 && missingFacts(nb, o, step).length === 0;
  if (step.kind === 'check') return nb.checks.length > 0 && checksLeft(nb, o).length === 0;
  return !!o.chosen;
}

/** The steps options go through (a profile step is about who the notebook is about, a write step about all of it, not its options). */
export function optionSteps<T extends Pick<NotebookStep, 'kind'>>(steps: readonly T[]): T[] {
  return steps.filter((s) => s.kind !== 'profile' && s.kind !== 'write');
}

const STEP_FUNNEL_WORD: Record<NotebookStepKind, string> = { profile: 'Learned', find: 'Found', source: 'Facts sourced', check: 'Checked', narrow: 'Kept', decide: 'Chosen', write: 'Written' };

/** The funnel's stage names for a notebook's steps: "Found", "Checked"…; a kind used twice goes by its steps' titles. */
export function stepFunnelLabels(steps: readonly Pick<NotebookStep, 'kind' | 'title'>[]): string[] {
  return steps.map((s) => (steps.filter((x) => x.kind === s.kind).length > 1 ? s.title : STEP_FUNNEL_WORD[s.kind]));
}

/** The options still in the running, best first by `rankBy` (ones without a value last). */
export function rankOptions<T extends Pick<NotebookViewOption, 'price' | 'score' | 'ruledOut'>>(nb: Pick<Notebook, 'fields'>, options: readonly T[]): T[] {
  const r = rankBy(nb);
  const val = (o: T) => (r.by === 'score' ? o.score : o.price);
  return options.filter((o) => !o.ruledOut).sort((a, b) => {
    const x = val(a); const y = val(b);
    if (x === undefined) return y === undefined ? 0 : 1;
    if (y === undefined) return -1;
    return r.better === 'lower' ? x - y : y - x;
  });
}

/**
 * Where a fact came from (an https link), whether it's an estimate, and the
 * words in the source that back it ("checked": code found them there).
 */
export interface NotebookFactMeta { source?: string; estimate?: boolean; quote?: string; checked?: boolean }

/**
 * An agent can give a fact as a plain value, or as {value, source, estimate}
 * when it says where a figure came from or that it's a guess. Splits the two.
 */
export function splitFacts(data: Record<string, unknown> | undefined, opts: { trusted?: boolean } = {}): { values: Record<string, unknown>; meta: Record<string, NotebookFactMeta> } {
  const values: Record<string, unknown> = {};
  const meta: Record<string, NotebookFactMeta> = {};
  for (const [k, v] of Object.entries(data ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in (v as object)) {
      const x = v as { value: unknown; source?: unknown; estimate?: unknown; confidence?: unknown; quote?: unknown; checked?: unknown };
      values[k] = x.value;
      const m: NotebookFactMeta = {};
      if (typeof x.source === 'string') m.source = x.source;
      if (x.estimate === true || x.confidence === 'estimate' || x.confidence === 'low') m.estimate = true;
      if (typeof x.quote === 'string' && x.quote.trim()) m.quote = x.quote.replace(/\s+/g, ' ').trim();
      // Only an agent's own code may say it found the quote in the source; a model's say-so isn't a check.
      if (m.quote && opts.trusted && x.checked === true) m.checked = true;
      if (m.source || m.estimate || m.quote) meta[k] = m;
    } else values[k] = v;
  }
  return { values, meta };
}

/** Meta only for facts that were kept, with sources that are plain https links. */
function cleanFactMeta(meta: Record<string, NotebookFactMeta>, kept: Record<string, unknown>): Record<string, NotebookFactMeta> {
  const out: Record<string, NotebookFactMeta> = {};
  for (const [k, m] of Object.entries(meta)) {
    if (!(k in kept)) continue;
    const c: NotebookFactMeta = {};
    if (m.source) { try { const u = new URL(m.source); if (u.protocol === 'https:' || u.protocol === 'http:') c.source = u.toString().slice(0, 500); } catch { /* not a link */ } }
    if (m.estimate) c.estimate = true;
    if (m.quote && m.quote.length >= 15) { c.quote = m.quote.slice(0, 300); if (m.checked && c.source) c.checked = true; }
    if (c.source || c.estimate || c.quote) out[k] = c;
  }
  return out;
}

/** A newly stated fact replaces its source and estimate (or clears them); others keep theirs. */
function mergeFactMeta(prev: Record<string, NotebookFactMeta> | undefined, stated: Record<string, unknown>, next: Record<string, NotebookFactMeta>): Record<string, NotebookFactMeta> | undefined {
  const out: Record<string, NotebookFactMeta> = { ...(prev ?? {}) };
  for (const k of Object.keys(stated)) delete out[k];
  Object.assign(out, next);
  return Object.keys(out).length ? out : undefined;
}

/** Which options a CSV has: the chosen ones, the ones in the running, or all of them (ruled out too). */
export type NotebookCsvRows = 'chosen' | 'running' | 'all';

/**
 * The shortlist as a spreadsheet (CSV): best first by `rankBy` (chosen first
 * once there's a decision), one column per field (numbers raw, ranges
 * "min-max"), then whether it was chosen, where facts came from, the quote
 * that backs the ranking, the checks done and when it was seen. `rows` picks
 * the options; `ids`, when given, keeps just those (the shortlist as you
 * filtered it). Ruled-out ones come last, with why. Excel-safe: a UTF-8 BOM,
 * CRLF lines, and text that could run as a formula is prefixed with '.
 */
export function notebookCsv(nb: Pick<Notebook, 'fields' | 'checks' | 'steps'>, options: readonly NotebookViewOption[], opts: { ruledOut?: boolean; rows?: NotebookCsvRows; ids?: readonly string[] } = {}): string {
  const rows: NotebookCsvRows = opts.rows ?? (opts.ruledOut ? 'all' : 'running');
  const keep = opts.ids ? new Set(opts.ids) : undefined;
  const pool = options.filter((o) => !keep || keep.has(o.id));
  const withOut = rows === 'all' && pool.some((o) => o.ruledOut);
  const anyChosen = pool.some((o) => o.chosen && !o.ruledOut);
  // With steps, the stage is how far it got through them (the funnel's words), not one moved to by hand.
  const osteps = optionSteps(nb.steps ?? []);
  const stepLabels = osteps.length > 1 ? stepFunnelLabels(osteps) : undefined;
  const decideAt = osteps.findIndex((x) => x.kind === 'decide');
  const cell = (v: unknown): string => {
    if (v === undefined || v === null) return '';
    let s = typeof v === 'number' ? String(v) : String(v);
    if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const value = (v: NotebookFieldValue | undefined): string | number | undefined =>
    v === undefined ? undefined : isRange(v) ? `${String(v.min)}-${String(v.max)}` : v;
  const label = (f: NotebookField) => (f.unit ? `${f.label} (${f.unit})` : f.label);
  const scoreKey = rankBy(nb).field?.key;
  // With a link field: each one's own page, and the search page when that's all it has.
  const hasLink = nb.fields.some((f) => f.role === 'link');
  const head = ['Rank', 'Option', 'Stage', ...(hasLink ? ['Own page', 'Found on'] : []), ...nb.fields.map(label), ...(anyChosen ? ['Chosen'] : []), 'Estimates', 'Sources', 'Quote', 'Quote source', 'Quote checked',
    ...(nb.checks.length ? ['Checks done'] : []), 'First seen', 'Last seen', ...(withOut ? ['Ruled out'] : [])];
  const row = (o: NotebookViewOption, rank: number | undefined): string[] => {
    const meta = o.factMeta ?? {};
    const byKey = new Map(nb.fields.map((f) => [f.key, f.label]));
    const qKey = [scoreKey, ...nb.fields.map((f) => f.key)].find((k) => k && meta[k]?.quote);
    const q = qKey ? meta[qKey] : undefined;
    return [
      // A pick reads as chosen, as the funnel counts it, whatever the steps before it got to.
      rank === undefined ? '' : String(rank), o.title, (stepLabels ? (o.chosen && !o.ruledOut && decideAt >= 0 ? stepLabels[decideAt] : stepLabels[o.stageIndex]) : o.stage) ?? '',
      ...(hasLink ? [o.link && !o.linkIsList ? o.link : '', o.link && o.linkIsList ? o.link : ''] : []),
      ...nb.fields.map((f) => value(o.fields[f.key])),
      ...(anyChosen ? [o.chosen && !o.ruledOut ? 'yes' : ''] : []),
      Object.entries(meta).filter(([, m]) => m.estimate).map(([k]) => byKey.get(k) ?? k).join('; '),
      Object.entries(meta).filter(([, m]) => m.source).map(([k, m]) => `${byKey.get(k) ?? k}: ${m.source ?? ''}`).join('; '),
      q?.quote ?? '', q?.source ?? '', q ? (q.checked ? 'yes' : 'no') : '',
      ...(nb.checks.length ? [`${String(nb.checks.filter((c) => o.checked.includes(c)).length)} of ${String(nb.checks.length)}`] : []),
      o.firstSeenAt.slice(0, 10), o.lastSeenAt.slice(0, 10),
      ...(withOut ? [o.ruledOut?.reason ?? ''] : []),
    ].map(cell);
  };
  // Best first, chosen ahead of the rest (a stable sort keeps the ranking within each).
  const ranked = rankOptions(nb, pool).map((o, i) => [o, i] as const)
    .sort((a, b) => Number(!!b[0].chosen) - Number(!!a[0].chosen) || a[1] - b[1]).map(([o]) => o)
    .filter((o) => rows !== 'chosen' || o.chosen);
  const lines = [head.map(cell), ...ranked.map((o, i) => row(o, i + 1)), ...(withOut ? pool.filter((o) => o.ruledOut).map((o) => row(o, undefined)) : [])];
  return `﻿${lines.map((l) => l.join(',')).join('\r\n')}\r\n`;
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const loose = (t: string) => t.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * What a done-when is about, when it repeats the notebook's own work: the
 * decision ("A decision recorded", "decided yes/no", "A final set recorded"),
 * a count of options ("At least 10 companies"), facts sourced ("Revenue …
 * sourced for each"), or one of its checks ("clean title" for "Clean title
 * (VIN)"). Anything else is yours to tick.
 */
export function criterionLink(nb: Pick<Notebook, 'checks'>, text: string): { kind: 'decide' } | { kind: 'count'; n: number } | { kind: 'source' } | { kind: 'check'; check: string } | undefined {
  const t = text.toLowerCase();
  const check = nb.checks.find((c) => { const a = loose(c); const b = loose(text); return !!a && !!b && (a === b || a.includes(b) || b.includes(a)); });
  if (check) return { kind: 'check', check };
  if (/\b(decid\w*|decision)\b/.test(t) || /\bfinal\b.*\b(recorded|chosen|picked)\b/.test(t)) return { kind: 'decide' };
  const count = /\bat least (\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/.exec(t);
  if (count) return { kind: 'count', n: NUMBER_WORDS[count[1]] ?? Number(count[1]) };
  if (/\bsourced\b/.test(t)) return { kind: 'source' };
  return undefined;
}

/** Whether the notebook's work meets a done-when (see criterionLink); false when it can't tell. */
export function criterionMet(nb: Notebook, entries: readonly NotebookEntry[], text: string): boolean {
  const link = criterionLink(nb, text);
  if (!link) return false;
  if (link.kind === 'decide') return nb.status === 'decided';
  const options = notebookViewData(nb, entries).notebook.options.filter((o) => !o.ruledOut);
  if (link.kind === 'count') return options.length >= link.n;
  if (link.kind === 'source') {
    const step = nb.steps?.find((s) => s.kind === 'source');
    // A step you moved on from short of its goal didn't source them all.
    return step ? stepProgress(nb, entries, { ...step, top: undefined }).met : false; // "for each" means all, not a top N
  }
  const chosen = options.filter((o) => o.chosen);
  const c = link.check.toLowerCase();
  return nb.status === 'decided' && chosen.length > 0 && chosen.every((o) => o.checked.some((d) => d.toLowerCase() === c));
}
