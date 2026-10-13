/**
 * A notebook as a brief to share: one self-contained page (no app chrome,
 * no scripts, no outside files but a font) with the goal, where it stands,
 * the decision or the shortlist with each option's key facts, its own page,
 * and its checks, then the limits and done-whens. Light and dark, phone width.
 * `fragment` leaves out the document wrapper, for a host that adds its own
 * (a Claude artifact).
 */
import { isListPage, type Notebook, type NotebookEntry, type NotebookField, type NotebookViewOption } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { formatFieldValue } from './notebooks.js';
import { notebookWidgetData, type NotebookWidgetHistory } from '../lib/notebook-widgets.js';

/** "**39 in the running**, 22 ruled out": escaped, with its bold kept. */
function inline(md: string): SafeHtml {
  return unsafeHtml(render(html`${md}`).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'));
}

const ROLE_ORDER = ['score', 'price', 'measure', 'when', 'place', 'org'] as const;

/** The facts a reader compares, in order: fit, price, the main measure, then the rest that fit on a line. */
function facts(nb: Notebook, o: NotebookViewOption): Array<{ label: string; value: string }> {
  const skip = new Set(['link', 'image']);
  const byRole = ROLE_ORDER.map((r) => nb.fields.find((f) => f.role === r)).filter((f): f is NotebookField => !!f);
  const rest = nb.fields.filter((f) => !byRole.includes(f) && !skip.has(f.role ?? '') && f.type !== 'url' && f.type !== 'image');
  return [...byRole, ...rest]
    .filter((f) => o.fields[f.key] !== undefined && o.fields[f.key] !== '')
    .map((f) => ({ label: f.label, value: formatFieldValue(f, o.fields[f.key]) }))
    .filter((x) => x.value.length <= 60)
    .slice(0, 6);
}

function optionRow(nb: Notebook, o: NotebookViewOption, n: number): SafeHtml {
  const checks = nb.checks.length ? nb.checks.filter((c) => o.checked.some((d) => d.toLowerCase() === c.toLowerCase())) : [];
  const own = o.link && !o.linkIsList && !isListPage(o.link) ? o.link : undefined;
  return html`<li class="opt${o.chosen ? ' is-chosen' : ''}">
    <span class="opt__n" aria-hidden="true">${String(n)}</span>
    <div class="opt__body">
      <div class="opt__head">
        <h3 class="opt__name">${o.title}</h3>
        ${o.chosen ? html`<span class="tag tag--chosen">Chosen</span>` : html``}
      </div>
      <dl class="opt__facts">${facts(nb, o).map((f) => html`<div><dt>${f.label}</dt><dd>${f.value}</dd></div>`) as unknown as SafeHtml[]}</dl>
      <div class="opt__foot">
        ${nb.checks.length ? html`<span class="checks${checks.length === nb.checks.length ? ' is-all' : ''}" title="${checks.join(', ') || 'None yet'}">${String(checks.length)}/${String(nb.checks.length)} checks</span>` : html``}
        ${own ? html`<a class="opt__link" href="${own}" target="_blank" rel="noopener noreferrer">Own page ↗</a>` : o.link ? html`<span class="opt__nolink" title="${o.link}">Found on a search page</span>` : html``}
      </div>
    </div>
  </li>`;
}

export function renderNotebookBrief(args: { nb: Notebook; entries: readonly NotebookEntry[]; history?: NotebookWidgetHistory; fragment?: boolean; now?: Date }): string {
  const { nb } = args;
  const d = notebookWidgetData(nb, args.entries, args.history).notebook;
  const active = d.options.filter((o) => !o.ruledOut);
  const chosen = active.filter((o) => o.chosen);
  const decided = nb.status === 'decided';
  // Decided: the final set, then the rest. Else the shortlist, best first (the widget data's order).
  const lead = decided && chosen.length ? chosen : active.slice(0, 12);
  const rest = decided && chosen.length ? active.filter((o) => !o.chosen) : active.slice(12);
  const date = (args.now ?? new Date()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const body = html`<title>${nb.title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&display=swap">
<style>
/* A brief: one column of reading, the options as a numbered list of compact fact rows. */
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
.brief { max-width: 46rem; margin: 0 auto; padding-inline: 1rem; padding-block: 2.5rem 3rem; display: grid; gap: 2rem; }
.eyebrow { font: 600 0.6875rem/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
h1 { margin: 0.5rem 0 0; font: 700 1.75rem/1.2 var(--mono); text-wrap: balance; }
.goal { margin: 0.75rem 0 0; color: var(--muted); max-width: 65ch; }
.stands { margin: 0; padding: 1rem 1.25rem; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; max-width: 65ch; }
.stands strong { font-weight: 650; }
.decision { margin: 0; padding: 1rem 1.25rem; border-radius: 10px; background: var(--accent-soft); }
.decision b { display: block; font: 600 0.6875rem/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); margin-bottom: 0.4rem; }
h2 { margin: 0 0 0.75rem; font: 700 1.0625rem/1.3 var(--mono); }
.count { font: 500 0.8125rem var(--mono); color: var(--muted); margin-left: 0.5rem; }
ol.opts { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
.opt { display: grid; grid-template-columns: 2rem minmax(0, 1fr); gap: 0.75rem; padding-block: 1rem; border-bottom: 1px solid var(--line); }
.opt__n { font: 700 0.875rem/1.6 var(--mono); color: var(--subtle); font-variant-numeric: tabular-nums; }
.is-chosen .opt__n { color: var(--accent); }
.opt__body { min-width: 0; display: grid; gap: 0.4rem; }
.opt__head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; }
.opt__name { margin: 0; font-size: 0.9375rem; font-weight: 650; overflow-wrap: anywhere; }
.tag { font: 600 0.6875rem/1 var(--mono); letter-spacing: 0.04em; text-transform: uppercase; padding: 0.25rem 0.45rem; border-radius: 999px; }
.tag--chosen { background: var(--accent); color: var(--bg); }
.opt__facts { margin: 0; display: flex; flex-wrap: wrap; gap: 0.25rem 1.25rem; }
.opt__facts div { display: flex; gap: 0.35rem; align-items: baseline; min-width: 0; }
.opt__facts dt { font-size: 0.75rem; color: var(--muted); }
.opt__facts dd { margin: 0; font: 500 0.8125rem var(--mono); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.opt__foot { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; align-items: center; font-size: 0.8125rem; }
.checks { font: 500 0.75rem var(--mono); color: var(--muted); }
.checks.is-all { color: var(--ok); }
.opt__link { color: var(--accent); text-decoration: none; font-weight: 600; }
.opt__link:hover, .opt__link:focus-visible { text-decoration: underline; }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
.opt__nolink { color: var(--subtle); }
.more { color: var(--muted); font-size: 0.875rem; }
.more summary { cursor: pointer; font-weight: 600; color: var(--text); }
.more ul { margin: 0.5rem 0 0; padding-left: 1.1rem; }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: 1.5rem; }
.cols ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 0.4rem; }
.chip { display: inline-block; padding: 0.15rem 0.55rem; border: 1px solid var(--line-strong); border-radius: 999px; font-size: 0.8125rem; }
.limits { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.crit { display: flex; gap: 0.5rem; font-size: 0.875rem; }
.crit i { font-style: normal; font-family: var(--mono); color: var(--subtle); }
.crit.is-met i { color: var(--ok); }
footer { color: var(--subtle); font-size: 0.75rem; border-top: 1px solid var(--line); padding-top: 1rem; }
</style>
<main class="brief">
  <header>
    <div class="eyebrow">Notebook brief · ${date}</div>
    <h1>${nb.title}</h1>
    ${nb.statement ? html`<p class="goal">${nb.statement}</p>` : html``}
  </header>
  ${decided && nb.decision ? html`<p class="decision"><b>Decision</b>${nb.decision}</p>` : html``}
  <p class="stands">${inline(d.summary)}</p>
  <section aria-labelledby="b-opts">
    <h2 id="b-opts">${decided && chosen.length ? 'The final set' : 'The shortlist'}<span class="count">${decided && chosen.length ? `${String(chosen.length)} chosen` : `${String(lead.length)} of ${String(active.length)} in the running`}</span></h2>
    ${lead.length ? html`<ol class="opts">${lead.map((o, i) => optionRow(nb, o, i + 1)) as unknown as SafeHtml[]}</ol>` : html`<p class="more">Nothing in the running yet.</p>`}
    ${rest.length ? html`<details class="more"><summary>${decided && chosen.length ? `Also in the running: ${String(rest.length)}` : `${String(rest.length)} more in the running`}</summary><ul>${rest.map((o) => html`<li>${o.title}</li>`) as unknown as SafeHtml[]}</ul></details>` : html``}
  </section>
  ${nb.params.length || nb.criteria.length ? html`<section class="cols">
    ${nb.params.length ? html`<div><h2>Limits</h2><div class="limits">${nb.params.slice(0, 12).map((p) => html`<span class="chip">${p.length > 80 ? `${p.slice(0, 77)}…` : p}</span>`) as unknown as SafeHtml[]}</div></div>` : html``}
    ${nb.criteria.length ? html`<div><h2>Done when</h2><ul>${nb.criteria.map((c) => html`<li class="crit${c.met ? ' is-met' : ''}"><i>${c.met ? '✓' : '○'}</i><span>${c.text}</span></li>`) as unknown as SafeHtml[]}</ul></div>` : html``}
  </section>` : html``}
  <footer>${String(d.options.length)} options looked at, ${String(d.options.length - active.length)} ruled out. Made with sua.</footer>
</main>`;
  if (args.fragment) return render(body);
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n${render(body).replace('<main class="brief">', '</head>\n<body>\n<main class="brief">')}\n</body>\n</html>\n`;
}
