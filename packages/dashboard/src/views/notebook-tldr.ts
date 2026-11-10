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
 * browser (core htmlToPng). `tldrCard` is the card alone, for the brief.
 */
import { briefTheme, type BriefTheme } from '../lib/brief-theme.js';
import { rankBy, rankOptions, type Notebook, type NotebookEntry, type NotebookField, type NotebookViewOption } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { formatFieldValue } from './notebooks.js';
import { notebookWidgetData, type NotebookWidgetHistory } from '../lib/notebook-widgets.js';
import { facts, span, spanText, split, type BriefPicture } from './notebook-brief.js';

/** The picture's width in CSS pixels (the PNG is twice that, so text stays sharp). */
export const TLDR_WIDTH = 1080;
/** Bars shown, at most; the rest are counted under them. */
const MAX_BARS = 8;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s);
/** Markdown's bold and links as plain words (the picture has no links). */
const plain = (md: string) => md.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();

export interface TldrBar { name: string; value: number; text: string; lead: boolean }
export interface TldrData {
  title: string;
  /** "Best lead", "Chosen", "The answer", "Where it stands". */
  leadLabel: string;
  /** The lead option's name, or the sentence that sums it up. */
  lead: string;
  /** The lead option's facts ("$139.99 · 220 Ah · Phoenix, AZ"). */
  leadFacts: string[];
  leadPicture?: string;
  /** The lead is a sentence (an answer), not an option's name. */
  sentence?: boolean;
  stats: Array<{ value: string; label: string }>;
  /** The options as bars by one fact, best first; none when nothing can be plotted. */
  chart?: { label: string; order: string; bars: TldrBar[]; more: number; max: number };
  /** Without bars: the first findings (or talking points), in words. */
  points: string[];
  pointsLabel?: string;
}

/** What the picture says, from the notebook. Pure. */
export function tldrData(nb: Notebook, entries: readonly NotebookEntry[], history?: NotebookWidgetHistory, pictures?: BriefPicture): TldrData {
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
      bars: shown.map((o) => ({ name: clip(o.name, 44), value: num(field, o)!, text: say(field, o), lead: decided ? !!o.chosen : o === lead })),
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
      ...(pictures && lead.image && !(decided && chosen.length > 1) && pictures(lead) ? { leadPicture: pictures(lead)! } : {}),
      stats: stats.slice(0, 3), chart, points: [],
    };
  }
  // A briefing with its talking points written: who or what the meeting is for, the numbers, then the first points.
  const talk = nb.briefing?.points ?? [];
  if (talk.length) {
    const about = nb.about?.person ?? nb.about?.company;
    return {
      title: nb.title, leadLabel: nb.meeting?.goal ? 'Your goal' : about?.summary ? 'Who they are' : "What it's for",
      lead: clip(plain(nb.meeting?.goal || about?.summary || nb.statement || d.summary), 320), leadFacts: [],
      stats: [
        { value: String(talk.length), label: talk.length === 1 ? 'talking point' : 'talking points' },
        ...(nb.briefing!.questions.length ? [{ value: String(nb.briefing!.questions.length), label: nb.briefing!.questions.length === 1 ? 'question to ask' : 'questions to ask' }] : []),
        ...(active.length ? [{ value: String(active.length), label: 'things they said, kept' }] : []),
      ].slice(0, 3),
      points: talk.slice(0, 4).map((p) => clip(plain(p.text), 170)), pointsLabel: 'Talking points',
    };
  }
  return {
    title: nb.title, leadLabel: written ? written.label : nb.status === 'decided' ? 'Decided' : 'Where it stands',
    lead: clip(plain(written ? written.text : nb.status === 'decided' && nb.decision ? nb.decision : d.summary), 320),
    leadFacts: [], stats: stats.slice(0, 3),
    points: d.findings.slice(0, 3).map((f) => clip(plain(f.text), 170)),
  };
}

/** The card's own styles (every class starts with `tl`), in the brief's colours. */
export const TLDR_CSS = `
.tl { box-sizing: border-box; display: grid; gap: 28px; padding: 48px 56px 36px; background: var(--surface); color: var(--text); font: 17px/1.5 var(--sans); border: 1px solid var(--line); }
.tl * { box-sizing: border-box; }
.tl__eyebrow { font: 600 13px/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
.tl__title { margin: 12px 0 0; font: 700 38px/1.15 var(--display); text-wrap: balance; }
.tl__lead { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 28px; align-items: center; padding: 24px 0; border-top: 2px solid var(--text); border-bottom: 1px solid var(--line); }
/* Under a title of its host's (the brief): no rule of its own above the lead. */
.tl--bare .tl__lead { border-top: 0; padding-top: 0; }
.tl__label { font: 600 12px/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.tl__name { margin: 10px 0 0; font: 700 30px/1.2 var(--display); overflow-wrap: anywhere; }
.tl__say { margin: 10px 0 0; font-size: 22px; line-height: 1.4; }
.tl__facts { margin: 12px 0 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 6px 22px; font: 500 16px/1.4 var(--mono); color: var(--muted); }
.tl__pic { width: 200px; height: 132px; border-radius: 8px; overflow: hidden; background: #fff; border: 1px solid var(--line); }
.tl__pic img { display: block; width: 100%; height: 100%; object-fit: contain; }
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
`;

/** The card: `title` false leaves out its eyebrow and title (the brief has its own above it). */
export function tldrCard(t: TldrData, o: { now?: Date; title?: boolean } = {}): SafeHtml {
  const now = o.now ?? new Date();
  const date = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const chart = t.chart;
  return html`<article class="tl${o.title === false ? ' tl--bare' : ''}" aria-label="${t.title}, in short">
  ${o.title === false ? html`` : html`<header><div class="tl__eyebrow">TL;DR · ${date}</div><h1 class="tl__title">${t.title}</h1></header>`}
  <section class="tl__lead">
    <div>
      <div class="tl__label">${t.leadLabel}</div>
      ${chart && !t.sentence ? html`<p class="tl__name">${t.lead}</p>` : html`<p class="tl__say">${t.lead}</p>`}
      ${t.leadFacts.length ? html`<ul class="tl__facts">${t.leadFacts.map((f) => html`<li>${f}</li>`) as unknown as SafeHtml[]}</ul>` : html``}
    </div>
    ${t.leadPicture ? html`<span class="tl__pic"><img src="${t.leadPicture}" alt=""></span>` : html``}
  </section>
  ${t.stats.length ? html`<section class="tl__stats">${t.stats.map((s) => html`<div class="tl__stat"><span class="tl__num${s.value.length > 12 ? ' is-long' : ''}">${s.value}</span><span class="tl__what">${s.label}</span></div>`) as unknown as SafeHtml[]}</section>` : html``}
  ${chart ? html`<section class="tl__chart">
    <div class="tl__label">${chart.label}, ${chart.order}</div>
    <ol class="tl__bars">${chart.bars.map((b) => html`<li class="tl__bar${b.lead ? ' is-lead' : ''}"><span>${b.name}</span><span class="tl__track"><span class="tl__fill" style="width:${(chart.max > 0 ? Math.max(0, (b.value / chart.max) * 100) : 0).toFixed(1)}%"></span></span><span class="tl__val">${b.text}</span></li>`) as unknown as SafeHtml[]}</ol>
    ${chart.more > 0 ? html`<p class="tl__more">and ${String(chart.more)} more in the running</p>` : html``}
  </section>` : t.points.length ? html`<section class="tl__chart"><div class="tl__label">${t.pointsLabel ?? 'What it found'}</div><ol class="tl__points">${t.points.map((p) => html`<li>${p}</li>`) as unknown as SafeHtml[]}</ol></section>` : html``}
  ${o.title === false ? html`` : html`<footer class="tl__foot"><span>From the notebook's own numbers, ${date}</span><span>Made with sua</span></footer>`}
</article>`;
}

/** The TL;DR as a page of its own, at the picture's width. */
export function renderNotebookTldr(args: { nb: Notebook; entries: readonly NotebookEntry[]; history?: NotebookWidgetHistory; pictures?: BriefPicture; now?: Date; theme?: BriefTheme }): string {
  const theme = args.theme ?? briefTheme(undefined, 'light');
  const t = tldrData(args.nb, args.entries, args.history, args.pictures);
  const body = html`<title>${args.nb.title}: TL;DR</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;600;700&display=swap">
<style>
${unsafeHtml(theme.css)}
html, body { margin: 0; background: var(--bg); }
body { width: ${String(TLDR_WIDTH)}px; }
${unsafeHtml(TLDR_CSS)}
</style>
${tldrCard(t, { ...(args.now ? { now: args.now } : {}) })}`;
  return `<!doctype html>\n<html lang="en"${theme.mode === 'light' ? ' data-theme="light"' : ''}>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=${String(TLDR_WIDTH)}">\n${render(body).replace('<article class="tl', '</head>\n<body>\n<article class="tl')}\n</body>\n</html>\n`;
}
