/**
 * How a notebook's TL;DR picture is drawn, when it isn't the standard one:
 * a small spec chosen from a fixed set of sizes, tones and layouts, plus at
 * most two lines of words written for it (a headline, a takeaway). The
 * picture's names, numbers and bars always come from the notebook's data
 * (dashboard views/notebook-tldr.ts); the spec only says how to set them.
 * A redraw by sua (the notebook-tldr agent) answers with one of these.
 */

export type TldrSize = 'standard' | 'landscape' | 'square' | 'portrait';
export type TldrTone = 'plain' | 'editorial' | 'bold';
export type TldrLayout = 'stack' | 'split' | 'hero';
export type TldrPart = 'lead' | 'stats' | 'bars' | 'points';

/** Each size: its box in CSS pixels (no height: as tall as it needs), how much it holds, and when it fits. */
export const TLDR_SIZES: Record<TldrSize, { width: number; height?: number; bars: number; points: number; name: string; fits: string }> = {
  standard: { width: 1080, bars: 8, points: 4, name: 'Standard', fits: 'The default: as tall as it needs. For a message, an email or a document.' },
  landscape: { width: 1200, height: 627, bars: 5, points: 3, name: 'Landscape', fits: 'Wide and short (1.91:1): a LinkedIn or X link or feed image, a Slack unfurl, a slide.' },
  square: { width: 1080, height: 1080, bars: 6, points: 4, name: 'Square', fits: 'A feed post on LinkedIn or Instagram.' },
  portrait: { width: 1080, height: 1350, bars: 8, points: 5, name: 'Portrait', fits: 'A tall feed post (4:5): the most room, and the most of the screen on a phone.' },
};

export const TLDR_TONES: Record<TldrTone, string> = {
  plain: 'As the dashboard looks: quiet, white, the accent colour only on the lead.',
  editorial: 'A magazine page: a large headline, rules, numerals in the accent colour, more air.',
  bold: 'A poster: the accent colour as the ground, white type, one thing very large.',
};

export const TLDR_LAYOUTS: Record<TldrLayout, string> = {
  stack: 'One column, top to bottom.',
  split: 'Two columns: the words at the left, the bars or points at the right. Suits landscape.',
  hero: 'One thing very large at the top (the lead\'s number, or the person), the rest small under it.',
};

export const TLDR_PARTS: Record<TldrPart, string> = {
  lead: 'The best lead (or what was chosen, the answer, who it\'s about), with its facts and picture.',
  stats: 'Up to three numbers that sum it up.',
  bars: 'The options as ranked bars (only when the notebook has numbers to plot).',
  points: 'The first talking points or findings, numbered (only when there are no bars).',
};

export interface TldrSpec {
  size: TldrSize;
  tone: TldrTone;
  layout: TldrLayout;
  /** Which parts, in order. */
  parts: TldrPart[];
  /** How many bars, within the size's limit. */
  bars?: number;
  /** Written for it: a headline in place of the notebook's title (the title becomes a line above it). */
  headline?: string;
  /** Written for it: one line under the headline. */
  takeaway?: string;
  /** What was done and why, in a line (shown where you redraw it). */
  about?: string;
  /** What was asked for. */
  ask?: string;
  at?: string;
}

export const TLDR_HEADLINE_MAX = 90;
export const TLDR_TAKEAWAY_MAX = 180;

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : t;
};

/**
 * A spec as it's kept: known sizes, tones, layouts and parts only (an unknown
 * one falls back to the standard, plain, stacked card), words clipped, bars
 * within the size's limit. Undefined when it isn't an object at all. Pure.
 */
export function cleanTldrSpec(raw: unknown): TldrSpec | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, known: Record<T, unknown>, d: T): T => (typeof v === 'string' && v in known ? v as T : d);
  const size = pick(o.size, TLDR_SIZES, 'standard');
  const parts = [...new Set((Array.isArray(o.parts) ? o.parts : []).filter((p): p is TldrPart => typeof p === 'string' && p in TLDR_PARTS))];
  const bars = typeof o.bars === 'number' && Number.isFinite(o.bars) ? Math.min(TLDR_SIZES[size].bars, Math.max(3, Math.round(o.bars))) : undefined;
  const headline = text(o.headline, TLDR_HEADLINE_MAX), takeaway = text(o.takeaway, TLDR_TAKEAWAY_MAX), about = text(o.about, 200), ask = text(o.ask, 300), at = text(o.at, 40);
  return {
    size, tone: pick(o.tone, TLDR_TONES, 'plain'), layout: pick(o.layout, TLDR_LAYOUTS, 'stack'),
    parts: parts.length ? parts : ['lead', 'stats', 'bars', 'points'],
    ...(bars !== undefined ? { bars } : {}), ...(headline ? { headline } : {}), ...(takeaway ? { takeaway } : {}), ...(about ? { about } : {}), ...(ask ? { ask } : {}), ...(at ? { at } : {}),
  };
}

/** What a model is told it may choose from, as text. */
export function tldrOptionsGuide(): string {
  const list = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `  - "${k}": ${v}`).join('\n');
  return [
    'size (one):', ...Object.entries(TLDR_SIZES).map(([k, v]) => `  - "${k}": ${String(v.width)}×${v.height ? String(v.height) : 'auto'}. ${v.fits} Holds up to ${String(v.bars)} bars or ${String(v.points)} points.`),
    'tone (one):', list(TLDR_TONES),
    'layout (one):', list(TLDR_LAYOUTS),
    'parts (any, in the order to show them):', list(TLDR_PARTS),
    `headline (optional): at most ${String(TLDR_HEADLINE_MAX)} characters.`,
    `takeaway (optional): one sentence, at most ${String(TLDR_TAKEAWAY_MAX)} characters.`,
  ].join('\n');
}
