/**
 * The Edit page's starters ("Make the page lead with…") and, for each, what
 * can really finish the sentence for this notebook. A starter that ends in
 * "…" is a question; these are its answers: the parts this notebook's page
 * has something to show for, the kinds of step it doesn't have yet, facts it
 * doesn't note yet, done-whens it could add. Worked out from the notebook,
 * no model. Each option is a whole sentence to send (or to change first).
 */
import { rankBy, type Notebook } from '@some-useful-agents/core';
import { notebookLayoutFlags } from './notebook-widgets.js';

export interface EditStarter {
  /** The chip ("Make the page lead with…") and what it puts in the box. */
  label: string;
  text: string;
  /** What the options are, as a short label ("It can lead with"). */
  ask: string;
  /** Ways to finish the sentence: what the chip says, and the whole sentence it fills. */
  options: Array<{ label: string; text: string }>;
}

/** Facts a shortlist often notes, offered when the notebook doesn't note one like it yet. */
const COMMON_FACTS = ['price', 'rating', 'reviews', 'warranty', 'availability', 'shipping cost', 'return policy', 'seller', 'location', 'condition'];

export function editStarters(nb: Notebook, hasOptions: boolean): EditStarter[] {
  const flags = notebookLayoutFlags(nb, hasOptions);
  const by = rankBy(nb).field?.label.toLowerCase();
  const measure = nb.fields.find((f) => f.role === 'measure')?.label.toLowerCase();
  const price = nb.fields.find((f) => f.role === 'price')?.label.toLowerCase();
  const kinds = new Set((nb.steps ?? []).map((s) => s.kind));
  const writes = (nb.steps ?? []).some((s) => s.kind === 'write');
  const noted = nb.fields.map((f) => `${f.label} ${f.key}`.toLowerCase());
  const criteria = nb.criteria.map((c) => c.text.toLowerCase());

  // What this notebook's page has something to show for, strongest first.
  const lead: Array<[boolean, string, string]> = [
    // Said as what you'd see, never as how the page is built ("a large number", "a component").
    [flags.answered, 'the answer', 'the answer'],
    [flags.planned, 'the plan', 'the plan'],
    [!!nb.briefing?.points.length, 'the talking points', 'the talking points'],
    [flags.person, 'who they are', 'who they are, with their photo'],
    [flags.company && !flags.person, 'the company', 'the company and what it does'],
    [flags.decided, 'the decision', 'the decision and why'],
    [flags.options && flags.numbers, 'the best option', `the best option${by ? ` and its ${by}` : ''}`],
    [flags.options && flags.numbers, 'the top three, side by side', 'the top three options side by side'],
    [flags.options && flags.numbers && !!by, `a chart by ${by ?? ''}`, `a bar chart of the options by ${by ?? ''}`],
    [flags.options && flags.map && !!price && !!measure, `${price ?? ''} against ${measure ?? ''}`, `a chart of ${price ?? ''} against ${measure ?? ''}`],
    // About someone: its "options" are what they said, not things to choose between.
    [flags.options && !flags.about, 'the full list', 'the full list of options'],
    [flags.options && flags.about, 'what they said', 'what they said, with where each came from'],
    [flags.competitors, 'their competitors', "the company's competitors"],
    [nb.criteria.length > 0, 'how far along it is', "what's done and what's left"],
    [flags.funnel && flags.options && !flags.about, 'how far each got', 'how many options got to each step'],
  ];
  const steps: Array<[boolean, string, string]> = [
    [true, 'find more options', 'find more options'],
    [nb.fields.length > 0, 'look up missing facts', 'look up the facts that are still missing'],
    [nb.checks.length > 0 || !kinds.has('check'), 'check each one', nb.checks.length ? 'check each one against the checks' : 'check each one is still available'],
    [!kinds.has('narrow'), 'narrow to the top 5', 'narrow them to the top 5'],
    [!writes, 'write up what it found', 'write up what it found'],
    [!kinds.has('profile') && (flags.about || !!nb.meeting), 'learn who it is about', 'learn about the person or company it is about'],
    [!kinds.has('decide'), 'decide', 'pick the one to go with'],
  ];
  const facts = COMMON_FACTS.filter((f) => !noted.some((n) => n.includes(f.split(' ')[0]))).slice(0, 6);
  // A done-when it already has one like (by its key word) isn't offered again.
  const has = (word: RegExp) => criteria.some((c) => word.test(c));
  const dones: Array<[boolean, string, string]> = [
    [!has(/\bfound\b/), 'at least 5 are found', 'at least 5 options are found'],
    [!has(/\bcheck/), 'the top 3 are checked', 'the top 3 options are checked'],
    [!has(/\bdeci/), 'a decision is recorded', 'a decision is recorded'],
    [!has(/\bwrit|\banswer/), 'it is written up', 'what it found is written up'],
    [!has(/\bby \w+ \d|\bdeadline\b/), 'by a date', 'everything above is done by the end of the month'],
  ];
  const pick = (start: string, rows: Array<[boolean, string, string]>) =>
    rows.filter(([on]) => on).slice(0, 7).map(([, label, text]) => ({ label, text: `${start}${text}` }));
  return [
    { label: 'Add a step to…', text: 'Add a step to ', ask: 'A step to', options: pick('Add a step to ', steps) },
    { label: 'Make the page lead with…', text: 'Make the page lead with ', ask: 'This page can lead with', options: pick('Make the page lead with ', lead) },
    { label: "Also note each one's…", text: "Also note each one's ", ask: 'Not noted yet', options: facts.map((f) => ({ label: f, text: `Also note each one's ${f}` })) },
    { label: "It's done when…", text: "It's done when ", ask: 'For example', options: pick("It's done when ", dones) },
  ];
}
