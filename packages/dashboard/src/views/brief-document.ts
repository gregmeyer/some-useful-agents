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
}

/** The same words, whatever the case or the closing mark (a goal that only repeats the title). */
export const sameWords = (a: string, b: string): boolean => { const n = (x: string) => x.trim().replace(/[.!?…]+$/, '').replace(/\s+/g, ' ').toLowerCase(); return n(a) === n(b); };

/** The document's head: what it is and when, its title, what it was asked for, and the meeting it is for. */
export function briefHead(h: BriefHead): SafeHtml {
  return html`<header class="masthead">
    <div>
      <div class="doc-line"><span class="eyebrow">${h.line}</span><span class="doc-by">Prepared by sua</span></div>
      <h1>${h.title}</h1>
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

/** How a brief is set as a document, after a renderer's own styles (so these decide). */
export const BRIEF_DOCUMENT_CSS = `
/* The brief as a prepared document (brief-document.ts). */
.masthead { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 1.5rem; align-items: start; border-bottom: 2px solid var(--text); padding-bottom: 1rem; }
.masthead aside { max-width: 20rem; font-size: 0.875rem; }
.doc-line { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; }
.masthead .eyebrow { color: var(--accent); margin: 0; }
.doc-by { font-size: 0.75rem; color: var(--muted); white-space: nowrap; }
.masthead .links { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 0.5rem 0 0; font-size: 0.8125rem; }
@media (max-width: 760px) { .masthead { grid-template-columns: 1fr; } }
/* Its sections are numbered, so one can be pointed to ("see 3"). */
.brief { counter-reset: sec; }
.brief h2::before { counter-increment: sec; content: counter(sec); margin-right: 0.6em; color: var(--accent); font-variant-numeric: tabular-nums; }
/* Lines short enough to read: prose stops at about 75 characters, whatever the page's width. */
.goal, .stands, .callout p, .sec > p, .plain li, .findings li, .quotes blockquote, .opt__body p { max-width: 75ch; }
.colophon { color: var(--subtle); font-size: 0.75rem; border-top: 1px solid var(--line); padding-top: 0.75rem; }
.colophon p { margin: 0; max-width: 95ch; } .colophon p + p { margin-top: 0.25rem; }
.colophon__how { color: var(--muted); }
@media print {
  /* Two sizes on paper: what's read first at the body's size, what's looked up (facts, tables, asides) a size down. */
  .part--aside, .part--band, .part--plain, .facts, table, .quotes figcaption { font-size: 9pt; }
  .part--aside .facts dd, .part--band td, .part--plain td { font-size: 9pt; }
  .colophon { break-inside: avoid; }
  /* A table that runs onto the next page: ruled, not boxed (a box breaks open at the foot of the page), its headings again at the top. */
  .tbl { overflow: visible; border: 0; border-top: 1px solid var(--line-strong); border-radius: 0; background: none; }
  thead { display: table-header-group; }
}
`;

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
${args.body}
</main>
${args.print ? unsafeHtml('<script>addEventListener("load", () => setTimeout(() => print(), 300));</script>') : html``}`;
  if (args.fragment) return render(page);
  return `<!doctype html>\n<html lang="en"${args.theme.mode === 'light' ? ' data-theme="light"' : ''}>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n${render(page).replace('<main class="brief">', '</head>\n<body>\n<main class="brief">')}\n</body>\n</html>\n`;
}
