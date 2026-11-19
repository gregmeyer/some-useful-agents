/**
 * Tracing an answer's sources (SIFT: trace claims to their source, ADR-0082).
 * Each page an answer learned from was filed with a quote copied from it;
 * the check step reads the page and looks for that quote word for word, so
 * a finding resting on it can say whether what it cites is really there.
 * The comparison is pure; reading the page goes through web-fetch (its
 * address guard, redirects re-checked, a browser for pages that need one).
 */
import { httpFetch } from './web-fetch/fetch.js';
import { webFetch } from './web-fetch/index.js';
import type { NotebookSourceOrigin } from './notebook-source-origin.js';

/** found: the quote is on its page; missing: the page was read and it isn't; unread: the page couldn't be read (blocked, gone, timed out); no-quote: it was filed without one. */
export const TRACE_STATUSES = ['found', 'missing', 'unread', 'no-quote'] as const;
export type SourceTraceStatus = typeof TRACE_STATUSES[number];
export interface NotebookSourceTrace { status: SourceTraceStatus; at: string }

/** What an answer's finding rests on, from the sources it cites: verified (a quote found on a primary page), supported (found on another page), unverified (none found). */
export type FindingTrace = 'verified' | 'supported' | 'unverified';

/** The quote an evidence entry was filed with: its body opens with it in quotes (`"…" Title (found by …)`). '' when it has none. */
export function evidenceQuote(body: string): string {
  const b = body.trim();
  if (!b.startsWith('"')) return '';
  const end = b.indexOf('" ', 1);
  const q = (end > 0 ? b.slice(1, end) : b.endsWith('"') ? b.slice(1, -1) : '').trim();
  return q;
}

const REPL: Record<string, string> = { '“': '"', '”': '"', '‘': "'", '’': "'", ' ': ' ', '—': '-', '–': '-', '…': '...' };

/** Text as compared: curly quotes and dashes made plain, markdown marks and links reduced to their words, spacing and case folded. */
export function traceText(s: string): string {
  return [...(s ?? '').normalize('NFKC')].map((ch) => REPL[ch] ?? ch).join('')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>|]+/g, ' ')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

/** A page's words from its HTML: no scripts or styles, tags gone, entities read. */
export function htmlText(html: string): string {
  return html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}

/**
 * Whether a quote is in a page's text word for word (15 characters at least,
 * so a stray phrase doesn't count). Spacing doesn't count: a page's markup
 * leaves spaces where the words have none ("open , lightweight", "( frontend").
 */
export function quoteOnPage(quote: string, pageText: string): boolean {
  const q = traceText(quote).replace(/^\.\.\.\s*|\s*\.\.\.$/g, '');
  const bare = (t: string) => t.replace(/\s+/g, '');
  return q.length >= 15 && bare(traceText(pageText)).includes(bare(q));
}

/** A bot check in place of the page. */
const CHALLENGE = /just a moment\.\.\.|cf-chl|attention required|px-captcha|captcha|verify you are (a )?human|enable javascript and cookies/i;

/**
 * Read a page and look for a quote on it: its HTML as downloaded first, then
 * (not found there, or nothing readable) the page as web-fetch reads it,
 * which renders it in a browser when the download is thin. Never throws.
 */
export async function traceQuote(url: string, quote: string, read: { http?: (u: string) => Promise<string>; rendered?: (u: string) => Promise<string> } = {}): Promise<SourceTraceStatus> {
  if (!quote.trim()) return 'no-quote';
  if (!/^https?:\/\//i.test(url)) return 'unread';
  const http = read.http ?? (async (u: string) => { const raw = await httpFetch(u, { timeoutSec: 10, maxBytes: 3_000_000 }); return raw.html.length < 20000 && CHALLENGE.test(raw.html) ? '' : htmlText(raw.html); });
  const rendered = read.rendered ?? (async (u: string) => (await webFetch(u, { timeoutSec: 15, maxChars: 400_000 })).content ?? '');
  let readAny = false;
  for (const get of [http, rendered]) {
    let text = '';
    try { text = await get(url); } catch { text = ''; }
    if (text.trim().length > 200) readAny = true;
    if (quoteOnPage(quote, text)) return 'found';
  }
  return readAny ? 'missing' : 'unread';
}

/** Whether a stored trace is one (undefined when it isn't). */
export function parseSourceTrace(v: unknown): NotebookSourceTrace | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  return typeof o.status === 'string' && (TRACE_STATUSES as readonly string[]).includes(o.status) && typeof o.at === 'string'
    ? { status: o.status as SourceTraceStatus, at: o.at } : undefined;
}

/**
 * How a finding's sources traced: verified when a cited quote was found on a
 * primary page (the thing itself: its spec, docs, repo, a standards body),
 * supported when found on another page, unverified when the cited sources
 * were traced and none was found; undefined while none has been traced (or
 * none had a quote to look for).
 */
export function findingTrace(cited: ReadonlyArray<{ trace?: NotebookSourceTrace; origin?: NotebookSourceOrigin }>): FindingTrace | undefined {
  // A source filed without a quote can't be checked: it neither confirms nor undercuts.
  const traced = cited.filter((c) => c.trace && c.trace.status !== 'no-quote');
  if (!traced.length) return undefined;
  const found = traced.filter((c) => c.trace!.status === 'found');
  if (found.some((c) => c.origin?.kind === 'primary')) return 'verified';
  return found.length ? 'supported' : 'unverified';
}
