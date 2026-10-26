/**
 * Home's Try next: agents you can run in one click, and questions to ask sua, picked from
 * what you use and what happened today. Pure (`pickSuggestions`) with a reader (`homeSuggestions`).
 */
import { NotebookStore, SYSTEM_AGENT_IDS, type Agent, type Notebook, type NotebookTemplate } from '@some-useful-agents/core';
import { agentShelves, DEMO_RE } from '../routes/agents/list.js';
import { cachedNotebookSuggestions } from './notebook-suggestions.js';
import { perItemInputs } from './notebook-pipeline.js';
import type { getContext } from '../context.js';

type Ctx = ReturnType<typeof getContext>;

/** One input it runs with as-is: its name in words and its default. */
export interface SuggestedInput { label: string; value: string }
export interface SuggestedAgent {
  id: string; name: string; description: string; lastRunAt?: string;
  /** Why it's suggested: your go-to, used this week, new to you, a tutorial. */
  why: 'go-to' | 'recent' | 'new' | 'tutorial';
  /** What Run uses (its defaults), the main one first. */
  runsWith: SuggestedInput[];
  /** A prompt for sua: run it with your own value for what it's about (sua asks you what), or what it's good for. */
  ownAsk: { label: string; text: string };
}
export interface SuggestedAsk {
  label: string;
  text: string;
  /** A page to open instead of filling the box (New notebook with the sentence started). */
  href?: string;
}
/** Home's Ask sua card: starters by verb; a pill fills the box (you finish it). */
export type StarterVerb = 'Start' | 'Run' | 'Build' | 'Fix' | 'Look up';
export interface AskStarters { verb: StarterVerb; pills: SuggestedAsk[] }
export interface HomeSuggestions { agents: SuggestedAgent[]; asks: SuggestedAsk[]; starters?: AskStarters[] }

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

/** A tutorial example ("… Teaches flow control."): fine to try, after the rest. */
const TUTORIAL_RE = /\bTeaches\b/;

/** An input's key in words: TARGET_URL → "target URL". */
export function inputLabel(key: string): string {
  return key.toLowerCase().split('_').filter(Boolean).map((w) => (/^(url|api|id|csv|json|rss)$/.test(w) ? w.toUpperCase() : w)).join(' ');
}

/** Its inputs as Run fills them: string ones first (that's usually what it's about), then the rest. */
export function runsWithInputs(agent: Pick<Agent, 'inputs'>, max = 2): SuggestedInput[] {
  const specs = Object.entries(agent.inputs ?? {}).filter(([, spec]) => spec.default !== undefined && String(spec.default).trim() !== '');
  specs.sort(([, a], [, b]) => Number(b.type === 'string') - Number(a.type === 'string'));
  return specs.slice(0, max).map(([key, spec]) => {
    const v = String(spec.default);
    return { label: inputLabel(key), value: v.length > 90 ? `${v.slice(0, 89)}…` : v };
  });
}

/** A setting rather than what it's about: where it writes, how many, how long. */
const SETTING_RE = /(^|_)(DIR|PATH|FILE|COUNT|LIMIT|MAX|MIN|TIMEOUT|SECONDS|MODEL|FORMAT|MODE|DAYS|HOURS)($|_)/i;

/**
 * A prompt for sua: run it with your own value for what it's about (its first
 * string input that isn't a setting), or, with nothing like that, what it's good for.
 */
function ownAsk(a: Agent): SuggestedAgent['ownAsk'] {
  const main = Object.entries(a.inputs ?? {}).find(([key, spec]) => spec.type === 'string' && spec.default !== undefined && !SETTING_RE.test(key));
  if (!main) return { label: 'Ask sua what it\'s good for', text: `What is ${a.name} (${a.id}) good for, and when would I use it? Suggest a way to try it.` };
  const what = inputLabel(main[0]);
  return { label: `Run it with your own ${what}`, text: `Run ${a.name} (${a.id}) with my own ${what}. Ask me for it first.` };
}

/** Kinds of notebook, each a sentence to finish: what they're for, as you'd say it. */
const NOTEBOOK_KINDS = [
  { kind: 'meeting', label: 'Prepare for a meeting with …', text: 'Prepare for a meeting with ' },
  { kind: 'report', label: 'Research a report on …', text: 'Research a report on ' },
  { kind: 'plan', label: 'Plan …', text: 'Plan ' },
  { kind: 'choose', label: 'Help me choose …', text: 'Help me choose ' },
] as const;
type NotebookKind = typeof NOTEBOOK_KINDS[number]['kind'];

/** What a notebook is for, from its page, steps and title. Pure. */
export function notebookKind(nb: Pick<Notebook, 'title' | 'layout' | 'steps' | 'statement'>): NotebookKind {
  const words = `${nb.title} ${nb.statement} ${nb.layout?.about ?? ''}`;
  if (nb.layout?.preset === 'dossier' || nb.steps?.some((s) => s.kind === 'profile') || /\b(meeting|interview)\b|\b(meet|call) with\b/i.test(words)) return 'meeting';
  if (/\b(plan|itinerary|trip|schedule for)\b/i.test(words)) return 'plan';
  if (/\b(report|research|answer|find out|understand|worth it)\b/i.test(words) || /\?\s*$/.test(nb.title) || (nb.layout && !nb.layout.preset && nb.steps?.some((s) => s.kind === 'write'))) return 'report';
  return 'choose';
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
      ? { label: `${clip(t.name, 40)} for …`, text: `Start a new notebook from my “${t.name}” template for ` }
      : { label: clip(t.name, 44), text: `Start a new notebook from my “${t.name}” template.` });
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

/**
 * Starters for Home's Ask sua card, one row per verb, never empty: run one of
 * yours on something, build one, fix what failed, look something up. Text
 * ending in "…" is for you to finish.
 */
export function askStarters(d: {
  agents: readonly Agent[];
  lastRunAt: ReadonlyMap<string, string>;
  runCounts: ReadonlyMap<string, number>;
  notebookIdeas: ReadonlyArray<{ label: string; text: string }>;
  failedAgents: readonly string[];
  /** Ways to start a notebook (notebookStartPills). */
  notebookStarts?: readonly SuggestedAsk[];
  now?: number;
}): AskStarters[] {
  const now = d.now ?? Date.now();
  const weekAgo = new Date(now - 7 * 86_400_000).toISOString();
  // Not sua's own, demos, or a notebook's helpers (page readers take one item at a time).
  const yours = d.agents.filter((a) => a.status === 'active' && !SYSTEM_AGENT_IDS.has(a.id) && !(DEMO_RE.test(a.id) || DEMO_RE.test(a.name)) && !perItemInputs(a));
  const shelves = agentShelves(yours, { lastRunAt: d.lastRunAt, runCounts: d.runCounts, feeds: new Map(), weekAgo });
  const used = [...shelves.goTo, ...shelves.recent.filter((a) => !shelves.goTo.includes(a))];
  const pill = (label: string, text = label): SuggestedAsk => ({ label, text });

  const run: SuggestedAsk[] = [];
  for (const a of used) {
    if (run.length === 2) break;
    const main = Object.entries(a.inputs ?? {}).find(([key, spec]) => spec.type === 'string' && !SETTING_RE.test(key));
    if (main) run.push(pill(`Run ${a.name} on …`, `Run ${a.name} with ${inputLabel(main[0])}: `));
  }
  const plain = used.find((a) => Object.keys(a.inputs ?? {}).length === 0);
  if (plain) run.push(pill(`Run ${plain.name}`, `Run ${plain.name} and tell me what it found.`));
  if (!run.length) run.push(pill('Run my most-used agent', 'Run my most-used agent and tell me what it found.'));

  const build: SuggestedAsk[] = [
    pill('Build an agent that checks … every morning', 'Build an agent that checks '),
    pill('Watch a page for changes', 'Build an agent that watches this page for changes and tells me what changed: '),
  ];
  const unscheduled = shelves.goTo.find((a) => !a.schedule && (d.runCounts.get(a.id) ?? 0) >= 3);
  if (unscheduled) build.push(pill(`Put ${unscheduled.name} on a schedule`, `Put ${unscheduled.name} (${unscheduled.id}) on a schedule that suits what it does.`));

  const fix: SuggestedAsk[] = [...new Set(d.failedAgents)].slice(0, 2).map((id) => {
    const name = d.agents.find((a) => a.id === id)?.name ?? id;
    return pill(`Why did ${name} fail?`, `Why did ${name} (${id}) fail today, and can you fix it?`);
  });
  if (fix.length < 2) fix.push(pill('Check my agents for anything broken', 'Check my agents for anything broken or slow, and fix what you can.'));

  const look: SuggestedAsk[] = d.notebookIdeas.slice(0, 2).map((i) => pill(`Help me find ${i.label.charAt(0).toLowerCase()}${i.label.slice(1)}`, i.text));
  look.push(pill('What did my agents find today?', 'What did my agents find today? Anything worth a look?'));
  if (look.length < 3) look.push(pill('Look up …', 'Look up '));

  return [
    ...(d.notebookStarts?.length ? [{ verb: 'Start' as const, pills: d.notebookStarts.slice(0, 4) }] : []),
    { verb: 'Run', pills: run.slice(0, 3) },
    { verb: 'Build', pills: build.slice(0, 3) },
    { verb: 'Fix', pills: fix.slice(0, 3) },
    { verb: 'Look up', pills: look.slice(0, 3) },
  ];
}

export function pickSuggestions(d: {
  agents: readonly Agent[];
  lastRunAt: ReadonlyMap<string, string>;
  runCounts: ReadonlyMap<string, number>;
  notebookIdeas: ReadonlyArray<{ label: string; text: string }>;
  failedToday: number;
  ranToday: number;
  now?: number;
}): HomeSuggestions {
  const now = d.now ?? Date.now();
  const dayAgo = new Date(now - 86_400_000).toISOString();
  const weekAgo = new Date(now - 7 * 86_400_000).toISOString();
  const runnable = d.agents.filter((a) => a.status === 'active' && !SYSTEM_AGENT_IDS.has(a.id) && runsAsIs(a)
    && !(DEMO_RE.test(a.id) || DEMO_RE.test(a.name)));
  const shelves = agentShelves(runnable, { lastRunAt: d.lastRunAt, runCounts: d.runCounts, feeds: new Map(), weekAgo });
  const ranRecently = (a: Agent) => (d.lastRunAt.get(a.id) ?? '') >= dayAgo;
  const order = [
    ...shelves.goTo.filter((a) => !ranRecently(a)),
    ...shelves.recent.filter((a) => !ranRecently(a)),
    ...runnable.filter((a) => !d.lastRunAt.has(a.id) && a.description?.trim() && !TUTORIAL_RE.test(a.description)),
    ...runnable.filter((a) => !d.lastRunAt.has(a.id) && a.description?.trim()),
    ...shelves.goTo, ...shelves.recent,
  ];
  const goTo = new Set(shelves.goTo.map((a) => a.id));
  const seen = new Set<string>();
  const agents: SuggestedAgent[] = [];
  for (const a of order) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    const last = d.lastRunAt.get(a.id);
    const why: SuggestedAgent['why'] = goTo.has(a.id) ? 'go-to' : last ? 'recent' : TUTORIAL_RE.test(a.description ?? '') ? 'tutorial' : 'new';
    agents.push({ id: a.id, name: a.name, description: (a.description ?? '').trim(), ...(last ? { lastRunAt: last } : {}), why, runsWith: runsWithInputs(a), ownAsk: ownAsk(a) });
    if (agents.length === 3) break;
  }

  const asks: SuggestedAsk[] = [];
  for (const idea of d.notebookIdeas.slice(0, 2)) asks.push({ label: `Start a notebook: ${idea.label}`, text: idea.text });
  if (d.failedToday > 0) asks.push({ label: 'What failed today?', text: 'What failed today, and what should I do about it?' });
  if (d.ranToday > 0) asks.push({ label: 'What did my agents do today?', text: 'What did my agents do today? Anything worth a look?' });
  // Only one you run often by hand: a starred one you rarely run isn't asking for a schedule.
  const unscheduled = shelves.goTo.find((a) => !a.schedule && (d.runCounts.get(a.id) ?? 0) >= 3);
  if (unscheduled) asks.push({ label: `Put ${unscheduled.name} on a schedule`, text: `Put ${unscheduled.name} (${unscheduled.id}) on a schedule that suits what it does.` });
  if (asks.length < 2) asks.push({ label: 'What can sua do for me?', text: 'What can you do for me with the agents I have? Suggest a few things to try.' });
  if (asks.length < 3) asks.push({ label: 'Build me an agent that checks something every morning', text: 'Build me an agent that checks something useful every morning. Ask me what to check.' });
  return { agents, asks: asks.slice(0, 4) };
}

/** Try next for Home, from the stores (cheap: two GROUP BYs, two counts, a cached file). */
export function homeSuggestions(ctx: Ctx, now = Date.now()): HomeSuggestions {
  try {
    const dayAgo = new Date(now - 86_400_000).toISOString();
    const agents = ctx.agentStore.listAgents();
    const lastRunAt = ctx.runStore.latestRunAtByAgent();
    const runCounts = ctx.runStore.runCountsByAgent(new Date(now - 30 * 86_400_000).toISOString());
    const notebookIdeas = cachedNotebookSuggestions(ctx);
    const failed = ctx.runStore.queryRuns({ statuses: ['failed'], since: dayAgo, limit: 5 });
    const picked = pickSuggestions({
      agents, lastRunAt, runCounts, notebookIdeas,
      failedToday: failed.total,
      ranToday: ctx.runStore.queryRuns({ since: dayAgo, limit: 1 }).total,
      now,
    });
    const failedAgents = failed.rows.map((r) => r.agentName).filter((id) => !SYSTEM_AGENT_IDS.has(id));
    const nbs = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
    const notebookStarts = notebookStartPills(nbs.listTemplates(), nbs.list());
    return { ...picked, starters: askStarters({ agents, lastRunAt, runCounts, notebookIdeas, failedAgents, notebookStarts, now }) };
  } catch {
    return { agents: [], asks: [], starters: askStarters({ agents: [], lastRunAt: new Map(), runCounts: new Map(), notebookIdeas: [], failedAgents: [] }) };
  }
}
