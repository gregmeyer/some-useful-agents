/**
 * A brief as a prepared document. Every kind of notebook's brief (a meeting
 * briefing, a subject or company briefing, an answer, a trip, a watch, an
 * experiment, a shortlist) is set by this one shell: the same head, numbered
 * sections, two sizes of type on paper, lines short enough to read, and a
 * colophon for an ending. A renderer says what its brief contains
 * (notebook-page-brief.ts for a drawn page, notebook-brief.ts for a
 * shortlist); how it is set on paper is here, once.
 */
import type { BriefTheme } from '../lib/brief-theme.js';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { readerPage } from '@some-useful-agents/core';

export interface BriefHead {
  /** What kind of brief it is, with its date ("Meeting briefing · November 16, 2026"). */
  line: string;
  title: string;
  /** What it was asked for; left out when it only repeats the title. */
  statement?: string;
  /** The links it was given, as words. */
  links?: ReadonlyArray<{ url: string; label: string }>;
  meeting?: { when?: string; goal?: string };
  /** A small part set beside the head (a drawn page's side part). */
  side?: SafeHtml;
  /**
   * Who or what the brief is about, as its cover (a photo, the name, a line
   * on them): then the cover is the head's big type and the title a small
   * line over it, so the name is said once.
   */
  cover?: SafeHtml;
}

/** The same words, whatever the case or the closing mark (a goal that only repeats the title). */
export const sameWords = (a: string, b: string): boolean => { const n = (x: string) => x.trim().replace(/[.!?…]+$/, '').replace(/\s+/g, ' ').toLowerCase(); return n(a) === n(b); };

/** The document's head: what it is and when, its title, what it was asked for, and the meeting it is for. */
export function briefHead(h: BriefHead): SafeHtml {
  return html`<header class="masthead">
    <div>
      <div class="doc-line"><span class="eyebrow">${h.line}</span><span class="doc-by">Prepared by sua</span></div>
      <h1${h.cover ? html` class="doc-title"` : html``}>${h.title}</h1>
      ${h.cover ? html`<div class="doc-cover">${h.cover}</div>` : html``}
      ${h.statement && !sameWords(h.statement, h.title) ? html`<p class="goal">${h.statement}</p>` : html``}
      ${h.links?.length ? html`<p class="links">${h.links.map((l) => html`<a href="${l.url}">${l.label}</a>`) as unknown as SafeHtml[]}</p>` : html``}
      ${h.meeting?.when || h.meeting?.goal ? html`<p class="goal">${h.meeting.when ? html`<b>Meeting ${h.meeting.when}</b>` : html``}${h.meeting.when && h.meeting.goal ? html` · ` : html``}${h.meeting.goal ? html`Your goal: ${h.meeting.goal}` : html``}</p>` : html``}
    </div>
    ${h.side ? html`<aside>${h.side}</aside>` : html``}
  </header>`;
}

/**
 * The document's last lines: where it looked and how much it found, in a
 * sentence (the log itself is in the extended brief and on the notebook),
 * then what the brief is and when it was made.
 */
export function briefColophon(c: { places?: ReadonlyArray<{ name: string; found: number }>; note: string }): SafeHtml {
  const places = (c.places ?? []).filter((p) => p.name);
  const found = places.reduce((n, p) => n + p.found, 0);
  return html`<footer class="colophon">${places.length
    ? html`<p class="colophon__how">Looked in ${String(places.length)} ${places.length === 1 ? 'place' : 'places'} and found ${String(found)}: ${places.map((p) => `${p.name} ${String(p.found)}`).join(', ')}.</p>`
    : html``}<p>${c.note}</p></footer>`;
}

/**
 * The brief's sources, numbered in the order they're first cited. A fact, a
 * row, a quote or a finding says where it comes from with a small number, and
 * the page it names is listed once under "Source notes", however often it is
 * cited. A source is a page (its address) or something by name (what you
 * gave; a finding named by its title, which `resolve` turns into its page).
 */
export class SourceNotes {
  private readonly list: Array<{ key: string; label: string; url?: string }> = [];
  constructor(private readonly resolve: (label: string) => string | undefined = () => undefined) {}

  /** The number for this source: the one it already has, or the next. */
  cite(src: { url?: string; label?: string }): number {
    const label = (src.label ?? '').replace(/\s+/g, ' ').trim();
    // The page a reader opens, not a text copy of it.
    const url = readerPage(src.url ?? (label ? this.resolve(label) : undefined));
    const key = url ? url.replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase() : label.toLowerCase();
    if (!key) return 0;
    const at = this.list.findIndex((x) => x.key === key);
    if (at >= 0) { if (label && !this.list[at].label) this.list[at].label = label; return at + 1; }
    this.list.push({ key, label, ...(url ? { url } : {}) });
    return this.list.length;
  }

  get all(): ReadonlyArray<{ label: string; url?: string }> { return this.list; }
}

const pageWords = (u: string): string => { try { const x = new URL(u); return `${x.hostname.replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}`; } catch { return u; } };

/** A source's number, set small after what it supports; several sources, several numbers. */
export function noteMarks(notes: SourceNotes, srcs: ReadonlyArray<{ url?: string; label?: string }>): SafeHtml {
  const ns = [...new Set(srcs.map((x) => notes.cite(x)).filter((n) => n > 0))];
  return ns.length ? html`<sup class="note">${ns.map((n, i) => html`${i ? ',' : ''}<a href="#note-${String(n)}">${String(n)}</a>`) as unknown as SafeHtml[]}</sup>` : html``;
}

/** The sources, each once, by number: its name, and its page as a link. Nothing when none was cited. */
export function briefSources(notes: SourceNotes): SafeHtml {
  if (!notes.all.length) return html``;
  return html`<section class="sources"><h2>Source notes</h2><ol>${notes.all.map((x, i) => html`<li id="note-${String(i + 1)}">${x.label ? html`<span>${x.label}</span>` : html``}${x.url ? html`<a href="${x.url}">${pageWords(x.url)}</a>` : html``}</li>`) as unknown as SafeHtml[]}</ol></section>`;
}

/** How a brief is set as a document, after a renderer's own styles (so these decide). */
export const BRIEF_DOCUMENT_CSS = `
/* The brief as a prepared document (brief-document.ts). */
.masthead { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 1.5rem; align-items: start; border-bottom: 2px solid var(--text); padding-bottom: 1rem; }
.masthead aside { max-width: 20rem; font-size: 0.875rem; }
.doc-line { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; }
.masthead .eyebrow { color: var(--accent); margin: 0; }
.doc-by { font-size: 0.75rem; color: var(--muted); white-space: nowrap; }
/* With a cover, the title is the small line and the cover's name the big one. */
.masthead h1.doc-title { margin: 0.2rem 0 0; font: 400 0.8125rem/1.4 var(--sans); color: var(--muted); letter-spacing: 0; }
.doc-cover { margin-top: 0.75rem; }
.doc-cover .profile--cover { grid-template-columns: 7rem minmax(0, 1fr); }
.doc-cover .pull { font-size: 0.9375rem; line-height: 1.4; }
.doc-cover .profile p { margin-top: 0.35rem; }
/* The part right under the head needs no rule of its own: the head's is there. */
.masthead + .stack > .part--feature:first-child { border-top: 0; padding-top: 0; }
.masthead .links { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 0.5rem 0 0; font-size: 0.8125rem; }
@media (max-width: 760px) { .masthead { grid-template-columns: 1fr; } }
/* Its sections are numbered, so one can be pointed to ("see 3"). The number is written on the heading (numberSections): a CSS counter stops counting inside a column that is a container. */
.brief h2[data-n]::before { content: attr(data-n); margin-right: 0.6em; color: var(--accent); font-variant-numeric: tabular-nums; }
/* Lines short enough to read: prose stops at about 75 characters, whatever the page's width. */
.goal, .stands, .callout p, .sec > p, .plain li, .findings li, .quotes blockquote, .opt__body p { max-width: 75ch; }
/* Where things come from: a small number after what it supports, the pages listed once at the end, two to a row. */
.note { font-size: 0.65em; line-height: 0; margin-left: 0.15em; } .note a { color: var(--accent); text-decoration: none; }
.sources { border-top: 2px solid var(--text); padding-top: 0.75rem; }
.sources ol { margin: 0.5rem 0 0; padding: 0; list-style: none; counter-reset: note; display: flex; flex-wrap: wrap; gap: 0.2rem 1.5rem; font-size: 0.75rem; color: var(--muted); }
.sources li { counter-increment: note; flex: 0 0 calc((100% - 1.5rem) / 2); min-width: 0; display: grid; grid-template-columns: 1.5rem minmax(0, 1fr); overflow-wrap: anywhere; break-inside: avoid; }
.sources li::before { content: counter(note); grid-row: span 2; color: var(--accent); font-variant-numeric: tabular-nums; }
.sources li > * { grid-column: 2; } .sources li span { color: var(--text); }
@media screen and (max-width: 760px) { .sources li { flex-basis: 100%; } }
.colophon { color: var(--subtle); font-size: 0.75rem; border-top: 1px solid var(--line); padding-top: 0.75rem; }
.colophon p { margin: 0; max-width: 95ch; } .colophon p + p { margin-top: 0.25rem; }
.colophon__how { color: var(--muted); }
/* A page's lead, full width: its points two to a row (about 55 characters a line), then the questions beside what to watch for. In a narrow column or on a phone they stay one to a row. */
@media print, screen and (min-width: 761px) {
  .brief > .stack > .part > .agenda > ol { display: flex; flex-wrap: wrap; gap: 0.9rem 1.75rem; }
  .brief > .stack > .part > .agenda > ol > li { flex: 0 0 calc((100% - 1.75rem) / 2); min-width: 0; align-content: start; }
  .brief > .stack > .part > .agenda > ol > li + li { margin-top: 0; }
  .brief > .stack > .part > .agenda > .agenda__pair { display: flex; gap: 0 1.75rem; border-top: 1px solid var(--line); padding-top: 0.25rem; }
  .brief > .stack > .part > .agenda > .agenda__pair > div { flex: 1 1 0; min-width: 0; }
}
/* What they said, two to a row when the part has the page's width: its theme over each, where it's from under. */
@media print, screen and (min-width: 761px) {
  .brief > .stack > .part > .quotes { display: flex; flex-wrap: wrap; gap: 1rem 1.75rem; }
  .brief > .stack > .part > .quotes > figure { flex: 0 0 calc((100% - 1.75rem) / 2); min-width: 0; margin-top: 0; }
  .brief > .stack > .part > .quotes > figure.lead, .brief > .stack > .part > .quotes > p { flex-basis: 100%; margin-top: 0; }
}
@media print {
  /* The lead on paper: set close, so who it's about and every point share the first page when they can. */
  .brief > .stack > .part > .agenda > ol > li { grid-template-columns: 1.5rem minmax(0, 1fr); line-height: 1.42; }
  .brief > .stack > .part > .agenda > ol.numerals > li::before { font-size: 1.375rem; }
  .brief > .stack > .part > .agenda > ol > li > b { font-size: 10pt; }
  .brief > .stack > .part > .agenda > ol > li > span { font-size: 9.5pt; }
  .brief > .stack > .part > .agenda .agenda__pair li { font-size: 9.5pt; line-height: 1.42; }
  .doc-cover .profile--cover { grid-template-columns: 6rem minmax(0, 1fr); }
  .doc-cover .profile p { font-size: 9.5pt; line-height: 1.45; }
  .brief > .stack > .part > .quotes blockquote { font-size: 10pt; line-height: 1.45; }
  /* Two sizes on paper: what's read first at the body's size, what's looked up (facts, tables, asides) a size down. */
  .part--aside, .part--band, .part--plain, .facts, table, .quotes figcaption { font-size: 9pt; }
  .part--aside .facts dd, .part--band td, .part--plain td { font-size: 9pt; }
  .colophon { break-inside: avoid; }
  /* A table that runs onto the next page: ruled, not boxed (a box breaks open at the foot of the page), its headings again at the top. */
  .tbl { overflow: visible; border: 0; border-top: 1px solid var(--line-strong); border-radius: 0; background: none; }
  thead { display: table-header-group; }
}
`;

/** Each section heading given its number, in the order they're read. Pure. */
export function numberSections(body: string): string {
  let n = 0;
  return body.replace(/<h2(?=[\s>])/g, () => `<h2 data-n="${String(++n)}"`);
}

/** The whole file: a renderer's styles, then the document's, around its head and body. */
export function briefPage(args: { title: string; theme: BriefTheme; css: string; body: SafeHtml; print?: boolean; fragment?: boolean }): string {
  const page = html`<title>${args.title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&display=swap">
<style>
${unsafeHtml(args.css)}
${unsafeHtml(BRIEF_DOCUMENT_CSS)}
</style>
<main class="brief">
${unsafeHtml(numberSections(render(args.body)))}
</main>
${args.print ? unsafeHtml('<script>addEventListener("load", () => setTimeout(() => print(), 300));</script>') : html``}`;
  if (args.fragment) return render(page);
  return `<!doctype html>\n<html lang="en"${args.theme.mode === 'light' ? ' data-theme="light"' : ''}>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n${render(page).replace('<main class="brief">', '</head>\n<body>\n<main class="brief">')}\n</body>\n</html>\n`;
}
