/**
 * An answer notebook's check step (ADR-0082): it has no options to check, so
 * it traces the answer's sources instead. Each page the notebook learned
 * from was filed with a quote copied from it; code reads the page and looks
 * for that quote word for word (no model). What it finds is kept on each
 * source, and a finding resting on them says whether it's verified,
 * supported or unverified.
 */
import { answerTracePages, evidenceQuote, traceQuote, type NotebookEntry, type NotebookStore, type SourceTraceStatus } from '@some-useful-agents/core';

/** At most this many pages read per press, a few at a time. */
const MAX_PAGES = 30;
const AT_ONCE = 4;

const pageKey = (u: string) => u.toLowerCase().replace(/[#?].*$/, '').replace(/\/+$/, '');

export interface TraceOutcome { found: number; missing: number; unread: number; noQuote: number; left: number }

/** Trace the pages not traced yet; every entry filed from one page gets that page's result. */
export async function traceAnswerSources(store: NotebookStore, notebookId: string, trace?: (url: string, quote: string) => Promise<SourceTraceStatus>): Promise<TraceOutcome> {
  const read = trace ?? ((u: string, q: string) => traceQuote(u, q));
  const entries = store.entries(notebookId, 1000);
  const todo = answerTracePages(entries).filter((e) => !e.trace);
  const now = todo.slice(0, MAX_PAGES);
  const out: TraceOutcome = { found: 0, missing: 0, unread: 0, noQuote: 0, left: todo.length - now.length };
  const samePage = (e: NotebookEntry) => entries.filter((x) => x.kind === 'evidence' && x.fingerprint && pageKey(x.fingerprint) === pageKey(e.fingerprint!));
  let next = 0;
  const worker = async () => {
    while (next < now.length) {
      const e = now[next++];
      // A page filed twice: any of its quotes found counts.
      const quotes = [...new Set(samePage(e).map((x) => evidenceQuote(x.body)).filter(Boolean))];
      let status: SourceTraceStatus = 'no-quote';
      for (const q of quotes) {
        const s = await read(e.fingerprint!, q).catch((): SourceTraceStatus => 'unread');
        if (s === 'found' || status === 'no-quote' || (status === 'unread' && s === 'missing')) status = s;
        if (s === 'found') break;
      }
      for (const x of samePage(e)) store.setEntryTrace(notebookId, x.id, status);
      if (status === 'found') out.found++; else if (status === 'missing') out.missing++; else if (status === 'unread') out.unread++; else out.noQuote++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, now.length) }, worker));
  return out;
}

/** What a trace found, in a line ("9 quotes found on their pages · 2 not found · 1 page couldn't be read"). */
export function traceWords(o: TraceOutcome): string {
  const n = (k: number, one: string, many: string) => `${String(k)} ${k === 1 ? one : many}`;
  return [
    `${n(o.found, 'quote', 'quotes')} found on ${o.found === 1 ? 'its page' : 'their pages'}`,
    o.missing ? `${n(o.missing, 'not found word for word', 'not found word for word')}` : '',
    o.unread ? `${n(o.unread, "page couldn't be read", "pages couldn't be read")}` : '',
    o.noQuote ? `${n(o.noQuote, 'source had no quote', 'sources had no quote')}` : '',
    o.left ? `${String(o.left)} left for next time` : '',
  ].filter(Boolean).join(' · ');
}
