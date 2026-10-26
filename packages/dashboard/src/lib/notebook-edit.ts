/**
 * Editing a notebook by saying what to change (the Edit page's Talk), or by
 * editing it as a document (its Prompt): either way the change is a
 * proposal first, the notebook as it would be, shown as a preview of its
 * page with what changes listed; Save makes it the notebook, Discard drops
 * it. Talk asks the notebook drafter to change the setup (the same one that
 * drafts a new notebook from a sentence) and, when it's about the page, the
 * page agent to change the page. One proposal per notebook, kept with the
 * drafts (id `edit:<notebook>`) until saved, discarded or two weeks old.
 */
import {
  NotebookStore, NOTEBOOK_FIELD_ROLES, NOTEBOOK_FIELD_TYPES, NOTEBOOK_LAYOUT_PRESETS, NOTEBOOK_STEP_KINDS, cleanFields, cleanSteps, layoutPreset, validateScheduleInterval,
  type Notebook, type NotebookField, type NotebookLayout, type NotebookStep,
} from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { parseNotebookDraft, runDrafter, searchAgents, NOTEBOOK_DRAFTER_ID, type NotebookDraft } from './notebook-draft.js';
import { drawNotebookPage, runNotebookPageAgent } from './notebook-page.js';
import { confirmDoneStepsAndSay, fitStepAgents } from './notebook-steps.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';

type Ctx = ReturnType<typeof getContext>;

/** What an edit changes: everything a notebook is set up with (not what it found). */
export type NotebookSetup = Omit<NotebookDraft, 'suggested' | 'why'> & { steps: NotebookStep[]; met: Record<string, boolean> };

export interface NotebookEditTurn {
  /** What you said, or "You edited the prompt." */
  you: string;
  via: 'talk' | 'prompt' | 'look';
  /** What changed with it, in words. */
  changes?: string[];
  /** sua's word on it, when it has one (why, or that nothing changed). */
  sua?: string;
  error?: string;
  at: string;
}

export interface NotebookEdit {
  setup: NotebookSetup;
  /** The page it would have: undefined, the page it has; null, the shortlist. */
  layout?: NotebookLayout | null;
  turns: NotebookEditTurn[];
  status: 'ready' | 'working';
  updatedAt: string;
}

const editId = (notebookId: string) => `edit:${notebookId}`;
const storeOf = (ctx: Ctx) => NotebookStore.fromHandle(ctx.runStore.databaseHandle());
/** A proposal sua was still working on after this long was cut off (the dashboard restarted). */
const STALE_MS = 6 * 60_000;

/** A notebook's setup, as an edit starts from it. Pure. */
export function setupOf(nb: Notebook): NotebookSetup {
  return {
    title: nb.title, statement: nb.statement, params: [...nb.params], criteria: nb.criteria.map((c) => c.text),
    met: Object.fromEntries(nb.criteria.map((c) => [c.text, c.met])),
    fields: nb.fields.map((f) => ({ ...f })), checks: [...nb.checks], stages: [...nb.stages], pipeline: [...nb.pipeline],
    steps: (nb.steps ?? []).map((s) => ({ ...s })), cadence: nb.cadence,
  };
}

/** The notebook as the edit would leave it (for the preview). Pure. */
export function proposedNotebook(nb: Notebook, edit: NotebookEdit | undefined): Notebook {
  if (!edit) return nb;
  const s = edit.setup;
  return {
    ...nb, title: s.title, statement: s.statement, params: s.params,
    criteria: s.criteria.map((text) => ({ text, met: s.met[text] ?? false })),
    fields: s.fields, checks: s.checks, stages: s.stages, pipeline: s.pipeline, steps: s.steps, cadence: s.cadence,
    ...(edit.layout === undefined ? {} : edit.layout === null ? { layout: undefined } : { layout: edit.layout }),
  };
}

export function readEdit(ctx: Ctx, notebookId: string): NotebookEdit | undefined {
  const r = storeOf(ctx).getDraft(editId(notebookId));
  const e = r?.draft as NotebookEdit | undefined;
  if (!r || !e?.setup) return undefined;
  if (Date.now() - Date.parse(r.updatedAt) > 14 * 86_400_000) { storeOf(ctx).deleteDraft(editId(notebookId)); return undefined; }
  if (e.status === 'working' && Date.now() - Date.parse(e.updatedAt) > STALE_MS) {
    const last = e.turns[e.turns.length - 1];
    return { ...e, status: 'ready', turns: [...e.turns.slice(0, -1), ...(last ? [{ ...last, error: 'sua stopped before it finished. Say it again.' }] : [])] };
  }
  return e;
}

function writeEdit(ctx: Ctx, notebookId: string, e: NotebookEdit): void {
  storeOf(ctx).saveDraft(editId(notebookId), { status: e.status, text: e.turns[0]?.you ?? 'edit', draft: { ...e, updatedAt: new Date().toISOString() } });
}

export function discardEdit(ctx: Ctx, notebookId: string): boolean {
  return storeOf(ctx).deleteDraft(editId(notebookId));
}

// ---- What changes ------------------------------------------------------------

const quote = (s: string) => `“${s}”`;
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

function listChange(what: string, before: readonly string[], after: readonly string[]): string[] {
  const was = new Set(before.map(norm));
  const now = new Set(after.map(norm));
  const added = after.filter((x) => !was.has(norm(x)));
  const removed = before.filter((x) => !now.has(norm(x)));
  return [
    ...added.map((x) => `Added ${what} ${quote(x)}`),
    ...removed.map((x) => `Removed ${what} ${quote(x)}`),
  ];
}

const fieldWords = (f: NotebookField) => [`${f.type}${f.unit ? ` in ${f.unit}` : ''}`, f.range ? 'range' : '', f.role ?? '', f.better ? `${f.better} is better` : ''].filter(Boolean).join(', ');
const stepWords = (s: Pick<NotebookStep, 'kind' | 'target' | 'agentId' | 'subject' | 'facts' | 'top' | 'shape'>) =>
  [`${s.kind}${s.target ? ` ${String(s.target)}` : ''}`, s.shape ?? '', s.subject ? `about ${s.subject}` : '', s.facts?.length ? `facts ${s.facts.join(', ')}` : '', s.top ? `top ${String(s.top)}` : '', s.agentId ? `with ${s.agentId}` : ''].filter(Boolean).join('; ');

/** The page's name: a ready-made one's label, the shortlist, or one drawn for it. Pure. */
export function pageName(layout: NotebookLayout | undefined): string {
  if (!layout) return 'Shortlist';
  const preset = layout.preset ? layoutPreset(layout.preset) : undefined;
  if (preset && JSON.stringify(preset.layout.components) === JSON.stringify(layout.components)) return preset.label;
  return 'Made for this notebook';
}

/** What an edit changes, one line each, in the setup's order. Pure. */
export function describeSetupChange(before: NotebookSetup, after: NotebookSetup, pageBefore?: NotebookLayout, pageAfter?: NotebookLayout | null): string[] {
  const out: string[] = [];
  if (before.title !== after.title) out.push(`Title: ${quote(before.title)} → ${quote(after.title)}`);
  if (before.statement !== after.statement) out.push(after.statement ? `What it's for: ${quote(after.statement)}` : 'Removed what it\'s for');
  out.push(...listChange('the limit', before.params, after.params));
  out.push(...listChange('done when', before.criteria, after.criteria));
  const fb = new Map(before.fields.map((f) => [f.key, f]));
  const fa = new Map(after.fields.map((f) => [f.key, f]));
  for (const f of after.fields) {
    const was = fb.get(f.key);
    if (!was) out.push(`Notes a new fact: ${f.label} (${fieldWords(f)})`);
    else if (was.label !== f.label || fieldWords(was) !== fieldWords(f)) out.push(`Changed the fact ${was.label}: ${f.label} (${fieldWords(f)})`);
  }
  for (const f of before.fields) if (!fa.has(f.key)) out.push(`No longer notes ${f.label}`);
  out.push(...listChange('the check', before.checks, after.checks));
  if (before.stages.join('→') !== after.stages.join('→')) out.push(after.stages.length ? `Stages: ${after.stages.join(' → ')}` : 'Removed the stages');
  const sb = before.steps.map((s) => `${s.title} (${stepWords(s)})`);
  const sa = after.steps.map((s) => `${s.title} (${stepWords(s)})`);
  if (sb.join('\n') !== sa.join('\n')) {
    const keptTitles = new Set(before.steps.map((s) => norm(s.title)));
    const newTitles = new Set(after.steps.map((s) => norm(s.title)));
    after.steps.forEach((s, i) => {
      const was = before.steps.find((w) => norm(w.title) === norm(s.title));
      if (!keptTitles.has(norm(s.title))) out.push(`Added step ${String(i + 1)}: ${s.title} (${stepWords(s)})`);
      else if (was && stepWords(was) !== stepWords(s)) out.push(`Changed step ${quote(s.title)}: ${stepWords(s)}`);
    });
    for (const s of before.steps) if (!newTitles.has(norm(s.title))) out.push(`Removed step ${quote(s.title)}`);
    const order = (list: readonly NotebookStep[]) => list.map((s) => norm(s.title)).filter((t) => keptTitles.has(t) && newTitles.has(t)).join('\n');
    if (order(before.steps) !== order(after.steps)) out.push(`Steps in a new order: ${after.steps.map((s) => s.title).join(' → ')}`);
  }
  out.push(...listChange('the agent', before.pipeline, after.pipeline));
  if (before.cadence !== after.cadence) out.push(after.cadence ? `Runs on a schedule: ${after.cadence}` : 'No longer runs on a schedule');
  if (pageAfter !== undefined && JSON.stringify(pageBefore ?? null) !== JSON.stringify(pageAfter ?? null)) {
    const a = pageName(pageAfter ?? undefined);
    const b = pageName(pageBefore);
    const why = pageAfter?.about && a === 'Made for this notebook' ? ` (${pageAfter.about})` : '';
    out.push(a === b ? `How it looks: changed${why}` : `How it looks: ${b} → ${a}${why}`);
  }
  return out;
}

// ---- Steps keep how far they got ----------------------------------------------

type StepIn = Pick<NotebookStep, 'title' | 'kind'> & Partial<Pick<NotebookStep, 'target' | 'agentId' | 'facts' | 'subject' | 'top' | 'shape'>>;

/**
 * New steps against the ones it had: a step with the same title (else the
 * same kind in the same place) is that step, keeping its id and how far it
 * got; the rest are new. Pure.
 */
export function keepStepProgress(was: readonly NotebookStep[], next: readonly StepIn[]): NotebookStep[] {
  const used = new Set<string>();
  const out = next.map((s, i) => {
    const same = was.find((w) => !used.has(w.id) && norm(w.title) === norm(s.title))
      ?? (was[i] && !used.has(was[i].id) && was[i].kind === s.kind ? was[i] : undefined);
    if (same) used.add(same.id);
    const { target: _t, agentId: _a, facts: _f, subject: _s, top: _p, shape: _h, ...base } = same ?? { id: '', status: 'todo' as const, tries: 0 };
    return {
      ...base, title: s.title, kind: s.kind,
      ...(s.target !== undefined ? { target: s.target } : {}), ...(s.agentId ? { agentId: s.agentId } : {}),
      ...(s.facts?.length ? { facts: s.facts } : {}), ...(s.subject ? { subject: s.subject } : {}), ...(s.top ? { top: s.top } : {}),
      ...(s.shape ? { shape: s.shape } : {}),
    } as NotebookStep;
  });
  // New ones get their ids from cleanSteps, after the kept ones' (which it keeps).
  return cleanSteps(out, was.filter((w) => used.has(w.id)));
}

// ---- The notebook as a document (the Prompt tab) --------------------------------

const PAGE = 'How it looks';
const SECTIONS = ['Limits', 'Done when', 'Facts each option notes', 'Checks', 'Steps', 'Stages', 'Agents and schedule', PAGE] as const;

/** A notebook's setup as markdown: a title, what it's for, then a section each. Pure. */
export function notebookToMarkdown(setup: NotebookSetup, layout: NotebookLayout | undefined): string {
  const lines: string[] = [`# ${setup.title}`, ''];
  if (setup.statement) lines.push(setup.statement, '');
  const section = (name: string, body: string[]) => { lines.push(`## ${name}`, ...(body.length ? body : ['']), ''); };
  section('Limits', setup.params.map((p) => `- ${p}`));
  section('Done when', setup.criteria.map((c) => `- [${setup.met[c] ? 'x' : ' '}] ${c}`));
  section('Facts each option notes', setup.fields.map((f) => `- ${f.label}: ${fieldWords(f)}`));
  section('Checks', setup.checks.map((c) => `- ${c}`));
  section('Steps', setup.steps.map((s, i) => `${String(i + 1)}. ${s.title} (${stepWords(s)})`));
  section('Stages', setup.stages.length ? [setup.stages.join(' → ')] : []);
  section('Agents and schedule', [`- Agents: ${setup.pipeline.join(', ') || 'none'}`, `- Schedule: ${setup.cadence || 'when you ask'}`]);
  section(PAGE, [pageName(layout)]);
  return `${lines.join('\n').trimEnd()}\n`;
}

const slugKey = (label: string) => label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'fact';

function parseField(line: string, base: readonly NotebookField[]): NotebookField | undefined {
  const m = /^(.+?)\s*:\s*(.+)$/.exec(line);
  const label = (m ? m[1] : line).trim();
  if (!label) return undefined;
  const was = base.find((f) => norm(f.label) === norm(label));
  const words = (m ? m[2] : '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
  let type: string | undefined;
  let unit: string | undefined;
  let range = false;
  let role: string | undefined;
  let better: 'higher' | 'lower' | undefined;
  for (const w of words) {
    const t = /^(money|number|text|url|image|date)(?:\s+in\s+(.+))?$/.exec(w);
    if (t) { type = t[1]; unit = t[2]; continue; }
    if (w === 'range') { range = true; continue; }
    const b = /^(higher|lower)( is better)?$/.exec(w);
    if (b) { better = b[1] as 'higher' | 'lower'; continue; }
    if ((NOTEBOOK_FIELD_ROLES as readonly string[]).includes(w)) role = w;
  }
  const raw = { key: was?.key ?? slugKey(label), label, type: type ?? was?.type ?? 'text', ...(unit ? { unit } : {}), ...(range ? { range } : {}), ...(role ? { role } : {}), ...(better ? { better } : {}) };
  return cleanFields([raw])[0];
}

function parseStep(line: string, agentIds: ReadonlySet<string>): StepIn | undefined {
  const m = /^(.+?)\s*\(([^()]*)\)\s*$/.exec(line);
  const title = (m ? m[1] : line).trim();
  if (!title) return undefined;
  const parts = (m ? m[2] : '').split(';').map((p) => p.trim()).filter(Boolean);
  const head = /^([a-z]+)(?:\s+(\d+))?$/i.exec(parts[0] ?? '');
  const kind = head && (NOTEBOOK_STEP_KINDS as readonly string[]).includes(head[1].toLowerCase()) ? head[1].toLowerCase() as NotebookStep['kind'] : 'find';
  const out: StepIn = { title, kind, ...(head?.[2] ? { target: Number(head[2]) } : {}) };
  for (const p of parts.slice(head ? 1 : 0)) {
    const with_ = /^with\s+(\S+)$/i.exec(p);
    if (with_ && agentIds.has(with_[1])) out.agentId = with_[1];
    const about = /^about\s+(.+)$/i.exec(p);
    if (about) out.subject = about[1].trim();
    const facts = /^facts\s+(.+)$/i.exec(p);
    if (facts) out.facts = facts[1].split(',').map((x) => x.trim()).filter(Boolean);
    const top = /^top\s+(\d+)$/i.exec(p);
    if (top) out.top = Number(top[1]);
    if (/^(answer|plan)$/i.test(p) && kind === 'write') out.shape = p.toLowerCase() as 'answer' | 'plan';
  }
  return out;
}

/**
 * Markdown back to a setup, against the one it was made from: a section
 * left out stays as it was, one emptied is emptied. The page changes only
 * when the Page section names another ready-made page. Pure.
 */
export function notebookFromMarkdown(md: string, base: NotebookSetup, baseLayout: NotebookLayout | undefined, agentIds: ReadonlySet<string>): { setup: NotebookSetup; layout?: NotebookLayout | null } | { error: string } {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const titleAt = lines.findIndex((l) => /^#\s+\S/.test(l));
  if (titleAt < 0) return { error: 'It needs a title: a first line starting with "# ".' };
  const title = lines[titleAt].replace(/^#\s+/, '').trim().slice(0, 120);
  const sections = new Map<string, string[]>();
  const intro: string[] = [];
  let cur: string[] | undefined;
  for (const l of lines.slice(titleAt + 1)) {
    const h = /^##\s+(.+?)\s*$/.exec(l);
    if (h) {
      // "Page" is what the section was called before.
      const name = norm(h[1]) === 'page' ? PAGE : SECTIONS.find((s) => norm(s) === norm(h[1])) ?? h[1];
      cur = [];
      sections.set(name, cur);
      continue;
    }
    (cur ?? intro).push(l);
  }
  const items = (name: string) => sections.get(name)?.map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/^(?:[-*]|\d+[.)])\s+/, '').trim()).filter(Boolean);
  const setup: NotebookSetup = { ...base, title, statement: intro.join(' ').replace(/\s+/g, ' ').trim().slice(0, 500) };
  const limits = items('Limits');
  if (limits) setup.params = limits.slice(0, 20);
  const done = items('Done when');
  if (done) {
    const met: Record<string, boolean> = {};
    setup.criteria = done.map((d) => {
      const m = /^\[( |x|X)\]\s*(.+)$/.exec(d);
      const text = (m ? m[2] : d).trim();
      met[text] = m ? m[1].toLowerCase() === 'x' : (base.met[text] ?? false);
      return text;
    }).slice(0, 10);
    setup.met = met;
  }
  const facts = items('Facts each option notes');
  if (facts) setup.fields = facts.map((f) => parseField(f, base.fields)).filter((f): f is NotebookField => !!f).slice(0, 12);
  const checks = items('Checks');
  if (checks) setup.checks = checks.slice(0, 8);
  const steps = items('Steps');
  if (steps) setup.steps = keepStepProgress(base.steps, steps.map((s) => parseStep(s, agentIds)).filter((s): s is StepIn => !!s));
  const stages = items('Stages');
  if (stages) setup.stages = stages.flatMap((s) => s.split(/\s*(?:→|->|,)\s*/)).map((s) => s.trim()).filter(Boolean).slice(0, 8);
  for (const line of items('Agents and schedule') ?? []) {
    const a = /^agents?\s*:\s*(.*)$/i.exec(line);
    if (a) setup.pipeline = /^none$/i.test(a[1].trim()) ? [] : a[1].split(',').map((x) => x.trim()).filter((x) => agentIds.has(x) || base.pipeline.includes(x));
    const s = /^schedule\s*:\s*(.*)$/i.exec(line);
    if (s) {
      const c = s[1].trim();
      if (!c || /^when you ask$/i.test(c)) setup.cadence = '';
      else {
        try { validateScheduleInterval(c, {}); } catch { return { error: `"${c}" isn't a schedule sua understands. Use five fields, e.g. 0 7 * * *, or "when you ask".` }; }
        setup.cadence = c;
      }
    }
  }
  const page = items(PAGE)?.join(' ');
  let layout: NotebookLayout | null | undefined;
  if (page && norm(page) !== norm(pageName(baseLayout))) {
    const preset = NOTEBOOK_LAYOUT_PRESETS.find((p) => norm(p.label) === norm(page) || norm(p.id) === norm(page));
    if (preset) layout = preset.id === 'shortlist' ? null : preset.layout;
  }
  return { setup, ...(layout !== undefined ? { layout } : {}) };
}

/** Take the Prompt tab's markdown as the proposal (no model): the preview shows it. */
export function proposeFromMarkdown(ctx: Ctx, nb: Notebook, md: string): { changes: string[] } | { error: string } {
  const was = readEdit(ctx, nb.id);
  if (was?.status === 'working') return { error: 'sua is still making your last change. Try again in a moment.' };
  const base = was?.setup ?? setupOf(nb);
  const baseLayout = was?.layout === undefined ? nb.layout : was.layout ?? undefined;
  const parsed = notebookFromMarkdown(md, base, baseLayout, new Set(searchAgents(ctx).map((a) => a.id)));
  if ('error' in parsed) return parsed;
  const changes = describeSetupChange(base, parsed.setup, baseLayout, parsed.layout);
  const layout = parsed.layout !== undefined ? parsed.layout : was?.layout;
  writeEdit(ctx, nb.id, {
    setup: parsed.setup, ...(layout !== undefined ? { layout } : {}), status: 'ready', updatedAt: new Date().toISOString(),
    turns: [...(was?.turns ?? []), { you: 'You edited the prompt.', via: 'prompt', changes, ...(changes.length ? {} : { sua: 'Nothing changed.' }), at: new Date().toISOString() }],
  });
  return { changes };
}

// ---- Talk ------------------------------------------------------------------------

/** A request about how the page looks rather than what the notebook does. */
const ABOUT_THE_PAGE = /\b(page|layout|look|looks|show|shows|showing|display|top|bottom|first|section|part|header|photo|picture|cover|portrait|briefing|report|shortlist|dossier|table|chart|map|quotes?|agenda|column|columns|side|bigger|smaller|move|magazine|design)\b/i;

/**
 * Say what to change: sua changes the proposal in the background (the
 * drafter for the setup; the page agent too when it's about the page) and
 * the Edit page shows it when it's done.
 */
export function startEditTalk(ctx: Ctx, nb: Notebook, text: string): { ok: true } | { error: string } {
  const said = text.replace(/\s+/g, ' ').trim().slice(0, 600);
  if (!said) return { error: 'Say what to change first.' };
  const was = readEdit(ctx, nb.id);
  if (was?.status === 'working') return { error: 'sua is still making your last change.' };
  if (!ctx.notebookDrafterRun && !ensureSystemAgentCurrent(ctx, NOTEBOOK_DRAFTER_ID, 'notebook edits')) return { error: "sua couldn't start the notebook drafter." };
  const base = was?.setup ?? setupOf(nb);
  const turns = [...(was?.turns ?? []), { you: said, via: 'talk' as const, at: new Date().toISOString() }];
  const working: NotebookEdit = { setup: base, ...(was?.layout !== undefined ? { layout: was.layout } : {}), turns, status: 'working', updatedAt: new Date().toISOString() };
  writeEdit(ctx, nb.id, working);
  void talk(ctx, nb, said, working).catch(() => undefined);
  return { ok: true };
}

async function talk(ctx: Ctx, nb: Notebook, said: string, working: NotebookEdit): Promise<void> {
  const base = working.setup;
  const baseLayout = working.layout === undefined ? nb.layout : working.layout ?? undefined;
  const agents = searchAgents(ctx);
  const ids = new Set(agents.map((a) => a.id));
  const current: NotebookDraft = { ...base, steps: base.steps.map(({ id: _i, status: _s, tries: _t, note: _n, doneAt: _d, stalled: _st, movedOn: _m, ...rest }) => rest as NotebookStep) };
  const { result, error } = await runDrafter(ctx, ctx.notebookDrafterRun ? undefined : ctx.agentStore.getAgent(NOTEBOOK_DRAFTER_ID), {
    TEXT: (base.statement || base.title).slice(0, 1000),
    TODAY: new Date().toISOString().slice(0, 10),
    AGENTS: agents.length ? agents.map((a) => `${a.id}: ${a.description}`).join('\n') : '(none)',
    CURRENT: JSON.stringify(current),
    CHANGE: `${said}\n(Change only what this asks for and keep everything else exactly as it is. If it's only about how the notebook's page looks, change nothing.)`,
  });
  // Gone meanwhile (saved or discarded while sua worked): leave it.
  const now = readEdit(ctx, nb.id);
  if (!now || now.status !== 'working') return;
  const last = (patch: Partial<NotebookEditTurn>) => [...working.turns.slice(0, -1), { ...working.turns[working.turns.length - 1], ...patch }];
  const parsed = result ? parseNotebookDraft(result, ids) : { error: error ?? "sua didn't come back with a change." };
  if ('error' in parsed) {
    writeEdit(ctx, nb.id, { ...working, status: 'ready', turns: last({ error: `sua couldn't change it: ${parsed.error}` }) });
    return;
  }
  const setup: NotebookSetup = {
    title: parsed.title, statement: parsed.statement, params: parsed.params, criteria: parsed.criteria,
    met: Object.fromEntries(parsed.criteria.map((c) => [c, base.met[c] ?? false])),
    fields: keepFieldKeys(base.fields, parsed.fields), checks: parsed.checks, stages: parsed.stages, pipeline: parsed.pipeline, cadence: parsed.cadence,
    steps: keepStepProgress(base.steps, parsed.steps ?? base.steps),
  };
  let layout = working.layout;
  // About the page, or the notebook's own page and what it does changed: the page agent draws it again for the change.
  const shapeChanged = JSON.stringify([base.fields.map((f) => f.role), base.steps.map((s) => s.kind)]) !== JSON.stringify([setup.fields.map((f) => f.role), setup.steps.map((s) => s.kind)]);
  if (ABOUT_THE_PAGE.test(said) || (shapeChanged && (nb.layoutBy === 'notebook' || (!nb.layout && !nb.layoutBy)))) {
    const draft = proposedNotebook(nb, { ...working, setup });
    const drawn = await drawNotebookPage(draft, async (inputs) => runPage(ctx, inputs), { request: said, current: baseLayout });
    if ('layout' in drawn.answer) layout = drawn.answer.layout;
    else if ('keep' in drawn.answer && baseLayout) layout = null;
  }
  const changes = describeSetupChange(base, setup, baseLayout, layout === working.layout ? undefined : layout);
  // The drafter's why is about the setup: said only when the setup changed.
  const setupChanged = describeSetupChange(base, setup).length > 0;
  writeEdit(ctx, nb.id, {
    setup, ...(layout !== undefined ? { layout } : {}), status: 'ready', updatedAt: new Date().toISOString(),
    turns: last({ changes, ...(changes.length ? (parsed.why && setupChanged ? { sua: parsed.why } : {}) : { sua: "That didn't change anything. Say it another way, or edit the prompt." }) }),
  });
}

/** Fields the drafter kept keep their keys (so options' facts still line up), matched by key then label. */
function keepFieldKeys(was: readonly NotebookField[], next: readonly NotebookField[]): NotebookField[] {
  return next.map((f) => {
    if (was.some((w) => w.key === f.key)) return f;
    const same = was.find((w) => norm(w.label) === norm(f.label));
    return same ? { ...f, key: same.key } : f;
  });
}

const runPage = (ctx: Ctx, inputs: Record<string, string>) => runNotebookPageAgent(ctx, inputs);

// ---- How it looks --------------------------------------------------------------------

const sameLayout = (a: NotebookLayout | null | undefined, b: NotebookLayout | null | undefined) => JSON.stringify(a?.components ?? null) === JSON.stringify(b?.components ?? null);

/**
 * Pick a look (Edit's "How it looks"): a ready-made one by id, `shortlist`,
 * or `now` (back to the look it has). It goes in your changes, like any other.
 */
export function proposeLook(ctx: Ctx, nb: Notebook, look: string): { changes: string[] } | { error: string } {
  const was = readEdit(ctx, nb.id);
  if (was?.status === 'working') return { error: 'sua is still making your last change. Try again in a moment.' };
  let layout: NotebookLayout | null | undefined;
  if (look === 'now') layout = undefined;
  else if (look === 'shortlist') layout = null;
  else {
    const preset = layoutPreset(look);
    if (!preset) return { error: 'There\'s no such look.' };
    layout = preset.layout;
  }
  // The look it has already: no change to it.
  if (layout !== undefined && sameLayout(layout, nb.layout)) layout = undefined;
  const setup = was?.setup ?? setupOf(nb);
  const before = was?.layout === undefined ? nb.layout : was.layout ?? undefined;
  const changes = describeSetupChange(setup, setup, before, layout === undefined ? nb.layout ?? null : layout);
  writeEdit(ctx, nb.id, {
    setup, ...(layout !== undefined ? { layout } : {}), status: 'ready', updatedAt: new Date().toISOString(),
    turns: [...(was?.turns ?? []), { you: `Look like: ${look === 'now' ? 'as it is now' : pageName(layout ?? undefined)}.`, via: 'look', changes, ...(changes.length ? {} : { sua: 'That\'s how it looks already.' }), at: new Date().toISOString() }],
  });
  return { changes };
}

/** Let sua pick how it looks: the page agent decides from what it's for (in the background, like Talk). */
export function startEditPick(ctx: Ctx, nb: Notebook): { ok: true } | { error: string } {
  const was = readEdit(ctx, nb.id);
  if (was?.status === 'working') return { error: 'sua is still making your last change.' };
  const working: NotebookEdit = {
    setup: was?.setup ?? setupOf(nb), ...(was?.layout !== undefined ? { layout: was.layout } : {}), status: 'working', updatedAt: new Date().toISOString(),
    turns: [...(was?.turns ?? []), { you: 'Let sua pick how it looks.', via: 'look', at: new Date().toISOString() }],
  };
  writeEdit(ctx, nb.id, working);
  void (async () => {
    const before = working.layout === undefined ? nb.layout : working.layout ?? undefined;
    const drawn = await drawNotebookPage(proposedNotebook(nb, working), (inputs) => runPage(ctx, inputs));
    const now = readEdit(ctx, nb.id);
    if (!now || now.status !== 'working') return;
    const last = (patch: Partial<NotebookEditTurn>) => [...working.turns.slice(0, -1), { ...working.turns[working.turns.length - 1], ...patch }];
    if ('error' in drawn.answer) { writeEdit(ctx, nb.id, { ...working, status: 'ready', turns: last({ error: `sua couldn't draw one: ${drawn.answer.error}` }) }); return; }
    const picked: NotebookLayout | null = 'layout' in drawn.answer ? drawn.answer.layout : null;
    const layout = sameLayout(picked, nb.layout) ? undefined : picked;
    const changes = describeSetupChange(working.setup, working.setup, before, layout === undefined ? nb.layout ?? null : layout);
    const about = 'layout' in drawn.answer ? drawn.answer.layout.about : drawn.answer.about;
    writeEdit(ctx, nb.id, {
      setup: working.setup, ...(layout !== undefined ? { layout } : {}), status: 'ready', updatedAt: new Date().toISOString(),
      turns: last({ changes, sua: changes.length ? (about ? `It fits as ${about}.` : 'Here\'s a look that fits.') : 'The look it has fits what it\'s for.' }),
    });
  })().catch(() => undefined);
  return { ok: true };
}

// ---- Save ------------------------------------------------------------------------

/** Make the proposal the notebook. Returns what changed; throws when it can't be (a running step removed). */
export function saveEdit(ctx: Ctx, notebookId: string): { changes: string[]; notes: string[] } {
  const s = storeOf(ctx);
  const nb = s.get(notebookId);
  if (!nb) throw new Error('No such notebook.');
  const edit = readEdit(ctx, notebookId);
  if (!edit) throw new Error('There are no changes to save.');
  if (edit.status === 'working') throw new Error('sua is still making your last change.');
  const p = edit.setup;
  const before = setupOf(nb);
  // Its steps as they are now (one may have moved on while you edited), with your changes on top.
  const steps = keepStepProgress(nb.steps ?? [], p.steps);
  const running = nb.steps?.find((x) => x.status === 'running');
  if (running && !steps.some((x) => x.id === running.id)) throw new Error(`"${running.title}" is running. Stop it before removing it.`);
  if (p.cadence) validateScheduleInterval(p.cadence, {});
  const changes = describeSetupChange(before, { ...p, steps }, nb.layout, edit.layout);
  s.update(notebookId, { title: p.title, statement: p.statement, params: p.params, pipeline: p.pipeline, cadence: p.cadence });
  s.setCriteria(notebookId, p.criteria);
  const now = s.get(notebookId)!;
  now.criteria.forEach((c, i) => { if (p.met[c.text] !== undefined && p.met[c.text] !== c.met) s.markCriterion(notebookId, i, p.met[c.text]); });
  s.setStages(notebookId, p.stages);
  s.setChecks(notebookId, p.checks);
  s.setFields(notebookId, p.fields);
  let notes: string[] = [];
  if (JSON.stringify(steps) !== JSON.stringify(nb.steps ?? [])) {
    const fit = fitStepAgents(ctx, steps);
    s.setSteps(notebookId, fit.steps);
    confirmDoneStepsAndSay(ctx, notebookId);
    notes = fit.notes;
  }
  if (edit.layout !== undefined && JSON.stringify(edit.layout ?? null) !== JSON.stringify(nb.layout ?? null)) s.setLayout(notebookId, edit.layout, 'you');
  discardEdit(ctx, notebookId);
  return { changes, notes };
}

export { ABOUT_THE_PAGE };
