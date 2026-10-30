/**
 * Correcting a notebook in its conversation ("she's COO now, not VP Ops",
 * "that point is wrong, she never said that"). Triage hands the correction
 * over (`notebook-correct`); sua's correction agent (`notebook-correction`)
 * reads the notebook, every part with an id and a role (evidence, judgment,
 * rule), and says the smallest change meant and what it touches: keep,
 * reevaluate or invalidate, or the one question to ask. Code checks that
 * against the notebook and follows its links (what cites what), so nothing
 * downstream is missed and evidence isn't dropped by a judgment's change.
 * The change shows as a card (`notebook-correct-apply`); nothing changes
 * until you apply it.
 */
import { clipWords, extractTaggedJson, shortName, type InboxActionMeta, type InboxActionStatus, type Notebook, type NotebookAboutWho, type NotebookEntry, type NotebookStore } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { runDispatchedAgentToTerminal } from '../routes/inbox-engine.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { publishInboxEvent } from '../routes/inbox-shared.js';
import { notebookThread, notebooksOf, threadOptionFocus } from './notebook-chat.js';
import { strikePoints, writeBriefing } from './notebook-write.js';
import { reconcileStepCards } from './notebook-step-queue.js';
import { NOTEBOOK_CHECKER_ID, NOTEBOOK_WRITER_ID } from './notebook-step-agents.js';
import { formatFieldValue } from './field-format.js';
import { YOUR_PICTURE, keepGivenPicture } from './notebook-profile.js';
import { recheckOptions } from './notebook-steps.js';

type Ctx = ReturnType<typeof getContext>;

export const NOTEBOOK_CORRECTION_ID = 'notebook-correction';

export type CorrectionType = 'about-fact' | 'option-fact' | 'limit' | 'check' | 'criterion' | 'written' | 'other';
const TYPES: readonly CorrectionType[] = ['about-fact', 'option-fact', 'limit', 'check', 'criterion', 'written', 'other'];
export type CorrectionAction = 'keep' | 'reevaluate' | 'invalidate';
const ACTIONS: readonly CorrectionAction[] = ['keep', 'reevaluate', 'invalidate'];
/** What applying a correction can do yet (the others are worked out and said, not applied). */
const APPLIES: ReadonlySet<CorrectionType> = new Set(['about-fact', 'option-fact', 'limit', 'check', 'criterion', 'written']);

export interface CorrectionDelta { type: CorrectionType; target_id: string; old_value: string; new_value: string; label?: string }
/** `new_value`: another rule that changes with it (a limit and the check that applies it), and what it says now. */
export interface CorrectionImpact { object_id: string; action: CorrectionAction; reason: string; new_value?: string }
export interface Correction {
  semantic_delta: CorrectionDelta;
  impact: CorrectionImpact[];
  clarification_required: boolean;
  clarification_question: string;
}

/** One part of the notebook as the agent reads it. */
export interface CorrectionPart {
  id: string;
  role: 'evidence' | 'judgment' | 'rule';
  /** What it is, in a word: "fact", "option", "talking point"… */
  kind: string;
  text: string;
  /** What it rests on (option ids, "option:<id>"). */
  from?: string[];
  source?: string;
  quote?: string;
}

const line = (v: unknown, n = 300) => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '').replace(/\s+/g, ' ').trim().slice(0, n);
const lower = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const optionId = (id: string) => `option:${id}`;

/**
 * The notebook as parts, each with an id, role and what it rests on: its
 * rules (limits, checks, done-whens), what's known about them, its options
 * (each one's facts, check results, rule-out and pick), what sua wrote
 * (talking points, questions, findings, plan items) and its notes. Pure.
 */
/** The pictures a notebook keeps of them (a person's photo, a company's logo), where each came from. */
export type CorrectionPictures = Partial<Record<NotebookAboutWho, { sourceUrl: string; page?: string; why?: string }>>;

/** A part that's a picture of them, and facts that are only a picture's link (the page shows them as text). */
const PICTURE_KEY = 'photo';
const PICTURE_LINK_FACT = /^(image|photo_url|picture|headshot|portrait|profile_photo)$/;

export function picturesOf(store: NotebookStore, notebookId: string): CorrectionPictures {
  const out: CorrectionPictures = {};
  for (const who of ['person', 'company'] as const) {
    const p = store.aboutPhoto(notebookId, who);
    if (p) out[who] = { sourceUrl: p.sourceUrl, ...(p.page ? { page: p.page } : {}), ...(p.why ? { why: p.why } : {}) };
  }
  return out;
}

export function correctionParts(nb: Notebook, entries: readonly NotebookEntry[], focus?: string, pictures: CorrectionPictures = {}): CorrectionPart[] {
  const parts: CorrectionPart[] = [];
  nb.params.forEach((p, i) => parts.push({ id: `limit:${String(i)}`, role: 'rule', kind: 'limit', text: p }));
  nb.checks.forEach((c, i) => parts.push({ id: `check:${String(i)}`, role: 'rule', kind: 'check', text: c }));
  nb.criteria.forEach((c, i) => parts.push({ id: `criterion:${String(i)}`, role: 'rule', kind: 'done when', text: `${c.text}${c.met ? ' (met)' : ''}` }));
  for (const who of ['person', 'company'] as const) {
    const one = nb.about?.[who];
    if (!one) continue;
    for (const f of one.facts) {
      const open = one.conflicts?.find((c) => c.fact === f.key && !c.settled);
      const yours = one.conflicts?.find((c) => c.fact === f.key && c.settled?.by === 'you');
      parts.push({
        id: `about:${who}:${f.key}`, role: 'evidence', kind: `${who} fact`,
        text: `${one.name ? `${one.name}, ` : ''}${f.label}: ${f.value}${open ? ` (not settled: ${open.claims.map((c) => c.value).join(' or ')})` : ''}${yours ? ' (you said so)' : ''}`,
        ...(f.source ? { source: f.source } : {}), ...(f.quote ? { quote: f.quote } : {}),
      });
    }
    // The picture the page shows of them: a part of its own ("use this picture instead").
    const pic = pictures[who];
    if (pic) parts.push({ id: `about:${who}:${PICTURE_KEY}`, role: 'evidence', kind: who === 'person' ? 'photo' : 'logo', text: `${one.name ? `${one.name}, ` : ''}${who === 'person' ? 'Photo' : 'Logo'}: ${pic.sourceUrl}${pic.page ? ` (on ${pic.page})` : ''}${pic.why === YOUR_PICTURE ? ' (you picked it)' : ''}`, source: pic.page ?? pic.sourceUrl });
  }
  const checkIndex = (check: string) => nb.checks.findIndex((c) => lower(c) === lower(check));
  const options = entries.filter((e) => e.kind === 'option');
  // The ones in the running, then the newest of the rest (and the one they're looking at, always).
  const shown = [...options.filter((e) => !e.ruledOut || e.id === focus), ...options.filter((e) => e.ruledOut && e.id !== focus)].slice(0, 60);
  for (const o of shown) {
    const facts = nb.fields.filter((f) => o.data?.[f.key] !== undefined && o.data[f.key] !== '');
    parts.push({ id: optionId(o.id), role: 'evidence', kind: 'option', text: `${o.title}${o.stage ? ` [${o.stage}]` : ''}` });
    for (const f of facts) {
      const meta = o.factMeta?.[f.key];
      parts.push({
        id: `${optionId(o.id)}:${f.key}`, role: 'evidence', kind: 'option fact', text: `${o.title}, ${f.label}: ${line(formatFieldValue(f, o.data![f.key]), 200)}`,
        ...(meta?.source ? { source: meta.source } : {}), ...(meta?.quote ? { quote: meta.quote } : {}),
      });
    }
    for (const c of o.checked ?? []) {
      const i = checkIndex(c);
      if (i >= 0) parts.push({ id: `${optionId(o.id)}:check:${String(i)}`, role: 'judgment', kind: 'check passed', text: `${o.title} passes "${nb.checks[i]}"`, from: [optionId(o.id)] });
    }
    for (const [c, why] of Object.entries(o.failedChecks ?? {})) {
      const i = checkIndex(c);
      if (i >= 0) parts.push({ id: `${optionId(o.id)}:check:${String(i)}`, role: 'judgment', kind: 'check failed', text: `${o.title} fails "${nb.checks[i]}": ${line(why, 200)}`, from: [optionId(o.id)] });
    }
    // Ruled out by a check: that check's failure is a part of its own, like one it failed while picked.
    const failedBy = /Fails "([^"]+)"/.exec(o.ruledOut?.reason ?? '')?.[1];
    const fi = failedBy ? checkIndex(failedBy) : -1;
    if (fi >= 0 && !parts.some((p) => p.id === `${optionId(o.id)}:check:${String(fi)}`)) parts.push({ id: `${optionId(o.id)}:check:${String(fi)}`, role: 'judgment', kind: 'check failed', text: `${o.title} fails "${nb.checks[fi]}" (so it was ruled out)`, from: [optionId(o.id)] });
    if (o.ruledOut) parts.push({ id: `${optionId(o.id)}:ruled-out`, role: 'judgment', kind: o.ruledOut.gone ? 'gone' : 'ruled out', text: `${o.title} ruled out: ${line(o.ruledOut.reason, 200)}`, from: [optionId(o.id)] });
    if (o.chosenAt) parts.push({ id: `${optionId(o.id)}:pick`, role: 'judgment', kind: 'pick', text: `${o.title} is picked`, from: [optionId(o.id)] });
  }
  const cites = (from: readonly string[]) => (from.length ? { from: from.map(optionId) } : {});
  nb.briefing?.points.forEach((p, i) => parts.push({ id: `point:${String(i)}`, role: 'judgment', kind: 'talking point', text: `${p.text}${p.why ? ` (why: ${p.why})` : ''}${p.ask ? ` (ask: ${p.ask})` : ''}`, ...cites(p.from) }));
  nb.briefing?.questions.forEach((q, i) => parts.push({ id: `question:${String(i)}`, role: 'judgment', kind: 'question', text: q }));
  nb.answer?.findings.forEach((f, i) => parts.push({ id: `finding:${String(i)}`, role: 'judgment', kind: 'finding', text: f.text, ...cites(f.from) }));
  nb.plan?.items.forEach((x, i) => parts.push({ id: `plan:${String(i)}`, role: 'judgment', kind: 'plan item', text: `${x.when}: ${x.title}${x.detail ? ` (${x.detail})` : ''}`, ...cites(x.from) }));
  for (const e of entries.filter((x) => x.kind === 'note' || x.kind === 'evidence').slice(0, 20)) {
    parts.push({ id: `entry:${e.id}`, role: 'evidence', kind: e.kind, text: `${e.title}${e.body ? `: ${line(e.body, 200)}` : ''}` });
  }
  return parts;
}

/** What the correction agent reads. Pure. */
export function correctionInputs(nb: Notebook, entries: readonly NotebookEntry[], instruction: string, conversation: string, focus?: string, pictures: CorrectionPictures = {}): Record<string, string> {
  return {
    NOTEBOOK: JSON.stringify({ title: nb.title, for: nb.statement, ...(nb.about?.person ? { person: nb.about.person.name } : {}), ...(nb.about?.company ? { company: nb.about.company.name } : {}), parts: correctionParts(nb, entries, focus, pictures) }),
    INSTRUCTION: instruction,
    CONVERSATION: conversation,
    FOCUS: focus ? optionId(focus) : '',
  };
}

/** A <correction> block as one to use, or undefined. Pure. */
export function parseCorrection(result: string): Correction | undefined {
  const block = extractTaggedJson(result, 'correction');
  let raw: unknown;
  try { raw = block ? JSON.parse(block) : undefined; } catch { return undefined; }
  if (!raw || typeof raw !== 'object') return undefined;
  const v = raw as Record<string, unknown>;
  const d = (v.semantic_delta ?? {}) as Record<string, unknown>;
  const type = TYPES.find((t) => t === line(d.type)) ?? 'other';
  const label = line(d.label, 40);
  const impact = (Array.isArray(v.impact) ? v.impact : []).map((x): CorrectionImpact | undefined => {
    const o = (x ?? {}) as Record<string, unknown>;
    const action = ACTIONS.find((a) => a === line(o.action));
    const id = line(o.object_id, 120);
    return action && id ? { object_id: id, action, reason: line(o.reason, 200), ...(typeof o.new_value === 'string' && RULE_ID.test(id) ? { new_value: line(o.new_value) } : {}) } : undefined;
  }).filter((x): x is CorrectionImpact => !!x);
  return {
    semantic_delta: { type, target_id: line(d.target_id, 120), old_value: line(d.old_value), new_value: line(d.new_value), ...(label ? { label } : {}) },
    impact,
    clarification_required: v.clarification_required === true || v.clarification_required === 'true',
    clarification_question: line(v.clarification_question, 300),
  };
}

const STRENGTH: Record<CorrectionAction, number> = { keep: 0, reevaluate: 1, invalidate: 2 };
const RULE_ID = /^(limit|check|criterion):\d+$/;

/** The rules a correction changes: its target, when it's a rule, and any rule that changes with it. */
export function ruleChanges(c: Pick<Correction, 'semantic_delta' | 'impact'>): Array<{ id: string; value: string }> {
  const d = c.semantic_delta;
  return [
    ...(RULE_ID.test(d.target_id) && (d.type === 'limit' || d.type === 'check' || d.type === 'criterion') ? [{ id: d.target_id, value: d.new_value }] : []),
    ...c.impact.filter((x) => x.new_value !== undefined && x.action !== 'keep' && RULE_ID.test(x.object_id)).map((x) => ({ id: x.object_id, value: x.new_value! })),
  ];
}

/** What a checked correction comes to: the change and its impact, or the question to ask. */
export type CheckedCorrection = { correction: Correction } | { question: string };

/**
 * The agent's correction, checked against the notebook and completed: only
 * ids the notebook has (an unknown target is a question), what follows by
 * the notebook's own links added (an option's facts reach its check
 * results, rule-out, pick and whatever cites it; a fact about them reaches
 * what sua wrote that says its old value; a check reaches the options it
 * was checked on), and evidence never invalidated by another part's
 * change. Pure.
 */
export function checkCorrection(nb: Notebook, entries: readonly NotebookEntry[], c: Correction, focus?: string, pictures: CorrectionPictures = {}): CheckedCorrection {
  const ask = c.clarification_question || 'Which part of the notebook is wrong, and what should it say?';
  if (c.clarification_required) return { question: ask };
  const parts = correctionParts(nb, entries, focus, pictures);
  const byId = new Map(parts.map((p) => [p.id, p]));
  let d = c.semantic_delta;
  const m = /^about:(person|company):([a-z][a-z0-9_]{0,39})$/.exec(d.target_id);
  const target = byId.get(d.target_id);
  const ok = d.type === 'about-fact' ? !!m && !!nb.about?.[m[1] as NotebookAboutWho] && (!!target || !!d.new_value)
    : d.type === 'option-fact' ? !!target && target.kind === 'option fact'
      : d.type === 'limit' || d.type === 'check' || d.type === 'criterion' ? !!target && d.target_id.startsWith(`${d.type}:`)
        : d.type === 'written' ? !!target && /^(point|question|finding|plan):\d+$/.test(d.target_id)
          : false;
  if (!ok) return { question: ask };
  // A picture is changed to one at a link (the picture, or a page it's on), or taken out.
  const picture = d.type === 'about-fact' && m?.[2] === PICTURE_KEY;
  if (picture && d.new_value && !/^https?:\/\/\S+$/i.test(d.new_value.trim())) return { question: 'Send me a link to the picture to use: the picture itself, or a page it’s on.' };
  // Just the values, when the agent gave the part's whole text ("Extend, Salary: $225,000").
  const label = d.type === 'option-fact' ? nb.fields.find((f) => f.key === d.target_id.split(':')[2])?.label : d.type === 'about-fact' ? (d.label ?? target?.text.split(': ')[0].split(', ').at(-1)) : undefined;
  const bare = (v: string) => { const i = label ? v.lastIndexOf(`${label}: `) : -1; return i >= 0 ? v.slice(i + label!.length + 2).trim() : v; };
  if (label && !picture) c = { ...c, semantic_delta: { ...d, old_value: bare(d.old_value), new_value: bare(d.new_value) } };
  d = c.semantic_delta;
  if (d.type === 'about-fact' && !picture && target && lower(d.new_value) === lower(/: (.*?)(?: \(|$)/.exec(target.text)?.[1] ?? '')) return { question: `The notebook already says ${d.label ?? 'that'} is ${d.new_value}. What should change?` };

  const impact = new Map<string, CorrectionImpact>();
  const put = (x: CorrectionImpact) => {
    if (x.object_id === d.target_id || !byId.has(x.object_id)) return;
    const was = impact.get(x.object_id);
    if (!was || STRENGTH[x.action] > STRENGTH[was.action]) impact.set(x.object_id, { ...x, reason: x.reason || was?.reason || '', ...(was?.new_value !== undefined && x.new_value === undefined ? { new_value: was.new_value } : {}) });
  };
  for (const x of c.impact) put(x);
  // What follows by the notebook's own links.
  const written = parts.filter((p) => /^(point|question|finding|plan):/.test(p.id));
  if (d.type === 'about-fact' && d.old_value.length >= 3) {
    for (const p of written) if (lower(p.text).includes(lower(d.old_value))) put({ object_id: p.id, action: 'reevaluate', reason: `it says ${d.old_value}` });
  }
  if (d.type === 'option-fact') {
    const opt = d.target_id.replace(/^(option:[^:]+):.*$/, '$1');
    // The checks the agent says rest on it; none named, all of the option's (a check it missed would stay wrong).
    const named = c.impact.some((x) => x.object_id.startsWith(`${opt}:check:`));
    for (const p of parts) {
      if ((p.id.startsWith(`${opt}:check:`) && !named) || p.id === `${opt}:ruled-out` || p.id === `${opt}:pick`) put({ object_id: p.id, action: 'reevaluate', reason: 'it rests on the corrected fact' });
      else if (p.from?.includes(opt) && written.includes(p)) put({ object_id: p.id, action: 'reevaluate', reason: 'it cites that option' });
    }
  }
  // A check that changes (the target, or one that changes with it): its results on each option. Not on one you ruled out: that stays your call.
  const yours = new Set(entries.filter((e) => e.ruledOut?.by === 'you').map((e) => optionId(e.id)));
  for (const r of ruleChanges({ semantic_delta: d, impact: [...impact.values()] }).filter((x) => x.id.startsWith('check:'))) {
    const i = r.id.slice('check:'.length);
    for (const p of parts) if (p.id.endsWith(`:check:${i}`) && !yours.has(p.id.replace(/:check:\d+$/, ''))) put({ object_id: p.id, action: 'reevaluate', reason: 'it was checked against the old check' });
  }
  // Evidence stays unless the change is to that very fact.
  for (const [id, x] of impact) {
    if (byId.get(id)?.role === 'evidence' && x.action === 'invalidate') impact.set(id, { ...x, action: 'reevaluate' });
  }
  // A picture's link kept as a fact about them is the picture, not a fact: it goes with the picture's change.
  if (picture) {
    for (const p of parts) {
      const k = /^about:(?:person|company):(.+)$/.exec(p.id)?.[1];
      if (k && PICTURE_LINK_FACT.test(k) && p.id.startsWith(`about:${m![1]}:`)) impact.set(p.id, { object_id: p.id, action: 'invalidate', reason: "a picture's link, not a fact about them" });
    }
  }
  // Something sua wrote that's wrong is itself what changes: rewritten, or out.
  const list = [...impact.values()];
  if (d.type === 'written' && !list.some((x) => x.object_id === d.target_id)) list.unshift({ object_id: d.target_id, action: d.new_value ? 'reevaluate' : 'invalidate', reason: "you said it's wrong" });
  return { correction: { ...c, impact: list } };
}

/** The part's words, as the agent read them (what applying finds it by). */
const partText = (nb: Notebook, entries: readonly NotebookEntry[], id: string) => correctionParts(nb, entries).find((p) => p.id === id)?.text ?? id;
/** Its words on the card: a point without its why and question. */
const cardText = (text: string) => text.split(/ \((?:why|ask): /)[0];

/** A rule's name on the card. */
const RULE_WORDS: Partial<Record<CorrectionType, string>> = { limit: 'Limit', check: 'Check', criterion: 'Done when' };

/** An option as the card and sua's words name it: its company ("Extend"), else its short name. */
function optionName(nb: Pick<Notebook, 'fields'>, o: Pick<NotebookEntry, 'title' | 'data'>): string {
  const org = nb.fields.find((f) => f.role === 'org')?.key;
  const v = org ? o.data?.[org] : undefined;
  return typeof v === 'string' && v.trim() ? v.trim() : clipWords(shortName(o.title), 40);
}

/** The card's rows and its one line: the change, what it redoes or drops, and that the rest stays. Pure. */
export function describeCorrection(nb: Notebook, entries: readonly NotebookEntry[], c: Correction): { rows: Array<{ what: string; before: string; after: string }>; summary: string } {
  const d = c.semantic_delta;
  // An option's fact is named with the option, short ("Extend, Salary").
  const [, optId, key] = d.type === 'option-fact' ? d.target_id.split(':') : [];
  const opt = optId ? entries.find((e) => e.id === optId) : undefined;
  const who = opt ? optionName(nb, opt) : 'option';
  const name = d.type === 'option-fact' ? `${who}, ${nb.fields.find((f) => f.key === key)?.label ?? key}`
    : RULE_WORDS[d.type] ?? (d.label || (d.type === 'written' ? cardText(partText(nb, entries, d.target_id)) : d.type.replace('-', ' ')));
  const rows: Array<{ what: string; before: string; after: string }> = [];
  // A rule's words as the notebook has them (the agent may say less).
  // A picture's link reads as where it is ("the picture on gregmeyer.com").
  const picture = d.type === 'about-fact' && d.target_id.endsWith(`:${PICTURE_KEY}`);
  const asSite = (u: string) => { if (!picture || !u) return u; try { return `the picture on ${new URL(u).hostname.replace(/^www\./, '')}`; } catch { return u; } };
  const old = RULE_WORDS[d.type] ? cardText(partText(nb, entries, d.target_id)).replace(/ \(met\)$/, '') : asSite(d.old_value);
  const now = asSite(d.new_value);
  if (d.type !== 'written') rows.push({ what: d.type === 'about-fact' ? (d.label ?? 'fact') : d.type === 'option-fact' ? name : RULE_WORDS[d.type]?.toLowerCase() ?? d.type, before: old || '—', after: now || '(take it out)' });
  const touched = c.impact.filter((x) => x.action !== 'keep');
  // Each touched part's row: evidence it flags isn't changed (only you or a new look change what was found), said so.
  const whatOf = (id: string, action: CorrectionAction) => RULE_ID.test(id) ? 'rule' : action === 'invalidate' && id.startsWith('about:') ? 'take out' : /^(about|entry):|^option:[^:]+(:(?!check:|ruled-out$|pick$)[^:]+)?$/.test(id) ? 'may be out of date'
    : action === 'invalidate' ? 'take out' : /^(point|finding|plan):/.test(id) ? 'rewrite' : /^question:/.test(id) ? 'take out' : 'look again';
  const all = touched.map((x) => ({ x, what: whatOf(x.object_id, x.action) }));
  // A changed check can touch every option: the first few by name, then how many more.
  const isResult = (id: string) => /^option:[^:]+:check:\d+$/.test(id);
  const shown = all.filter(({ x }, i) => !isResult(x.object_id) || all.slice(0, i).filter((y) => isResult(y.x.object_id)).length < 5);
  for (const { x, what } of shown) {
    // A rule that changes with it shows its change; one only to look at, why.
    if (what === 'rule') rows.push({ what: RULE_WORDS[x.object_id.split(':')[0] as CorrectionType]!.toLowerCase(), before: cardText(partText(nb, entries, x.object_id)).replace(/ \(met\)$/, ''), after: x.new_value === undefined ? `look at it: ${x.reason || 'it rests on this'}` : x.new_value || '(take it out)' });
    else rows.push({ what, before: cardText(partText(nb, entries, x.object_id)).slice(0, 160), after: x.reason || '—' });
  }
  const more = all.length - shown.length;
  if (more) rows.push({ what: 'look again', before: '—', after: `and ${String(more)} more option${more === 1 ? '' : 's'}' results for it` });
  const counts = (['rewrite', 'take out', 'look again', 'may be out of date'] as const).map((w) => [w, all.filter((r) => r.what === w).length] as const).filter(([, n]) => n);
  // A changed check is checked on every option (not listed: it's all of them).
  const rules = all.filter((r) => r.what === 'rule' && r.x.new_value !== undefined).length;
  const againstAll = [
    ...(rules ? [`changes ${String(rules)} more rule${rules === 1 ? '' : 's'} with it`] : []),
    ...(ruleChanges(c).some((r) => r.id.startsWith('check:') && r.value) ? ['checks the options against it'] : []),
  ];
  const changes = [...againstAll, ...counts.map(([w, n]) => w === 'may be out of date' ? `flags ${String(n)} that may be out of date` : `${w === 'rewrite' ? 'rewrites' : w === 'take out' ? 'takes out' : 'looks again at'} ${String(n)}`)].join(', ');
  // A count of every part kept (facts, check results…) means nothing to read: say the rest stays.
  const head = d.type === 'written'
    ? `"${name.slice(0, 80)}" is wrong`
    : `${d.type === 'option-fact' || RULE_WORDS[d.type] ? name : d.label ?? name}: ${old || '—'} → ${now || 'taken out'}`;
  rows.push({ what: 'keeps', before: '—', after: touched.length ? 'everything else in the notebook as it is' : 'everything else: nothing rests on it' });
  return { rows, summary: `${head}. ${changes ? `${capital(changes)}; everything else stays as it is.` : 'Nothing else changes.'}` };
}

/** The last few turns of the thread, oldest first, for what "that one" means. */
function recentTurns(ctx: Ctx, threadId: string): string {
  const said = (ctx.inboxStore?.listResponses(threadId) ?? []).filter((r) => r.role === 'user' || r.role === 'triage').slice(-6);
  return said.map((r) => `${r.role === 'user' ? 'Them' : 'sua'}: ${r.body.replace(/\s+/g, ' ').slice(0, 600)}`).join('\n');
}

async function runCorrectionAgent(ctx: Ctx, inputs: Record<string, string>): Promise<{ result?: string; error?: string }> {
  if (ctx.notebookCorrectionRun) return { result: await ctx.notebookCorrectionRun(inputs) };
  if (!ensureSystemAgentCurrent(ctx, NOTEBOOK_CORRECTION_ID, 'notebook corrections')) return { error: `${NOTEBOOK_CORRECTION_ID} isn't installed` };
  const agent = ctx.agentStore.getAgent(NOTEBOOK_CORRECTION_ID)!;
  const run = await runDispatchedAgentToTerminal(ctx, agent, inputs);
  return run.status === 'completed' ? { result: run.result } : { error: run.error ?? run.status };
}

function say(ctx: Ctx, threadId: string, words: string): void {
  const msg = ctx.inboxStore!.addResponse(threadId, 'triage', words);
  publishInboxEvent(ctx, threadId, 'message:created', { responseId: msg.id, role: 'triage', body: msg.body, createdAt: msg.createdAt });
}

/**
 * Triage's `notebook-correct`: work out what the correction changes, in the
 * background (it changes nothing), then post the card to apply it, or the
 * question. Returns at once.
 */
export function startNotebookCorrection(ctx: Ctx, messageId: string, meta: InboxActionMeta, done?: (p: Promise<void>) => void): { status: InboxActionStatus; summary?: string; refusalReason?: string } {
  const store = notebooksOf(ctx);
  const nb = store.get(meta.inputs.NOTEBOOK ?? '');
  if (!nb) return { status: 'failed', refusalReason: 'That notebook is gone.' };
  const instruction = (meta.inputs.INSTRUCTION ?? '').trim();
  if (!instruction) return { status: 'failed', refusalReason: 'notebook-correct needs inputs.INSTRUCTION: what they said is wrong.' };
  const focus = threadOptionFocus(ctx.inboxStore?.get(messageId)?.contextJson);
  const work = (async () => {
    const entries = store.entries(nb.id, 1000);
    const { result, error } = await runCorrectionAgent(ctx, correctionInputs(nb, entries, instruction, recentTurns(ctx, messageId), focus, picturesOf(store, nb.id)));
    const c = result ? parseCorrection(result) : undefined;
    if (!c) {
      say(ctx, messageId, `I couldn't work out what that changes in the notebook${error ? ` (${error.slice(0, 160)})` : ''}. Nothing changed. Say which part is wrong and what it should be.`);
      return;
    }
    const now = store.get(nb.id) ?? nb;
    const nowEntries = store.entries(nb.id, 1000);
    const checked = checkCorrection(now, nowEntries, c, focus, picturesOf(store, nb.id));
    if ('question' in checked) {
      say(ctx, messageId, checked.question);
      ctx.inboxStore?.updateStatus(messageId, 'awaiting_user');
      return;
    }
    const { rows, summary } = describeCorrection(now, nowEntries, checked.correction);
    if (!APPLIES.has(checked.correction.semantic_delta.type)) {
      say(ctx, messageId, `${summary}\n\nI can't apply that kind of correction from here yet. Change it on the notebook's Edit page.`);
      return;
    }
    const action: InboxActionMeta = {
      kind: 'action', status: 'proposed', agentId: 'notebook-correct-apply', effect: 'write',
      inputs: { NOTEBOOK: nb.id, NOTEBOOK_TITLE: now.title, INSTRUCTION: instruction, CORRECTION: JSON.stringify(checked.correction), TEXTS: JSON.stringify(Object.fromEntries([checked.correction.semantic_delta.target_id, ...checked.correction.impact.map((x) => x.object_id)].map((id) => [id, partText(now, nowEntries, id)]))) },
      rationale: summary, surfaceChanges: rows, ctaLabel: 'Apply',
    };
    const resp = ctx.inboxStore!.addResponse(messageId, 'action', summary, JSON.stringify(action));
    publishInboxEvent(ctx, messageId, 'action:created', { responseId: resp.id, agentId: action.agentId, rationale: summary, inputs: action.inputs, createdAt: resp.createdAt });
    ctx.inboxStore?.updateStatus(messageId, 'awaiting_user');
  })().catch((err: unknown) => {
    try { say(ctx, messageId, `I couldn't work out what that changes: ${err instanceof Error ? err.message.slice(0, 160) : 'it failed'}. Nothing changed.`); } catch { /* the thread is gone */ }
  });
  done?.(work);
  return { status: 'completed', summary: 'Working out what that changes in the notebook…' };
}

/** Its index in what's there now, by the words it had when the card was made (you may have edited since). */
function placeNow(items: readonly string[], id: string, texts: Record<string, string>): number {
  const was = texts[id];
  if (was === undefined) return -1;
  return items.findIndex((t) => t === was || was.startsWith(t));
}

/**
 * Apply a correction card: the fact changes now (kept as yours, so research
 * doesn't change it back), what's wrong comes out of what sua wrote, and
 * what rests on the old value is written again in the background. Says
 * what it did; the rewrite says its own.
 */
export function applyNotebookCorrection(ctx: Ctx, messageId: string, meta: InboxActionMeta, done?: (p: Promise<void>) => void): { status: InboxActionStatus; summary?: string; refusalReason?: string } {
  const store = notebooksOf(ctx);
  const nb = store.get(meta.inputs.NOTEBOOK ?? '');
  if (!nb) return { status: 'failed', refusalReason: 'That notebook is gone.' };
  let c: Correction;
  let texts: Record<string, string>;
  try {
    c = JSON.parse(meta.inputs.CORRECTION ?? '') as Correction;
    texts = JSON.parse(meta.inputs.TEXTS ?? '{}') as Record<string, string>;
  } catch { return { status: 'failed', refusalReason: 'The correction on this card can\'t be read. Ask again.' }; }
  const d = c.semantic_delta;
  if (!APPLIES.has(d.type)) return { status: 'failed', refusalReason: 'sua can\'t apply that kind of correction yet.' };
  if (ctx.notebookPipelines?.has(nb.id)) return { status: 'failed', refusalReason: 'The notebook is running a step. Apply this when it\'s done.' };
  const said: string[] = [];
  // A picture at a link to keep (fetched in the background).
  let pictureLink: { who: NotebookAboutWho; link: string } | undefined;
  try {
    if (d.type === 'about-fact' && d.target_id.endsWith(`:${PICTURE_KEY}`)) {
      const who = d.target_id.split(':')[1] as NotebookAboutWho;
      const word = who === 'person' ? 'photo' : 'logo';
      if (d.new_value) pictureLink = { who, link: d.new_value.trim() };
      else said.push(store.rejectAboutPhoto(nb.id, who) ? `took out the ${word}; it won't be used again` : `there was no ${word} to take out`);
      // A picture's link kept as a fact goes (it isn't a fact about them).
      const links = c.impact.filter((x) => x.action === 'invalidate' && PICTURE_LINK_FACT.test(x.object_id.split(':')[2] ?? '') && x.object_id.startsWith(`about:${who}:`) && nb.about?.[who]?.facts.some((f) => f.key === x.object_id.split(':')[2]));
      for (const x of links) store.correctAbout(nb.id, who, x.object_id.split(':')[2], { value: '', why: meta.inputs.INSTRUCTION });
      if (links.length) said.push(`took out the picture's link from what it knows about them`);
    } else if (d.type === 'about-fact') {
      const [, who, key] = d.target_id.split(':') as [string, NotebookAboutWho, string];
      store.correctAbout(nb.id, who, key, { value: d.new_value, ...(d.label ? { label: d.label } : {}), why: meta.inputs.INSTRUCTION });
      said.push(d.new_value ? `${d.label ?? key.replace(/_/g, ' ')} is ${d.new_value} now, as you said` : `took out ${d.label ?? key.replace(/_/g, ' ')}`);
    }
    if (d.type === 'option-fact') {
      // option:<entry id>:<field key>
      const [, entryId, key] = d.target_id.split(':');
      const field = nb.fields.find((f) => f.key === key);
      const { entry, changed } = store.correctOption(nb.id, entryId, { [key]: d.new_value }, 'you');
      said.push(changed.length ? `${optionName(nb, entry)}'s ${(field?.label ?? key).toLowerCase()} is ${field ? formatFieldValue(field, changed[0].to) : String(changed[0].to)} now, as you said` : `${optionName(nb, entry)} already says that`);
    }
    // Each rule that changes (the target, and any that changes with it), found by its words when the card was made.
    const rules = ruleChanges(c);
    for (const r of rules) {
      const kind = r.id.split(':')[0] as 'limit' | 'check' | 'criterion';
      const now = store.get(nb.id)!;
      const list = kind === 'limit' ? now.params : kind === 'check' ? now.checks : now.criteria.map((x) => x.text);
      const at = placeNow(list, r.id, texts);
      if (at < 0) {
        if (r.id === d.target_id) return { status: 'failed', refusalReason: 'That rule has changed since this was worked out. Ask again.' };
        continue;
      }
      const was = list[at];
      const next = r.value ? list.map((x, j) => (j === at ? r.value : x)) : list.filter((_, j) => j !== at);
      if (kind === 'limit') store.update(nb.id, { params: next });
      else if (kind === 'check') store.setChecks(nb.id, next);
      else store.setCriteria(nb.id, next);
      const word = kind === 'criterion' ? 'done-when' : kind;
      said.push(r.value ? `the ${word} "${was}" is "${r.value}" now` : `took out the ${word} "${was}"`);
    }
    if (rules.some((r) => r.id.startsWith('limit:'))) said.push('the next search uses it');
  } catch (err) {
    return { status: 'failed', refusalReason: err instanceof Error ? err.message : String(err) };
  }
  const touched = (prefix: string, action?: CorrectionAction) => c.impact.filter((x) => x.object_id.startsWith(`${prefix}:`) && x.action !== 'keep' && (!action || x.action === action));
  const fresh = store.get(nb.id)!;
  // Questions that rest on the wrong fact come out (there are more to ask).
  const b = fresh.briefing;
  if (b) {
    const out = new Set(touched('question').map((x) => placeNow(b.questions, x.object_id, texts)).filter((i) => i >= 0));
    if (out.size) {
      store.setBriefing(nb.id, { ...b, questions: b.questions.filter((_, i) => !out.has(i)) }, { swap: true });
      said.push(`took out ${String(out.size)} question${out.size === 1 ? '' : 's'}`);
    }
  }
  const points = (store.get(nb.id)!.briefing?.points ?? []).map((p) => p.text);
  // The ones to write again first: the writer writes new ones in the places of the first struck.
  const strike = touched('point').map((x) => ({ at: placeNow(points, x.object_id, texts), redo: x.action === 'reevaluate' })).filter((x) => x.at >= 0).sort((x, y) => Number(y.redo) - Number(x.redo));
  // Findings and plan items that are wrong come out, remembered so they aren't written again.
  for (const [prefix, kind] of [['finding', 'answer'], ['plan', 'plan']] as const) {
    const now = store.get(nb.id)!;
    const items = kind === 'answer' ? now.answer?.findings.map((f) => f.text) ?? [] : now.plan?.items.map((i) => `${i.when}: ${i.title}${i.detail ? ` (${i.detail})` : ''}`) ?? [];
    const out = new Set(touched(prefix).map((x) => placeNow(items, x.object_id, texts)).filter((i) => i >= 0));
    if (!out.size) continue;
    if (kind === 'answer' && now.answer) {
      const gone = now.answer.findings.filter((_, i) => out.has(i)).map((f) => f.text);
      store.setAnswer(nb.id, { ...now.answer, findings: now.answer.findings.filter((_, i) => !out.has(i)), struck: [...(now.answer.struck ?? []), ...gone] }, { swap: true });
    } else if (now.plan) {
      const gone = now.plan.items.filter((_, i) => out.has(i)).map((x) => x.title);
      store.setPlan(nb.id, { ...now.plan, items: now.plan.items.filter((_, i) => !out.has(i)), struck: [...(now.plan.struck ?? []), ...gone] }, { swap: true });
    }
    said.push(`took out ${String(out.size)} ${kind === 'answer' ? 'finding' : 'plan item'}${out.size === 1 ? '' : 's'}`);
  }
  // Options whose check results, rule-out or pick rest on it: those results are forgotten and they're checked again.
  const recheck = new Map<string, Set<string>>();
  for (const x of c.impact) {
    const m = /^option:([^:]+):(check:(\d+)|ruled-out|pick)$/.exec(x.object_id);
    if (!m || x.action === 'keep') continue;
    const checks = recheck.get(m[1]) ?? new Set<string>();
    if (m[3] !== undefined && nb.checks[Number(m[3])]) checks.add(nb.checks[Number(m[3])]);
    recheck.set(m[1], checks);
  }
  const optionNow = (id: string) => store.entries(nb.id, 1000).find((e) => e.id === id && e.kind === 'option');
  for (const [id, checks] of [...recheck]) {
    const o = optionNow(id);
    if (!o) { recheck.delete(id); continue; }
    if (checks.size) store.clearChecks(nb.id, id, [...checks]);
    // Ruled out by sua's checks (not by you, and not gone): back in, to be checked again.
    // Ruled out by sua (not you, and not gone), on what's corrected or on a check that changed: back in.
    const byCheck = /Fails "([^"]+)"/.exec(o.ruledOut?.reason ?? '')?.[1]?.toLowerCase();
    if (o.ruledOut && o.ruledOut.by !== 'you' && !o.ruledOut.gone && (c.impact.some((x) => x.object_id === `option:${id}:ruled-out` && x.action !== 'keep') || (!!byCheck && [...checks].some((k) => k.toLowerCase() === byCheck)))) {
      store.reinstate(nb.id, id);
      said.push(`brought ${optionName(fresh, o)} back to check it again`);
    }
  }
  const pointStep = fresh.steps?.find((s) => s.kind === 'write' && !s.shape);
  const rewriteWhole = (['answer', 'plan'] as const).filter((shape) => touched(shape === 'answer' ? 'finding' : 'plan', 'reevaluate').length && fresh.steps?.some((s) => s.kind === 'write' && s.shape === shape));
  const redo = strike.filter((x) => x.redo).length;
  // A check that changed applies to every option: all of them (in the check step's top N) are checked on it.
  const recheckAll = ruleChanges(c).some((r) => r.id.startsWith('check:') && !!r.value) && !!fresh.steps?.some((s) => s.kind === 'check');
  if (!strike.length && !rewriteWhole.length && !recheck.size && !recheckAll && !pictureLink) {
    store.noteRun(nb.id, `Corrected: ${said.join('; ')}`);
    return { status: 'completed', summary: `${capital(said.join('; ') || 'nothing to change')}.` };
  }
  // The rest is the checker's and the writer's: one run at a time, like Write again.
  ctx.notebookPipelines ??= new Map();
  const running = { agentId: recheck.size || recheckAll ? NOTEBOOK_CHECKER_ID : NOTEBOOK_WRITER_ID, step: 0, of: fresh.steps?.length ?? 0, startedAt: Date.now(), again: true };
  ctx.notebookPipelines.set(nb.id, running);
  const work = (async () => {
    const out: string[] = [];
    if (pictureLink) {
      const r = await keepGivenPicture(ctx, store, nb.id, pictureLink.who, pictureLink.link);
      const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
      out.push('from' in r ? `kept the ${pictureLink.who === 'person' ? 'photo' : 'logo'} from ${host(r.from)}, as you picked` : `couldn't use that picture: ${r.why}`);
    }
    if (recheck.size || recheckAll) {
      const inBefore = new Set((recheckAll ? store.entries(nb.id, 1000).filter((e) => e.kind === 'option').map((e) => e.id) : [...recheck.keys()]).filter((id) => !optionNow(id)?.ruledOut));
      out.push((await recheckOptions(ctx, nb.id, recheckAll ? 'all' : [...recheck.keys()])).replace(/\.$/, ''));
      // Ruled out by the new look: said, with why.
      for (const id of inBefore) {
        const o = optionNow(id);
        if (o?.ruledOut) out.push(`${optionName(fresh, o)} is ruled out now (${o.ruledOut.reason.replace(/\.$/, '')})`);
      }
      // A pick that now fails a check stays picked (that's your call), and says so.
      for (const x of touched('option')) {
        const m = /^option:([^:]+):pick$/.exec(x.object_id);
        const o = m ? optionNow(m[1]) : undefined;
        const fails = o ? Object.keys(o.failedChecks ?? {}).filter((k) => [...(recheck.get(o.id) ?? [])].some((c) => c.toLowerCase() === k.toLowerCase())) : [];
        if (o && fails.length) out.push(`${optionName(fresh, o)} is still picked, but now fails ${fails.map((f) => `"${f}"`).join(' and ')}: unpick it if that changes your mind`);
      }
    }
    running.agentId = NOTEBOOK_WRITER_ID;
    if ((strike.length || rewriteWhole.length) && !ctx.notebookWriterRun) ensureSystemAgentCurrent(ctx, NOTEBOOK_WRITER_ID, 'notebook corrections');
    if (strike.length) {
      out.push(...(pointStep
        ? await strikePoints(ctx, store, nb.id, pointStep, strike.map((x) => ({ at: x.at, text: points[x.at] })), redo)
        : [`struck ${String(strike.length)} point${strike.length === 1 ? '' : 's'}`]));
      if (!pointStep && strike.length) {
        const now = store.get(nb.id)!.briefing!;
        const gone = new Set(strike.map((x) => x.at));
        store.setBriefing(nb.id, { ...now, points: now.points.filter((_, i) => !gone.has(i)), struck: [...(now.struck ?? []), ...strike.map((x) => points[x.at])] }, { swap: true });
      }
    }
    for (const shape of rewriteWhole) {
      const step = store.get(nb.id)!.steps!.find((s) => s.kind === 'write' && s.shape === shape)!;
      out.push(...await writeBriefing(ctx, store, nb.id, step));
    }
    store.noteRun(nb.id, `Corrected: ${[...said, ...out].join('; ')}`);
    say(ctx, messageId, `Corrected **${fresh.title}**: ${[...said, ...out].join('; ')}.`);
  })().catch((err: unknown) => {
    try { store.noteRun(nb.id, `Correction: ${err instanceof Error ? err.message.slice(0, 160) : 'it failed'}`); } catch { /* the notebook is gone */ }
  }).finally(() => {
    ctx.notebookPipelines?.delete(nb.id);
    reconcileStepCards(ctx, nb.id);
  });
  done?.(work);
  const next = [
    pictureLink ? 'fetching the picture' : '',
    recheckAll ? 'checking the options against it' : recheck.size ? `checking ${recheck.size === 1 ? 'it' : `${String(recheck.size)} options`} again` : '',
    redo ? `rewriting ${String(redo)} talking point${redo === 1 ? '' : 's'}` : strike.length ? `striking ${String(strike.length)} talking point${strike.length === 1 ? '' : 's'}` : '',
    rewriteWhole.length ? 'writing it again' : '',
  ].filter(Boolean).join(', then ');
  return { status: 'completed', summary: `${capital([...said, next].join('; '))}…` };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
