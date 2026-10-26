/**
 * Why a notebook step came out short, in plain words, from what its last try
 * did: where its search looked and what each place gave, what it found that
 * the notebook already had or had ruled out, a run that didn't finish, a
 * page reader that was blocked, and what the agent said about it. The step
 * keeps it (NotebookStep.why) and its row and card show it. Pure.
 */
import type { NotebookStep } from '@some-useful-agents/core';
import type { KeeperOutcome } from './notebook-pipeline.js';

/** One try of a step that runs an agent. */
export interface StepTry {
  status: 'completed' | 'failed' | 'stopped';
  /** A run that didn't complete: its error. */
  error?: string;
  /** A completed run whose own steps didn't all finish (shortSteps). */
  short?: string;
  /** What filing the run did. */
  out?: KeeperOutcome;
}

/** "A", "A and B", "A, B and C". */
export function andList(xs: readonly string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/** A run's error, as a few words: "timed out", "ran out of turns", "hit a rate limit", else its first sentence. */
export function errorWords(error?: string): string {
  const e = (error ?? '').replace(/\s+/g, ' ').trim();
  if (/max_turns|maximum number of turns|out of turns/i.test(e)) return 'ran out of turns';
  if (/timed? ?out|timeout/i.test(e)) return 'timed out';
  if (/rate.?limit|\b429\b/i.test(e)) return 'hit a rate limit';
  if (!e) return 'failed';
  const first = e.split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, '');
  return `failed (${first.length > 90 ? `${first.slice(0, 89)}…` : first})`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;
const sentence = (s: string) => (s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}${/[.!?”"]$/.test(s) ? '' : '.'}` : '');

/** What the places a search looked gave: "Searched Craigslist and OfferUp: neither had a match. Autotrader blocked the search." */
function searchedWords(sources: NonNullable<KeeperOutcome['sources']>, options: number): string {
  const blocked = sources.filter((s) => s.status === 'blocked').map((s) => s.name);
  const empty = sources.filter((s) => s.status === 'none' || (s.status !== 'blocked' && s.status !== 'skipped' && s.found === 0)).map((s) => s.name);
  const gave = sources.filter((s) => s.status === 'found' && s.found > 0);
  const parts: string[] = [];
  if (empty.length) {
    const none = empty.length === 1 ? 'it had no match' : empty.length === 2 ? 'neither had a match' : 'none had a match';
    parts.push(`Its last search looked at ${andList(empty)}: ${none}`);
  }
  if (gave.length && options === 0) parts.push(`${andList(gave.map((s) => `${s.name} (${String(s.found)})`))} gave only ones it already has`);
  if (blocked.length) parts.push(`${andList(blocked)} blocked the search`);
  return parts.map(sentence).join(' ');
}

/**
 * Why a step that runs an agent stopped short of its goal. `stalled`: its
 * last try got it no closer (else it was still getting closer when it ran
 * out of tries this press). Undefined when there's nothing to say.
 */
export function stepWhy(step: Pick<NotebookStep, 'kind'>, last: StepTry | undefined, opts: { stalled: boolean; tries: number }): string | undefined {
  if (!last) return undefined;
  if (last.status === 'stopped') return 'You stopped it.';
  if (last.status === 'failed') return `Its last try ${errorWords(last.error)}, so it found nothing more.`;
  const out = last.out;
  const parts: string[] = [];
  if (!opts.stalled) parts.push(`It was still getting closer after ${plural(opts.tries, 'try', 'tries')}; Try again keeps going`);
  else if (out?.error) parts.push(`Its last try ran, but what it found couldn't be filed: ${out.error.replace(/\.$/, '')}`);
  else if (out) {
    const options = out.options ?? out.added;
    const known = [
      out.refreshed ? `${String(out.refreshed)} it already has` : '',
      out.ruledOutSeen ? `${String(out.ruledOutSeen)} already ruled out` : '',
    ].filter(Boolean);
    if (step.kind === 'find') {
      const searched = out.sources?.length ? searchedWords(out.sources, options) : '';
      if (searched) parts.push(searched);
      else if (options === 0) parts.push(`Its last search found no new ones${known.length ? `, only ${andList(known)}` : ''}`);
      if (out.ruledOutNew) parts.push(`${plural(out.ruledOutNew, 'new one')} it found didn't fit, so it ruled ${out.ruledOutNew === 1 ? 'it' : 'them'} out`);
      if (out.checksFailed) parts.push(`${plural(out.checksFailed, 'one')} failed a check and ${out.checksFailed === 1 ? 'was' : 'were'} ruled out`);
    } else if (step.kind === 'source') {
      parts.push(out.factsSet ? `Its last try filled in ${plural(out.factsSet, 'fact')}, but none that were still missing` : 'Its last try found none of the missing facts');
    } else if (step.kind === 'check') {
      parts.push(out.checksMet || out.checksFailed
        ? `Its last try settled ${plural((out.checksMet ?? 0) + (out.checksFailed ?? 0), 'check')}, but none still open`
        : "Its last try couldn't confirm any of the open checks from a source");
      if (out.checksKept) parts.push(`${plural(out.checksKept, 'one')} you chose failed a check and ${out.checksKept === 1 ? 'was' : 'were'} kept`);
    } else {
      parts.push('Its last try got it no closer');
    }
    if (out.factsDropped) parts.push(`${plural(out.factsDropped, 'number')} it gave ${out.factsDropped === 1 ? "wasn't" : "weren't"} in what it read, so ${out.factsDropped === 1 ? 'it was' : 'they were'} left out`);
  } else {
    parts.push('Its last try got it no closer');
  }
  if (last.short) parts.push(`Part of its run was cut short (${/out of turns/.test(last.short) ? 'out of turns' : /timed out/.test(last.short) ? 'timed out' : "didn't finish"})`);
  const said = out?.summary?.replace(/\s+/g, ' ').trim();
  const words = parts.map(sentence).join(' ');
  const all = said && opts.stalled ? `${words} It said: “${said.replace(/[.”"]+$/, '')}.”` : words;
  return all.length > 300 ? `${all.slice(0, 299)}…` : all || undefined;
}

/** Why a source step that reads each option's own page stopped short. */
export function perItemWhy(r: { read: number; pages: number; factsSet: number; blocked: readonly string[]; failed: number; noPage: number; stopped: boolean }): string {
  if (r.stopped) return 'You stopped it.';
  const parts = [
    r.blocked.length ? `${andList(r.blocked)} blocked the page reader` : '',
    r.failed ? `${plural(r.failed, 'page')} couldn't be read (the run failed)` : '',
    r.read && !r.factsSet ? `the ${plural(r.read, 'page')} it read didn't give the missing facts` : '',
    r.noPage ? `${plural(r.noPage, 'option')} ${r.noPage === 1 ? 'has' : 'have'} no page of ${r.noPage === 1 ? 'its' : 'their'} own to read` : '',
  ].filter(Boolean);
  return parts.length ? parts.map(sentence).join(' ') : 'Its last try got it no closer.';
}
