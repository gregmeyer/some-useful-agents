/**
 * How sure an answer is, from its evidence rather than the writer's word
 * (SIFT: stop, and weigh the evidence; ADR-0083). The writer says high,
 * medium or low; code caps it from what the notebook knows about the sources
 * the answer cites: how many publishers outside its subjects back it
 * (ADR-0081), how its findings traced to their pages (ADR-0082), and whether
 * its sources disagree. Never raised, only capped, each cap with its reason
 * in plain words. Pure.
 */
import { answerSubjects, evidenceOrigin, sourceSpread } from './notebook-source-origin.js';
import { findingTrace } from './notebook-trace.js';
import type { Notebook, NotebookAnswer, NotebookEntry } from './notebooks.js';

/** "A2UI, AG-UI or CopilotKit". */
const orList = (xs: readonly string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);

export type AnswerConfidence = NotebookAnswer['confidence'];
const RANK: Record<AnswerConfidence, number> = { low: 0, medium: 1, high: 2 };

export interface AnswerSureness {
  /** What the writer said. */
  said: AnswerConfidence;
  /** What it is, capped by its evidence. */
  shown: AnswerConfidence;
  /** Why it isn't higher than the writer said, each a short clause ("every source it cites is the subjects' own"); empty when not capped. */
  why: string[];
}

/** Every entry id an answer cites (its findings, its sections' rows and steps, its contradictions), once each. */
export function answerCitedIds(a: Pick<NotebookAnswer, 'findings' | 'sections' | 'contradictions'>): string[] {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (k === 'from' && Array.isArray(x)) x.forEach((id) => { if (typeof id === 'string') out.add(id); });
      else if (k !== 'previous') walk(x);
    }
  };
  walk(a.findings); walk(a.sections); walk(a.contradictions);
  return [...out];
}

/** How a finding stands: an interpretation as the writer marked it, else how what it cites traced (undefined before any trace). */
export function findingStatus(nb: Pick<Notebook, 'title' | 'statement' | 'briefOn'>, f: NotebookAnswer['findings'][number], byId: ReadonlyMap<string, NotebookEntry>): 'interpretation' | 'verified' | 'supported' | 'unverified' | undefined {
  if (f.kind === 'interpretation') return 'interpretation';
  const subjects = answerSubjects(nb);
  const cited = f.from.map((id) => byId.get(id)).filter((e): e is NotebookEntry => !!e && e.kind === 'evidence')
    .map((e) => { const o = evidenceOrigin(e, subjects); return { ...(e.trace ? { trace: e.trace } : {}), ...(o ? { origin: o } : {}) }; });
  return findingTrace(cited);
}

/**
 * The caps, in order, applied only to what an answer rests on from pages
 * (evidence); an answer that cites none (a shortlist's write-up) keeps the
 * writer's word.
 * - fewer than two publishers outside its subjects among what it cites: medium;
 * - its sources not traced yet (the notebook has a check step): medium;
 * - no factual finding traced to a primary page: medium;
 * - most factual findings' quotes not found: low; some not found: medium;
 * - its sources disagree (contradictions it noted): medium.
 */
export function answerConfidence(nb: Pick<Notebook, 'title' | 'statement' | 'briefOn' | 'steps' | 'answer'>, entries: readonly NotebookEntry[]): AnswerSureness | undefined {
  const a = nb.answer;
  if (!a?.text) return undefined;
  const byId = new Map(entries.map((e) => [e.id, e]));
  const cited = answerCitedIds(a).map((id) => byId.get(id)).filter((e): e is NotebookEntry => !!e && e.kind === 'evidence');
  if (!cited.length) return { said: a.confidence, shown: a.confidence, why: [] };
  const caps: Array<{ to: AnswerConfidence; why: string }> = [];
  const subjects = answerSubjects(nb);
  if (subjects.length) {
    const spread = sourceSpread(cited.map((e) => evidenceOrigin(e, subjects)).filter((o): o is NonNullable<typeof o> => !!o));
    if (spread.outside === 0) caps.push({ to: 'medium', why: `every source it cites is published by ${orList(subjects)} ${subjects.length === 1 ? 'itself' : 'themselves'}` });
    else if (spread.outside < 2) caps.push({ to: 'medium', why: `only one publisher it cites is from outside ${subjects.join(', ')}` });
  }
  const facts = a.findings.filter((f) => f.kind !== 'interpretation');
  const statuses = facts.map((f) => findingStatus(nb, f, byId));
  const traced = statuses.filter((s) => s !== undefined);
  const hasCheck = (nb.steps ?? []).some((s) => s.kind === 'check');
  if (!traced.length && hasCheck) caps.push({ to: 'medium', why: "its sources haven't been traced to their pages yet" });
  if (traced.length) {
    const unverified = traced.filter((s) => s === 'unverified').length;
    if (!traced.includes('verified')) caps.push({ to: 'medium', why: 'no finding traces to a primary source' });
    if (unverified * 2 > traced.length) caps.push({ to: 'low', why: `${String(unverified)} of ${String(traced.length)} findings' quotes weren't found on their pages` });
    else if (unverified) caps.push({ to: 'medium', why: `${String(unverified)} finding${unverified === 1 ? "'s" : "s'"} quote${unverified === 1 ? " wasn't" : "s weren't"} found on ${unverified === 1 ? 'its page' : 'their pages'}` });
  }
  if (a.contradictions?.length) caps.push({ to: 'medium', why: `its sources disagree${a.contradictions.length === 1 ? '' : ` in ${String(a.contradictions.length)} places`}` });
  const binding = caps.filter((c) => RANK[c.to] < RANK[a.confidence]);
  const shown = binding.reduce<AnswerConfidence>((m, c) => (RANK[c.to] < RANK[m] ? c.to : m), a.confidence);
  return { said: a.confidence, shown, why: binding.map((c) => c.why) };
}

/** Pages an answer's notebook found after the answer was written: how many, how many primary, how many from outside its subjects (ADR-0083). Undefined when there are none, or no answer. */
export function answerNewSources(nb: Pick<Notebook, 'title' | 'statement' | 'briefOn' | 'answer'>, entries: readonly NotebookEntry[]): { pages: number; primary: number; outside: number } | undefined {
  const a = nb.answer;
  if (!a?.text || !a.at) return undefined;
  const subjects = answerSubjects(nb);
  const pages = new Map<string, NonNullable<ReturnType<typeof evidenceOrigin>>>();
  for (const e of entries) {
    if (e.kind !== 'evidence' || !e.fingerprint || e.createdAt <= a.at) continue;
    const o = evidenceOrigin(e, subjects);
    if (o) pages.set(e.fingerprint.toLowerCase().replace(/[#?].*$/, '').replace(/\/+$/, ''), o);
  }
  if (!pages.size) return undefined;
  const os = [...pages.values()];
  return { pages: os.length, primary: os.filter((o) => o.kind === 'primary').length, outside: subjects.length ? os.filter((o) => !o.whose).length : 0 };
}

