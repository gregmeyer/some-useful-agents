/**
 * A notebook as something else can read it (notebook-read: an MCP client, an
 * agent, another notebook's conversation): what it's for, what it learned
 * about who it's about, what it wrote, its options with their facts and
 * sources, and its notes. Text for a model, JSON for code. Pure.
 */
import { answerSectionLines, fieldNumber, openConflicts, rankBy, writesUp, type Notebook, type NotebookAboutOne, type NotebookAboutWho, type NotebookEntry, type NotebookStore } from './notebooks.js';
import { formatFieldValue } from './notebook-field-format.js';

export const NOTEBOOK_READ_PARTS = ['all', 'about', 'written', 'options', 'notes'] as const;
export type NotebookReadPart = (typeof NOTEBOOK_READ_PARTS)[number];

const MAX_OPTIONS = 40;
const MAX_RULED_OUT = 20;
const MAX_NOTES = 20;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

export interface NotebookReadoutOption {
  id: string;
  title: string;
  facts: Record<string, string>;
  /** Where a fact came from, by its label. */
  sources: Record<string, string>;
  passed: string[];
  failed: Record<string, string>;
  picked?: boolean;
  body?: string;
}

export interface NotebookReadoutJson {
  id: string;
  title: string;
  for: string;
  status: Notebook['status'];
  decision?: string;
  archived: boolean;
  link: string;
  lastRunAt?: string;
  limits: string[];
  checks: string[];
  doneWhen: Array<{ text: string; met: boolean }>;
  about?: Partial<Record<NotebookAboutWho, {
    name: string;
    summary?: string;
    facts: Array<{ label: string; value: string; source?: string }>;
    competitors: Array<{ name: string; how?: string; website?: string }>;
    otherCompanies: Array<{ name: string; role?: string; what?: string }>;
    open: string[];
  }>>;
  answer?: { question: string; text: string; confidence: string; findings: string[]; open: string[]; sections?: ReadoutSection[]; writeup?: boolean };
  briefing?: { points: Array<{ text: string; why?: string; ask?: string }>; questions: string[]; watch: string[] };
  plan?: { summary: string; items: Array<{ when: string; title: string; detail?: string }>; before: string[]; open: string[]; sections?: ReadoutSection[] };
  options?: { inTheRunning: NotebookReadoutOption[]; ruledOut: Array<{ id: string; title: string; reason: string }>; more: number };
  notes?: { items: Array<{ kind: string; title: string; body?: string; by: string; at: string }>; more: number };
}

function aboutOne(one: NotebookAboutOne) {
  return {
    name: one.name,
    ...(one.summary ? { summary: one.summary } : {}),
    facts: one.facts.filter((f) => f.value).map((f) => ({ label: f.label, value: f.value, ...(f.source ? { source: f.source } : {}) })),
    competitors: (one.competitors ?? []).map((c) => ({ name: c.name, ...(c.how ? { how: c.how } : {}), ...(c.website ? { website: c.website } : {}) })),
    otherCompanies: (one.affiliations ?? []).map((a) => ({ name: a.name, ...(a.role ? { role: a.role } : {}), ...(a.what ? { what: a.what } : {}) })),
    open: openConflicts(one).map((c) => c.question),
  };
}

function optionOf(nb: Notebook, e: NotebookEntry): NotebookReadoutOption {
  const facts: Record<string, string> = {};
  const sources: Record<string, string> = {};
  for (const f of nb.fields) {
    const v = e.data?.[f.key];
    if (v === undefined || v === '') continue;
    facts[f.label] = formatFieldValue(f, v) + (e.factMeta?.[f.key]?.estimate ? ' (estimate)' : '');
    const src = e.factMeta?.[f.key]?.source;
    if (src) sources[f.label] = src;
  }
  const passed = nb.checks.filter((c) => (e.checked ?? []).some((x) => x.toLowerCase() === c.toLowerCase()));
  const body = oneLine(e.body);
  return { id: e.id, title: e.title, facts, sources, passed, failed: { ...(e.failedChecks ?? {}) }, ...(e.chosenAt ? { picked: true } : {}), ...(body ? { body: clip(body, 300) } : {}) };
}

/** The options still in it, best first: the pick, then by its score or price, then newest. */
function ranked(nb: Notebook, options: readonly NotebookEntry[]): NotebookEntry[] {
  const r = rankBy(nb);
  const val = (e: NotebookEntry) => (r.field ? fieldNumber(e.data?.[r.field.key]) : undefined);
  return [...options].sort((a, b) => {
    if (!!a.chosenAt !== !!b.chosenAt) return a.chosenAt ? -1 : 1;
    const x = val(a); const y = val(b);
    if (x !== undefined && y !== undefined && x !== y) return r.better === 'lower' ? x - y : y - x;
    if (x !== undefined && y === undefined) return -1;
    if (y !== undefined && x === undefined) return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/** The notebook as JSON, whole or one part. `entries` as the store lists them (newest first). */
export function notebookReadoutJson(nb: Notebook, entries: readonly NotebookEntry[], part: NotebookReadPart = 'all'): NotebookReadoutJson {
  const want = (p: NotebookReadPart) => part === 'all' || part === p;
  const out: NotebookReadoutJson = {
    id: nb.id, title: nb.title, for: nb.statement, status: nb.status,
    ...(nb.decision ? { decision: nb.decision } : {}),
    archived: !!nb.archivedAt,
    link: `/notebooks/${encodeURIComponent(nb.id)}`,
    ...(nb.lastRunAt ? { lastRunAt: nb.lastRunAt } : {}),
    limits: nb.params, checks: nb.checks,
    doneWhen: nb.criteria.map((c) => ({ text: c.text, met: c.met })),
  };
  if (want('about') && nb.about) {
    const about: NonNullable<NotebookReadoutJson['about']> = {};
    for (const who of ['person', 'company'] as const) { const one = nb.about[who]; if (one) about[who] = aboutOne(one); }
    if (Object.keys(about).length) out.about = about;
  }
  if (want('written')) {
    const a = nb.answer;
    if (a) {
      const struck = new Set(a.struck ?? []);
      const sections = (a.sections ?? []).map((x) => ({
        title: x.title, kind: x.kind, ...(x.kind === 'table' ? { columns: x.columns } : {}),
        lines: answerSectionLines(x).filter((t) => !struck.has(t)),
      })).filter((x) => x.lines.length);
      // A shortlist written up is kept as the answer (ADR-0069); it reads as the write-up.
      const writeup = writesUp(nb);
      out.answer = { question: a.question, text: a.text, confidence: a.confidence, findings: a.findings.map((f) => f.text).filter((t) => !struck.has(t)), open: a.open, ...(sections.length ? { sections } : {}), ...(writeup ? { writeup: true } : {}) };
    }
    const b = nb.briefing;
    if (b && (b.points.length || b.questions.length || b.watch.length)) {
      const struck = new Set(b.struck ?? []);
      out.briefing = {
        points: b.points.filter((p) => !struck.has(p.text)).map((p) => ({ text: p.text, ...(p.why ? { why: p.why } : {}), ...(p.ask ? { ask: p.ask } : {}) })),
        questions: b.questions, watch: b.watch,
      };
    }
    const p = nb.plan;
    if (p) {
      const struck = new Set(p.struck ?? []);
      const sections = (p.sections ?? []).map((x) => ({ title: x.title, kind: x.kind, ...(x.kind === 'table' ? { columns: x.columns } : {}), lines: answerSectionLines(x).filter((t) => !struck.has(t)) })).filter((x) => x.lines.length);
      out.plan = { summary: p.summary, items: p.items.filter((i) => !struck.has(i.title)).map((i) => ({ when: i.when, title: i.title, ...(i.detail ? { detail: i.detail } : {}) })), before: p.before, open: p.open, ...(sections.length ? { sections } : {}) };
    }
  }
  if (want('options')) {
    const options = entries.filter((e) => e.kind === 'option');
    const inIt = ranked(nb, options.filter((e) => !e.ruledOut));
    const out_ = options.filter((e) => e.ruledOut);
    if (options.length) {
      out.options = {
        inTheRunning: inIt.slice(0, MAX_OPTIONS).map((e) => optionOf(nb, e)),
        ruledOut: out_.slice(0, MAX_RULED_OUT).map((e) => ({ id: e.id, title: e.title, reason: e.ruledOut!.reason })),
        more: Math.max(0, inIt.length - MAX_OPTIONS) + Math.max(0, out_.length - MAX_RULED_OUT),
      };
    }
  }
  if (want('notes')) {
    const notes = entries.filter((e) => e.kind !== 'option');
    if (notes.length) {
      out.notes = {
        items: notes.slice(0, MAX_NOTES).map((e) => { const body = oneLine(e.body); return { kind: e.kind, title: e.title, ...(body ? { body: clip(body, 600) } : {}), by: e.by, at: e.createdAt }; }),
        more: Math.max(0, notes.length - MAX_NOTES),
      };
    }
  }
  return out;
}

/** An answer's or plan's part, as text (notebook-read). */
type ReadoutSection = { title: string; kind: string; columns?: string[]; lines: string[] };

function sectionLines(lines: string[], sections: readonly ReadoutSection[] | undefined): void {
  for (const x of sections ?? []) {
    lines.push('', `### ${x.title}`);
    if (x.columns) lines.push(`(${x.columns.join(' · ')})`);
    x.lines.forEach((l, i) => lines.push(x.kind === 'steps' ? `${String(i + 1)}. ${l}` : x.kind === 'text' ? l : `- ${l}`));
  }
}

/** The same, as text a model reads (Markdown). */
export function notebookReadoutText(nb: Notebook, entries: readonly NotebookEntry[], part: NotebookReadPart = 'all'): string {
  const j = notebookReadoutJson(nb, entries, part);
  const lines: string[] = [`# ${j.title}`, ''];
  const state = [j.status === 'decided' ? `decided${j.decision ? `: ${j.decision}` : ''}` : j.status, ...(j.archived ? ['archived'] : []), ...(j.lastRunAt ? [`last run ${j.lastRunAt.slice(0, 10)}`] : [])];
  if (j.for) lines.push(`For: ${j.for}`);
  lines.push(`Notebook ${j.id} (${state.join(', ')}) · ${j.link}`);
  if (j.limits.length) lines.push(`Limits: ${j.limits.join('; ')}`);
  if (j.checks.length) lines.push(`Checks: ${j.checks.join('; ')}`);
  if (j.doneWhen.length) lines.push(`Done when: ${j.doneWhen.map((c) => `${c.text} (${c.met ? 'met' : 'not yet'})`).join('; ')}`);
  for (const who of ['person', 'company'] as const) {
    const a = j.about?.[who];
    if (!a) continue;
    lines.push('', `## ${who === 'person' ? 'Who' : 'Their company'}: ${a.name}`);
    if (a.summary) lines.push(a.summary);
    for (const f of a.facts) lines.push(`- ${f.label}: ${f.value}${f.source ? ` (${f.source})` : ''}`);
    if (a.competitors.length) lines.push(`- Competitors: ${a.competitors.map((c) => (c.how ? `${c.name} (${c.how})` : c.name)).join('; ')}`);
    if (a.otherCompanies.length) lines.push(`- Other companies: ${a.otherCompanies.map((c) => [c.name, c.role].filter(Boolean).join(', ') + (c.what ? ` (${c.what})` : '')).join('; ')}`);
    for (const q of a.open) lines.push(`- Not settled: ${q}`);
  }
  if (j.answer) {
    if (j.answer.writeup) lines.push('', `## Write-up (${j.answer.confidence} confidence)`, j.answer.text);
    else lines.push('', `## Answer (${j.answer.confidence} confidence)`, `Q: ${j.answer.question}`, j.answer.text);
    for (const f of j.answer.findings) lines.push(`- ${f}`);
    for (const o of j.answer.open) lines.push(`- Open: ${o}`);
    sectionLines(lines, j.answer.sections);
  }
  if (j.briefing) {
    lines.push('', '## Talking points');
    for (const p of j.briefing.points) lines.push(`- ${p.text}${p.why ? ` — ${p.why}` : ''}${p.ask ? ` Ask: ${p.ask}` : ''}`);
    for (const q of j.briefing.questions) lines.push(`- Question: ${q}`);
    for (const w of j.briefing.watch) lines.push(`- Watch for: ${w}`);
  }
  if (j.plan) {
    lines.push('', '## Plan', j.plan.summary);
    for (const i of j.plan.items) lines.push(`- ${i.when}: ${i.title}${i.detail ? ` — ${i.detail}` : ''}`);
    for (const b of j.plan.before) lines.push(`- Before: ${b}`);
    for (const o of j.plan.open) lines.push(`- Open: ${o}`);
    sectionLines(lines, j.plan.sections);
  }
  if (j.options) {
    lines.push('', `## Options (${j.options.inTheRunning.length} in the running)`);
    for (const o of j.options.inTheRunning) {
      const facts = Object.entries(o.facts).map(([k, v]) => `${k}: ${v}`).join('; ');
      lines.push(`- ${o.picked ? '[picked] ' : ''}${o.title}${facts ? ` — ${facts}` : ''} (id ${o.id})`);
      if (o.body) lines.push(`  ${o.body}`);
      const srcs = [...new Set(Object.values(o.sources))];
      if (srcs.length) lines.push(`  Sources: ${srcs.join(' ')}`);
      if (o.passed.length) lines.push(`  Passed: ${o.passed.join('; ')}`);
      const failed = Object.entries(o.failed);
      if (failed.length) lines.push(`  Failed: ${failed.map(([c, why]) => `${c} (${why})`).join('; ')}`);
    }
    if (j.options.ruledOut.length) {
      lines.push('', '### Ruled out');
      for (const o of j.options.ruledOut) lines.push(`- ${o.title}: ${o.reason}`);
    }
    if (j.options.more) lines.push(`…and ${String(j.options.more)} more options not shown.`);
  }
  if (j.notes) {
    lines.push('', '## Notes and evidence');
    for (const n of j.notes.items) lines.push(`- ${n.title}${n.body && n.body !== n.title ? `: ${n.body}` : ''} (${n.kind}, ${n.by}, ${n.at.slice(0, 10)})`);
    if (j.notes.more) lines.push(`…and ${String(j.notes.more)} more not shown.`);
  }
  return lines.join('\n');
}

/**
 * The notebook someone means: an id, a /notebooks/<id> link, or words from its
 * title (archived ones too). Several match by name: they're returned to choose
 * from. None: undefined.
 */
export function findNotebook(store: Pick<NotebookStore, 'get' | 'list'>, ask: string): { notebook: Notebook } | { matches: Notebook[] } | undefined {
  const q = ask.trim();
  if (!q) return undefined;
  const id = /\/notebooks\/([A-Za-z0-9_-]+)/.exec(q)?.[1] ?? q;
  const byId = store.get(id);
  if (byId) return { notebook: byId };
  const all = store.list({ archived: 'include' });
  const lower = q.toLowerCase();
  const exact = all.filter((n) => n.title.toLowerCase() === lower);
  if (exact.length === 1) return { notebook: exact[0] };
  const words = lower.split(/[^a-z0-9.]+/).filter((w) => w.length > 1);
  if (!words.length) return undefined;
  const hits = all.filter((n) => { const t = `${n.title} ${n.id}`.toLowerCase(); return words.every((w) => t.includes(w)); });
  if (hits.length === 1) return { notebook: hits[0] };
  return hits.length ? { matches: hits } : undefined;
}
