/**
 * A notebook as a brief to share: a summary of what it found, as one
 * self-contained page (no app chrome, no outside files but a font, no
 * scripts unless it's opened to print). The goal; the decision or where it
 * stands; key findings computed from the notebook itself (spans, gaps, why
 * the rest were ruled out, where it looked); the options as a table, then
 * each with its facts, why it fits and its own page; what was ruled out;
 * sua's notes; the limits and done-whens. Light and dark, phone width, and
 * laid out for print (Save as PDF). `fragment` leaves out the document
 * wrapper, for a host that adds its own (a Claude artifact).
 */
import { isListPage, isRange, rankOptions, readOptionText, type Notebook, type NotebookEntry, type NotebookField, type NotebookFieldValue, type NotebookViewOption } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { decisionPicks, formatFieldValue } from './notebooks.js';
import { notebookWidgetData, optionFacets, type NotebookWidgetHistory } from '../lib/notebook-widgets.js';

/** "**39 in the running**, 22 ruled out": escaped, with its bold kept. */
function inline(md: string): SafeHtml {
  return unsafeHtml(render(html`${md}`).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'));
}

const ROLE_ORDER = ['score', 'price', 'measure', 'when', 'place', 'org'] as const;

/** The org fact, when the name already starts with it ("Vena: Excel-centered FP&A"). */
const orgInName = (f: NotebookField, o: NotebookViewOption) => f.role === 'org' && typeof o.fields[f.key] === 'string' && o.title.toLowerCase().startsWith(String(o.fields[f.key]).toLowerCase());

/** The fields a reader compares, in order: fit, price, the main measure, when, place, org, then the rest. */
function compareFields(nb: Notebook): NotebookField[] {
  const byRole = ROLE_ORDER.map((r) => nb.fields.find((f) => f.role === r)).filter((f): f is NotebookField => !!f);
  const rest = nb.fields.filter((f) => !byRole.includes(f) && f.role !== 'link' && f.role !== 'image' && f.type !== 'url' && f.type !== 'image');
  return [...byRole, ...rest];
}

/** An option's facts for its row: the ones its title doesn't already say. */
function facts(nb: Notebook, o: NotebookViewOption): Array<{ label: string; value: string }> {
  const title = o.title.toLowerCase();
  const stated = readOptionText(o.title, nb.fields);
  return compareFields(nb)
    .filter((f) => o.fields[f.key] !== undefined && o.fields[f.key] !== '')
    .filter((f) => !orgInName(f, o))
    // Repeats of the title: a text fact it contains ("Controller"), the price it states.
    .filter((f) => !(typeof o.fields[f.key] === 'string' && title.includes(String(o.fields[f.key]).toLowerCase())))
    .filter((f) => !(f.role === 'price' && stated[f.key] !== undefined))
    .map((f) => ({ label: f.label, value: formatFieldValue(f, o.fields[f.key]) }))
    .filter((x) => x.value.length <= 60)
    .slice(0, 6);
}

/** The first sentence of an option's notes: why it's here, in a line. */
function whyLine(o: NotebookViewOption): string {
  const text = o.body.replace(/\s+/g, ' ').replace(/\(found by the [^)]*\)/g, '').trim();
  if (!text) return '';
  const first = /^(.+?[.!?])(\s|$)/.exec(text)?.[1] ?? text;
  return first.length > 200 ? `${first.slice(0, 197).replace(/\s+\S*$/, '')}…` : first;
}

/** The option's own page, when it has one (not a page of search results). */
const ownPage = (o: NotebookViewOption) => (o.link && !o.linkIsList && !isListPage(o.link) ? o.link : undefined);

/** The checks ticked on an option (only the notebook's own). */
const ticked = (nb: Notebook, o: NotebookViewOption) => nb.checks.filter((c) => o.checked.some((d) => d.toLowerCase() === c.toLowerCase()));

/** A number field's values across options: each range by its ends. */
function span(f: NotebookField, options: readonly NotebookViewOption[]): { lo: number; hi: number; have: number } | undefined {
  let lo = Infinity; let hi = -Infinity; let have = 0;
  for (const o of options) {
    const v: NotebookFieldValue | undefined = o.fields[f.key];
    const ends = isRange(v) ? [v.min, v.max] : typeof v === 'number' ? [v] : [];
    if (!ends.length) continue;
    have++;
    lo = Math.min(lo, ...ends); hi = Math.max(hi, ...ends);
  }
  return have ? { lo, hi, have } : undefined;
}

const spanText = (f: NotebookField, s: { lo: number; hi: number }) => (s.lo === s.hi ? formatFieldValue(f, s.lo) : formatFieldValue(f, { min: s.lo, max: s.hi }));

/** A ruled-out reason's gist, to group by: the check it failed, else its first clause. */
function reasonGist(reason: string): string {
  const fails = /^Fails\s+"([^"]+)"/i.exec(reason);
  if (fails) return `fails "${fails[1]}"`;
  // "Unfit: pays $150k…", "Posting closed: page not found": the label before the colon.
  const lead = /^([^:]{3,25}):/.exec(reason)?.[1]?.trim();
  if (lead) return lead.replace(/\s*\(\d+\)$/, '').toLowerCase();
  const s = reason.split(/[,.;(]/)[0].trim().toLowerCase();
  return s.length > 60 ? `${s.slice(0, 57).replace(/\s+\S*$/, '')}…` : s;
}

/** A short categorical field to say how the options split ("Remote: 3 remote, 1 on-site"), with its counts. */
function split(nb: Notebook, options: readonly NotebookViewOption[]): { label: string; counts: Array<[string, number]> } | undefined {
  if (options.length < 3) return undefined;
  const candidates = nb.fields.filter((f) => f.type === 'text' && f.role !== 'org' && f.role !== 'link' && f.role !== 'image' && !/title|name/i.test(f.key));
  let best: { label: string; counts: Array<[string, number]>; have: number } | undefined;
  for (const f of candidates) {
    const counts = new Map<string, number>();
    let have = 0;
    for (const o of options) {
      const facet = optionFacets(nb, o)?.[f.key];
      const raw = o.fields[f.key];
      const v = (facet || (typeof raw === 'string' ? raw : '')).replace(/\s+/g, ' ').trim();
      if (!v) continue;
      have++;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const values = [...counts.keys()];
    if (values.length < 2 || values.length > 5 || values.some((v) => v.length > 30) || have < Math.ceil(options.length * 0.6)) continue;
    // Place first; else the field most options state.
    const score = (f.role === 'place' ? 1000 : 0) + have;
    if (!best || score > best.have) best = { label: f.label, counts: [...counts.entries()].sort((a, b) => b[1] - a[1]), have: score };
  }
  return best ? { label: best.label, counts: best.counts } : undefined;
}

/** Key findings, computed from the notebook: nothing a model wrote, nothing guessed. */
function findings(nb: Notebook, all: readonly NotebookViewOption[], active: readonly NotebookViewOption[], searches: number, sources: ReadonlyArray<{ name: string; found: number; status: string }>): SafeHtml[] {
  const out: SafeHtml[] = [];
  const ruled = all.filter((o) => o.ruledOut);
  const chosen = active.filter((o) => o.chosen);
  out.push(html`<strong>${String(all.length)} option${all.length === 1 ? '' : 's'} looked at</strong>${searches ? ` over ${String(searches)} search${searches === 1 ? '' : 'es'}` : ''}: ${String(active.length)} in the running${chosen.length ? `, ${String(chosen.length)} chosen` : ''}${ruled.length ? `, ${String(ruled.length)} ruled out` : ''}.`);
  const priceF = nb.fields.find((f) => f.role === 'price');
  const priceS = priceF ? span(priceF, active) : undefined;
  if (priceF && priceS) {
    const missing = active.length - priceS.have;
    out.push(html`${priceF.label} in the running: <span class="num">${spanText(priceF, priceS)}</span>${missing ? html`; ${String(missing)} ${missing === 1 ? "doesn't" : "don't"} list it` : html``}.`);
  }
  const scoreF = nb.fields.find((f) => f.role === 'score');
  const scoreS = scoreF ? span(scoreF, active) : undefined;
  if (scoreF && scoreS) {
    const strong = active.filter((o) => (o.score ?? -1) >= 80).length;
    out.push(html`${scoreF.label} runs <span class="num">${spanText(scoreF, scoreS)}</span>${strong ? `; ${String(strong)} score 80 or more` : ''}.`);
  }
  const measureF = nb.fields.find((f) => f.role === 'measure');
  const measureS = measureF ? span(measureF, active) : undefined;
  if (measureF && measureS && measureS.have > 1) out.push(html`${measureF.label}: <span class="num">${spanText(measureF, measureS)}</span>.`);
  const sp = split(nb, active);
  if (sp) out.push(html`${sp.label}: ${sp.counts.map(([v, n]) => `${String(n)} ${v}`).join(', ')}.`);
  if (ruled.length) {
    const groups = new Map<string, number>();
    for (const o of ruled) { const g = reasonGist(o.ruledOut!.reason); if (g) groups.set(g, (groups.get(g) ?? 0) + 1); }
    const top = [...groups.entries()].sort((a, b) => b[1] - a[1]).filter(([, n]) => n > 1).slice(0, 3);
    if (top.length) out.push(html`Most often ruled out for: ${top.map(([g, n]) => `${g} (${String(n)})`).join('; ')}.`);
  }
  const toCheck = nb.checks.length ? active.filter((o) => ticked(nb, o).length < nb.checks.length).length : 0;
  const linkF = nb.fields.find((f) => f.role === 'link');
  const noOwn = linkF ? active.filter((o) => !ownPage(o)).length : 0;
  const open = [toCheck ? `${String(toCheck)} of ${String(active.length)} still to check` : '', noOwn ? `${String(noOwn)} without their own page` : ''].filter(Boolean);
  if (open.length) out.push(html`Still open: ${open.join(', ')}.`);
  if (sources.length) {
    const found = sources.filter((x) => x.status === 'found');
    const none = sources.filter((x) => x.status === 'none').map((x) => x.name);
    const stuck = sources.filter((x) => x.status === 'blocked').map((x) => x.name);
    out.push(html`The last search looked at ${sources.map((x) => `${x.name} (${String(x.found)})`).join(', ')}${none.length && found.length ? `; nothing from ${none.join(', ')}` : ''}${stuck.length ? `; ${stuck.join(', ')} didn't finish` : ''}.`);
  }
  return out;
}

/** The options side by side: a column per key fact. */
function table(nb: Notebook, options: readonly NotebookViewOption[]): SafeHtml {
  // Up to 4 key facts that at least half of them state (a column of dashes says nothing).
  const stated = (f: NotebookField) => options.filter((o) => o.fields[f.key] !== undefined && o.fields[f.key] !== '').length;
  // A text fact most names already say (a "Title" field) is a column of repeats.
  const inTitle = (f: NotebookField) => options.filter((o) => typeof o.fields[f.key] === 'string' && o.title.toLowerCase().includes(String(o.fields[f.key]).toLowerCase())).length;
  const cols = compareFields(nb)
    .filter((f) => !(f.role === 'org' && options.every((o) => orgInName(f, o))))
    .filter((f) => !(f.type === 'text' && f.role !== 'org' && inTitle(f) > stated(f) / 2))
    .filter((f) => stated(f) >= Math.max(1, Math.ceil(options.length / 2)))
    .slice(0, 4);
  const anyChecks = nb.checks.length > 0 && options.some((o) => ticked(nb, o).length > 0);
  const cell = (f: NotebookField, o: NotebookViewOption) => {
    const v = o.fields[f.key];
    if (v === undefined || v === '') return html`<td class="dim">—</td>`;
    const t = formatFieldValue(f, v);
    // Numbers in mono; words (a value proposition, a location) in the reading face.
    const cls = f.type === 'money' || f.type === 'number' || f.type === 'date' ? 'num' : 'txt';
    return t.length > 40 ? html`<td class="${cls}" title="${t}">${t.slice(0, 38)}…</td>` : html`<td class="${cls}">${t}</td>`;
  };
  return html`<div class="tbl"><table>
    <thead><tr><th scope="col">#</th><th scope="col">Option</th>${cols.map((f) => html`<th scope="col">${f.label}</th>`) as unknown as SafeHtml[]}${anyChecks ? html`<th scope="col">Checks</th>` : html``}</tr></thead>
    <tbody>${options.map((o, i) => html`<tr${o.chosen ? unsafeHtml(' class="is-chosen"') : unsafeHtml('')}><td class="n">${String(i + 1)}</td><th scope="row">${o.name}${o.chosen ? html` <span class="tag tag--chosen">Chosen</span>` : html``}</th>${cols.map((f) => cell(f, o)) as unknown as SafeHtml[]}${anyChecks ? html`<td>${String(ticked(nb, o).length)}/${String(nb.checks.length)}</td>` : html``}</tr>`) as unknown as SafeHtml[]}</tbody>
  </table></div>`;
}

function optionRow(nb: Notebook, o: NotebookViewOption, n: number): SafeHtml {
  const checks = ticked(nb, o);
  const own = ownPage(o);
  const why = whyLine(o);
  return html`<li class="opt${o.chosen ? ' is-chosen' : ''}">
    <span class="opt__n" aria-hidden="true">${String(n)}</span>
    <div class="opt__body">
      <div class="opt__head">
        <h3 class="opt__name">${o.title}</h3>
        ${o.chosen ? html`<span class="tag tag--chosen">Chosen</span>` : html``}
      </div>
      <dl class="opt__facts">${facts(nb, o).map((f) => html`<div><dt>${f.label}</dt><dd>${f.value}</dd></div>`) as unknown as SafeHtml[]}</dl>
      ${why ? html`<p class="opt__why">${why}</p>` : html``}
      <div class="opt__foot">
        ${checks.length ? html`<span class="checks${checks.length === nb.checks.length ? ' is-all' : ''}" title="${checks.join(', ')}">${String(checks.length)}/${String(nb.checks.length)} checks</span>` : html``}
        ${own ? html`<a class="opt__link" href="${own}" target="_blank" rel="noopener noreferrer">Own page ↗</a>` : o.link ? html`<span class="opt__nolink" title="${o.link}">Found on a search page</span>` : html``}
      </div>
    </div>
  </li>`;
}

/** sua's notes along the way, newest first (not the finder's own "Searched N places" line: findings say that). */
function notes(entries: readonly NotebookEntry[]): NotebookEntry[] {
  return entries
    .filter((e) => (e.kind === 'note' || e.kind === 'evidence') && !/^Searched \d+ places at once/.test(e.title))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6);
}

/** Text cut at a word, with an ellipsis. */
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s);

/** How many ruled-out options the brief lists (the findings group the rest by reason). */
const RULED_SHOWN = 12;

const fmtDate = (iso: string | undefined, fallback: Date) => (iso ? new Date(iso) : fallback).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

export function renderNotebookBrief(args: { nb: Notebook; entries: readonly NotebookEntry[]; history?: NotebookWidgetHistory; fragment?: boolean; now?: Date; print?: boolean }): string {
  const { nb } = args;
  const now = args.now ?? new Date();
  const d = notebookWidgetData(nb, args.entries, args.history).notebook;
  // Best first, by the notebook's own ranking (fit, else price); once decided, the chosen first.
  const ranked = rankOptions(nb, d.options);
  const chosen = ranked.filter((o) => o.chosen);
  const decided = nb.status === 'decided';
  const active = decided && chosen.length ? [...chosen, ...ranked.filter((o) => !o.chosen)] : ranked;
  const detailed = active.slice(0, 12);
  const brief = active.slice(12);
  const ruled = [...d.options.filter((o) => o.ruledOut)].sort((a, b) => b.ruledOut!.at.localeCompare(a.ruledOut!.at));
  const searches = args.history?.searches?.(nb.id, 50).length ?? 0;
  const picks = decided ? decisionPicks(nb, args.entries) : undefined;
  const keyF = compareFields(nb)[0];
  const body = html`<title>${nb.title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&display=swap">
<style>
/* A brief: one column of reading. Findings first, the options as a table, then each in detail. */
:root {
  --bg: #faf9f7; --surface: #ffffff; --line: #e7e5e4; --line-strong: #d6d3d1;
  --text: #1c1917; --muted: #78716c; --subtle: #a8a29e;
  --accent: #0f766e; --accent-soft: #ccfbf1; --ok: #15803d;
  --mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
  --sans: system-ui, -apple-system, "Segoe UI", sans-serif;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #1a1918; --surface: #242220; --line: #3d3a37; --line-strong: #57534e;
  --text: #e7e5e4; --muted: #a8a29e; --subtle: #78716c;
  --accent: #2dd4bf; --accent-soft: rgba(45, 212, 191, 0.12); --ok: #4ade80; color-scheme: dark;
} }
:root[data-theme="dark"] {
  --bg: #1a1918; --surface: #242220; --line: #3d3a37; --line-strong: #57534e;
  --text: #e7e5e4; --muted: #a8a29e; --subtle: #78716c;
  --accent: #2dd4bf; --accent-soft: rgba(45, 212, 191, 0.12); --ok: #4ade80; color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.6 var(--sans); }
.brief { max-width: 48rem; margin: 0 auto; padding-inline: 1rem; padding-block: 2.5rem 3rem; display: grid; gap: 2rem; }
.brief > * { min-width: 0; }
.eyebrow { font: 600 0.6875rem/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
h1 { margin: 0.5rem 0 0; font: 700 1.75rem/1.2 var(--mono); text-wrap: balance; }
.goal { margin: 0.75rem 0 0; color: var(--muted); max-width: 65ch; }
.stands { margin: 0; padding: 1rem 1.25rem; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; max-width: 65ch; }
.stands strong { font-weight: 650; }
.decision { padding: 1rem 1.25rem; border-radius: 10px; background: var(--accent-soft); display: grid; gap: 0.6rem; }
.decision__head { margin: 0; font-size: 0.9375rem; }
.decision__head b { font: 600 0.6875rem/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); margin-right: 0.5rem; }
.decision ul { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 0.25rem 1.5rem; font-size: 0.875rem; }
.decision li strong { font-weight: 650; }
.decision li span { color: var(--muted); }
.decision p { margin: 0; color: var(--muted); font-size: 0.875rem; max-width: 65ch; }
h2 { margin: 0 0 0.75rem; font: 700 1.0625rem/1.3 var(--mono); }
.count { font: 500 0.8125rem var(--mono); color: var(--muted); margin-left: 0.5rem; }
.findings { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.35rem; max-width: 70ch; }
.findings li::marker { color: var(--accent); }
.num { font-family: var(--mono); font-size: 0.875em; font-variant-numeric: tabular-nums; }
.tbl { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); }
table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--line); vertical-align: top; }
thead th { font: 600 0.6875rem/1.2 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); white-space: nowrap; }
tbody th { font-weight: 600; min-width: 12rem; }
tbody td { font-family: var(--mono); font-variant-numeric: tabular-nums; max-width: 14rem; overflow-wrap: break-word; }
tbody td.txt { font-family: var(--sans); color: var(--muted); min-width: 7rem; }
tbody td.n, tbody td.num { white-space: nowrap; }
tbody td.n { width: 1.5rem; }
tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
td.n { color: var(--subtle); }
tr.is-chosen td.n { color: var(--accent); }
td.dim { color: var(--subtle); }
ol.opts { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
.opt { display: grid; grid-template-columns: 2rem minmax(0, 1fr); gap: 0.75rem; padding-block: 1rem; border-bottom: 1px solid var(--line); }
.opt__n { font: 700 0.875rem/1.6 var(--mono); color: var(--subtle); font-variant-numeric: tabular-nums; }
.is-chosen .opt__n { color: var(--accent); }
.opt__body { min-width: 0; display: grid; gap: 0.4rem; }
.opt__head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; }
.opt__name { margin: 0; font-size: 0.9375rem; font-weight: 650; overflow-wrap: anywhere; }
.tag { font: 600 0.625rem/1 var(--mono); letter-spacing: 0.04em; text-transform: uppercase; padding: 0.2rem 0.4rem; border-radius: 999px; vertical-align: 1px; }
.tag--chosen { background: var(--accent); color: var(--bg); }
.opt__facts { margin: 0; display: flex; flex-wrap: wrap; gap: 0.25rem 1.25rem; }
.opt__facts div { display: flex; gap: 0.35rem; align-items: baseline; min-width: 0; }
.opt__facts dt { font-size: 0.75rem; color: var(--muted); }
.opt__facts dd { margin: 0; font: 500 0.8125rem var(--mono); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.opt__why { margin: 0; font-size: 0.875rem; color: var(--muted); max-width: 70ch; }
.opt__foot { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; align-items: center; font-size: 0.8125rem; }
.opt__foot:empty { display: none; }
.checks { font: 500 0.75rem var(--mono); color: var(--muted); }
.checks.is-all { color: var(--ok); }
.opt__link { color: var(--accent); text-decoration: none; font-weight: 600; }
.opt__link:hover, .opt__link:focus-visible { text-decoration: underline; }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
.opt__nolink { color: var(--subtle); }
.plain { margin: 0; padding: 0; list-style: none; display: grid; gap: 0.4rem; font-size: 0.875rem; }
.plain li { overflow-wrap: anywhere; }
.plain .why { color: var(--muted); }
.more { color: var(--muted); font-size: 0.875rem; margin: 0.5rem 0 0; }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: 1.5rem; }
.cols ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 0.4rem; }
.chip { display: inline-block; padding: 0.15rem 0.55rem; border: 1px solid var(--line-strong); border-radius: 999px; font-size: 0.8125rem; }
.limits { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.crit { display: flex; gap: 0.5rem; font-size: 0.875rem; }
.crit i { font-style: normal; font-family: var(--mono); color: var(--subtle); }
.crit.is-met i { color: var(--ok); }
footer { color: var(--subtle); font-size: 0.75rem; border-top: 1px solid var(--line); padding-top: 1rem; }
/* On paper (Save as PDF): the light palette, fills kept, nothing split across pages, links with their address. */
@media print {
  :root, :root[data-theme="dark"] {
    --bg: #ffffff; --surface: #ffffff; --line: #e7e5e4; --line-strong: #d6d3d1;
    --text: #1c1917; --muted: #57534e; --subtle: #78716c;
    --accent: #0f766e; --accent-soft: #ccfbf1; --ok: #15803d; color-scheme: light;
  }
  @page { margin: 16mm 14mm; }
  body { font-size: 11pt; }
  .brief { max-width: none; padding: 0; gap: 1.25rem; }
  .decision, .tag, tr.is-chosen td.n { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .tbl { overflow: visible; border-color: var(--line-strong); }
  h2, h3 { break-after: avoid; }
  .opt, tr, .decision, .stands, .findings li, .plain li, .cols > div { break-inside: avoid; }
  .opt__link::after { content: " " attr(href); font: 400 0.6875rem var(--mono); color: var(--subtle); word-break: break-all; }
  footer { break-before: avoid; }
}
</style>
<main class="brief">
  <header>
    <div class="eyebrow">Notebook brief · ${fmtDate(undefined, now)}</div>
    <h1>${nb.title}</h1>
    ${nb.statement ? html`<p class="goal">${nb.statement}</p>` : html``}
  </header>
  ${decided && nb.decision
    ? html`<section class="decision" aria-label="Decision">
        <p class="decision__head"><b>Decision</b>Decided ${fmtDate(nb.decidedAt ?? nb.updatedAt, now)}${picks ? ` · ${String(picks.picks.length)} chosen of ${String(active.length)} in the running` : ''}</p>
        ${picks
          ? html`<ul>${picks.picks.map((p) => html`<li><strong>${p.name}</strong>${p.what ? html` <span>${p.what}</span>` : html``}</li>`) as unknown as SafeHtml[]}</ul>${picks.why ? html`<p>${picks.why}</p>` : html``}`
          : html`<p>${nb.decision}</p>`}
      </section>`
    : html`<p class="stands">${inline(d.summary)}</p>`}
  <section aria-labelledby="b-find">
    <h2 id="b-find">Key findings</h2>
    <ul class="findings">${findings(nb, d.options, active, searches, d.coverage.sources).map((f) => html`<li>${f}</li>`) as unknown as SafeHtml[]}</ul>
  </section>
  ${active.length ? html`<section aria-labelledby="b-table">
    <h2 id="b-table">${decided && chosen.length ? 'The final set, and the rest in the running' : 'The shortlist'}<span class="count">${decided && chosen.length ? `${String(chosen.length)} chosen of ${String(active.length)}` : `${String(active.length)} in the running`}</span></h2>
    ${table(nb, active)}
  </section>
  <section aria-labelledby="b-opts">
    <h2 id="b-opts">In detail</h2>
    <ol class="opts">${detailed.map((o, i) => optionRow(nb, o, i + 1)) as unknown as SafeHtml[]}</ol>
    ${brief.length ? html`<p class="more">Also in the running:</p><ul class="plain">${brief.map((o) => html`<li>${o.title}${keyF && o.fields[keyF.key] !== undefined ? html` <span class="why">· ${formatFieldValue(keyF, o.fields[keyF.key])}</span>` : html``}</li>`) as unknown as SafeHtml[]}</ul>` : html``}
  </section>` : html`<p class="more">Nothing in the running yet.</p>`}
  ${ruled.length ? html`<section aria-labelledby="b-out">
    <h2 id="b-out">Ruled out<span class="count">${String(ruled.length)}</span></h2>
    <ul class="plain">${ruled.slice(0, RULED_SHOWN).map((o) => html`<li><strong>${clip(o.title, 90)}</strong> <span class="why">· ${clip(o.ruledOut!.reason.replace(/\s*\(https?:\/\/[^)]*\)?/g, ''), 140)}</span></li>`) as unknown as SafeHtml[]}</ul>
    ${ruled.length > RULED_SHOWN ? html`<p class="more">And ${String(ruled.length - RULED_SHOWN)} more (the notebook has them all, with their sources).</p>` : html``}
  </section>` : html``}
  ${notes(args.entries).length ? html`<section aria-labelledby="b-notes">
    <h2 id="b-notes">Notes along the way</h2>
    <ul class="plain">${notes(args.entries).map((e) => html`<li>${e.title}</li>`) as unknown as SafeHtml[]}</ul>
  </section>` : html``}
  ${nb.params.length || nb.criteria.length ? html`<section class="cols">
    ${nb.params.length ? html`<div><h2>Limits</h2><div class="limits">${nb.params.slice(0, 12).map((p) => html`<span class="chip">${p.length > 80 ? `${p.slice(0, 77)}…` : p}</span>`) as unknown as SafeHtml[]}</div></div>` : html``}
    ${nb.criteria.length ? html`<div><h2>Done when</h2><ul>${nb.criteria.map((c) => html`<li class="crit${c.met ? ' is-met' : ''}"><i>${c.met ? '✓' : '○'}</i><span>${c.text}</span></li>`) as unknown as SafeHtml[]}</ul></div>` : html``}
  </section>` : html``}
  <footer>Facts are as each option's own page or search gave them, not checked unless its checks say so. Made with sua.</footer>
</main>
${args.print ? unsafeHtml('<script>addEventListener("load", () => setTimeout(() => print(), 300));</script>') : html``}`;
  if (args.fragment) return render(body);
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n${render(body).replace('<main class="brief">', '</head>\n<body>\n<main class="brief">')}\n</body>\n</html>\n`;
}
