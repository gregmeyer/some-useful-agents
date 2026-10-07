/**
 * How a notebook was made (/notebooks/:id/workflow): every run that filed
 * into it, the runs those started, and what each left, drawn as one graph
 * with the same renderer as a run's DAG, plus the same runs as a list.
 */
import type { Notebook, NotebookLineage, LineageFeeder, LineageRun } from '@some-useful-agents/core';
import { html, render, unsafeHtml, type SafeHtml } from './html.js';
import { layout } from './layout.js';
import { formatAge } from './components.js';
import { renderGraphFrame } from './dag-view.js';

const KIND_WORDS: Record<string, [string, string]> = { option: ['option', 'options'], note: ['note', 'notes'], evidence: ['piece of evidence', 'evidence'], decision: ['ruling', 'rulings'] };

/** "4 options · 1 note · saw 3 again". */
export function leftSummary(f: Pick<LineageFeeder, 'kinds' | 'seenAgain'>): string {
  const parts = (['option', 'note', 'evidence', 'decision'] as const)
    .filter((k) => (f.kinds[k] ?? 0) > 0)
    .map((k) => `${String(f.kinds[k])} ${KIND_WORDS[k][f.kinds[k] === 1 ? 0 : 1]}`);
  if (f.seenAgain) parts.push(`saw ${String(f.seenAgain)} again`);
  return parts.join(' · ');
}

const GRAPH_FEEDERS = 4;

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The graph: notebook → runs that filed → the runs they started, and what each left. */
export function lineageElements(nb: Pick<Notebook, 'id' | 'title'>, lineage: Pick<NotebookLineage, 'feeders'>): unknown[] {
  const out: unknown[] = [{ data: { id: 'nb', label: short(nb.title, 40), type: 'notebook', href: `/notebooks/${encodeURIComponent(nb.id)}` } }];
  const node = (r: LineageRun, extra: Record<string, unknown> = {}) => ({
    data: { id: r.id, label: `${r.agentId} · ${formatAge(r.startedAt)}`, status: r.status, startedAt: r.startedAt, completedAt: r.completedAt, href: `/runs/${encodeURIComponent(r.id)}`, ...extra },
  });
  const seen = new Set<string>();
  for (const f of lineage.feeders) {
    if (seen.has(f.run.id)) continue;
    seen.add(f.run.id);
    out.push(node(f.run, { found: f.found }));
    out.push({ data: { id: `nb->${f.run.id}`, source: 'nb', target: f.run.id } });
    for (const s of f.subRuns) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(node(s));
      const from = s.parentRunId && seen.has(s.parentRunId) ? s.parentRunId : f.run.id;
      out.push({ data: { id: `${from}->${s.id}`, source: from, target: s.id } });
    }
    const left = leftSummary(f);
    if (left) {
      out.push({ data: { id: `left:${f.run.id}`, label: short(left, 36), type: 'entries', href: `/notebooks/${encodeURIComponent(nb.id)}` } });
      out.push({ data: { id: `${f.run.id}->left`, source: f.run.id, target: `left:${f.run.id}` } });
    }
  }
  return out;
}

function runRow(f: LineageFeeder): SafeHtml {
  const left = leftSummary(f);
  return html`
    <li class="nbw-run">
      <div class="nbw-run__head">
        <span class="nbw-status nbw-status--${f.run.status}">${f.run.status}</span>
        <a class="nbw-run__agent" href="/agents/${encodeURIComponent(f.run.agentId)}">${f.run.agentId}</a>
        <span class="nbw-run__when">${formatAge(f.run.startedAt)} · ${f.run.triggeredBy}</span>
        <a class="nbw-run__link" href="/runs/${encodeURIComponent(f.run.id)}">run ${f.run.id.slice(0, 8)} →</a>
      </div>
      <p class="nbw-run__left">${f.found !== undefined ? `Found ${String(f.found)}` : 'Filed'}${left ? ` · left ${left}` : ''}${f.run.error ? html` · <span class="nbw-run__err">${short(f.run.error, 120)}</span>` : html``}</p>
      ${f.subRuns.length ? html`
        <details class="nbw-subs">
          <summary>${String(f.subRuns.length)} run${f.subRuns.length === 1 ? '' : 's'} it started</summary>
          <ul>${f.subRuns.map((s) => html`<li><span class="nbw-status nbw-status--${s.status}">${s.status}</span> <a href="/agents/${encodeURIComponent(s.agentId)}">${s.agentId}</a>${s.parentNodeId ? html` <span class="nbw-run__when">from ${s.parentNodeId}</span>` : html``} <a href="/runs/${encodeURIComponent(s.id)}">run ${s.id.slice(0, 8)}</a></li>`) as unknown as SafeHtml[]}</ul>
        </details>` : html``}
    </li>`;
}

export function renderNotebookWorkflow(args: { nb: Notebook; lineage: NotebookLineage }): string {
  const { nb, lineage } = args;
  const id = encodeURIComponent(nb.id);
  const total = lineage.feeders.reduce((n, f) => n + 1 + f.subRuns.length, 0);
  // The graph stays readable: the newest few searches; the list has them all.
  const drawn = lineage.feeders.slice(0, GRAPH_FEEDERS);
  const agents = new Set(lineage.feeders.flatMap((f) => [f.run.agentId, ...f.subRuns.map((s) => s.agentId)]));
  return render(layout({ title: `How ${nb.title} was made`, activeNav: 'inbox', wide: true }, html`
    <p class="nb-crumbs"><a href="/">Home</a> › <a href="/notebooks">Notebooks</a> › <a href="/notebooks/${id}">${nb.title}</a> › How it was made</p>
    <header class="nbw-head">
      <h1 class="nbw-head__title">How this notebook was made</h1>
      <p class="nbw-head__lede">${lineage.feeders.length
        ? `${String(total)} run${total === 1 ? '' : 's'} by ${String(agents.size)} agent${agents.size === 1 ? '' : 's'}: every run that filed into it, the runs those started, and what each left. Click a box to open its run.`
        : 'Nothing has filed into this notebook yet. Runs show up here once a search, the pipeline or Add to notebook puts something in it.'}</p>
    </header>
    ${lineage.feeders.length ? html`
      ${renderGraphFrame({ title: 'Workflow', countLabel: drawn.length < lineage.feeders.length ? `the newest ${String(drawn.length)} of ${String(lineage.feeders.length)} searches; all of them below` : `${String(total)} run${total === 1 ? '' : 's'}`, elements: lineageElements(nb, { feeders: drawn }) })}
      <section class="nbw-list" aria-labelledby="nbw-list-title">
        <h2 class="nbw-list__title" id="nbw-list-title">Runs, newest first</h2>
        <ul class="nbw-runs">${lineage.feeders.map(runRow) as unknown as SafeHtml[]}</ul>
        ${lineage.more ? html`<p class="nbw-more">${String(lineage.more)} older run${lineage.more === 1 ? '' : 's'} not shown.</p>` : html``}
      </section>` : unsafeHtml('')}
  `));
}
