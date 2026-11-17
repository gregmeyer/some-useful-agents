/**
 * What a notebook's page and brief are given, tidied before it's shown: the
 * research writes some things in a form a reader shouldn't see (a raise as
 * "40000000", the same quote from two articles, a profile's stats kept as
 * "what they said"). Each of these is pure, and changes how a value reads,
 * never what the notebook stores.
 */

/**
 * Round figures written out as digits ("40000000") read as "40M"; with a "$"
 * when the passage the fact was read from gives money ("$40 million"). Only
 * whole hundred-thousands of a million or more, so a phone number, an id or
 * a year stays as it is.
 */
export function readableNumbers(text: string, quote?: string): string {
  const money = !!quote && /\$\s?\d/.test(quote);
  return text.replace(/(?<![\w.,$€£-])(\d{7,12})(?![\w%]|[.,]\d)/g, (all, digits: string) => {
    const n = Number(digits);
    if (!Number.isFinite(n) || n % 100000 !== 0) return all;
    const [div, unit] = n >= 1e9 ? [1e9, 'B'] : [1e6, 'M'];
    const short = (n / div).toFixed(1).replace(/\.0$/, '');
    return `${money ? '$' : ''}${short}${unit}`;
  });
}

/** A quote with its marks in pairs: a closing mark with no opening one (cut from mid-article) goes. */
export function cleanQuote(q: string): string {
  const t = q.trim();
  const open = (t.match(/“/g) ?? []).length;
  const close = (t.match(/”/g) ?? []).length;
  if (open === close) return t;
  return t.replace(/[“”]/g, '').replace(/\s+([,.;])/g, '$1').trim();
}

const quoteKey = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The same words said (one line carried by two articles): the same from the start for a good stretch. */
export function sameQuote(a: string, b: string): boolean {
  const x = quoteKey(a);
  const y = quoteKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const n = Math.min(x.length, y.length, 60);
  return n >= 40 && x.slice(0, n) === y.slice(0, n);
}

/** Each thing said once, the first kept. */
export function uniqueQuotes<T extends { quote: string }>(all: readonly T[]): T[] {
  const out: T[] = [];
  for (const q of all) if (!out.some((o) => sameQuote(o.quote, q.quote))) out.push(q);
  return out;
}

/** The fact that holds a pull quote you chose ("use this line of theirs instead"). */
export const PULL_QUOTE_KEY = 'pull_quote';

/** What's kept about one of them, as far as the pull quote goes. */
interface PullQuoteAbout {
  facts: readonly { key: string; value: string }[];
  conflicts?: readonly { fact: string; settled?: { wrong?: readonly string[] } }[];
}

/**
 * The page's pull quote and the quotes after it. The one you chose leads (it
 * needn't be among the kept quotes; when a kept quote holds its words, that
 * quote leads, word for word); else the first that reads as said. Lines you
 * said aren't theirs are out of both. Pure.
 */
export function pullQuoteOf<T extends { quote: string }>(about: PullQuoteAbout | undefined, all: readonly T[]): { lead?: string; from?: T; quotes: T[]; others: T[] } {
  const yours = about?.facts.find((f) => f.key === PULL_QUOTE_KEY)?.value.trim();
  const wrong = about?.conflicts?.find((c) => c.fact === PULL_QUOTE_KEY)?.settled?.wrong ?? [];
  const quotes = all.filter((q) => !wrong.some((w) => sameQuote(w, q.quote)));
  if (yours) {
    const key = quoteKey(yours);
    const kept = quotes.find((q) => sameQuote(q.quote, yours) || (key.length >= 20 && quoteKey(q.quote).includes(key)));
    return { lead: kept?.quote ?? yours, ...(kept ? { from: kept } : {}), quotes, others: quotes.filter((q) => q !== kept) };
  }
  const at = quotes.findIndex((q) => saidLike(q.quote));
  return { ...(at >= 0 ? { lead: quotes[at].quote, from: quotes[at] } : {}), quotes, others: quotes.filter((_, i) => i !== at) };
}

/**
 * Whether a kept "quote" reads as something a person said, fit to lead a page:
 * a sentence, not a profile's stats stitched together ("Investment Range $25K
 * - $50K ... Investments On Record 8").
 */
export function saidLike(q: string): boolean {
  const words = q.trim().split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (words.length < 3 || /\s\.\.\.\s|…/.test(q)) return false;
  const titled = words.filter((w) => /^[A-Z]/.test(w)).length;
  return titled / words.length < 0.5;
}

/** What you gave, named as it should read: their name and "LinkedIn" in their own capitals, however it was typed. */
export function tidyGiven(label: string, names: readonly string[]): string {
  let out = label.replace(/\blinkedin\b/gi, 'LinkedIn');
  for (const name of names) {
    if (!name.trim()) continue;
    out = out.replace(new RegExp(name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), name.trim());
  }
  return out;
}

const DANGLES = new Set(['by', 'of', 'and', 'the', 'with', 'for', 'to', 'in', 'at', 'on', 'a', 'an', 'or', 'from']);

/** A line cut off mid-sentence ("… and 200M (2022). Run by"): the stub after the last full sentence goes. */
export function trimDangling(text: string): string {
  const t = text.trim();
  const m = /^([\s\S]*[.!?])\s+([^.!?]*)$/.exec(t);
  if (!m) return t;
  const tail = m[2].trim().split(/\s+/);
  return tail.length <= 3 && DANGLES.has(tail[tail.length - 1].toLowerCase()) ? m[1] : t;
}

/** "Partner, Expa" as a role at a company: [company, role]; a bare name is the company. */
export function roleAtCompany(claim: string): { name: string; role?: string } {
  const at = claim.lastIndexOf(',');
  const name = at > 0 ? claim.slice(at + 1).trim() : '';
  return name ? { name, role: claim.slice(0, at).trim() } : { name: claim.trim() };
}
