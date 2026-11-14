/**
 * A notebook that shows an experiment (ADR-0078). The experiment holds the
 * runs and is where it is run from; the notebook shows what it found, drawn
 * from the latest pass each time, and is where you talk to sua about it.
 * One notebook an experiment: asking again opens the one it has.
 */
import { ExperimentStore, NotebookStore, experimentLayout, experimentPageData, experimentReadoutText, findExperiment, readExperiment, type ExperimentPageData, type Notebook } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { runningPass } from './experiment-runner.js';

type Ctx = ReturnType<typeof getContext>;

/** An experiment's results for a notebook's page, from its latest pass. Undefined when the experiment is gone. */
export function experimentDataFor(ctx: Ctx, experimentId: string): ExperimentPageData | undefined {
  try {
    const s = ExperimentStore.fromHandle(ctx.runStore.databaseHandle());
    const e = s.get(experimentId);
    if (!e) return undefined;
    const pass = s.passes(e.id, 1)[0];
    return experimentPageData(e, pass ? s.cells(pass.id) : [], pass ? s.scores(pass.id) : [], { running: !!runningPass(ctx, e.id) });
  } catch {
    return undefined;
  }
}

/**
 * The notebook that shows this experiment, made when there isn't one: its
 * title and what it's for are the experiment's name and question, its page
 * is laid out for this experiment's conditions and scorers, and it has no
 * steps of its own (the experiment is run from its own page). An archived
 * one is restored, not replaced.
 */
export function notebookForExperiment(ctx: Ctx, experimentId: string): { notebook: Notebook; made: boolean } {
  const e = ExperimentStore.fromHandle(ctx.runStore.databaseHandle()).get(experimentId);
  if (!e) throw new Error('No such experiment.');
  const nbs = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
  const have = nbs.forExperiment(e.id);
  if (have) {
    if (have.archivedAt) nbs.unarchive(have.id);
    return { notebook: nbs.get(have.id)!, made: false };
  }
  const nb = nbs.create({ title: e.name, statement: e.question || `What changes what ${e.task.agentId} produces, measured from its runs.`, params: [], criteria: [] });
  // Nothing to set up or search for: its content is the experiment's.
  nbs.markSetup(nb.id);
  nbs.setLayout(nb.id, experimentLayout(e), 'experiment');
  nbs.setExperiment(nb.id, e.id);
  nbs.addEntry(nb.id, { kind: 'note', title: 'Shows an experiment', body: `This notebook shows the results of the experiment [${e.name}](/experiments/${encodeURIComponent(e.id)}). The runs are made and kept there; this page reads them each time it opens.`, by: 'sua' });
  return { notebook: nbs.get(nb.id)!, made: true };
}

/**
 * The operator's experiments as sua is told them: the newest ten, each
 * with how it stands and what it found in the words its page uses (counted
 * from its runs), so sua repeats the finding and never makes one up.
 */
export function experimentsForTriage(ctx: Ctx): string {
  try {
    const s = ExperimentStore.fromHandle(ctx.runStore.databaseHandle());
    const nbs = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
    return JSON.stringify(s.list().slice(0, 10).map((e) => {
      const d = experimentDataFor(ctx, e.id);
      const nb = nbs.forExperiment(e.id);
      return {
        id: e.id, name: e.name, ...(e.question ? { question: e.question } : {}), runs: e.task.agentId,
        changes: e.factors.map((f) => `${f.name}: ${f.levels.map((l) => l.name).join(' | ')}`),
        stands: d?.runs ?? 'not run yet',
        ...(d && d.label !== 'Not run yet' ? { found: d.headline.replace(/\*\*/g, ''), restsOn: d.rests } : {}),
        link: `/experiments/${encodeURIComponent(e.id)}`,
        ...(nb && !nb.archivedAt ? { notebook: `/notebooks/${encodeURIComponent(nb.id)}` } : {}),
      };
    }));
  } catch {
    return '[]';
  }
}

/** An experiment as it is mentioned elsewhere: on the page of the agent it ran. */
export interface ExperimentMention { id: string; name: string; href: string; stands: string; found?: string; restsOn?: string }

/**
 * The experiments that ran an agent, newest first, each with what it found
 * in its page's words (counted from its runs). Never throws: a page that
 * mentions them still renders.
 */
export function experimentsOn(ctx: Ctx, of: { agentId: string }): ExperimentMention[] {
  try {
    const s = ExperimentStore.fromHandle(ctx.runStore.databaseHandle());
    const mine = s.list().filter((e) => e.task.agentId === of.agentId).slice(0, 8);
    return mine.map((e) => {
      const d = experimentDataFor(ctx, e.id);
      const ran = !!d && d.label !== 'Not run yet';
      return {
        id: e.id, name: e.name, href: `/experiments/${encodeURIComponent(e.id)}`, stands: d?.runs ?? 'not run yet',
        // The finding alone, without the figures after it.
        ...(ran ? { found: (/^\*\*(.+?)\*\*/.exec(d.headline)?.[1] ?? d.headline).trim(), restsOn: d.rests } : {}),
      };
    });
  } catch {
    return [];
  }
}

/** Experiments read in full into one conversation turn, at most, and how much of each. */
const LINKED_MAX = 2;
const LINKED_CHARS = 6000;

/**
 * The experiments a thread links (`/experiments/<id>`, newest mention
 * first) or that the latest message names by their name, as experiment-read
 * reads them, for EXPERIMENTS_LINKED: so "what did the build experiment
 * find about the Anthropic role?" can be answered from its conditions and
 * item table, not only its headline. Archived ones too.
 */
export function experimentsLinked(ctx: Ctx, texts: readonly string[], named: readonly string[] = []): string {
  try {
    const s = ExperimentStore.fromHandle(ctx.runStore.databaseHandle());
    const ids: string[] = [];
    for (const text of texts) {
      for (const m of [...text.matchAll(/\/experiments\/([A-Za-z0-9_-]+)/g)].reverse()) if (!ids.includes(m[1]) && m[1] !== 'new' && m[1] !== 'sets') ids.push(m[1]);
    }
    // Named in so many words: its whole name appears in what they said.
    for (const said of named) {
      const lower = said.toLowerCase();
      for (const e of s.list({ archived: true })) if (e.name.length >= 8 && lower.includes(e.name.toLowerCase()) && !ids.includes(e.id)) ids.push(e.id);
    }
    const out: string[] = [];
    for (const id of ids) {
      if (out.length >= LINKED_MAX) break;
      const found = findExperiment(s, id);
      const read = found && 'experiment' in found ? readExperiment(s, found.experiment.id) : undefined;
      if (!read) continue;
      const text = experimentReadoutText(read);
      out.push(text.length > LINKED_CHARS ? `${text.slice(0, LINKED_CHARS)}\n…(cut short; the rest is on its page)` : text);
    }
    return out.join('\n\n────────\n\n');
  } catch {
    return '';
  }
}
