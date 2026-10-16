/**
 * Reading a run's output as what it is (the agent page's Latest result, and a
 * run's page): a list of records reads as a table, a plain JSON answer as
 * labelled facts, and an empty value isn't shown at all. Pure helpers; the
 * renderers (lib/legacy-view.ts, views/run-detail.ts runWidget) lay them out.
 */
import { stripEnclosingCodeFence } from '../views/components.js';

/** Values that mean "nothing here" (a field with one of these isn't shown). */
export function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  const t = String(v).trim();
  return t === '' || t === '[]' || t === '{}' || t === 'null' || t === '""' || t === '—' || t === '-';
}

function parse(text: string): unknown {
  try { return JSON.parse(stripEnclosingCodeFence(text).trim()); } catch { return undefined; }
}

const isPlain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** One cell or fact as text: a list of words joined, anything nested kept short. */
export function cellText(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object')) return v.map((x) => String(x ?? '')).filter(Boolean).join(', ');
  const s = JSON.stringify(v);
  return s.length > 200 ? `${s.slice(0, 199)}…` : s;
}

/** A JSON list of records (objects), as rows of text; undefined when it isn't one. At most 200 rows. */
export function recordsOf(text: string): Array<Record<string, string>> | undefined {
  const v = parse(text);
  if (!Array.isArray(v) || !v.length || !v.every(isPlain)) return undefined;
  return (v as Array<Record<string, unknown>>).slice(0, 200).map((o) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, cellText(x)])));
}

/** "source_url" → "Source url". */
export function keyLabel(key: string): string {
  const t = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return t ? t[0]!.toUpperCase() + t.slice(1) : key;
}

const URL_RE = /^https?:\/\/\S+$/;

/** The table's columns: every key in order of first appearance (at most 10); a column of single links is a link column. */
export function recordColumns(rows: ReadonlyArray<Record<string, string>>): Array<{ key: string; label: string; format?: 'link' }> {
  const keys: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  return keys.slice(0, 10).map((key) => {
    const vals = rows.map((r) => r[key] ?? '').filter(Boolean);
    return { key, label: keyLabel(key), ...(vals.length && vals.every((x) => URL_RE.test(x)) ? { format: 'link' as const } : {}) };
  });
}

/**
 * A plain JSON answer (one object of facts) as labelled facts, in order; an
 * empty value says so. Undefined when the output isn't one object, or is too
 * big to read as facts (more than 30 of them).
 */
export function factsOf(text: string): Array<{ label: string; value: string }> | undefined {
  const v = parse(text);
  if (!isPlain(v)) return undefined;
  const entries = Object.entries(v);
  if (!entries.length || entries.length > 30) return undefined;
  return entries.map(([k, x]) => ({ label: keyLabel(k), value: isEmptyValue(x) ? '(empty)' : cellText(x) }));
}
