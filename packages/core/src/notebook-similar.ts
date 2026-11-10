/**
 * Notebooks like an ask: when someone asks for a new notebook, the ones they
 * already have that it could be. Two ways a notebook is "like" the ask:
 *
 *  - `same-topic`: it's about the same thing ("a used SUV" again; a meeting
 *    with the same person). Run it again, or open it, rather than start over.
 *  - `same-kind`: the same kind of notebook about someone or something else
 *    (a meeting with another person, a briefing on another company). Set the
 *    new one up like it, with its subject swapped.
 *
 * No model: words in the ask against the notebook's title, goal, limits,
 * topic tags and subject (who or what it's about, NotebookTags.subject).
 * It errs toward offering a candidate: sua's triage reads the candidates and
 * makes the call, and the New notebook page words its hint as a maybe.
 */
import { notebookTags, type Notebook } from './notebooks.js';

/** What a notebook is for: preparing for a meeting, a report or answer, a plan, or choosing between options. */
export type NotebookPurpose = 'meeting' | 'report' | 'plan' | 'choose';

const MEETING = /\b(meeting|interview)\b|\b(meet|call) with\b/i;
const PLAN = /\b(plan|itinerary|trip|schedule for)\b/i;
const REPORT = /\b(report|research|answer|find out|understand|worth it|brief|briefing)\b/i;
const CHOOSE = /\b(choose|pick|buy|shortlist|compare|decide|find|search for|shop for|looking for|options)\b/i;

/** What a notebook is for, from its page, steps and words. Pure. */
export function notebookPurpose(nb: Pick<Notebook, 'title' | 'layout' | 'steps' | 'statement'>): NotebookPurpose {
  const words = `${nb.title} ${nb.statement} ${nb.layout?.about ?? ''}`;
  if (nb.layout?.preset === 'dossier' || nb.steps?.some((s) => s.kind === 'profile') || MEETING.test(words)) return 'meeting';
  if (PLAN.test(words)) return 'plan';
  if (REPORT.test(words) || /\?\s*$/.test(nb.title) || (nb.layout && !nb.layout.preset && nb.steps?.some((s) => s.kind === 'write'))) return 'report';
  return 'choose';
}

/** What an ask is for, when its words say (the same words notebookPurpose reads); otherwise undefined. Pure. */
export function requestPurpose(text: string): NotebookPurpose | undefined {
  if (MEETING.test(text)) return 'meeting';
  if (PLAN.test(text)) return 'plan';
  if (REPORT.test(text) || /\?\s*$/.test(text.trim())) return 'report';
  if (CHOOSE.test(text)) return 'choose';
  return undefined;
}

/** Words that say nothing about the topic: grammar, and the words for asking for or naming a kind of notebook. */
const SKIP = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'about', 'under', 'over', 'your', 'my', 'me', 'our', 'their', 'his', 'her', 'its',
  'of', 'in', 'on', 'at', 'to', 'by', 'or', 'an', 'as', 'is', 'it', 'be', 'are', 'was', 'can', 'you', 'please', 'some', 'any', 'one', 'each', 'than', 'then', 'who', 'what', 'which', 'how', 'where', 'when',
  'new', 'another', 'again', 'notebook', 'notebooks', 'create', 'start', 'make', 'set', 'build', 'run', 'help', 'need', 'want', 'like', 'would', 'get', 'give', 'show',
  'find', 'search', 'look', 'looking', 'buy', 'choose', 'pick', 'compare', 'decide', 'best', 'good', 'great', 'top',
  'meeting', 'meet', 'call', 'interview', 'prepare', 'prep', 'brief', 'briefing', 'report', 'research', 'plan', 'answer', 'shortlist', 'options', 'option',
]);

/** A text's words, lower case, a plural's final "s" dropped ("cars" → "car"). Keeps short ones ("AI", "PM") and any alphabet. */
const words = (text: string): string[] => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));

/** The words of a text that say what it's about (2+ characters, none of SKIP). Pure. */
export function topicWords(text: string): Set<string> {
  return new Set(words(text).filter((w) => w.length >= 2 && !SKIP.has(w)));
}

export interface SimilarNotebook {
  notebook: Notebook;
  match: 'same-topic' | 'same-kind';
  /** Higher is closer; only for ordering. */
  score: number;
}

/** A same-topic notebook with no subject shares at least this many topic words with the ask, covering at least this share of the ask's. */
const MIN_SHARED = 2;
const MIN_COVER = 0.6;

/**
 * The notebooks an ask could be, closest first: same-topic ones, then at most
 * one same-kind one. A notebook run again several times (same title) counts
 * once: the one in use, else the newest. Archived ones are included. Pure.
 */
export function similarNotebooks(request: string, notebooks: readonly Notebook[], limit = 3): SimilarNotebook[] {
  const ask = topicWords(request);
  if (!ask.size) return [];
  const said = new Set(words(request));
  const purpose = requestPurpose(request);

  // One of each run-again chain: not archived first, then the most recently changed.
  const byTitle = new Map<string, Notebook>();
  for (const nb of [...notebooks].sort((a, b) => Number(!!a.archivedAt) - Number(!!b.archivedAt) || b.updatedAt.localeCompare(a.updatedAt))) {
    const key = nb.title.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!byTitle.has(key)) byTitle.set(key, nb);
  }

  const topic: SimilarNotebook[] = [];
  const kind: SimilarNotebook[] = [];
  for (const nb of byTitle.values()) {
    const has = topicWords([nb.title, nb.statement, ...nb.params, ...notebookTags(nb)].join(' '));
    const shared = [...ask].filter((w) => has.has(w)).length;
    const cover = shared / ask.size;
    const subject = words(nb.tags?.subject ?? '');
    if (subject.length) {
      // About someone or something by name: the same notebook only when the ask names them too.
      if (subject.every((w) => said.has(w))) topic.push({ notebook: nb, match: 'same-topic', score: 2 + cover });
      // Otherwise the same kind for someone else. A choice between things also has to share a topic word ("running shoes").
      else if (purpose && purpose === notebookPurpose(nb) && (purpose !== 'choose' || shared >= 1)) kind.push({ notebook: nb, match: 'same-kind', score: cover });
    } else if (shared >= MIN_SHARED && cover >= MIN_COVER) {
      topic.push({ notebook: nb, match: 'same-topic', score: 1 + cover });
    }
  }
  const order = (a: SimilarNotebook, b: SimilarNotebook) => b.score - a.score || Number(!!a.notebook.archivedAt) - Number(!!b.notebook.archivedAt) || b.notebook.updatedAt.localeCompare(a.notebook.updatedAt);
  return [...topic.sort(order), ...kind.sort(order).slice(0, 1)].slice(0, limit);
}
