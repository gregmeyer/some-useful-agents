/**
 * A notebook's TL;DR as one picture to share: its title, the best lead (or
 * what was chosen), up to three numbers that sum it up, and the options in
 * the running as ranked bars by the fact that decides between them (fit,
 * else price, else its main measure). Everything on it is worked out from
 * the notebook's own data: nothing a model wrote for the picture, nothing
 * guessed. A notebook with nothing to plot (an answer, a briefing) gets its
 * answer in a sentence and its first findings instead of bars.
 *
 * One self-contained page (no scripts), set at a fixed width so it comes out
 * the same every time; the dashboard turns it into a PNG with a headless
 * browser (core htmlToPng). `tldrChart` is its bars alone, for the brief.
 */
import { briefTheme, type BriefTheme } from '../lib/brief-theme.js';
import { rankBy, rankOptions, subjectHost, TLDR_SIZES, type Notebook, type NotebookEntry, type NotebookField, type NotebookViewOption, type TldrLayout, type TldrPart, type TldrPicture, type TldrSpec, type ViewComponent } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { drawnCoverSrc, formatFieldValue } from './notebooks.js';
import { notebookWidgetData, type NotebookWidgetHistory } from '../lib/notebook-widgets.js';
import { facts, span, spanText, split, type BriefPicture } from './notebook-brief.js';

/** The picture's width in CSS pixels (the PNG is twice that, so text stays sharp). */
export const TLDR_WIDTH = 1080;
/** Bars shown, at most; the rest are counted under them. */
const MAX_BARS = 8;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s);
/** Markdown's bold and links as plain words (the picture has no links). */
const plain = (md: string) => md.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();

/** What a picture is, which decides how it's framed: a photo whole over a blur of itself, a portrait filling its frame, a logo or drawing whole on white, the notebook's own art filling it. */
export type TldrPictureKind = 'photo' | 'portrait' | 'logo' | 'drawing' | 'art';
export interface TldrBar { name: string; value: number; text: string; lead: boolean; picture?: string; kind?: TldrPictureKind }
/** Options whose pictures the card may show (a lineup's tiles), at most. */
const MAX_TILES = 4;
export interface TldrData {
  title: string;
  /** "Best lead", "Chosen", "The answer", "Where it stands". */
  leadLabel: string;
  /** The lead option's name, or the sentence that sums it up. */
  lead: string;
  /** The lead option's facts ("$139.99 · 220 Ah · Phoenix, AZ"). */
  leadFacts: string[];
  leadPicture?: string;
  leadPictureKind?: TldrPictureKind;
  /** The lead is a sentence (an answer), not an option's name. */
  sentence?: boolean;
  /** The lead is who it's about (a person, a company): their name, with `note` under it. */
  who?: 'person' | 'company';
  /** Under a person's or company's name: your goal for the meeting, else who they are in a sentence. */
  note?: string;
  /** The lead's picture is a logo (shown whole on white), not a photo. */
  logo?: boolean;
  stats: Array<{ value: string; label: string }>;
  /** The options as bars by one fact, best first; none when nothing can be plotted. */
  chart?: { label: string; order: string; bars: TldrBar[]; more: number; max: number };
  /** Without bars: the first findings (or talking points), in words. */
  points: string[];
  pointsLabel?: string;
  /**
   * The notebook's own photos (a briefing on a subject: its sources' own
   * pictures, the subject's site first), each with the site it's from.
   * Never a logo, a drawing or a photo from an image search.
   */
  photos?: TldrPhoto[];
  /** The notebook's drawing (its colour and icon, as its card's cover): the picture when it has no photo, or when a redraw asks for it. */
  drawing?: string;
}

/** One of the notebook's own photos on the card. */
export interface TldrPhoto { src: string; credit: string; name: string }

/**
 * The picture chosen for the notebook (notebook-photo) as the card's first
 * photo, at `src` (its address, or the copy a file carries): credited as it
 * was given ("Renee Comet"), else by the site it's from. Pure.
 */
export function chosenTldrPhoto(nb: Pick<Notebook, 'photo' | 'title'>, src: string | undefined): TldrPhoto | undefined {
  const c = nb.photo;
  if (!c || !src) return undefined;
  const host = (() => { try { return new URL(c.page ?? c.image).hostname.replace(/^www\./, ''); } catch { return undefined; } })();
  return { src, credit: c.credit?.trim() || host || 'chosen', name: c.alt ?? nb.title };
}

/** Where the notebook's chosen picture is served (its kept copy), for the page and the PNG. */
export const chosenPhotoPath = (nb: Pick<Notebook, 'id' | 'photo'>): string | undefined =>
  nb.photo ? `/notebooks/${encodeURIComponent(nb.id)}/photo?v=${encodeURIComponent(nb.photo.at)}` : undefined;
/** Photos a card shows in a strip, at most. */
export const TLDR_PHOTOS_MAX = 4;

/**
 * A subject briefing's photos for its picture: each source's own picture
 * (kept from its page, never an example photo, a logo or a drawing), the
 * subject's own site first, one a picture (two sources sharing one show it
 * once). None for any other notebook. Pure.
 */
export function tldrPhotos(nb: Pick<Notebook, 'briefOn'>, options: readonly NotebookViewOption[], pictures: BriefPicture | undefined): TldrPhoto[] {
  if (!nb.briefOn || !pictures) return [];
  const own = subjectHost(nb.briefOn);
  const host = (u: string | undefined) => { try { return u ? new URL(u).hostname.replace(/^www\./, '').toLowerCase() : ''; } catch { return ''; } };
  const real = options.filter((o) => !o.ruledOut && o.image && (o.imageKind === 'listing' || o.imageKind === undefined));
  const ordered = [...real.filter((o) => own && host(o.link) === own), ...real.filter((o) => !(own && host(o.link) === own))];
  const out: TldrPhoto[] = [];
  for (const o of ordered) {
    const src = pictures(o);
    if (!src || out.some((x) => x.src === src)) continue;
    out.push({ src, credit: host(o.link) || 'source', name: clip(o.name, 60) });
    if (out.length >= TLDR_PHOTOS_MAX) break;
  }
  return out;
}

const pictureKind = (o: Pick<NotebookViewOption, 'imageKind'>): TldrPictureKind => (o.imageKind === 'logo' ? 'logo' : o.imageKind === 'illustration' ? 'drawing' : 'photo');

/** What the picture says, from the notebook. Pure. */
/**
 * What the picture says, with its pictures: the notebook's chosen photo
 * (`chosen`, as the page shows or a file carries it) leads its photos, and
 * its drawing is there for when it has none or a redraw asks for it. Pure.
 */
export function tldrData(nb: Notebook, entries: readonly NotebookEntry[], history?: NotebookWidgetHistory, pictures?: BriefPicture, aboutPicture?: { src: string; logo?: boolean }, chosen?: TldrPhoto): TldrData {
  const t = tldrDataOf(nb, entries, history, pictures, aboutPicture);
  const photos = chosen ? [chosen, ...(t.photos ?? []).filter((x) => x.src !== chosen.src)].slice(0, TLDR_PHOTOS_MAX) : t.photos;
  return { ...t, ...(photos?.length ? { photos } : {}), drawing: drawnCoverSrc(nb) };
}

/**
 * Whether the TL;DR card adds something the page doesn't say (ADR-0093): a
 * chart of how the options compare, its sources' own photos, or who it's
 * about with their picture. A card that's only the answer and its first
 * findings again, over a drawing, doesn't. Pure.
 */
export function tldrCardAdds(t: Pick<TldrData, 'chart' | 'photos' | 'who' | 'leadPicture'>): boolean {
  return !!t.chart || !!t.photos?.length || (!!t.who && !!t.leadPicture);
}

/**
 * Whether a notebook's page, brief and PDF show its TL;DR card: as you set it
 * (Always, Never), else when it adds something (tldrCardAdds). Redrawing the
 * picture isn't asking for it on the page: that's how it looks when shared.
 * The TL;DR picture itself (tldr.png) is there either way.
 */
export function showsTldrCard(nb: Notebook, entries: readonly NotebookEntry[], history?: NotebookWidgetHistory): boolean {
  if (nb.tldrCard === 'never') return false;
  if (nb.tldrCard === 'always') return true;
  const d = notebookWidgetData(nb, entries, history).notebook;
  const about = d.person?.image ?? d.company?.image;
  return tldrCardAdds(tldrData(nb, entries, history, (o) => o.image, about ? { src: about } : undefined));
}

function tldrDataOf(nb: Notebook, entries: readonly NotebookEntry[], history?: NotebookWidgetHistory, pictures?: BriefPicture, aboutPicture?: { src: string; logo?: boolean }): TldrData {
  const d = notebookWidgetData(nb, entries, history).notebook;
  const ranked = rankOptions(nb, d.options);
  const chosen = ranked.filter((o) => o.chosen);
  const decided = nb.status === 'decided' && chosen.length > 0;
  const active = decided ? [...chosen, ...ranked.filter((o) => !o.chosen)] : ranked;
  const r = rankBy(nb);

  // The fact to plot: what ranks them, else the price, else the main measure; the first that two or more state.
  const num = (f: NotebookField, o: NotebookViewOption): number | undefined => (f.role === 'score' ? o.score : f.role === 'price' ? o.price : f.role === 'measure' ? o.measure : (typeof o.fields[f.key] === 'number' ? o.fields[f.key] as number : undefined));
  const candidates = [r.field, nb.fields.find((f) => f.role === 'price'), nb.fields.find((f) => f.role === 'measure')].filter((f): f is NotebookField => !!f);
  const field = candidates.find((f) => active.filter((o) => num(f, o) !== undefined).length >= 2);
  // A fit score says its scale as a unit ("0-100"): on the picture it's the number alone.
  const say = (f: NotebookField, o: NotebookViewOption) => (f.role === 'score' ? String(num(f, o)) : formatFieldValue(f, o.fields[f.key] ?? num(f, o)!));
  const better = !field ? 'higher' : field === r.field ? r.better : (field.better ?? (field.role === 'price' ? 'lower' : 'higher'));
  // Plotted by a fact other than the one that ranks them (too few state that one): best by the plotted fact, so the bars read in order.
  const valued = !field ? [] : field === r.field || decided
    ? active.filter((o) => num(field, o) !== undefined)
    : active.filter((o) => num(field, o) !== undefined).sort((a, b) => (better === 'lower' ? num(field, a)! - num(field, b)! : num(field, b)! - num(field, a)!));
  const lead = valued[0] ?? active[0];

  let chart: TldrData['chart'];
  if (field) {
    const shown = valued.slice(0, MAX_BARS);
    chart = {
      label: field.label,
      order: decided ? 'chosen first' : better === 'lower' ? 'lowest first' : 'highest first',
      // The first few carry their pictures too (a lineup shows them as tiles).
      bars: shown.map((o, i) => { const pic = i < MAX_TILES && pictures && o.image ? pictures(o) : undefined; return { name: clip(o.name, 44), value: num(field, o)!, text: say(field, o), lead: decided ? !!o.chosen : o === lead, ...(pic ? { picture: pic, kind: pictureKind(o) } : {}) }; }),
      more: active.length - shown.length,
      max: Math.max(...shown.map((o) => num(field, o)!), 0),
    };
  }

  const stats: TldrData['stats'] = [];
  if (active.length) stats.push(decided ? { value: `${String(chosen.length)} of ${String(active.length)}`, label: 'chosen' } : { value: String(active.length), label: active.length === 1 ? 'option in the running' : 'options in the running' });
  const spanField = field ?? candidates[0];
  const sp = spanField ? span(spanField, active) : undefined;
  if (spanField && sp && sp.lo !== sp.hi) stats.push({ value: spanField.role === 'score' ? `${String(sp.lo)}–${String(sp.hi)}` : spanText(spanField, sp), label: `${spanField.label.toLowerCase()}, lowest to highest` });
  const sl = active.length ? split(nb, active) : undefined;
  // "3 of 8 in Mesa, Arizona" for a place; "5 of 8 remote: yes" reads badly, so other facts name themselves.
  if (sl) stats.push({ value: `${String(sl.counts[0][1])} of ${String(sl.counts.reduce((n, c) => n + c[1], 0))}`, label: clip(/location|place|city|where|area|region/i.test(sl.label) ? `in ${sl.counts[0][0]}` : `${sl.label.toLowerCase()}: ${sl.counts[0][0]}`, 40) });
  const ruled = d.options.filter((o) => o.ruledOut).length;
  if (stats.length < 3 && ruled) stats.push({ value: String(ruled), label: 'ruled out' });
  if (stats.length < 3 && d.findings.length && !active.length) stats.push({ value: String(d.findings.length), label: d.findings.length === 1 ? 'finding' : 'findings' });

  // What leads: the options' best (or the pick); with no options, what was written, else where it stands.
  const written = nb.answer?.text ? d.answer : undefined;
  // It wrote an answer: that leads, in its words, over the bars.
  if (written && chart) {
    return { title: nb.title, leadLabel: written.label, lead: clip(plain(written.text), 320), leadFacts: [], sentence: true, stats: stats.slice(0, 3), chart, points: [] };
  }
  if (lead && chart) {
    return {
      title: nb.title, leadLabel: decided ? (chosen.length > 1 ? `Chosen (${String(chosen.length)})` : 'Chosen') : 'Best lead',
      lead: decided && chosen.length > 1 ? clip(chosen.map((o) => o.name).join(', '), 120) : lead.name,
      // The fact it's ranked by first (its row may leave it out when the title already says it), then what else it states.
      leadFacts: decided && chosen.length > 1 ? [] : [
        ...(num(field!, lead) !== undefined ? [`${field!.label} ${say(field!, lead)}`] : []),
        ...facts(nb, lead).filter((f) => f.label !== field!.label).slice(0, 3).map((f) => `${f.label} ${f.value}`),
      ],
      ...(pictures && lead.image && !(decided && chosen.length > 1) && pictures(lead) ? { leadPicture: pictures(lead)!, leadPictureKind: pictureKind(lead) } : {}),
      stats: stats.slice(0, 3), chart, points: [],
    };
  }
  // About someone (a meeting, a company briefing): they lead, with their picture, what they do and where, and your
  // goal or who they are in a sentence; then the talking points once they're written, else the first findings.
  const talk = nb.briefing?.points ?? [];
  // A briefing on a subject: its sources' own photos.
  const photos = tldrPhotos(nb, active, pictures);
  const who = nb.about?.person?.name ? 'person' as const : nb.about?.company?.name ? 'company' as const : undefined;
  if (who) {
    const about = nb.about![who]!;
    const fact = (...keys: string[]) => keys.map((k) => about.facts.find((f) => f.key === k)?.value).find((v) => v && v.length <= 70);
    const say = nb.meeting?.goal ? `Your goal: ${nb.meeting.goal}` : about.summary ?? '';
    return {
      title: nb.title, who,
      leadLabel: who === 'person' ? "Who you're meeting" : 'The company',
      lead: about.name,
      leadFacts: (who === 'person' ? [fact('role', 'title'), fact('organization', 'company'), fact('location', 'based_in')] : [fact('what_they_do', 'industry'), fact('headquarters', 'location', 'based_in'), fact('size', 'employees')]).filter((x): x is string => !!x),
      ...(say ? { note: clip(plain(say), 260) } : {}),
      ...(aboutPicture ? { leadPicture: aboutPicture.src, leadPictureKind: aboutPicture.logo ? 'logo' as const : who === 'person' ? 'portrait' as const : 'photo' as const, ...(aboutPicture.logo ? { logo: true } : {}) } : {}),
      stats: talk.length ? [
        { value: String(talk.length), label: talk.length === 1 ? 'talking point' : 'talking points' },
        ...(nb.briefing!.questions.length ? [{ value: String(nb.briefing!.questions.length), label: nb.briefing!.questions.length === 1 ? 'question to ask' : 'questions to ask' }] : []),
        ...(active.length ? [{ value: String(active.length), label: 'things they said, kept' }] : []),
      // No talking points yet: what's kept about them is findings, not options to choose between.
      ].slice(0, 3) : stats.slice(0, 3).map((x) => (/^options? in the running$/.test(x.label) ? { ...x, label: x.value === '1' ? 'finding kept' : 'findings kept' } : x)),
      ...(talk.length ? { points: talk.slice(0, 4).map((p) => clip(plain(p.text), 170)), pointsLabel: 'Talking points' } : { points: d.findings.slice(0, 3).map((f) => clip(plain(f.text), 170)) }),
      ...(photos.length ? { photos } : {}),
    };
  }
  // A briefing about no one in particular: what it's for, then its talking points.
  if (talk.length) {
    return {
      title: nb.title, leadLabel: nb.meeting?.goal ? 'Your goal' : "What it's for",
      lead: clip(plain(nb.meeting?.goal || nb.statement || d.summary), 320), leadFacts: [],
      stats: [
        { value: String(talk.length), label: talk.length === 1 ? 'talking point' : 'talking points' },
        ...(nb.briefing!.questions.length ? [{ value: String(nb.briefing!.questions.length), label: nb.briefing!.questions.length === 1 ? 'question to ask' : 'questions to ask' }] : []),
      ],
      points: talk.slice(0, 4).map((p) => clip(plain(p.text), 170)), pointsLabel: 'Talking points',
    };
  }
  return {
    title: nb.title, leadLabel: written ? written.label : nb.status === 'decided' ? 'Decided' : 'Where it stands',
    lead: clip(plain(written ? written.text : nb.status === 'decided' && nb.decision ? nb.decision : d.summary), 320),
    // A briefing's options are its sources.
    leadFacts: [], stats: stats.slice(0, 3).map((x) => (nb.briefOn && /^options? in the running$/.test(x.label) ? { ...x, label: x.value === '1' ? 'source' : 'sources' } : x)),
    points: d.findings.slice(0, 3).map((f) => clip(plain(f.text), 170)),
    ...(photos.length ? { photos } : {}),
  };
}

/** The card's own styles (every class starts with `tl`), in the brief's colours. */
export const TLDR_CSS = `
.tl { box-sizing: border-box; display: grid; gap: 28px; padding: 48px 56px 36px; background: var(--surface); color: var(--text); font: 17px/1.5 var(--sans); border: 1px solid var(--line); }
.tl * { box-sizing: border-box; }
.tl__eyebrow { font: 600 13px/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
.tl__title { margin: 12px 0 0; font: 700 38px/1.15 var(--display); text-wrap: balance; }
.tl__lead { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 28px; align-items: center; padding: 24px 0; border-top: 2px solid var(--text); border-bottom: 1px solid var(--line); }
/* The bars alone (in the brief): a figure, with less room around it. */
.tl--chart { margin: 0; gap: 14px; padding: 28px 36px; }
.tl__label { font: 600 12px/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.tl__name { margin: 10px 0 0; font: 700 30px/1.2 var(--display); overflow-wrap: anywhere; }
.tl__say { margin: 10px 0 0; font-size: 22px; line-height: 1.4; }
.tl__facts { margin: 12px 0 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 6px 22px; font: 500 16px/1.4 var(--mono); color: var(--muted); }
.tl__pic { width: 200px; height: 132px; border-radius: 8px; overflow: hidden; background: #fff; border: 1px solid var(--line); }
.tl__pic img { display: block; width: 100%; height: 100%; object-fit: contain; }
/* A person's photo: a square portrait that fills its frame (a logo or a product stays whole). */
.tl__pic.is-portrait { width: 176px; height: 176px; border-radius: 10px; }
.tl__pic.is-portrait img { object-fit: cover; object-position: center 20%; }
.tl__note { margin: 14px 0 0; font-size: 18px; line-height: 1.45; max-width: 46em; }
.tl__stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); gap: 28px; }
.tl__stat { display: grid; gap: 6px; align-content: start; padding-left: 16px; border-left: 2px solid var(--accent); }
.tl__num { font: 700 30px/1.1 var(--display); font-variant-numeric: tabular-nums; }
.tl__num.is-long { font-size: 22px; line-height: 1.5; white-space: nowrap; }
.tl__what { font-size: 14px; line-height: 1.35; color: var(--muted); }
.tl__chart { display: grid; gap: 14px; }
.tl__bars { margin: 0; padding: 0; list-style: none; display: grid; gap: 12px; }
.tl__bar { display: grid; grid-template-columns: 300px minmax(0, 1fr) 132px; gap: 16px; align-items: center; font-size: 16px; }
.tl__bar span:first-child { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.tl__bar.is-lead span:first-child { font-weight: 650; }
.tl__track { height: 16px; border-left: 1px solid var(--line-strong); }
.tl__fill { display: block; height: 100%; min-width: 3px; border-radius: 0 4px 4px 0; background: color-mix(in srgb, var(--accent) 38%, var(--surface)); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.tl__bar.is-lead .tl__fill { background: var(--accent); }
.tl__val { font: 500 16px/1 var(--mono); font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
.tl__bar.is-lead .tl__val { font-weight: 700; }
.tl__more { margin: 0; font-size: 14px; color: var(--muted); }
.tl__points { margin: 0; padding: 0; list-style: none; counter-reset: tl; display: grid; gap: 14px; }
.tl__points li { counter-increment: tl; display: grid; grid-template-columns: 34px minmax(0, 1fr); font-size: 18px; line-height: 1.45; }
.tl__points li::before { content: counter(tl); font: 700 20px/1.3 var(--mono); color: var(--accent); }
.tl__foot { display: flex; justify-content: space-between; gap: 24px; padding-top: 16px; border-top: 1px solid var(--line); font: 500 12px/1.4 var(--mono); color: var(--subtle); }
/* A redraw's words: the notebook's title as a line over the headline written for it, and a takeaway under it. */
.tl__kicker { margin: 12px 0 0; font: 600 15px/1.3 var(--mono); color: var(--muted); }
.tl__kicker + .tl__title { margin-top: 6px; }
.tl__lede { margin: 12px 0 0; font-size: 21px; line-height: 1.4; color: var(--muted); max-width: 44em; }
/* Sizes: fixed boxes (a feed image is its exact size), the footer at the bottom, what doesn't fit cut off rather than spilling. */
.tl--landscape, .tl--square, .tl--portrait { display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; }
.tl--landscape .tl__num.is-long, .tl--square .tl__num.is-long, .tl--portrait .tl__num.is-long { font-size: 22px; line-height: 1.5; }
.tl--landscape { width: 1200px; height: 627px; padding: 34px 44px 24px; gap: 16px; font-size: 15px; }
.tl--landscape .tl__title { font-size: 30px; margin-top: 8px; }
.tl--landscape .tl__lede { font-size: 17px; margin-top: 8px; }
.tl--landscape .tl__lead { padding: 14px 0; gap: 20px; }
.tl--landscape .tl__name { font-size: 24px; margin-top: 6px; }
.tl--landscape .tl__say { font-size: 18px; margin-top: 6px; }
.tl--landscape .tl__facts { font-size: 14px; margin-top: 8px; }
.tl--landscape .tl__note { font-size: 15px; margin-top: 8px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.tl--landscape .tl__pic { width: 132px; height: 88px; }
.tl--landscape .tl__pic.is-portrait { width: 104px; height: 104px; }
.tl--landscape .tl__stats { gap: 20px; }
.tl--landscape .tl__num { font-size: 24px; }
.tl--landscape .tl__num.is-long { font-size: 18px; }
.tl--landscape .tl__what { font-size: 13px; }
.tl--landscape .tl__bars { gap: 8px; }
.tl--landscape .tl__bar { grid-template-columns: 250px minmax(0, 1fr) 112px; font-size: 14px; }
.tl--landscape .tl__val { font-size: 14px; }
.tl--landscape .tl__track { height: 13px; }
.tl--landscape .tl__points { gap: 9px; }
.tl--landscape .tl__points li { font-size: 15px; }
.tl--landscape .tl__foot { padding-top: 10px; }
.tl--square { width: 1080px; height: 1080px; padding: 56px 60px 36px; gap: 22px; font-size: 18px; }
.tl--square .tl__title { font-size: 42px; }
.tl--square .tl__bars { gap: 16px; }
.tl--square .tl__bar { font-size: 18px; }
.tl--square .tl__val { font-size: 18px; }
.tl--square .tl__track { height: 20px; }
.tl--square .tl__points { gap: 18px; }
.tl--square .tl__points li { font-size: 20px; }
.tl--square .tl__num { font-size: 34px; }
.tl--portrait { width: 1080px; height: 1350px; padding: 64px 60px 40px; gap: 34px; font-size: 19px; }
.tl--portrait .tl__title { font-size: 46px; }
.tl--portrait .tl__bars { gap: 22px; }
.tl--portrait .tl__bar { font-size: 20px; }
.tl--portrait .tl__val { font-size: 20px; }
.tl--portrait .tl__track { height: 24px; }
.tl--portrait .tl__points { gap: 24px; }
.tl--portrait .tl__points li { font-size: 23px; }
.tl--portrait .tl__num { font-size: 36px; }
/* Split: the words at the left, the bars or points at the right. */
.tl__cols { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); gap: 44px; align-items: center; min-height: 0; flex: 1; }
.tl__col { display: grid; gap: 22px; align-content: center; min-width: 0; }
.tl--split .tl__stats { grid-template-columns: 1fr; gap: 14px; }
.tl--split .tl__lead { grid-template-columns: minmax(0, 1fr); padding-bottom: 0; border-bottom: 0; }
/* No room for a product's picture beside the words; a person's portrait stays. */
.tl--split .tl__lead .tl__pic:not(.is-portrait) { display: none; }
.tl--split .tl__lead:has(.is-portrait) { grid-template-columns: minmax(0, 1fr) auto; align-items: start; }
.tl--split .tl__bar { grid-template-columns: minmax(0, 220px) minmax(0, 1fr) auto; }
.tl--split .tl__bars { gap: 16px; }
.tl--split .tl__track { height: 18px; }
.tl--split .tl__points { gap: 16px; }
.tl--split.tl--landscape .tl__points li { font-size: 17px; }
.tl--split.tl--landscape .tl__bar { font-size: 15px; }
.tl--split .tl__col + .tl__col { padding-left: 36px; border-left: 1px solid var(--line); align-self: stretch; }
.tl--split.tl--landscape .tl__col { gap: 14px; }
.tl--split.tl--landscape .tl__stats { grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); gap: 14px; }
.tl--split.tl--landscape .tl__stat:nth-child(n+3) { display: none; }
/* Hero: one thing very large. */
.tl__hero { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 32px; align-items: center; padding: 26px 0; border-top: 2px solid var(--text); border-bottom: 1px solid var(--line); }
.tl__hero--who { grid-template-columns: auto minmax(0, 1fr); }
.tl__big { margin: 8px 0 0; font: 700 104px/1 var(--display); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.tl__hero--who .tl__big { font-size: 64px; line-height: 1.05; }
.tl__under { margin: 12px 0 0; font-size: 22px; line-height: 1.35; color: var(--muted); }
.tl__hero .tl__pic { width: 240px; height: 160px; }
.tl__hero .tl__pic.is-portrait { width: 220px; height: 220px; }
.tl--landscape .tl__hero { padding: 14px 0; gap: 24px; }
.tl--landscape .tl__big { font-size: 72px; }
.tl--landscape .tl__hero--who .tl__big { font-size: 46px; }
.tl--landscape .tl__under { font-size: 17px; margin-top: 8px; }
.tl--landscape .tl__hero .tl__pic { width: 168px; height: 112px; }
.tl--landscape .tl__hero .tl__pic.is-portrait { width: 132px; height: 132px; }
.tl--portrait .tl__big { font-size: 132px; }
.tl--portrait .tl__hero--who .tl__big { font-size: 76px; }
/* A picture in a frame. A photo sits whole over a blurred, enlarged copy of itself, so a small or odd-shaped one fills
   the frame without being stretched or cut; a portrait fills it; a logo or drawing sits whole on white with room around it. */
.tl__frame { position: relative; display: block; width: 100%; height: 100%; overflow: hidden; isolation: isolate; background: #fff; }
.tl__frame img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; display: block; }
.tl__frame.is-photo { background: var(--raised); }
.tl__frame.is-photo::before { content: ""; position: absolute; inset: 0; z-index: -1; background: var(--pic) center / cover no-repeat; filter: blur(34px) saturate(1.15); transform: scale(1.35); opacity: 0.6; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.tl__frame.is-portrait img { object-fit: cover; object-position: center 18%; }
/* A wide band would cut a face at the forehead: there the portrait sits whole over a blur of itself, like a photo. */
.tl--cover .tl__art .tl__frame.is-portrait img { object-fit: contain; }
.tl--cover .tl__art .tl__frame.is-portrait::before { content: ""; position: absolute; inset: 0; z-index: -1; background: var(--pic) center / cover no-repeat; filter: blur(34px) saturate(1.1); transform: scale(1.35); opacity: 0.75; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.tl__frame.is-logo img, .tl__frame.is-drawing img { inset: 14%; width: 72%; height: 72%; }
/* The notebook's own drawing fills its frame (it is drawn to be cropped at the edges). */
.tl__frame.is-art { background: none; }
.tl__frame.is-art img { object-fit: cover; }
/* Cover: the lead's picture as a band across the top, the rest under it. Spotlight: the picture down one whole side. */
.tl--cover, .tl--spotlight { padding: 0; gap: 0; }
.tl__inner { display: grid; gap: 26px; padding: 40px 56px 36px; align-content: start; min-width: 0; }
.tl__art { min-width: 0; min-height: 0; position: relative; }
.tl__artcredit { position: absolute; right: 10px; bottom: 10px; max-width: calc(100% - 20px); padding: 3px 8px; border-radius: 4px; background: rgba(0, 0, 0, 0.62); color: #fff; font: 500 12px/1.3 var(--mono); letter-spacing: 0.02em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
/* A card composed as a view (ADR-0096): a cover runs to the edges, the rest sits in the card's margins. */
.tl--view { padding: 0 0 32px; gap: 0; align-content: start; overflow: hidden; }
.tlv__pad { padding: 28px 56px 0; min-width: 0; }
.tlv__col { display: grid; gap: 22px; align-content: start; min-width: 0; }
.tlv__row { display: grid; gap: 28px; align-items: start; min-width: 0; }
.tlv__h2 { margin: 0; font: 700 28px/1.2 var(--display); text-wrap: balance; }
.tlv__h3 { margin: 0; font: 600 20px/1.3 var(--sans); }
.tlv__body { margin: 0; font-size: 19px; line-height: 1.5; }
.tlv__cover { position: relative; overflow: hidden; height: 440px; background: var(--raised); color: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.tlv__cover.is-short { height: 300px; }
.tlv__cover.is-tall { height: 580px; }
.tl--landscape .tlv__cover { height: 380px; }
.tl--landscape .tlv__cover.is-tall { height: 460px; }
.tlv__cover > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
.tlv__over { position: absolute; left: 0; right: 0; display: grid; gap: 10px; padding: 36px 56px; }
.tlv__cover.at-bottom .tlv__over { bottom: 0; padding-top: 96px; }
.tlv__cover.at-top .tlv__over { top: 0; padding-bottom: 96px; }
.tlv__cover.at-center .tlv__over { top: 50%; transform: translateY(-50%); }
.tlv__cover.scrim-dark.at-bottom .tlv__over { background: linear-gradient(to top, rgba(0, 0, 0, 0.78), rgba(0, 0, 0, 0)); }
.tlv__cover.scrim-dark.at-top .tlv__over { background: linear-gradient(to bottom, rgba(0, 0, 0, 0.78), rgba(0, 0, 0, 0)); }
.tlv__cover.scrim-dark.at-center .tlv__over { background: rgba(0, 0, 0, 0.5); }
.tlv__cover.scrim-light { color: #111; }
.tlv__cover.scrim-light.at-bottom .tlv__over { background: linear-gradient(to top, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0)); }
.tlv__cover.scrim-light.at-top .tlv__over { background: linear-gradient(to bottom, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0)); }
.tlv__cover.scrim-light.at-center .tlv__over { background: rgba(255, 255, 255, 0.82); }
.tlv__cover.scrim-none .tlv__over { text-shadow: 0 1px 12px rgba(0, 0, 0, 0.7); }
.tlv__kick { margin: 0; font: 600 14px/1.2 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.92; }
.tlv__hl { margin: 0; font: 700 46px/1.08 var(--display); text-wrap: balance; }
.tl--landscape .tlv__hl { font-size: 40px; }
.tlv__tk { margin: 0; font-size: 21px; line-height: 1.4; max-width: 40em; }
.tlv__credit { position: absolute; right: 10px; bottom: 10px; max-width: calc(100% - 20px); padding: 3px 8px; border-radius: 4px; background: rgba(0, 0, 0, 0.62); color: #fff; font: 500 12px/1.3 var(--mono); letter-spacing: 0.02em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-shadow: none; }
.tlv__cover.at-bottom .tlv__credit { top: 10px; bottom: auto; }
.tlv__grid .tl__shot .tl__frame, .tl--landscape .tlv__grid .tl__shot .tl__frame { aspect-ratio: var(--ratio, 4 / 3); }
.tl--cover .tl__art { height: 400px; border-bottom: 1px solid var(--line); }
.tl--cover .tl__lead, .tl--spotlight .tl__lead { grid-template-columns: minmax(0, 1fr); }
.tl--cover.tl--square, .tl--cover.tl--portrait { display: flex; flex-direction: column; justify-content: flex-start; }
.tl--cover.tl--square .tl__art { height: 430px; flex: none; }
.tl--cover.tl--portrait .tl__art { height: 560px; flex: none; }
.tl--cover.tl--square .tl__inner, .tl--cover.tl--portrait .tl__inner { flex: 1; display: flex; flex-direction: column; justify-content: space-between; gap: 18px; padding: 36px 60px 32px; }
.tl--cover.tl--square .tl__title { font-size: 36px; }
.tl--cover.tl--square .tl__lead { padding: 16px 0; }
.tl--cover.tl--square .tl__bars { gap: 12px; }
.tl--cover.tl--portrait .tl__inner { padding: 44px 60px 36px; }
.tl--cover.tl--portrait .tl__title, .tl--cover.tl--portrait.tl--editorial .tl__title { font-size: 44px; }
.tl--cover.tl--square .tl__note, .tl--cover.tl--portrait .tl__note { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.tl--cover.tl--square .tl__points, .tl--cover.tl--portrait .tl__points { gap: 14px; }
.tl--cover.tl--square .tl__points li { font-size: 18px; }
.tl--spotlight { display: grid; grid-template-columns: minmax(0, 42fr) minmax(0, 58fr); }
.tl--spotlight .tl__art { min-height: 560px; border-right: 1px solid var(--line); }
.tl--spotlight .tl__inner { padding: 44px 48px 32px; gap: 22px; }
.tl--spotlight .tl__title { font-size: 32px; }
.tl--spotlight .tl__stats { gap: 18px; }
.tl--spotlight .tl__num { font-size: 26px; }
.tl--spotlight .tl__num.is-long { font-size: 18px; }
.tl--spotlight .tl__bar { grid-template-columns: minmax(0, 190px) minmax(0, 1fr) auto; }
.tl--spotlight.tl--landscape { display: grid; grid-template-columns: minmax(0, 40fr) minmax(0, 60fr); padding: 0; }
.tl--spotlight.tl--landscape .tl__art { min-height: 0; height: 627px; }
.tl--spotlight.tl--landscape .tl__inner { display: flex; flex-direction: column; justify-content: space-between; gap: 12px; padding: 30px 40px 22px; height: 627px; }
.tl--spotlight.tl--landscape .tl__title { font-size: 27px; }
.tl--spotlight.tl--landscape .tl__stat:nth-child(n+3) { display: none; }
.tl--spotlight.tl--landscape .tl__lead { padding: 12px 0; }
.tl--spotlight.tl--landscape .tl__bar { grid-template-columns: minmax(0, 170px) minmax(0, 1fr) auto; }
/* Lineup: the top options as picture tiles side by side. */
.tl__lineup { display: grid; gap: 14px; }
/* The notebook's own photos: a strip of frames, each with the site it's from. */
.tl__photos { margin: 0; }
.tl__shots { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(var(--shots, 3), minmax(0, 1fr)); gap: 16px; }
.tl__shot { display: grid; gap: 6px; min-width: 0; }
.tl__shot .tl__frame { height: auto; aspect-ratio: 4 / 3; border-radius: 8px; border: 1px solid var(--line); }
.tl__photos.is-lead .tl__shot .tl__frame { aspect-ratio: 1 / 1; }
.tl__credit { font: 500 12px/1.3 var(--mono); letter-spacing: 0.02em; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tl--landscape .tl__shots { gap: 12px; }
.tl--landscape .tl__shot .tl__frame, .tl--landscape .tl__photos.is-lead .tl__shot .tl__frame { aspect-ratio: 16 / 10; }
.tl__tiles { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(var(--tiles, 3), minmax(0, 1fr)); gap: 20px; }
.tl__tile { display: grid; gap: 6px; align-content: start; min-width: 0; padding-top: 12px; border-top: 2px solid var(--line-strong); }
.tl__tile.is-lead { border-top-color: var(--accent); }
.tl__tile .tl__frame { height: auto; aspect-ratio: 4 / 3; border-radius: 8px; border: 1px solid var(--line); margin-bottom: 6px; }
.tl__rank { font: 600 12px/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.tl__tile.is-lead .tl__rank { color: var(--accent); }
.tl__tname { font-size: 17px; font-weight: 650; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.tl__tval { font: 700 22px/1.2 var(--mono); font-variant-numeric: tabular-nums; }
.tl--lineup.tl--landscape .tl__tiles { gap: 16px; }
.tl--lineup.tl--landscape .tl__tile .tl__frame { aspect-ratio: 4 / 3; }
.tl--lineup.tl--landscape .tl__tname { font-size: 14px; -webkit-line-clamp: 1; }
.tl--lineup.tl--landscape .tl__tval { font-size: 18px; }
.tl--lineup.tl--landscape .tl__stats { display: none; }
.tl--lineup.tl--portrait .tl__tile .tl__frame { aspect-ratio: 3 / 4; }
.tl--lineup.tl--portrait .tl__tname { font-size: 21px; }
.tl--lineup.tl--portrait .tl__tval { font-size: 28px; }
.tl--lineup.tl--square .tl__tile .tl__frame { aspect-ratio: 1 / 1; }
.tl--lineup.tl--square .tl__tname { font-size: 19px; }
.tl--lineup.tl--square .tl__tval { font-size: 25px; }
.tl--bold .tl__tile { border-top-color: rgba(255, 255, 255, 0.4); }
.tl--bold .tl__tile.is-lead { border-top-color: #fff; }
.tl--bold .tl__rank, .tl--bold .tl__tile.is-lead .tl__rank { color: rgba(255, 255, 255, 0.86); }
.tl--bold .tl__art { border-color: rgba(255, 255, 255, 0.3); }
/* Editorial: a magazine page. The page colour, no frame, a large headline, numerals in the accent colour. */
.tl--editorial { background: var(--bg); border-color: transparent; }
.tl--editorial .tl__title { font-size: 50px; line-height: 1.08; letter-spacing: -0.015em; }
.tl--editorial.tl--landscape .tl__title { font-size: 36px; }
.tl--editorial.tl--portrait .tl__title { font-size: 60px; }
.tl--editorial .tl__lede { color: var(--text); }
.tl--editorial .tl__lead, .tl--editorial .tl__hero { border-top-width: 3px; }
.tl--editorial .tl__num, .tl--editorial .tl__big { color: var(--accent); }
.tl--editorial .tl__stat { border-left: 0; padding-left: 0; border-top: 1px solid var(--text); padding-top: 12px; }
.tl--editorial .tl__label { color: var(--accent); }
/* Bold: a poster. The accent colour as the ground, white type; bars in white. */
.tl--bold { background: var(--accent); color: #fff; border-color: transparent; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.tl--bold .tl__eyebrow, .tl--bold .tl__label { color: rgba(255, 255, 255, 0.82); }
.tl--bold .tl__kicker, .tl--bold .tl__lede, .tl--bold .tl__facts, .tl--bold .tl__what, .tl--bold .tl__more, .tl--bold .tl__under { color: rgba(255, 255, 255, 0.86); }
.tl--bold .tl__foot { color: rgba(255, 255, 255, 0.7); border-top-color: rgba(255, 255, 255, 0.3); }
.tl--bold .tl__lead, .tl--bold .tl__hero { border-top-color: #fff; border-bottom-color: rgba(255, 255, 255, 0.3); }
.tl--bold .tl__stat { border-left-color: #fff; }
.tl--bold .tl__track { border-left-color: rgba(255, 255, 255, 0.5); }
.tl--bold .tl__fill { background: rgba(255, 255, 255, 0.4); }
.tl--bold .tl__bar.is-lead .tl__fill { background: #fff; }
.tl--bold .tl__points li::before { color: #fff; }
.tl--bold .tl__col + .tl__col { border-left-color: rgba(255, 255, 255, 0.3); }
.tl--bold .tl__title { font-size: 46px; }
.tl--bold.tl--landscape .tl__title { font-size: 34px; }
`;

/**
 * The bars alone, for the brief: its own words already give the lead and the
 * numbers (where it stands, key findings), so there the picture is only what
 * words can't show, how the options compare. Nothing when there's no chart.
 */
export function tldrChart(t: TldrData): SafeHtml {
  const chart = t.chart;
  if (!chart) return html``;
  return html`<figure class="tl tl--chart" aria-label="${chart.label} of the options in the running, ${chart.order}">
  <figcaption class="tl__label">${chart.label}, ${chart.order}</figcaption>
  <ol class="tl__bars">${chart.bars.map((b) => html`<li class="tl__bar${b.lead ? ' is-lead' : ''}"><span>${b.name}</span><span class="tl__track"><span class="tl__fill" style="width:${(chart.max > 0 ? Math.max(0, (b.value / chart.max) * 100) : 0).toFixed(1)}%"></span></span><span class="tl__val">${b.text}</span></li>`) as unknown as SafeHtml[]}</ol>
  ${chart.more > 0 ? html`<p class="tl__more">and ${String(chart.more)} more in the running</p>` : html``}
</figure>`;
}

/** How many picture tiles a lineup shows at a size. */
const lineupTiles = (spec: TldrSpec | undefined): number => (spec?.size === 'square' || spec?.size === 'portrait' ? 3 : MAX_TILES);

/**
 * The layout a card is really drawn in. A layout that leads with a picture
 * needs one, so this is decided here from the data, never left to whoever
 * chose the spec: a lineup without three pictured options is a cover (or a
 * stack); a cover or spotlight without the lead's picture is a stack or a
 * split. A cover has no room on landscape (drawn as spotlight), and a
 * spotlight's side-by-side has none on square or portrait (drawn as cover). Pure.
 */
export function tldrLayoutFor(t: TldrData, spec: TldrSpec | undefined): TldrLayout {
  let layout: TldrLayout = spec?.layout ?? 'stack';
  // A gallery needs two photos; with one it's a cover (that photo large), with none a stack.
  const choice = spec?.picture ?? 'photos';
  if (layout === 'gallery' && (choice !== 'photos' || (t.photos?.length ?? 0) < 2)) layout = tldrBigPicture(t, choice) ? 'cover' : 'stack';
  if (layout === 'lineup' && (t.who || (t.chart?.bars ?? []).slice(0, lineupTiles(spec)).filter((b) => b.picture).length < 3)) layout = t.leadPicture ? 'cover' : 'stack';
  if (layout === 'cover' && spec?.size === 'landscape') layout = 'spotlight';
  if (layout === 'spotlight' && (spec?.size === 'square' || spec?.size === 'portrait')) layout = 'cover';
  if (layout === 'cover' && !tldrBigPicture(t, choice)) layout = 'stack';
  if (layout === 'spotlight' && !tldrBigPicture(t, choice)) layout = 'split';
  return layout;
}

/**
 * The picture a cover or a spotlight shows large: one of the notebook's own
 * photos when it has any (a briefing on an organization would otherwise
 * blow up its logo), else the lead's picture. Pure.
 */
export function tldrBigPicture(t: Pick<TldrData, 'photos' | 'leadPicture' | 'leadPictureKind' | 'drawing'>, choice: TldrPicture = 'photos'): { src: string; kind: TldrPictureKind } | undefined {
  if (choice === 'none') return undefined;
  const drawing = t.drawing ? { src: t.drawing, kind: 'art' as const } : undefined;
  if (choice === 'drawing') return drawing;
  if (t.photos?.length) return { src: t.photos[0].src, kind: 'photo' };
  return t.leadPicture ? { src: t.leadPicture, kind: t.leadPictureKind ?? 'photo' } : drawing;
}

/** A picture in a frame, by what it is: a photo whole over a blur of itself, a portrait filling it, a logo or drawing whole on white. */
function frame(src: string, kind: TldrPictureKind | undefined, alt: string): SafeHtml {
  const k = kind ?? 'photo';
  return html`<span class="tl__frame is-${k}"${k === 'photo' || k === 'portrait' ? html` style="--pic:url('${src}')"` : html``}><img src="${src}" alt="${alt}"></span>`;
}

/**
 * The whole card, as the picture shows it. Without a `spec` it's the
 * standard picture. With one, the same data set as the spec says: its size
 * (a fixed box, holding only what fits), tone and layout, its parts in its
 * order, and its headline over the notebook's title.
 */
export function tldrCard(t: TldrData, o: { now?: Date; spec?: TldrSpec } = {}): SafeHtml {
  const now = o.now ?? new Date();
  const date = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const spec = o.spec;
  const size = TLDR_SIZES[spec?.size ?? 'standard'];
  // Composed as a view (ADR-0096): its parts are drawn as the stacked card draws them, and placed where the view says.
  const composed = spec?.view?.length ? spec.view : undefined;
  const layout = composed ? 'stack' : tldrLayoutFor(t, spec);
  const parts = spec?.parts ?? ['lead', 'photos', 'stats', 'bars', 'points'];
  // A fixed box holds less when more is stacked in it: the hero's big number, a cover's picture, and each line written for it, cost a bar or two.
  const words = (spec?.headline ? 1 : 0) + (spec?.takeaway ? 1 : 0);
  const room = !size.height ? size.bars : Math.max(3, size.bars - (layout === 'hero' ? 2 : 0) - (layout === 'cover' ? 4 + Math.min(words, 1) : 0) - (layout === 'spotlight' ? 1 : 0) - (layout !== 'split' && spec?.size === 'landscape' ? words : 0));
  const cap = Math.min(spec?.bars ?? size.bars, room);
  // Bars are measured against the longest one shown (each still starts at zero and says its value), so a short list isn't dwarfed by ones left out.
  const kept = t.chart?.bars.slice(0, cap) ?? [];
  const chart = t.chart ? { ...t.chart, bars: kept, more: t.chart.more + Math.max(0, t.chart.bars.length - cap), max: Math.max(...kept.map((b) => b.value), 0) } : undefined;
  // A gallery's photos take the room of a point or two in a fixed box.
  const points = t.points.slice(0, layout === 'gallery' && size.height ? 2 : layout === 'cover' && size.height ? Math.max(2, size.points - 2) : size.points);
  const named = (!!t.chart && !t.sentence) || !!t.who;
  // The lead's picture large (a cover's band, a spotlight's side) leaves the small one beside the words out.
  const large = layout === 'cover' || layout === 'spotlight';
  // No picture asked for: none beside the lead, and no photo strip (below).
  const choice = spec?.picture ?? 'photos';
  const picture = t.leadPicture && !large && choice === 'photos' ? html`<span class="tl__pic${t.who === 'person' && !t.logo ? ' is-portrait' : ''}"><img src="${t.leadPicture}" alt="${t.who ? t.lead : ''}"></span>` : html``;

  const header = html`<header class="tl__head"><div class="tl__eyebrow">TL;DR · ${date}</div>${spec?.headline
    ? html`<p class="tl__kicker">${t.title}</p><h1 class="tl__title">${spec.headline}</h1>`
    : html`<h1 class="tl__title">${t.title}</h1>`}${spec?.takeaway ? html`<p class="tl__lede">${spec.takeaway}</p>` : html``}</header>`;
  const lead = html`<section class="tl__lead">
    <div>
      <div class="tl__label">${t.leadLabel}</div>
      ${named ? html`<p class="tl__name">${t.lead}</p>` : html`<p class="tl__say">${t.lead}</p>`}
      ${t.leadFacts.length ? html`<ul class="tl__facts">${t.leadFacts.map((f) => html`<li>${f}</li>`) as unknown as SafeHtml[]}</ul>` : html``}
      ${t.note ? html`<p class="tl__note">${t.note}</p>` : html``}
    </div>
    ${picture}
  </section>`;
  // The hero layout's opener: one thing very large. Who it's about; else the lead's own number with its name; else the first number.
  const leadBar = chart?.bars.find((b) => b.lead) ?? chart?.bars[0];
  const hero = t.who
    ? html`<section class="tl__hero tl__hero--who">${picture}<div><div class="tl__label">${t.leadLabel}</div><p class="tl__big">${t.lead}</p>${t.leadFacts.length ? html`<p class="tl__under">${t.leadFacts.join(' · ')}</p>` : html``}</div></section>`
    : leadBar && named
      ? html`<section class="tl__hero"><div><div class="tl__label">${t.leadLabel} · ${chart!.label}</div><p class="tl__big">${leadBar.text}</p><p class="tl__under">${t.lead}</p></div>${picture}</section>`
      : t.stats[0]
        ? html`<section class="tl__hero"><div><div class="tl__label">${t.stats[0].label}</div><p class="tl__big">${t.stats[0].value}</p><p class="tl__under">${t.lead}</p></div></section>`
        : lead;
  const stats = t.stats.length ? html`<section class="tl__stats">${t.stats.map((x) => html`<div class="tl__stat"><span class="tl__num${x.value.length > 12 ? ' is-long' : ''}">${x.value}</span><span class="tl__what">${x.label}</span></div>`) as unknown as SafeHtml[]}</section>` : html``;
  const bars = chart ? html`<section class="tl__chart">
    <div class="tl__label">${chart.label}, ${chart.order}</div>
    <ol class="tl__bars">${chart.bars.map((b) => html`<li class="tl__bar${b.lead ? ' is-lead' : ''}"><span>${b.name}</span><span class="tl__track"><span class="tl__fill" style="width:${(chart.max > 0 ? Math.max(0, (b.value / chart.max) * 100) : 0).toFixed(1)}%"></span></span><span class="tl__val">${b.text}</span></li>`) as unknown as SafeHtml[]}</ol>
    ${chart.more > 0 ? html`<p class="tl__more">and ${String(chart.more)} more in the running</p>` : html``}
  </section>` : html``;
  const list = !chart && points.length ? html`<section class="tl__chart"><div class="tl__label">${t.pointsLabel ?? 'What it found'}</div><ol class="tl__points">${points.map((p) => html`<li>${p}</li>`) as unknown as SafeHtml[]}</ol></section>` : html``;
  // A lineup: the top options as picture tiles, in rank order, each with its name and value; they stand in for the lead and the bars.
  const tiled = (t.chart?.bars ?? []).slice(0, lineupTiles(spec)).map((b, i) => ({ b, rank: i + 1 })).filter((x) => x.b.picture);
  const lineup = layout === 'lineup' && t.chart ? html`<section class="tl__lineup">
    <div class="tl__label">${t.chart.label}, ${t.chart.order}</div>
    <ol class="tl__tiles" style="--tiles:${String(tiled.length)}">${tiled.map(({ b, rank }) => html`<li class="tl__tile${b.lead ? ' is-lead' : ''}">${frame(b.picture!, b.kind, b.name)}<span class="tl__rank">${b.lead ? t.leadLabel : `#${String(rank)}`}</span><span class="tl__tname">${b.name}</span><span class="tl__tval">${b.text}</span></li>`) as unknown as SafeHtml[]}</ol>
    ${t.chart.bars.length + t.chart.more - tiled.length > 0 ? html`<p class="tl__more">and ${String(t.chart.bars.length + t.chart.more - tiled.length)} more in the running</p>` : html``}
  </section>` : html``;
  // The notebook's own photos in a strip, each with the site it's from. A cover or spotlight already shows the first one large.
  // A large photo is the strip's first; a large drawing leaves all the photos to the strip.
  const strip = choice === 'none' ? [] : (t.photos ?? []).slice(large && choice === 'photos' ? 1 : 0, large ? TLDR_PHOTOS_MAX : size.height && layout !== 'gallery' ? 3 : TLDR_PHOTOS_MAX);
  const photos = strip.length >= (layout === 'gallery' ? 2 : 1) ? html`<section class="tl__photos${layout === 'gallery' ? ' is-lead' : ''}">
    <ol class="tl__shots" style="--shots:${String(strip.length)}">${strip.map((x) => html`<li class="tl__shot">${frame(x.src, 'photo', x.name)}<span class="tl__credit">${x.credit}</span></li>`) as unknown as SafeHtml[]}</ol>
  </section>` : html``;
  const part: Record<TldrPart, SafeHtml> = layout === 'lineup'
    ? { lead: html``, photos: html``, stats, bars: lineup, points: html`` }
    : { lead: layout === 'hero' ? hero : lead, photos, stats, bars, points: list };
  const shown = (keys: readonly TldrPart[]) => parts.filter((k) => keys.includes(k)).map((k) => part[k]) as unknown as SafeHtml[];
  const foot = html`<footer class="tl__foot"><span>From the notebook's own numbers, ${date}</span><span>Made with sua</span></footer>`;
  const cls = spec ? ` tl--${spec.size} tl--${spec.tone} tl--${layout}` : '';
  // A lineup always shows its tiles, whatever parts were asked for (they are the layout).
  // A gallery always shows its photos, first, whatever parts were asked for.
  // On landscape there is room for the photos and one more thing: the findings, else the lead.
  const galleryParts = spec?.size === 'landscape' ? [parts.includes('points') && points.length ? 'points' as const : 'lead' as const] : parts.filter((k) => k !== 'photos');
  const all = layout === 'gallery' ? ['photos' as const, ...galleryParts] : layout === 'lineup' && !parts.includes('bars') ? [...parts, 'bars' as const] : parts;
  const every = (keys: readonly TldrPart[]) => all.filter((k) => keys.includes(k)).map((k) => part[k]) as unknown as SafeHtml[];
  if (composed) return tldrViewCard(composed, t, spec!, { header, foot, date, part: { ...part, lead, hero } });
  // Cover and spotlight: the lead's picture large (a band across the top, or one whole side), everything else in a column beside or under it.
  if (large) {
    const big = tldrBigPicture(t, spec?.picture)!;
    // One of its photos shown large is credited on it, as a strip credits each.
    const credit = t.photos?.find((x) => x.src === big.src)?.credit;
    return html`<article class="tl${cls}" aria-label="${t.title}, in short">
  <div class="tl__art">${frame(big.src, big.kind, t.who ? t.lead : '')}${credit ? html`<span class="tl__artcredit">Photo: ${credit}</span>` : html``}</div>
  <div class="tl__inner">${header}${every(['lead', 'photos', 'stats', 'bars', 'points'])}${foot}</div>
</article>`;
  }
  // Split: the words (title, lead, numbers) at the left, what's drawn or listed at the right.
  const body = layout === 'split'
    ? html`<div class="tl__cols"><div class="tl__col">${header}${shown(['lead', 'stats'])}</div><div class="tl__col">${shown(['photos', 'bars', 'points'])}</div></div>`
    : html`${header}${every(['lead', 'photos', 'stats', 'bars', 'points'])}`;
  return html`<article class="tl${cls}" aria-label="${t.title}, in short">
  ${body}
  ${foot}
</article>`;
}

/** A composed card's data, at /tldr/… (core TLDR_VIEW_PATHS): words and pictures from the notebook, never from the view. Pure. */
export function tldrViewData(t: TldrData, spec: Pick<TldrSpec, 'headline' | 'takeaway' | 'picture'>, date: string): Record<string, unknown> {
  const big = tldrBigPicture(t, spec.picture ?? 'photos');
  const photo = big ? (t.photos?.find((x) => x.src === big.src) ?? { src: big.src, credit: '', name: t.lead }) : undefined;
  return {
    title: t.title, headline: spec.headline ?? t.title, ...(spec.takeaway ? { takeaway: spec.takeaway } : {}),
    leadLabel: t.leadLabel, lead: t.lead, ...(t.note ? { note: t.note } : {}), date,
    ...(photo ? { photo } : {}), photos: t.photos ?? [],
    ...(t.drawing ? { drawing: { src: t.drawing, credit: '', name: t.title } } : {}),
  };
}

type Blocks = { header: SafeHtml; foot: SafeHtml; date: string; part: Record<TldrPart | 'hero', SafeHtml> };
const VIEW_PARTS: Record<string, keyof Blocks['part'] | 'header' | 'foot'> = { header: 'header', foot: 'foot', lead: 'lead', hero: 'hero', stats: 'stats', bars: 'bars', points: 'points', photos: 'photos' };

/**
 * A card composed as an A2UI view (core checkTldrView passed it): its layout
 * and the card's own components, every word and picture taken from the
 * card's data, each photo credited, and the card's foot always at the end.
 */
function tldrViewCard(view: readonly ViewComponent[], t: TldrData, spec: TldrSpec, blocks: Blocks): SafeHtml {
  const byId = new Map(view.map((c) => [c.id, c]));
  const data = tldrViewData(t, spec, blocks.date);
  const at = (p: string): unknown => p.replace(/^\/tldr\/?/, '').split('/').filter(Boolean).reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), data);
  const val = (v: unknown): unknown => {
    if (v && typeof v === 'object' && !Array.isArray(v)) { const o = v as { path?: unknown; '@path'?: unknown }; const p = typeof o.path === 'string' ? o.path : typeof o['@path'] === 'string' ? o['@path'] : undefined; if (p !== undefined) return at(p); }
    return v;
  };
  const words = (v: unknown): string => { const x = val(v); return typeof x === 'string' || typeof x === 'number' ? String(x) : ''; };
  const photo = (v: unknown): TldrPhoto | undefined => { const x = val(v) as Partial<TldrPhoto> | undefined; return x && typeof x === 'object' && typeof x.src === 'string' ? { src: x.src, credit: x.credit ?? '', name: x.name ?? '' } : undefined; };
  const kids = (c: ViewComponent): string[] => (Array.isArray(c.children) ? (c.children as unknown[]).filter((x): x is string => typeof x === 'string') : []);
  let footUsed = false;
  const seen = new Set<string>();
  const node = (id: string): SafeHtml => {
    const c = byId.get(id);
    if (!c || seen.has(id)) return html``;
    seen.add(id);
    switch (c.component) {
      case 'Column': return html`<div class="tlv__col">${kids(c).map(node) as unknown as SafeHtml[]}</div>`;
      case 'Row': case 'Columns': {
        const ids = kids(c);
        const w = Array.isArray(c.widths) ? (c.widths as unknown[]).map((x) => (typeof x === 'number' && x > 0 ? x : 1)) : [];
        return html`<div class="tlv__row" style="grid-template-columns:${ids.map((_, i) => `minmax(0, ${String(w[i] ?? 1)}fr)`).join(' ')}">${ids.map(node) as unknown as SafeHtml[]}</div>`;
      }
      case 'Text': {
        const text = words(c.text);
        if (!text) return html``;
        const v = typeof c.variant === 'string' ? c.variant : 'body';
        return v === 'h1' ? html`<h1 class="tl__title">${text}</h1>` : v === 'h2' ? html`<h2 class="tlv__h2">${text}</h2>` : v === 'h3' ? html`<h3 class="tlv__h3">${text}</h3>` : v === 'caption' ? html`<p class="tl__kicker">${text}</p>` : html`<p class="tlv__body">${text}</p>`;
      }
      case 'TldrPart': {
        const k = VIEW_PARTS[String(c.part)];
        if (k === 'foot') { footUsed = true; return blocks.foot; }
        return k === 'header' ? blocks.header : k ? blocks.part[k] : html``;
      }
      case 'PhotoCover': {
        const ph = photo(c.photo);
        const kicker = words(c.kicker), headline = words(c.headline), takeaway = words(c.takeaway);
        const cls = `tlv__cover is-${String(c.height ?? 'normal')} at-${String(c.align ?? 'bottom')} scrim-${String(c.scrim ?? 'dark')}`;
        const focus = c.focus === 'top' ? '20%' : c.focus === 'bottom' ? '80%' : '50%';
        return html`<section class="${cls}">${ph ? html`<img src="${ph.src}" alt="${ph.name}" style="object-position:center ${focus}">` : html``}<div class="tlv__over">${kicker ? html`<p class="tlv__kick">${kicker}</p>` : html``}${headline ? html`<h1 class="tlv__hl">${headline}</h1>` : html``}${takeaway ? html`<p class="tlv__tk">${takeaway}</p>` : html``}</div>${ph?.credit ? html`<span class="tlv__credit">Photo: ${ph.credit}</span>` : html``}</section>`;
      }
      case 'PhotoGrid': {
        const list = (Array.isArray(val(c.photos)) ? (val(c.photos) as unknown[]) : []).map((x) => photo(x)).filter((x): x is TldrPhoto => !!x).slice(0, typeof c.count === 'number' ? c.count : TLDR_PHOTOS_MAX);
        if (!list.length) return html``;
        const ratio = c.ratio === '1:1' ? '1 / 1' : c.ratio === '16:10' ? '16 / 10' : '4 / 3';
        return html`<section class="tl__photos tlv__grid" style="--ratio:${ratio}"><ol class="tl__shots" style="--shots:${String(list.length)}">${list.map((x) => html`<li class="tl__shot">${frame(x.src, 'photo', x.name)}${x.credit ? html`<span class="tl__credit">${x.credit}</span>` : html``}</li>`) as unknown as SafeHtml[]}</ol></section>`;
      }
      default: return html``;
    }
  };
  // The root's own parts: a cover runs to the card's edges, everything else sits inside its margins.
  const root = byId.get('root');
  const top = root && root.component === 'Column' ? kids(root) : ['root'];
  if (root?.component === 'Column') seen.add('root');
  const body = top.map((id) => { const c = byId.get(id); const drawn = node(id); return c?.component === 'PhotoCover' ? drawn : html`<div class="tlv__pad">${drawn}</div>`; });
  return html`<article class="tl tl--view tl--${spec.size} tl--${spec.tone}" aria-label="${t.title}, in short">
  ${body as unknown as SafeHtml[]}
  ${footUsed ? html`` : html`<div class="tlv__pad">${blocks.foot}</div>`}
</article>`;
}

/** The TL;DR as a page of its own, at the picture's width. */
export function renderNotebookTldr(args: { nb: Notebook; entries: readonly NotebookEntry[]; history?: NotebookWidgetHistory; pictures?: BriefPicture; aboutPicture?: { src: string; logo?: boolean }; chosen?: TldrPhoto; now?: Date; theme?: BriefTheme; spec?: TldrSpec }): string {
  const theme = args.theme ?? briefTheme(undefined, 'light');
  const t = tldrData(args.nb, args.entries, args.history, args.pictures, args.aboutPicture, args.chosen);
  // Drawn as the notebook's redraw says (or the one asked for); else the standard picture.
  const width = TLDR_SIZES[args.spec?.size ?? 'standard'].width;
  const body = html`<title>${args.nb.title}: TL;DR</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;600;700&display=swap">
<style>
${unsafeHtml(theme.css)}
html, body { margin: 0; background: var(--bg); }
body { width: ${String(width)}px; }
${unsafeHtml(TLDR_CSS)}
</style>
${tldrCard(t, { ...(args.now ? { now: args.now } : {}), ...(args.spec ? { spec: args.spec } : {}) })}`;
  return `<!doctype html>\n<html lang="en"${theme.mode === 'light' ? ' data-theme="light"' : ''}>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=${String(width)}">\n${render(body).replace('<article class="tl', '</head>\n<body>\n<article class="tl')}\n</body>\n</html>\n`;
}
