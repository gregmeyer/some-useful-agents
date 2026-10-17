/**
 * A notebook's pipeline (goal surfaces G2–G3): run each agent in order with
 * the notebook's goal as context, then have the notebook keeper turn what it
 * found into entries (options, evidence, notes, ruled-out decisions), skipping
 * anything the notebook already has. Entries carry the agent and run they came
 * from. One pipeline run per notebook at a time.
 */
import { randomUUID } from 'node:crypto';
import {
  NotebookStore, SYSTEM_AGENT_IDS, notebookViewData, rankOptions, splitFacts, groundFacts, executeAgentDag, extractTaggedJson, entryKey, cleanData, cleanSources, optionFingerprint, NOTEBOOK_ENTRY_KINDS,
  type Agent, type Notebook, type NotebookEntry, type NotebookField, type NotebookStep, type NotebookEntryKind, type NotebookPassKind,
  trackedFacts, stepFacts,
} from '@some-useful-agents/core';
import { parseJsonFromOutput } from '../views/output-widgets.js';
import type { getContext } from '../context.js';
import { runDispatchedAgentToTerminal } from '../routes/inbox-engine.js';
import { ensureSystemAgentCurrent } from '../routes/inbox-catalog.js';
import { buildLlmSettingsSnapshot } from './llm-settings-snapshot.js';
import { keepPhotos } from './notebook-photos.js';
import { startNotebookPictures } from './notebook-pictures.js';

type Ctx = ReturnType<typeof getContext>;

export const NOTEBOOK_KEEPER_ID = 'notebook-keeper';
/** The "agent" a setup pass is kept as: no search, just the goal and what the notebook has. */
export const NOTEBOOK_SETUP = 'notebook-setup';
const OUTPUT_CAP = 12_000;
const MAX_ENTRIES_PER_RUN = 12;
/** A run that files its own structured block (no keeper in between) may add more. */
const MAX_DIRECT_ENTRIES = 50;

/** Options named in a brief, at most; the rest are counted. */
const BRIEF_OPTIONS = 40;

/**
 * What the notebook already has, for a search agent: the options in the
 * running (so it doesn't bring them again) and, for each, the facts the
 * notebook tracks that it's still missing (so an agent can fill those in,
 * by the option's name, instead of only finding new ones). Best first.
 */
export function notebookGaps(nb: Notebook, entries: readonly NotebookEntry[]): string {
  const options = rankOptions(nb, notebookViewData(nb, entries).notebook.options);
  if (!options.length) return '';
  const tracked = trackedFacts(nb);
  const missing = (o: (typeof options)[number]) => tracked.filter((f) => o.fields[f.key] === undefined || o.fields[f.key] === '').map((f) => f.label.toLowerCase());
  const shown = options.slice(0, BRIEF_OPTIONS);
  const gaps = shown.filter((o) => missing(o).length);
  const more = options.length - shown.length;
  return [
    `It has ${String(options.length)} option${options.length === 1 ? '' : 's'} in the running; don't add these again: ${shown.map((o) => o.name).join('; ')}${more ? `; and ${String(more)} more` : ''}.`,
    gaps.length ? `Facts still missing (find them, with a source, and give them under the option's name):\n${gaps.map((o) => `- ${o.name} — ${missing(o).join(', ')}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

/** Options per run for a check step: each is looked up on the web, so a few at a time. */
export const CHECK_BATCH = 8;

/**
 * The options in the running, best first, as JSON for an agent that works
 * on them: id, name, facts by label, sources and its own notes, and (for a
 * check step) the checks it still needs, only those options, a few at a time.
 */
export function optionsInput(nb: Notebook, entries: readonly NotebookEntry[], forChecks = false, top?: number): string {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const ranked = rankOptions(nb, notebookViewData(nb, entries).notebook.options);
  // A check step on the top N checks only those.
  let options = (top ? ranked.slice(0, top) : ranked).map((o) => ({ o, left: nb.checks.filter((c) => !o.checked.some((d) => d.toLowerCase() === c.toLowerCase())) }));
  if (forChecks) options = options.filter((x) => x.left.length).slice(0, CHECK_BATCH);
  else options = options.slice(0, BRIEF_OPTIONS);
  return JSON.stringify(options.map(({ o, left }) => {
    const facts: Record<string, unknown> = {};
    for (const f of nb.fields) if (o.fields[f.key] !== undefined && o.fields[f.key] !== '') facts[f.label] = o.fields[f.key];
    const sources = [...new Set([o.link, ...Object.values(o.factMeta ?? {}).map((m) => m.source)].filter((u): u is string => !!u))].slice(0, 6);
    return { id: o.id, name: o.name, facts, sources, text: (byId.get(o.id)?.body ?? '').replace(/\s+/g, ' ').slice(0, 1500), ...(forChecks ? { left } : {}) };
  }));
}

/** A step being worked on, and what it still needs (stepProgress's `missing`). */
export interface StepJob { step: Pick<NotebookStep, 'title' | 'kind' | 'facts' | 'top'>; want: number; have: number; missing: readonly string[] }

/**
 * The job a step gives its agent, in a line or a short list: what this run
 * is for, so an agent that does many things does this one ("for these
 * options only, find the missing facts"). The agent itself is never changed.
 */
export function stepLine(nb: Notebook, job: StepJob): string {
  const list = (xs: readonly string[]) => `${xs.slice(0, 40).map((x) => `- ${x}`).join('\n')}${xs.length > 40 ? `\n- and ${String(xs.length - 40)} more` : ''}`;
  const head = `This step: ${job.step.title}.`;
  if (job.step.kind === 'find') return `${head} Find ${String(Math.max(1, job.want - job.have))} more options that fit (the notebook wants ${String(job.want)} in the running and has ${String(job.have)}). Don't bring back ones it already has. Give each one's own page (the listing, posting or product page itself), not a search-results page that lists many.`;
  if (job.step.kind === 'source') return `${head} Don't look for new options. For these options only, find the missing facts${job.step.facts?.length ? ` (only ${stepFacts(nb, job.step).map((f) => f.label.toLowerCase()).join(', ')})` : ''}, each with a source${stepFacts(nb, job.step).some((f) => f.role === 'link') ? `; for ${nb.fields.find((f) => f.role === 'link')!.label.toLowerCase()}, each one's own page (its listing, posting or product page), not a search page` : ''}:\n${list(job.missing)}`;
  if (job.step.kind === 'check') return `${head} Don't look for new options. Check each of these options against what's listed after it (${nb.checks.join('; ')}), and say whether it's met, quoting the source:\n${list(job.missing)}`;
  return head;
}

/** The notebook in a few lines, for an agent's goal-like inputs; with `entries`, also what it has and what's missing; with a step, that step's job first. */
export function notebookBrief(nb: Notebook, entries?: readonly NotebookEntry[], job?: StepJob): string {
  return [
    job ? stepLine(nb, job) : '',
    nb.statement || nb.title,
    nb.params.length ? `Parameters: ${nb.params.join('; ')}` : '',
    nb.criteria.length ? `Done when: ${nb.criteria.map((c) => c.text).join('; ')}` : '',
    entries ? notebookGaps(nb, entries) : '',
  ].filter(Boolean).join('\n');
}

/**
 * What a pipeline agent is given: the notebook as its goal, in whichever
 * goal-like inputs it declares. Everything else keeps its default.
 */
export function pipelineInputs(agent: Pick<Agent, 'inputs'>, nb: Notebook, entries?: readonly NotebookEntry[], job?: StepJob): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(agent.inputs ?? {})) {
    const n = name.toUpperCase();
    if (n === 'NOTEBOOK' || n === 'NOTEBOOK_CONTEXT' || n === 'GOAL' || n === 'BRIEF') out[name] = notebookBrief(nb, entries, job);
    // A step's job goes first in the topic too: an agent with only a topic still learns what this run is for.
    else if (n === 'TOPIC' || n === 'QUERY' || n === 'QUESTION' || n === 'SEARCH') out[name] = job ? `${stepLine(nb, job)}\n\n${nb.statement || nb.title}` : nb.statement || nb.title;
    else if (n === 'STEP' && job) out[name] = stepLine(nb, job);
    else if (n === 'CHECKS') out[name] = JSON.stringify(nb.checks);
    else if (n === 'OPTIONS' && entries) out[name] = optionsInput(nb, entries, job?.step.kind === 'check', job?.step.top);
    // An agent that files directly needs the notebook's field keys and roles.
    else if (n === 'FIELDS' || n === 'NOTEBOOK_FIELDS') out[name] = JSON.stringify(nb.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, ...(f.role ? { role: f.role } : {}), ...(f.unit ? { unit: f.unit } : {}) })));
  }
  return out;
}

/** Inputs that give an agent the whole notebook (it works on many options at once). */
const NOTEBOOK_LEVEL = /^(NOTEBOOK|NOTEBOOK_CONTEXT|GOAL|BRIEF|OPTIONS|FIELDS|NOTEBOOK_FIELDS|TOPIC|QUERY|QUESTION|SEARCH|STEP|CHECKS)$/i;

/**
 * An agent that reads one item's own page a run (listing-page-facts): it
 * takes a page address (PAGE_URL, URL, ITEM_URL, LISTING_URL or LINK) and
 * nothing about the notebook. Its page input, and the one that says which
 * facts to read (WANT or FACTS) when it has one. Undefined for any other agent.
 */
export function perItemInputs(agent: Pick<Agent, 'inputs'>): { page: string; want?: string } | undefined {
  const names = Object.keys(agent.inputs ?? {});
  if (names.some((n) => NOTEBOOK_LEVEL.test(n))) return undefined;
  const page = names.find((n) => /^(PAGE_URL|URL|ITEM_URL|LISTING_URL|LINK)$/i.test(n));
  if (!page) return undefined;
  const want = names.find((n) => /^(WANT|FACTS)$/i.test(n));
  return { page, ...(want ? { want } : {}) };
}

/**
 * A page reader's answer for one option: what the page said (ok, blocked or
 * gone) and the facts it gave, as the notebook's own field keys (matched by
 * key or label; empty values and 0 for a number left out, since the reader
 * leaves out what the page doesn't show). Pure.
 */
export function readItemAnswer(raw: string, fields: readonly NotebookField[]): { status: 'ok' | 'blocked' | 'gone'; facts: Record<string, string | number | boolean> } {
  const v = parseJsonFromOutput(raw);
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { status: 'blocked', facts: {} };
  const o = v as Record<string, unknown>;
  const st = String(o.status ?? 'ok').toLowerCase();
  const status = st === 'gone' ? 'gone' : st === 'blocked' ? 'blocked' : 'ok';
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const byName = new Map<string, NotebookField>();
  for (const f of fields) { byName.set(norm(f.key), f); byName.set(norm(f.label), f); }
  const facts: Record<string, string | number | boolean> = {};
  for (const [k, x] of Object.entries(o)) {
    const f = byName.get(norm(k));
    if (!f || f.role === 'link' || f.role === 'image' || f.type === 'image' || k === 'status' || k === 'url') continue;
    if (x === null || x === undefined || x === '' || (typeof x === 'number' && x === 0 && (f.type === 'money' || f.type === 'number'))) continue;
    if (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean') facts[f.key] = typeof x === 'string' ? x.trim() : x;
  }
  return { status, facts };
}

export interface KeeperOutcome {
  added: number;
  /** Options the notebook already had, found again and refreshed. */
  refreshed?: number;
  /** Setup: options given their facts. */
  factsSet?: number;
  /** Numbers the keeper gave that its source doesn't state: left out, never guessed. */
  factsDropped?: number;
  /** The run gave its own <notebook> block, filed as is (no keeper model). */
  direct?: boolean;
  /** Checks ticked on options (only from an agent's own code, which confirmed each with a quote). */
  checksMet?: number;
  /** Options ruled out because they fail a check. */
  checksFailed?: number;
  skipped: number;
  criteriaMet: number;
  summary?: string;
  error?: string;
}

/**
 * Apply the keeper's <notebook> block: add new entries (skipping titles the
 * notebook already has), tick criteria it showed are met (with a note saying
 * why). Pure apart from the store, so it's tested without a model.
 */
export function applyKeeperResult(store: NotebookStore, nb: Notebook, agentId: string, runId: string, raw: string, opts: { maxEntries?: number; trusted?: boolean; source?: string } = {}): KeeperOutcome {
  const block = extractTaggedJson(raw, 'notebook');
  if (!block) return { added: 0, skipped: 0, criteriaMet: 0, error: 'The keeper gave no <notebook> block.' };
  let parsed: { entries?: unknown; criteriaMet?: unknown; summary?: unknown; fields?: unknown; stages?: unknown; facts?: unknown; checks?: unknown; sources?: unknown };
  try { parsed = JSON.parse(block) as typeof parsed; } catch { return { added: 0, skipped: 0, criteriaMet: 0, error: "The keeper's block wasn't JSON." }; }
  const searchAt = new Date().toISOString();
  // A notebook's fields are set once, by the first run that finds options.
  if (nb.fields.length === 0 && Array.isArray(parsed.fields) && parsed.fields.length > 0) {
    nb = store.setFields(nb.id, parsed.fields);
    store.backfillOptions(nb.id);
  }
  // Stages too, once; existing options start at the first.
  if (nb.stages.length === 0 && Array.isArray(parsed.stages) && parsed.stages.length > 0) {
    nb = store.setStages(nb.id, parsed.stages);
  }
  if (nb.checks.length === 0 && Array.isArray(parsed.checks) && parsed.checks.length > 0) {
    nb = store.setChecks(nb.id, parsed.checks);
  }
  // A model's numbers must be in what it read: the run's output (and, for an
  // option it already has, that option's own text). Code's own block is trusted.
  let factsDropped = 0;
  const grounded = (data: Record<string, unknown> | undefined, text: string) => {
    if (!data || opts.trusted || opts.source === undefined) return data;
    const g = groundFacts(data, text);
    factsDropped += g.dropped.length;
    return g.data;
  };
  const byId = new Map(store.entries(nb.id, 1000).map((e) => [e.id, e]));
  // Facts for options the notebook already has, by id: setup's, and a run's
  // figures for an option it already has (a company's revenue and headcount).
  let factsSet = 0;
  let checksMet = 0;
  let checksFailed = 0;
  for (const f of Array.isArray(parsed.facts) ? parsed.facts.slice(0, 100) : []) {
    const x = f as { id?: unknown; data?: unknown; fingerprint?: unknown; checked?: unknown; ruleOut?: unknown };
    if (typeof x.id !== 'string') continue;
    // Checks are ticked, and options ruled out for failing one, only by an
    // agent's own code (it confirmed the quote); a model's say-so isn't a check.
    const own0 = byId.get(x.id);
    if (opts.trusted && own0?.kind === 'option') {
      for (const c of Array.isArray(x.checked) ? x.checked : []) {
        const check = typeof c === 'string' ? nb.checks.find((k) => k.toLowerCase() === c.trim().toLowerCase()) : undefined;
        if (check && !(own0.checked ?? []).some((d) => d.toLowerCase() === check.toLowerCase())) { store.checkOption(nb.id, x.id, check, true); checksMet++; }
      }
      if (typeof x.ruleOut === 'string' && x.ruleOut.trim() && !own0.ruledOut) { store.ruleOut(nb.id, x.id, x.ruleOut.trim().slice(0, 300), `agent:${agentId}`); checksFailed++; }
    }
    if (!x.data || typeof x.data !== 'object') continue;
    const own = byId.get(x.id);
    const data = grounded(x.data as Record<string, unknown>, `${own ? `${own.title}\n${own.body}\n` : ''}${opts.source ?? ''}`) ?? {};
    // Nothing left after grounding (every number was missing from the output): nothing to set.
    if (!Object.keys(data).length && typeof x.fingerprint !== 'string') continue;
    if (store.setOptionFacts(nb.id, x.id, data, typeof x.fingerprint === 'string' ? x.fingerprint : undefined)) factsSet++;
  }
  const seen = new Set(store.entries(nb.id, 1000).map((e) => entryKey(e.title)));
  let added = 0;
  let refreshed = 0;
  let skipped = 0;
  let ruledOutSeen = 0;
  for (const e of (Array.isArray(parsed.entries) ? parsed.entries : []).slice(0, opts.maxEntries ?? MAX_ENTRIES_PER_RUN)) {
    const x = e as { kind?: unknown; title?: unknown; body?: unknown; data?: unknown; fingerprint?: unknown; ruleOut?: unknown };
    if (typeof x.title !== 'string' || !(NOTEBOOK_ENTRY_KINDS as readonly string[]).includes(String(x.kind))) { skipped++; continue; }
    const body = typeof x.body === 'string' ? x.body : '';
    const key = entryKey(x.title);
    if (x.kind === 'option') {
      const data = grounded(x.data && typeof x.data === 'object' ? x.data as Record<string, unknown> : undefined, opts.source ?? '');
      const fingerprint = typeof x.fingerprint === 'string' ? x.fingerprint : undefined;
      // With a fingerprint (or a link) the store decides new vs. seen again; without, fall back to the title,
      // except an organization the notebook has by name, whose facts are refreshed (findOrgOption).
      const values = cleanData(splitFacts(data).values, nb.fields);
      if (!optionFingerprint(fingerprint, values, nb.fields) && (!key || seen.has(key)) && !store.findOrgOption(nb.id, { title: x.title, data: values })) { skipped++; continue; }
      const r = store.upsertOption(nb.id, { title: x.title, body, data, fingerprint, by: `agent:${agentId}`, runId, trustedFacts: opts.trusted });
      // The agent rules it out itself ("Unfit: …"): kept, so the next search doesn't bring it back.
      if (!r.ruledOut && typeof x.ruleOut === 'string' && x.ruleOut.trim()) {
        store.ruleOut(nb.id, r.entry.id, x.ruleOut.replace(/\s+/g, ' ').trim().slice(0, 300), `agent:${agentId}`);
        if (!r.seenAgain) added++; else refreshed++;
        continue;
      }
      if (r.ruledOut) { skipped++; ruledOutSeen++; }
      else if (r.seenAgain) refreshed++;
      else { added++; seen.add(key); }
      continue;
    }
    if (!key || seen.has(key)) { skipped++; continue; }
    // "Ruled out: Vena, …" about an option the notebook has: a model's text
    // can't rule it out (you decide those, and it may be chosen), and a
    // ruling that didn't happen only contradicts the page. Left out.
    if (!opts.trusted && x.kind === 'decision' && rulesOutExisting(store, nb, x.title)) { skipped++; continue; }
    seen.add(key);
    store.addEntry(nb.id, { kind: x.kind as NotebookEntryKind, title: x.title, body, by: `agent:${agentId}`, runId });
    added++;
  }
  // The search counts even when everything it found was known: that's how a
  // later "not in the last 2 searches" knows someone looked.
  if (agentId !== NOTEBOOK_SETUP) store.recordSearch(nb.id, agentId, runId, added + refreshed + ruledOutSeen, searchAt, cleanSources(parsed.sources));
  let criteriaMet = 0;
  for (const c of Array.isArray(parsed.criteriaMet) ? parsed.criteriaMet : []) {
    const x = c as { index?: unknown; why?: unknown };
    const i = Number(x.index);
    const cur = store.get(nb.id);
    if (!cur || !Number.isInteger(i) || !cur.criteria[i] || cur.criteria[i].met) continue;
    store.markCriterion(nb.id, i, true);
    store.addEntry(nb.id, { kind: 'note', title: `Met: ${cur.criteria[i].text}`, body: typeof x.why === 'string' ? x.why : '', by: `agent:${agentId}`, runId });
    criteriaMet++;
  }
  return { added, ...(refreshed ? { refreshed } : {}), ...(factsSet ? { factsSet } : {}), ...(checksMet ? { checksMet } : {}), ...(checksFailed ? { checksFailed } : {}), ...(factsDropped ? { factsDropped } : {}), skipped, criteriaMet, ...(typeof parsed.summary === 'string' ? { summary: parsed.summary.slice(0, 200) } : {}) };
}

/** A "Ruled out: <name>, …" title naming an option the notebook already has (by title, or its organization's name). */
export function rulesOutExisting(store: NotebookStore, nb: Notebook, title: string): boolean {
  const m = /^\s*ruled out\s*[:\-–—]\s*([^,;:(]+)/i.exec(title);
  if (!m) return false;
  const name = m[1].trim();
  if (!name) return false;
  const orgF = nb.fields.find((f) => f.role === 'org');
  return !!store.findOption(nb.id, name) || !!(orgF && store.findOrgOption(nb.id, { title: name, data: { [orgF.key]: name } }));
}

/** Run the keeper over one agent's output; returns what it added. */
/** File one run into a notebook, as its own pass (from its conversation, or Add to notebook). */
export async function keepIntoNotebook(ctx: Ctx, nb: Notebook, agentId: string, runId: string, output: string, kind: NotebookPassKind = 'conversation'): Promise<KeeperOutcome> {
  const store = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
  const passId = store.startPass(nb.id, kind);
  store.addRunToPass(passId, runId);
  try {
    const out = await keep(ctx, store, nb, agentId, runId, output);
    store.finishPass(passId, passNote(agentId, out));
    return out;
  } catch (err) {
    store.finishPass(passId, `${agentId}: ${err instanceof Error ? err.message.slice(0, 80) : 'failed'}`);
    throw err;
  }
}

/** "car-sweep: 3 new, 2 seen again" (or what went wrong). */
export function passNote(agentId: string, out: KeeperOutcome): string {
  return out.error ? `${agentId}: ran, but ${out.error}` : `${agentId}: ${String(out.added)} new${out.refreshed ? `, ${String(out.refreshed)} seen again` : ''}${out.factsSet && agentId !== NOTEBOOK_SETUP ? `, ${String(out.factsSet)} updated` : ''}${out.criteriaMet ? `, ${String(out.criteriaMet)} criteria met` : ''}${out.checksMet ? `, ${String(out.checksMet)} check${out.checksMet === 1 ? '' : 's'} met` : ''}${out.checksFailed ? `, ${String(out.checksFailed)} ruled out on a check` : ''}${out.factsDropped ? `, ${String(out.factsDropped)} number${out.factsDropped === 1 ? '' : 's'} not in its output left out` : ''}${out.direct ? ' (filed directly)' : ''}`;
}

/**
 * A run's own <notebook> block, when it gives one that parses and has
 * entries (the shape the keeper writes); else undefined and the keeper reads it.
 */
export function directBlock(output: string): string | undefined {
  const block = extractTaggedJson(output, 'notebook');
  if (!block) return undefined;
  try {
    const v = JSON.parse(block) as { entries?: unknown; facts?: unknown };
    // Entries, or checks on options it already has (a checker's own verified block).
    const checks = Array.isArray(v.facts) && v.facts.some((f) => !!f && typeof f === 'object' && ('checked' in f || 'ruleOut' in f));
    return (Array.isArray(v.entries) && v.entries.length > 0) || checks ? `<notebook>${block}</notebook>` : undefined;
  } catch { return undefined; }
}

export async function keep(ctx: Ctx, store: NotebookStore, nb: Notebook, agentId: string, runId: string, output: string): Promise<KeeperOutcome> {
  // A run that already speaks the notebook's language files directly: its
  // <notebook> block, cleaned the same way, with no keeper model, no 12k cap.
  const direct = agentId !== NOTEBOOK_SETUP ? directBlock(output) : undefined;
  if (direct) {
    const out = applyKeeperResult(store, store.get(nb.id) ?? nb, agentId, runId, direct, { maxEntries: MAX_DIRECT_ENTRIES, trusted: true });
    try { await keepPhotos(store, nb.id); } catch { /* photos are a nicety */ }
    try { startNotebookPictures(ctx, nb.id); } catch { /* pictures are a nicety */ }
    return { ...out, direct: true };
  }
  const setup = agentId === NOTEBOOK_SETUP;
  // Setup needs each option's id and text, to give it its facts.
  // Each option with its id, so facts this run gives about one it already has go onto it ("facts"); setup also gets its text.
  const existing = store.entries(nb.id, 200).map((e) => `${e.kind}: ${e.title}${e.kind === 'option' ? ` [id: ${e.id}]${setup && e.body ? ` — ${e.body.replace(/\s+/g, ' ').slice(0, 400)}` : ''}` : ''}${e.fingerprint ? ` [fingerprint: ${e.fingerprint}]` : ''}${e.ruledOut ? ` — RULED OUT: ${e.ruledOut.reason}` : e.stage ? ` (stage: ${e.stage})` : ''}`).join('\n');
  const inputs = {
    NOTEBOOK: JSON.stringify({ title: nb.title, statement: nb.statement, params: nb.params, criteria: nb.criteria.map((c, index) => ({ index, text: c.text, met: c.met })), fields: nb.fields }),
    SOURCE_AGENT: agentId,
    RUN_OUTPUT: output.length > OUTPUT_CAP ? `${output.slice(0, OUTPUT_CAP)}\n(truncated)` : output,
    EXISTING: existing || '(nothing yet)',
  };
  let result: string | undefined;
  if (ctx.notebookKeeperRun) {
    result = await ctx.notebookKeeperRun(inputs);
  } else {
    if (!ensureSystemAgentCurrent(ctx, NOTEBOOK_KEEPER_ID, 'notebook pipeline')) return { added: 0, skipped: 0, criteriaMet: 0, error: 'The notebook keeper agent is missing.' };
    const keeper = ctx.agentStore.getAgent(NOTEBOOK_KEEPER_ID);
    if (!keeper) return { added: 0, skipped: 0, criteriaMet: 0, error: 'The notebook keeper agent is missing.' };
    const keepRunId = randomUUID();
    const ac = new AbortController();
    ctx.activeRuns.set(keepRunId, ac);
    try {
      // No onRunFailure: a keeper hiccup shouldn't open an inbox thread.
      await executeAgentDag(keeper, { triggeredBy: 'dashboard', runId: keepRunId, signal: ac.signal, inputs }, {
        runStore: ctx.runStore,
        secretsStore: ctx.secretsStore,
        variablesStore: ctx.variablesStore,
        dataRoot: ctx.agentStore.dataRoot,
        llmSettings: buildLlmSettingsSnapshot(ctx),
        spawnNode: ctx.workflowSpawnNode,
      });
    } finally {
      ctx.activeRuns.delete(keepRunId);
    }
    const run = ctx.runStore.getRun(keepRunId);
    if (!run || run.status !== 'completed' || !run.result) return { added: 0, skipped: 0, criteriaMet: 0, error: run?.error ?? 'The keeper did not finish.' };
    result = run.result;
  }
  if (!result) return { added: 0, skipped: 0, criteriaMet: 0, error: 'The keeper did not finish.' };
  // Check the keeper's numbers against the whole output (setup: against each option's own text).
  const out = applyKeeperResult(store, store.get(nb.id) ?? nb, agentId, runId, result, { source: setup ? '' : output });
  // Photos for what it found; a slow or failing site never fails the keep.
  try { await keepPhotos(store, nb.id); } catch { /* photos are a nicety */ }
  // Options still without one get a representative picture or a drawing, in the background.
  try { startNotebookPictures(ctx, nb.id); } catch { /* pictures are a nicety */ }
  return out;
}

export function pipelineRunning(ctx: Ctx, notebookId: string) {
  return ctx.notebookPipelines?.get(notebookId);
}

/**
 * Run the notebook's pipeline once, start to finish. Returns false when it's
 * already running (or there's nothing to run). Errors become the run's note;
 * nothing throws to the caller.
 */
export function startNotebookPipeline(ctx: Ctx, notebookId: string, opts: { scheduled?: boolean } = {}): { started: boolean; reason?: string } {
  const store = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
  const nb = store.get(notebookId);
  if (!nb) return { started: false, reason: 'No such notebook.' };
  if (nb.status !== 'active') return { started: false, reason: 'Reopen the notebook to run its pipeline.' };
  if (nb.pipeline.length === 0) return { started: false, reason: 'Add agents to the pipeline under Edit first.' };
  ctx.notebookPipelines ??= new Map();
  if (ctx.notebookPipelines.has(notebookId)) return { started: false, reason: 'Its pipeline is already running.' };
  ctx.notebookPipelines.set(notebookId, { agentId: nb.pipeline[0], step: 1, of: nb.pipeline.length, startedAt: Date.now() });
  void runPipeline(ctx, store, nb, opts).finally(() => ctx.notebookPipelines?.delete(notebookId));
  return { started: true };
}

async function runPipeline(ctx: Ctx, store: NotebookStore, nb: Notebook, opts: { scheduled?: boolean } = {}): Promise<void> {
  const notes: string[] = [];
  let total = 0;
  // One pass for the whole pipeline: every agent's run, failed ones too.
  const passId = store.startPass(nb.id, 'pipeline', undefined, opts);
  for (const [i, agentId] of nb.pipeline.entries()) {
    ctx.notebookPipelines?.set(nb.id, { agentId, step: i + 1, of: nb.pipeline.length, startedAt: Date.now() });
    const agent = ctx.agentStore.getAgent(agentId);
    if (!agent || agent.status === 'archived') { notes.push(`${agentId}: not installed`); continue; }
    try {
      // What the notebook has now (an earlier agent in this pass may have added some).
      const run = await runDispatchedAgentToTerminal(ctx, agent, pipelineInputs(agent, nb, store.entries(nb.id, 1000)));
      store.addRunToPass(passId, run.id);
      if (run.status !== 'completed') { notes.push(`${agentId}: ${run.status}${run.error ? ` (${run.error.slice(0, 80)})` : ''}`); continue; }
      const out = await keep(ctx, store, nb, agentId, run.id, run.result ?? '');
      total += out.added;
      notes.push(passNote(agentId, out));
    } catch (err) {
      notes.push(`${agentId}: ${err instanceof Error ? err.message.slice(0, 80) : 'failed'}`);
    }
  }
  const note = `${String(total)} new entr${total === 1 ? 'y' : 'ies'} · ${notes.join(' · ')}`;
  store.finishPass(passId, note);
  store.noteRun(nb.id, note);
}

/**
 * Set a notebook up (fields, stages, and facts for the options it already
 * has) with one keeper pass and no search. Runs in the background, once per
 * notebook at a time; marks the notebook so a page visit doesn't retry it.
 */
export function startNotebookSetup(ctx: Ctx, notebookId: string, opts: { onDone?: () => void } = {}): boolean {
  const store = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
  const nb = store.get(notebookId);
  if (!nb || nb.fields.length > 0) return false;
  ctx.notebookSetups ??= new Set();
  if (ctx.notebookSetups.has(notebookId)) return false;
  ctx.notebookSetups.add(notebookId);
  store.markSetup(notebookId);
  void keep(ctx, store, nb, NOTEBOOK_SETUP, randomUUID(), '(Nothing was searched: set this notebook up from its goal and the entries it already has.)')
    .catch(() => { /* the page still works without fields */ })
    .finally(() => {
      ctx.notebookSetups?.delete(notebookId);
      try { opts.onDone?.(); } catch { /* a greeting is a nicety */ }
    });
  return true;
}

export function setupRunning(ctx: Ctx, notebookId: string): boolean {
  return !!ctx.notebookSetups?.has(notebookId);
}

// ── Runs not in the notebook yet ──
// Only a run started from the notebook's conversation (or its pipeline) is
// filed automatically. A run of one of its agents started anywhere else (its
// Run button, a schedule) is offered on the page: Add to notebook.

const UNFILED_DAYS = 14;

export interface UnfiledRun { id: string; agentId: string; startedAt: string }

/** Finished runs of this notebook's agents, from the last two weeks, that aren't in it yet (newest first). */
export function unfiledRuns(ctx: Ctx, nb: Notebook, limit = 5): UnfiledRun[] {
  const s = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
  const { agents, runIds } = s.runSources(nb.id);
  const filed = new Set(runIds);
  // A run already filed into another notebook belongs there (an agent can feed several).
  const candidates: string[] = [];
  const since = Date.now() - UNFILED_DAYS * 86_400_000;
  const out: UnfiledRun[] = [];
  for (const agentId of agents) {
    if (agentId === NOTEBOOK_SETUP || SYSTEM_AGENT_IDS.has(agentId)) continue;
    for (const r of ctx.runStore.listRuns({ agentName: agentId, status: 'completed', limit: 10 })) {
      // A run another agent started is part of its parent's search, not one to file on its own.
      if (filed.has(r.id) || r.parentRunId || !r.result || Date.parse(r.startedAt) < since) continue;
      candidates.push(r.id);
      out.push({ id: r.id, agentId, startedAt: r.startedAt });
    }
  }
  const elsewhere = new Set(s.notebooksForRuns(candidates).filter((x) => x.notebookId !== nb.id).map((x) => x.runId));
  return out.filter((r) => !elsewhere.has(r.id)).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
}

/** Runs being added to a notebook right now (run id), so a second click doesn't add one twice. */
export function addingRun(ctx: Ctx, runId: string): boolean {
  return !!ctx.notebookAddingRuns?.has(runId);
}

/** File one of the notebook's unfiled runs into it, in the background. */
export function addRunToNotebook(ctx: Ctx, notebookId: string, runId: string): { started: boolean; reason?: string } {
  const s = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
  const nb = s.get(notebookId);
  if (!nb) return { started: false, reason: 'No such notebook.' };
  // Decided or stopped still takes what you add (anything learned since is worth keeping); archived doesn't.
  if (nb.archivedAt) return { started: false, reason: 'This notebook is archived. Bring it back to add to it.' };
  const run = unfiledRuns(ctx, nb, 50).find((r) => r.id === runId);
  if (!run) return { started: false, reason: 'That run is already in the notebook, or it isn\'t one of its agents\' finished runs.' };
  if (addingRun(ctx, runId)) return { started: false, reason: 'That run is being added already.' };
  const result = ctx.runStore.getRun(runId)?.result ?? '';
  (ctx.notebookAddingRuns ??= new Set()).add(runId);
  void keepIntoNotebook(ctx, nb, run.agentId, runId, result, 'added')
    .catch(() => undefined)
    .finally(() => { ctx.notebookAddingRuns?.delete(runId); });
  return { started: true };
}
