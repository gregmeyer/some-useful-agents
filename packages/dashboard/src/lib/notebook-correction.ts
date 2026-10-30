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
import { extractTaggedJson, type InboxActionMeta, type InboxActionStatus, type Notebook, type NotebookAboutWho, type NotebookEntry} from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { runDispatchedAgentToTerminal } from '../routes/inbox-engine.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { publishInboxEvent } from '../routes/inbox-shared.js';
import { notebookThread, notebooksOf, threadOptionFocus } from './notebook-chat.js';
import { strikePoints, writeBriefing } from './notebook-write.js';
import { reconcileStepCards } from './notebook-step-queue.js';
import { NOTEBOOK_WRITER_ID } from './notebook-step-agents.js';

type Ctx = ReturnType<typeof getContext>;

export const NOTEBOOK_CORRECTION_ID = 'notebook-correction';

export type CorrectionType = 'about-fact' | 'option-fact' | 'limit' | 'check' | 'criterion' | 'written' | 'other';
const TYPES: readonly CorrectionType[] = ['about-fact', 'option-fact', 'limit', 'check', 'criterion', 'written', 'other'];
export type CorrectionAction = 'keep' | 'reevaluate' | 'invalidate';
const ACTIONS: readonly CorrectionAction[] = ['keep', 'reevaluate', 'invalidate'];
/** What applying a correction can do yet (the others are worked out and said, not applied). */
const APPLIES: ReadonlySet<CorrectionType> = new Set(['about-fact', 'written']);

export interface CorrectionDelta { type: CorrectionType; target_id: string; old_value: string; new_value: string; label?: string }
export interface CorrectionImpact { object_id: string; action: CorrectionAction; reason: string }
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
export function correctionParts(nb: Notebook, entries: readonly NotebookEntry[], focus?: string): CorrectionPart[] {
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
        id: `${optionId(o.id)}:${f.key}`, role: 'evidence', kind: 'option fact', text: `${o.title}, ${f.label}: ${line(o.data?.[f.key], 200)}`,
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
export function correctionInputs(nb: Notebook, entries: readonly NotebookEntry[], instruction: string, conversation: string, focus?: string): Record<string, string> {
  return {
    NOTEBOOK: JSON.stringify({ title: nb.title, for: nb.statement, ...(nb.about?.person ? { person: nb.about.person.name } : {}), ...(nb.about?.company ? { company: nb.about.company.name } : {}), parts: correctionParts(nb, entries, focus) }),
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
    return action && id ? { object_id: id, action, reason: line(o.reason, 200) } : undefined;
  }).filter((x): x is CorrectionImpact => !!x);
  return {
    semantic_delta: { type, target_id: line(d.target_id, 120), old_value: line(d.old_value), new_value: line(d.new_value), ...(label ? { label } : {}) },
    impact,
    clarification_required: v.clarification_required === true || v.clarification_required === 'true',
    clarification_question: line(v.clarification_question, 300),
  };
}

const STRENGTH: Record<CorrectionAction, number> = { keep: 0, reevaluate: 1, invalidate: 2 };

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
export function checkCorrection(nb: Notebook, entries: readonly NotebookEntry[], c: Correction, focus?: string): CheckedCorrection {
  const ask = c.clarification_question || 'Which part of the notebook is wrong, and what should it say?';
  if (c.clarification_required) return { question: ask };
  const parts = correctionParts(nb, entries, focus);
  const byId = new Map(parts.map((p) => [p.id, p]));
  const d = c.semantic_delta;
  const m = /^about:(person|company):([a-z][a-z0-9_]{0,39})$/.exec(d.target_id);
  const target = byId.get(d.target_id);
  const ok = d.type === 'about-fact' ? !!m && !!nb.about?.[m[1] as NotebookAboutWho] && (!!target || !!d.new_value)
    : d.type === 'option-fact' ? !!target && target.kind === 'option fact'
      : d.type === 'limit' || d.type === 'check' || d.type === 'criterion' ? !!target && d.target_id.startsWith(`${d.type}:`)
        : d.type === 'written' ? !!target && /^(point|question|finding|plan):\d+$/.test(d.target_id)
          : false;
  if (!ok) return { question: ask };
  if (d.type === 'about-fact' && target && lower(d.new_value) === lower(/: (.*?)(?: \(|$)/.exec(target.text)?.[1] ?? '')) return { question: `The notebook already says ${d.label ?? 'that'} is ${d.new_value}. What should change?` };

  const impact = new Map<string, CorrectionImpact>();
  const put = (x: CorrectionImpact) => {
    if (x.object_id === d.target_id || !byId.has(x.object_id)) return;
    const was = impact.get(x.object_id);
    if (!was || STRENGTH[x.action] > STRENGTH[was.action]) impact.set(x.object_id, { ...x, reason: x.reason || was?.reason || '' });
  };
  for (const x of c.impact) put(x);
  // What follows by the notebook's own links.
  const written = parts.filter((p) => /^(point|question|finding|plan):/.test(p.id));
  if (d.type === 'about-fact' && d.old_value.length >= 3) {
    for (const p of written) if (lower(p.text).includes(lower(d.old_value))) put({ object_id: p.id, action: 'reevaluate', reason: `it says ${d.old_value}` });
  }
  if (d.type === 'option-fact') {
    const opt = d.target_id.replace(/^(option:[^:]+):.*$/, '$1');
    for (const p of parts) {
      if (p.id.startsWith(`${opt}:check:`) || p.id === `${opt}:ruled-out` || p.id === `${opt}:pick`) put({ object_id: p.id, action: 'reevaluate', reason: 'it rests on the corrected fact' });
      else if (p.from?.includes(opt) && written.includes(p)) put({ object_id: p.id, action: 'reevaluate', reason: 'it cites that option' });
    }
  }
  if (d.type === 'check') {
    const i = d.target_id.slice('check:'.length);
    for (const p of parts) if (p.id.endsWith(`:check:${i}`)) put({ object_id: p.id, action: 'reevaluate', reason: 'it was checked against the old check' });
  }
  // Evidence stays unless the change is to that very fact.
  for (const [id, x] of impact) {
    if (byId.get(id)?.role === 'evidence' && x.action === 'invalidate') impact.set(id, { ...x, action: 'reevaluate' });
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

/** The card's rows and its one line: the change, what it redoes or drops, and that the rest stays. Pure. */
export function describeCorrection(nb: Notebook, entries: readonly NotebookEntry[], c: Correction): { rows: Array<{ what: string; before: string; after: string }>; summary: string } {
  const d = c.semantic_delta;
  const name = d.label || (d.type === 'written' ? cardText(partText(nb, entries, d.target_id)) : d.type.replace('-', ' '));
  const rows: Array<{ what: string; before: string; after: string }> = [];
  if (d.type !== 'written') rows.push({ what: d.type === 'about-fact' ? (d.label ?? 'fact') : d.type.replace('-', ' '), before: d.old_value || '—', after: d.new_value || '(take it out)' });
  const touched = c.impact.filter((x) => x.action !== 'keep');
  for (const x of touched) {
    const what = x.action === 'invalidate' ? 'take out' : /^(point|finding|plan):/.test(x.object_id) ? 'rewrite' : /^question:/.test(x.object_id) ? 'take out' : 'look again';
    rows.push({ what, before: cardText(partText(nb, entries, x.object_id)).slice(0, 160), after: x.reason || '—' });
  }
  const counts = (['rewrite', 'take out', 'look again'] as const).map((w) => [w, rows.filter((r) => r.what === w).length] as const).filter(([, n]) => n);
  const changes = counts.map(([w, n]) => `${w === 'rewrite' ? 'rewrites' : w === 'take out' ? 'takes out' : 'looks again at'} ${String(n)}`).join(', ');
  // A count of every part kept (facts, check results…) means nothing to read: say the rest stays.
  const head = d.type === 'written'
    ? `"${name.slice(0, 80)}" is wrong`
    : `${d.label ?? name}: ${d.old_value || '—'} → ${d.new_value || 'taken out'}`;
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
    const { result, error } = await runCorrectionAgent(ctx, correctionInputs(nb, entries, instruction, recentTurns(ctx, messageId), focus));
    const c = result ? parseCorrection(result) : undefined;
    if (!c) {
      say(ctx, messageId, `I couldn't work out what that changes in the notebook${error ? ` (${error.slice(0, 160)})` : ''}. Nothing changed. Say which part is wrong and what it should be.`);
      return;
    }
    const now = store.get(nb.id) ?? nb;
    const nowEntries = store.entries(nb.id, 1000);
    const checked = checkCorrection(now, nowEntries, c, focus);
    if ('question' in checked) {
      say(ctx, messageId, checked.question);
      ctx.inboxStore?.updateStatus(messageId, 'awaiting_user');
      return;
    }
    const { rows, summary } = describeCorrection(now, nowEntries, checked.correction);
    if (!APPLIES.has(checked.correction.semantic_delta.type)) {
      say(ctx, messageId, `${summary}\n\nI can't apply that kind of correction from here yet. Change it on the notebook's page, or ask me to correct the option ("its price is $450").`);
      return;
    }
    const action: InboxActionMeta = {
      kind: 'action', status: 'proposed', agentId: 'notebook-correct-apply', effect: 'write',
      inputs: { NOTEBOOK: nb.id, NOTEBOOK_TITLE: now.title, INSTRUCTION: instruction, CORRECTION: JSON.stringify(checked.correction), TEXTS: JSON.stringify(Object.fromEntries(checked.correction.impact.map((x) => [x.object_id, partText(now, nowEntries, x.object_id)]))) },
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
  try {
    if (d.type === 'about-fact') {
      const [, who, key] = d.target_id.split(':') as [string, NotebookAboutWho, string];
      store.correctAbout(nb.id, who, key, { value: d.new_value, ...(d.label ? { label: d.label } : {}), why: meta.inputs.INSTRUCTION });
      said.push(d.new_value ? `${d.label ?? key.replace(/_/g, ' ')} is ${d.new_value} now, as you said` : `took out ${d.label ?? key.replace(/_/g, ' ')}`);
    }
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
  const pointStep = fresh.steps?.find((s) => s.kind === 'write' && !s.shape);
  const rewriteWhole = (['answer', 'plan'] as const).filter((shape) => touched(shape === 'answer' ? 'finding' : 'plan', 'reevaluate').length && fresh.steps?.some((s) => s.kind === 'write' && s.shape === shape));
  const redo = strike.filter((x) => x.redo).length;
  if (!strike.length && !rewriteWhole.length) {
    store.noteRun(nb.id, `Corrected: ${said.join('; ')}`);
    return { status: 'completed', summary: `${capital(said.join('; ') || 'nothing to change')}.` };
  }
  // The rest is the writer's: one run at a time, like Write again.
  ctx.notebookPipelines ??= new Map();
  ctx.notebookPipelines.set(nb.id, { agentId: NOTEBOOK_WRITER_ID, step: 0, of: fresh.steps?.length ?? 0, startedAt: Date.now(), again: true });
  const work = (async () => {
    if (!ctx.notebookWriterRun) ensureSystemAgentCurrent(ctx, NOTEBOOK_WRITER_ID, 'notebook corrections');
    const out: string[] = [];
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
  const next = redo ? `rewriting ${String(redo)} talking point${redo === 1 ? '' : 's'}` : strike.length && !rewriteWhole.length ? `striking ${String(strike.length)} talking point${strike.length === 1 ? '' : 's'}` : 'writing it again';
  return { status: 'completed', summary: `${capital([...said, next].join('; '))}…` };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
