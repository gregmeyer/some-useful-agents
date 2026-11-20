/**
 * A2UI values for printing (the brief and its PDF, ADR-0091): what a page's
 * prop says when it's drawn on paper, worked out on the server the way the
 * renderer works it out in the browser. A literal stays as it is; a binding,
 * `{ path }` or `{ "@path" }`, reads the data; a function call, `{ call, args }`
 * or `{ "@call", args }`, runs: formatString (with `${/path}` and
 * `${fn(arg:${/path})}`), formatNumber, formatCurrency, formatDate,
 * pluralize, sua's join, count, formatRange and relativeTime (the same words
 * as assets/sua-functions.js; a test keeps them in step), and the agent
 * functions through `agent` (findOptions, optionFacts). Anything else is
 * undefined. Pure but for the agent it's given.
 */
import { resolvePointer } from '@some-useful-agents/core';

export interface PrintValueContext {
  data: unknown;
  /** An agent function's answer (findOptions, optionFacts), or undefined. */
  agent?: (name: string, args: Record<string, unknown>) => unknown;
  now?: number;
}

/** "hotel, rental", with `last`: "hotel, rental and villa" (as the browser's join). */
export function joinWords(list: unknown, separator = ', ', last?: string): string {
  const xs = (Array.isArray(list) ? list : list === undefined || list === null || list === '' ? [] : [list]).map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x)));
  if (last && xs.length > 1) return `${xs.slice(0, -1).join(separator)}${last}${xs[xs.length - 1]}`;
  return xs.join(separator);
}

/** "3 days ago", "in 2 hours", "just now" (as the browser's relativeTime). */
export function relativeWords(iso: unknown, now = Date.now()): string {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return '';
  const s = Math.round((t - now) / 1000);
  if (Math.abs(s) < 45) return 'just now';
  const fmt = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of units) if (Math.abs(s) >= size) return fmt.format(Math.round(s / size), unit);
  return fmt.format(Math.round(s / 60), 'minute');
}

/** "$120K–$140K", "120–140" (as the browser's formatRange). */
export function rangeWords(min: unknown, max: unknown, currency?: string): string {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const lo = n(min), hi = n(max);
  const one = (v: number) => {
    if (!currency) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
    const short = Math.abs(v) >= 1000;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, ...(short ? { notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 } : { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }).format(v);
  };
  if (lo === undefined && hi === undefined) return '';
  if (lo === undefined || hi === undefined || lo === hi) return one((lo ?? hi)!);
  return `${one(lo)}–${one(hi)}`;
}

const asText = (v: unknown): string => (v === undefined || v === null ? '' : Array.isArray(v) ? joinWords(v) : typeof v === 'object' ? JSON.stringify(v) : String(v));
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);

function call(name: string, args: Record<string, unknown>, ctx: PrintValueContext): unknown {
  const a = Object.fromEntries(Object.entries(args).map(([k, x]) => [k, printValue(x, ctx)]));
  switch (name) {
    case 'formatString': return formatTemplate(asText(a.value), ctx);
    case 'join': return joinWords(a.value, typeof a.separator === 'string' ? a.separator : ', ', typeof a.last === 'string' ? a.last : undefined);
    case 'count': return Array.isArray(a.value) ? a.value.length : 0;
    case 'formatRange': return rangeWords(a.min, a.max, typeof a.currency === 'string' ? a.currency : undefined);
    case 'relativeTime': return relativeWords(a.value, ctx.now);
    case 'formatNumber': { const v = num(a.value); return v === undefined ? '' : v.toLocaleString('en-US', { maximumFractionDigits: num(a.decimals) ?? 2, ...(num(a.decimals) !== undefined ? { minimumFractionDigits: num(a.decimals) } : {}) }); }
    case 'formatCurrency': { const v = num(a.value); return v === undefined ? '' : new Intl.NumberFormat('en-US', { style: 'currency', currency: typeof a.currency === 'string' ? a.currency : 'USD', ...(num(a.decimals) !== undefined ? { minimumFractionDigits: num(a.decimals), maximumFractionDigits: num(a.decimals) } : {}) }).format(v); }
    case 'formatDate': { const t = Date.parse(asText(a.value)); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : ''; }
    case 'pluralize': { const v = num(a.value); const pick = v === 0 && a.zero !== undefined ? a.zero : v === 1 && a.one !== undefined ? a.one : a.other; return asText(pick); }
    default: return ctx.agent ? ctx.agent(name, a) : undefined;
  }
}

/** A formatString template: `${/path}` and `${fn(key:value, …)}`, innermost first (a value may itself be `${/path}`). */
export function formatTemplate(template: string, ctx: PrintValueContext): string {
  const held: unknown[] = [];
  const hold = (v: unknown) => `\u0000${String(held.push(v) - 1)}\u0000`;
  const lookup = (s: string): unknown => { const m = /^\u0000(\d+)\u0000$/.exec(s.trim()); return m ? held[Number(m[1])] : undefined; };
  let t = template;
  for (let guard = 0; guard < 50; guard++) {
    const m = /\$\{([^${}]*)\}/.exec(t);
    if (!m) break;
    const body = m[1].trim();
    const fn = /^([A-Za-z_][\w]*)\(([\s\S]*)\)$/.exec(body);
    let value: unknown;
    if (fn) {
      const args: Record<string, unknown> = {};
      for (const part of fn[2].split(',')) {
        const kv = /^\s*([A-Za-z_]\w*)\s*:\s*([\s\S]*?)\s*$/.exec(part);
        if (!kv) continue;
        const held1 = lookup(kv[2]);
        args[kv[1]] = held1 !== undefined ? held1 : /^-?\d+(\.\d+)?$/.test(kv[2]) ? Number(kv[2]) : kv[2].replace(/^['"]|['"]$/g, '');
      }
      value = call(fn[1], args, ctx);
    } else {
      value = resolvePointer(ctx.data, body.startsWith('/') ? body : `/${body}`);
    }
    t = t.slice(0, m.index) + hold(value) + t.slice(m.index + m[0].length);
  }
  return t.replace(/\u0000(\d+)\u0000/g, (_, i: string) => asText(held[Number(i)]));
}

/** A prop's value on paper: a literal, a binding read, or a function call run. */
export function printValue(v: unknown, ctx: PrintValueContext): unknown {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
  const o = v as Record<string, unknown>;
  const path = typeof o['@path'] === 'string' ? o['@path'] : typeof o.path === 'string' && typeof o.componentId !== 'string' ? o.path : undefined;
  if (path !== undefined && Object.keys(o).length === 1) return resolvePointer(ctx.data, path as string);
  const name = typeof o['@call'] === 'string' ? o['@call'] : typeof o.call === 'string' ? o.call : undefined;
  if (name) return call(name as string, o.args && typeof o.args === 'object' ? o.args as Record<string, unknown> : {}, ctx);
  return v;
}
