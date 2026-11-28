/**
 * How a notebook's TL;DR picture is drawn, when it isn't the standard one:
 * a small spec chosen from a fixed set of sizes, tones and layouts, plus at
 * most two lines of words written for it (a headline, a takeaway). The
 * picture's names, numbers and bars always come from the notebook's data
 * (dashboard views/notebook-tldr.ts); the spec only says how to set them.
 * A redraw by sua (the notebook-tldr agent) answers with one of these.
 */

import { validateViewComponents, type ViewComponent } from './a2ui/view.js';
import { TLDR_COMPONENT_NAMES, tldrComponentDocs } from './a2ui/catalog.js';

export type TldrSize = 'standard' | 'landscape' | 'square' | 'portrait';
export type TldrTone = 'plain' | 'editorial' | 'bold';
export type TldrLayout = 'stack' | 'split' | 'hero' | 'cover' | 'lineup' | 'spotlight' | 'gallery';
export type TldrPart = 'lead' | 'photos' | 'stats' | 'bars' | 'points';
/** What picture leads it: its photos (else its drawing), the notebook's drawing, or none. */
export type TldrPicture = 'photos' | 'drawing' | 'none';

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
  cover: 'The lead\'s picture (or the person\'s portrait) as a large band across the top, the words and numbers under it; with no photo, the notebook\'s drawing. On landscape it is drawn as spotlight.',
  lineup: 'The top three or four options side by side as picture tiles, each with its name and value, the best one marked; the pictures take the place of the bars. Needs pictures of at least three of the top options. Not for a notebook about a person.',
  gallery: 'The notebook\'s own photos lead: up to four side by side under the headline, each with the site it is from, then the lead and the findings. Needs two or more photos (a briefing\'s sources have them); with one it is drawn as a cover, with none as a stack.',
  spotlight: 'The lead\'s picture takes one whole side, top to bottom, the words and bars or points on the other; with no photo, the notebook\'s drawing. Best on landscape, and for a person\'s portrait.',
};

export const TLDR_PICTURES: Record<TldrPicture, string> = {
  photos: 'Its own photos (the default): the picture chosen for the notebook or the illustration drawn for its answer (whichever was put there last leads), its sources\' photos, who it\'s about; with none, its drawing.',
  drawing: 'The notebook\'s drawing: its own colour and an icon for what it\'s about, the same art as its card on the Notebooks page. For a notebook whose photos say little, or a look that matches its card.',
  none: 'No picture: the words and numbers only.',
};

export const TLDR_PARTS: Record<TldrPart, string> = {
  lead: 'The best lead (or what was chosen, the answer, who it\'s about), with its facts and picture.',
  photos: 'Up to four of the notebook\'s own photos in a strip, each with the site it is from (only when it has photos; a gallery shows them whatever parts are asked for).',
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
  /** What picture leads it (unset: its photos, else its drawing). */
  picture?: TldrPicture;
  /** Written for it: a headline in place of the notebook's title (the title becomes a line above it). */
  headline?: string;
  /** Written for it: one line under the headline. */
  takeaway?: string;
  /** What was done and why, in a line (shown where you redraw it). */
  about?: string;
  /** What was asked for. */
  ask?: string;
  at?: string;
  /**
   * Composed as an A2UI view (ADR-0096): the card laid out by the agent from
   * TL;DR_VIEW_COMPONENTS, bound to /tldr/…; `layout` and `parts` don't apply.
   * Kept only when it passes checkTldrView.
   */
  view?: ViewComponent[];
}

/** What a TL;DR view may use: layout, words, and the card's own components. */
export const TLDR_VIEW_COMPONENTS: readonly string[] = ['Column', 'Row', 'Columns', 'Text', ...TLDR_COMPONENT_NAMES];
/** A TL;DR view's size, at most. */
export const TLDR_VIEW_MAX_COMPONENTS = 25;
/** What a TL;DR view binds to. */
export const TLDR_VIEW_PATHS: Record<string, string> = {
  '/tldr/title': "The notebook's title.",
  '/tldr/headline': 'The headline written for it (this spec\'s headline), else the title.',
  '/tldr/takeaway': 'The takeaway written for it (this spec\'s takeaway), if any.',
  '/tldr/leadLabel': 'What the lead is ("Best lead", "The answer").',
  '/tldr/lead': "The lead: the best option's name, or the answer in a sentence.",
  '/tldr/note': 'Under a person or company: the goal or who they are.',
  '/tldr/date': "The card's date.",
  '/tldr/photo': 'The picture shown large: its first photo, else the lead\'s picture, else its drawing ({src, credit, name}).',
  '/tldr/photos': "Its photos, the chosen one first ({src, credit, name} each); /tldr/photos/0, /1, … one of them.",
  '/tldr/drawing': "The notebook's own drawing (its colour and icon), as a photo-like {src, credit: '', name}.",
};

/** Every {path} / {"@path"} a view binds to. Pure. */
function boundPaths(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) { v.forEach((x) => boundPaths(x, out)); return out; }
  if (!v || typeof v !== 'object') return out;
  const o = v as Record<string, unknown>;
  for (const k of ['path', '@path']) if (typeof o[k] === 'string' && Object.keys(o).length <= 2) out.push(o[k] as string);
  for (const [k, x] of Object.entries(o)) if (k !== 'path' && k !== '@path') boundPaths(x, out);
  return out;
}

/** The words a view writes itself (not bound): Text's text, a PhotoCover's kicker, headline and takeaway. Pure. */
export function tldrViewWords(view: readonly ViewComponent[]): string[] {
  return view.flatMap((c) => (['text', 'kicker', 'headline', 'takeaway'] as const).map((k) => c[k]).filter((x): x is string => typeof x === 'string'));
}

/**
 * Whether a TL;DR view can be drawn: a valid A2UI view (the TL;DR card's
 * components allowed), only TLDR_VIEW_COMPONENTS, one "root", at most
 * TLDR_VIEW_MAX_COMPONENTS, every binding one of the card's own paths
 * (/tldr/…: a picture or a number is never written in). Pure.
 */
export function checkTldrView(view: unknown): { ok: true; components: ViewComponent[] } | { ok: false; errors: string[] } {
  if (!Array.isArray(view) || !view.length) return { ok: false, errors: ['"view" must be a non-empty list of components.'] };
  if (view.length > TLDR_VIEW_MAX_COMPONENTS) return { ok: false, errors: [`A TL;DR view has at most ${String(TLDR_VIEW_MAX_COMPONENTS)} components (got ${String(view.length)}).`] };
  const errors: string[] = [];
  for (const c of view as Array<Record<string, unknown>>) {
    if (c && typeof c.component === 'string' && !TLDR_VIEW_COMPONENTS.includes(c.component)) errors.push(`${String(c.id)}: ${c.component} isn't for a TL;DR card (use ${TLDR_VIEW_COMPONENTS.join(', ')}).`);
  }
  if (!(view as Array<Record<string, unknown>>).some((c) => c?.id === 'root')) errors.push('One component must have id "root".');
  const stray = [...new Set(boundPaths(view).filter((p) => !(p === '/tldr' || p.startsWith('/tldr/'))))];
  if (stray.length) errors.push(`Bind only the card's own data (/tldr/…), not ${stray.join(', ')}.`);
  if (errors.length) return { ok: false, errors };
  const v = validateViewComponents(view, { tldr: true });
  return v.ok ? { ok: true, components: v.components } : { ok: false, errors: v.errors };
}

/** How to compose a TL;DR view, for the agent: its components, what it binds to, and an example. */
export function tldrViewGuide(): string {
  return [
    'view (required: you compose the card): a list of A2UI components, one with id "root". Size, tone, headline and takeaway still apply.',
    'Components you may use:',
    '  - Column {children: [ids]} to stack; Row {children: [ids]} side by side in equal widths; Columns {children: [ids], widths?: [n, …]} side by side in the widths given (each 1–12).',
    '  - Text {text, variant?: h1 | h2 | h3 | body | caption}: text bound to a path below, or a short label of your own (no numbers that aren\'t in CARD).',
    ...tldrComponentDocs().map((d) => `  - ${d.name}: ${d.summary} e.g. ${JSON.stringify(d.example)}`),
    'What to bind ({"path": "…"}); never write a picture\'s address, a name or a number yourself:',
    ...Object.entries(TLDR_VIEW_PATHS).map(([p, what]) => `  - ${p}: ${what}`),
    'Example, a photo with the headline over it and the numbers under it:',
    `  ${JSON.stringify([
      { id: 'root', component: 'Column', children: ['cover', 'nums', 'found'] },
      { id: 'cover', component: 'PhotoCover', photo: { path: '/tldr/photo' }, kicker: { path: '/tldr/title' }, headline: { path: '/tldr/headline' }, takeaway: { path: '/tldr/takeaway' }, scrim: 'dark', align: 'bottom', height: 'tall' },
      { id: 'nums', component: 'TldrPart', part: 'stats' },
      { id: 'found', component: 'TldrPart', part: 'points' },
    ])}`,
  ].join('\n');
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
  const picture = typeof o.picture === 'string' && o.picture in TLDR_PICTURES && o.picture !== 'photos' ? o.picture as TldrPicture : undefined;
  // A composed card is kept only when it can be drawn.
  const checked = o.view === undefined ? undefined : checkTldrView(o.view);
  const view = checked?.ok ? checked.components : undefined;
  const headline = text(o.headline, TLDR_HEADLINE_MAX), takeaway = text(o.takeaway, TLDR_TAKEAWAY_MAX), about = text(o.about, 200), ask = text(o.ask, 300), at = text(o.at, 40);
  return {
    size, tone: pick(o.tone, TLDR_TONES, 'plain'), layout: pick(o.layout, TLDR_LAYOUTS, 'stack'),
    parts: parts.length ? parts : ['lead', 'photos', 'stats', 'bars', 'points'],
    ...(bars !== undefined ? { bars } : {}), ...(picture ? { picture } : {}), ...(headline ? { headline } : {}), ...(takeaway ? { takeaway } : {}), ...(about ? { about } : {}), ...(ask ? { ask } : {}), ...(at ? { at } : {}),
    ...(view ? { view } : {}),
  };
}

/** The numbers in a text, as digits ("$2,130.99" → "2130.99", "8" → "8"). Pure. */
export function tldrNumbers(text: string): string[] {
  return (text.match(/\d[\d,.]*\d|\d/g) ?? []).map((n) => n.replace(/,/g, '').replace(/\.$/, ''));
}

/**
 * Numbers in the words written for a picture (its headline, its takeaway)
 * that `known` (what the notebook itself says) doesn't have: those would be
 * the writer's own, and a picture's numbers only ever come from its data. Pure.
 */
export function strayTldrNumbers(words: readonly (string | undefined)[], known: string): string[] {
  const have = new Set(tldrNumbers(known));
  return [...new Set(words.flatMap((w) => tldrNumbers(w ?? '')).filter((n) => !have.has(n)))];
}

/** What leads a composed TL;DR card. */
export type TldrLead = 'photo' | 'photos' | 'headline' | 'bars' | 'points';

/** The picture a page prefers for its TL;DR card: a size and what leads it, and why (for the page and the agent). */
export interface TldrPreference { size: TldrSize; lead: TldrLead; why: string }

/**
 * What each layout preset prefers. All landscape: the "In short" slot is a
 * full-width panel, and a wide card is also the one that shares well.
 */
export const TLDR_PREFERENCE_BY_PRESET: Record<string, { lead: TldrLead; kind: string }> = {
  shortlist: { lead: 'bars', kind: 'a shortlist' },
  watch: { lead: 'bars', kind: 'a watch' },
  dossier: { lead: 'photo', kind: 'a meeting briefing' },
  company: { lead: 'photo', kind: 'a company briefing' },
  subject: { lead: 'photos', kind: 'a subject briefing' },
  answer: { lead: 'headline', kind: 'an answer' },
  runbook: { lead: 'headline', kind: 'a runbook' },
  plan: { lead: 'headline', kind: 'a plan' },
};

const LEAD_WORDS: Record<TldrLead, string> = {
  photo: 'its photo, with the headline over it',
  photos: 'its sources\' photos in a grid',
  headline: 'the headline, then its findings or steps',
  bars: 'the options as ranked bars',
  points: 'the headline, then its findings',
};

/** How the lead is drawn as a view, for the agent. */
const LEAD_HOW: Record<TldrLead, string> = {
  photo: 'a PhotoCover bound to /tldr/photo with the headline over it, then TldrPart stats or points',
  photos: 'TldrPart header, a PhotoGrid bound to /tldr/photos, then TldrPart points',
  headline: 'TldrPart header (or Text h1 bound to /tldr/headline), then TldrPart points (or stats)',
  bars: 'TldrPart header, then TldrPart bars beside or under TldrPart lead',
  points: 'TldrPart header, then TldrPart points',
};

/**
 * The TL;DR picture a notebook's page prefers (pure). From its layout's
 * preset; a page sua drew with no preset goes by what the card has. What a
 * preset wants but the card can't draw steps down: a photo grid needs two
 * photos (else one photo), a photo needs a picture (else the headline), bars
 * need bars (else the findings).
 */
export function tldrPreference(preset: string | undefined, card: { bars: boolean; photos: number; leadPicture: boolean }): TldrPreference {
  const known = preset ? TLDR_PREFERENCE_BY_PRESET[preset] : undefined;
  let lead: TldrLead = known?.lead
    ?? (card.bars ? 'bars' : card.photos >= 2 ? 'photos' : card.leadPicture || card.photos ? 'photo' : 'headline');
  if (lead === 'photos' && card.photos < 2) lead = 'photo';
  if (lead === 'photo' && !card.leadPicture && !card.photos) lead = 'headline';
  if (lead === 'bars' && !card.bars) lead = 'points';
  return { size: 'landscape', lead, why: `${known?.kind ?? 'this page'}: ${LEAD_WORDS[lead]}` };
}

/** The preference in words, for the page ("Landscape 1200×627, leading with …"). Pure. */
export function tldrPreferenceWords(p: TldrPreference): string {
  const s = TLDR_SIZES[p.size];
  const kind = p.why.split(':')[0];
  return `${s.name} ${String(s.width)}×${s.height ? String(s.height) : 'auto'}, leading with ${LEAD_WORDS[p.lead]}${kind === 'this page' ? '' : ` (${kind})`}`;
}

/** The preference, for the agent: use it unless the ask says otherwise. Pure. */
export function tldrPreferenceGuide(p: TldrPreference): string {
  const kind = p.why.split(':')[0];
  return `This picture sits on ${kind === 'this page' ? 'a page that' : `${kind}'s page, which`} prefers size "${p.size}" leading with ${LEAD_WORDS[p.lead]}: compose it as ${LEAD_HOW[p.lead]}. Use this unless ASK names a size or what to lead with.`;
}

/** The sizes and tones a composed card is drawn in, for the agent (no fixed layouts: the view lays it out). */
export function tldrSizesTonesGuide(): string {
  return [
    'size (one):', ...Object.entries(TLDR_SIZES).map(([k, v]) => `  - "${k}": ${String(v.width)}×${v.height ? String(v.height) : 'auto'}. ${v.fits} Holds up to ${String(v.bars)} bars or ${String(v.points)} points.`),
    'tone (one):', ...Object.entries(TLDR_TONES).map(([k, v]) => `  - "${k}": ${v}`),
    `headline (optional): at most ${String(TLDR_HEADLINE_MAX)} characters.`,
    `takeaway (optional): one sentence, at most ${String(TLDR_TAKEAWAY_MAX)} characters.`,
  ].join('\n');
}

/** What a model is told it may choose from, as text. */
export function tldrOptionsGuide(): string {
  const list = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `  - "${k}": ${v}`).join('\n');
  return [
    'size (one):', ...Object.entries(TLDR_SIZES).map(([k, v]) => `  - "${k}": ${String(v.width)}×${v.height ? String(v.height) : 'auto'}. ${v.fits} Holds up to ${String(v.bars)} bars or ${String(v.points)} points.`),
    'tone (one):', list(TLDR_TONES),
    'layout (one):', list(TLDR_LAYOUTS),
    'parts (any, in the order to show them):', list(TLDR_PARTS),
    'picture (one, optional):', list(TLDR_PICTURES),
    `headline (optional): at most ${String(TLDR_HEADLINE_MAX)} characters.`,
    `takeaway (optional): one sentence, at most ${String(TLDR_TAKEAWAY_MAX)} characters.`,
  ].join('\n');
}
