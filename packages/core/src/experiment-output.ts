/**
 * What a run produced, as a list of items an experiment can compare
 * (ADR-0078). An experiment runs the whole agent once per version; to say
 * whether two runs found the same things, each run's output is read into
 * items, in code:
 *
 * - JSON anywhere in the output (the whole of it, a fenced block, a tagged
 *   block): the largest list of objects. An item's title is its title-like
 *   field; its link, when it has one; its other short fields are its facts.
 * - Otherwise a bulleted or numbered list: a line an item.
 *
 * Two items are the same when their keys are: the link when both have one
 * (host and path, nothing after), else the title's words, with who it's
 * from when stated. Nothing is guessed: an output with no list reads as no
 * items, and its run is not counted.
 */

/** One thing a run's output lists. */
export interface OutputItem {
  /** What makes it the same item in another run's output. */
  key: string;
  title: string;
  link?: string;
  /** Its other short fields, by label. */
  facts: Record<string, string>;
}

const TITLE_KEYS = ['title', 'name', 'headline', 'role', 'job_title', 'jobtitle', 'position', 'label', 'product', 'item', 'subject'];
const ORG_KEYS = ['company', 'org', 'organization', 'organisation', 'employer', 'brand', 'seller', 'source'];
const LINK_KEYS = ['url', 'link', 'href', 'posting_url', 'page', 'apply_url'];
const SKIP_KEYS = /^(id|uuid|image|img|photo|thumbnail|index)$/i;

const short = (v: unknown): string | undefined => {
  if (typeof v === 'string') { const s = v.replace(/\s+/g, ' ').trim(); return s ? s.slice(0, 300) : undefined; }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (typeof o.min === 'number' && typeof o.max === 'number') return `${String(o.min)}–${String(o.max)}`;
    const parts = Object.entries(o).filter(([, x]) => typeof x === 'string' || typeof x === 'number').slice(0, 4).map(([k, x]) => `${k}: ${String(x)}`);
    return parts.length ? parts.join(', ').slice(0, 300) : undefined;
  }
  if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string' || typeof x === 'number')) return v.slice(0, 8).join(', ').slice(0, 300);
  return undefined;
};
const label = (k: string) => { const s = k.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim(); return s.charAt(0).toUpperCase() + s.slice(1); };
const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

/** A link as a key: its host (without www) and path, nothing after; undefined when it isn't a web address. */
export function linkKey(link: string | undefined): string | undefined {
  if (!link || !/^https?:\/\//i.test(link)) return undefined;
  try { const u = new URL(link); return `${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '').toLowerCase()}`; } catch { return undefined; }
}

/** What makes an item the same one elsewhere: its link, else its title's words with who it's from. */
export function itemKey(title: string, link?: string, org?: string): string {
  const byLink = linkKey(link);
  if (byLink && byLink.includes('/')) return `link:${byLink}`;
  const t = words(title);
  const o = org ? words(org) : '';
  return `name:${o && !t.includes(o) ? `${t} | ${o}` : t}`.slice(0, 240);
}

function itemOf(o: Record<string, unknown>): OutputItem | undefined {
  const keys = Object.keys(o);
  const find = (names: readonly string[]) => names.map((t) => keys.find((k) => k.toLowerCase() === t)).find((k) => k && typeof o[k] === 'string' && (o[k] as string).trim());
  const linkKeyName = find(LINK_KEYS) ?? keys.find((k) => typeof o[k] === 'string' && /^https?:\/\/\S+$/i.test((o[k] as string).trim()));
  const orgKey = find(ORG_KEYS);
  const titleKey = find(TITLE_KEYS) ?? orgKey
    ?? keys.find((k) => typeof o[k] === 'string' && (o[k] as string).trim().length > 2 && !/^https?:/i.test(o[k] as string) && !SKIP_KEYS.test(k));
  if (!titleKey) return undefined;
  const title = (o[titleKey] as string).replace(/\s+/g, ' ').trim().slice(0, 200);
  const link = linkKeyName ? (o[linkKeyName] as string).trim().slice(0, 500) : undefined;
  const facts: Record<string, string> = {};
  for (const k of keys) {
    if (k === titleKey || k === linkKeyName || SKIP_KEYS.test(k)) continue;
    const v = short(o[k]);
    if (v && !/^https?:\/\/\S+$/i.test(v)) facts[label(k)] = v;
    if (Object.keys(facts).length === 12) break;
  }
  const org = orgKey && orgKey !== titleKey ? (o[orgKey] as string) : undefined;
  return { key: itemKey(title, link, org), title, ...(link ? { link } : {}), facts };
}

function lists(v: unknown, depth = 0, out: Array<Array<Record<string, unknown>>> = []): Array<Array<Record<string, unknown>>> {
  if (depth > 4 || !v || typeof v !== 'object') return out;
  if (Array.isArray(v)) {
    const objs = v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x));
    if (objs.length >= 1 && objs.length === v.length) out.push(objs);
    for (const x of v.slice(0, 50)) lists(x, depth + 1, out);
  } else for (const x of Object.values(v as Record<string, unknown>)) lists(x, depth + 1, out);
  return out;
}

function jsonIn(text: string): unknown[] {
  const tries = [text, ...[...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]), ...[...text.matchAll(/<([a-z][a-z0-9_-]*)>\s*([[{][\s\S]*?[\]}])\s*<\/\1>/gi)].map((m) => m[2])];
  const a = text.indexOf('['); const b = text.lastIndexOf(']');
  if (a >= 0 && b > a) tries.push(text.slice(a, b + 1));
  const c = text.indexOf('{'); const d = text.lastIndexOf('}');
  if (c >= 0 && d > c) tries.push(text.slice(c, d + 1));
  const out: unknown[] = [];
  for (const t of tries) { try { out.push(JSON.parse(t.trim())); } catch { /* not JSON */ } }
  return out;
}

/** Items a run's output may hold, at most. */
export const OUTPUT_ITEMS_MAX = 100;

/**
 * The items an output lists, in the order it lists them (at most 100; one
 * of the same key is kept once). `listed` says whether a list was found at
 * all: an output that lists nothing on purpose ("[]") is a result, an
 * output with no list isn't one. Pure.
 */
export function readOutput(text: string | undefined): { listed: boolean; items: OutputItem[] } {
  const raw = (text ?? '').slice(0, 400_000);
  let best: OutputItem[] | undefined;
  let sawList = false;
  for (const v of jsonIn(raw)) {
    if (Array.isArray(v) && v.length === 0) sawList = true;
    for (const l of lists(v)) {
      const items = l.map(itemOf).filter((x): x is OutputItem => !!x);
      // Most of the list has to read as items, or it's some other list (log lines, steps).
      if (items.length && items.length * 2 >= l.length && items.length > (best?.length ?? 0)) best = items;
    }
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.values(v as Record<string, unknown>).some((x) => Array.isArray(x) && x.length === 0)) sawList = true;
  }
  if (!best) {
    const lines = raw.split(/\r?\n/).map((x) => /^\s*(?:[-*•]|\d{1,3}[.)])\s+(.+)$/.exec(x)?.[1]?.trim()).filter((x): x is string => !!x && x.length > 2);
    if (lines.length >= 2) best = lines.map((x) => { const t = x.replace(/\*\*/g, ''); const link = /https?:\/\/\S+/.exec(t)?.[0]?.replace(/[).,]+$/, ''); const title = t.replace(/\(?https?:\/\/\S+\)?/g, '').replace(/\[([^\]]+)\]/g, '$1').replace(/\s+/g, ' ').trim().slice(0, 200) || t.slice(0, 200); return { key: itemKey(title, link), title, ...(link ? { link } : {}), facts: {} }; });
  }
  if (!best) return { listed: sawList, items: [] };
  const seen = new Set<string>();
  return { listed: true, items: best.filter((i) => { if (seen.has(i.key)) return false; seen.add(i.key); return true; }).slice(0, OUTPUT_ITEMS_MAX) };
}
