/**
 * How a notebook was made (/notebooks/:id/workflow): every run that filed
 * into it, the runs those started, and what each left, drawn as one graph
 * with the same renderer as a run's DAG, plus the same runs as a list.
 */
import type { Notebook, NotebookLineage, LineageFeeder, LineagePass, LineageRun } from '@some-useful-agents/core';
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

const PASS_KIND: Record<LineagePass['kind'], string> = { pipeline: 'Pipeline', conversation: 'From the conversation', added: 'Added to notebook', earlier: 'Earlier run' };

/** A pass in a line: its runs, what they found, and its note. */
function passFacts(p: LineagePass): string {
  const runs = p.feeders.length + p.feeders.reduce((n, f) => n + f.subRuns.length, 0);
  const found = p.feeders.reduce((n, f) => n + (f.found ?? 0), 0);
  return [`${String(runs)} run${runs === 1 ? '' : 's'}`, found ? `found ${String(found)}` : '', p.feeders.some((f) => f.run.status === 'failed') ? 'something failed' : ''].filter(Boolean).join(' · ');
}

export function renderNotebookWorkflow(args: { nb: Notebook; lineage: NotebookLineage; pass?: string }): string {
  const { nb, lineage } = args;
  const id = encodeURIComponent(nb.id);
  const passes = lineage.passes;
  const selected = passes.find((p) => p.id === args.pass) ?? passes[0];
  const total = passes.reduce((n, p) => n + p.feeders.length + p.feeders.reduce((m, f) => m + f.subRuns.length, 0), 0);
  const agents = new Set(passes.flatMap((p) => p.feeders.flatMap((f) => [f.run.agentId, ...f.subRuns.map((s) => s.agentId)])));
  const shown = selected ? selected.feeders.length + selected.feeders.reduce((m, f) => m + f.subRuns.length, 0) : 0;
  return render(layout({ title: `How ${nb.title} was made`, activeNav: 'inbox', wide: true }, html`
    <p class="nb-crumbs"><a href="/">Home</a> › <a href="/notebooks">Notebooks</a> › <a href="/notebooks/${id}">${nb.title}</a> › How it was made</p>
    <header class="nbw-head">
      <h1 class="nbw-head__title">How this notebook was made</h1>
      <p class="nbw-head__lede">${passes.length
        ? `${String(passes.length)} pass${passes.length === 1 ? '' : 'es'}, ${String(total)} run${total === 1 ? '' : 's'} by ${String(agents.size)} agent${agents.size === 1 ? '' : 's'}. A pass is one go at filling the notebook: a pipeline run of all its agents, or one run filed from its conversation or with Add to notebook. Pick one to draw it; click a box to open its run.`
        : 'Nothing has filed into this notebook yet. Runs show up here once a search, the pipeline or Add to notebook puts something in it.'}</p>
    </header>
    ${selected ? html`
      <nav class="nbw-passes" aria-label="Passes">
        ${passes.map((p) => html`<a class="nbw-pass${p === selected ? ' is-on' : ''}" href="/notebooks/${id}/workflow?pass=${encodeURIComponent(p.id)}"${p === selected ? unsafeHtml(' aria-current="true"') : unsafeHtml('')}>
          <span class="nbw-pass__when">${formatAge(p.startedAt)}</span>
          <span class="nbw-pass__kind">${PASS_KIND[p.kind]}</span>
          <span class="nbw-pass__facts">${passFacts(p)}</span>
        </a>`) as unknown as SafeHtml[]}
      </nav>
      ${renderGraphFrame({ title: `${PASS_KIND[selected.kind]} · ${formatAge(selected.startedAt)}`, countLabel: `${String(shown)} run${shown === 1 ? '' : 's'}`, elements: lineageElements(nb, { feeders: selected.feeders }) })}
      ${selected.note ? html`<p class="nbw-note">${selected.note}</p>` : html``}
      <section class="nbw-list" aria-labelledby="nbw-list-title">
        <h2 class="nbw-list__title" id="nbw-list-title">Passes, newest first</h2>
        ${passes.map((p) => html`
          <section class="nbw-group${p === selected ? ' is-on' : ''}" aria-label="${PASS_KIND[p.kind]}, ${formatAge(p.startedAt)}">
            <h3 class="nbw-group__head"><a href="/notebooks/${id}/workflow?pass=${encodeURIComponent(p.id)}">${PASS_KIND[p.kind]} · ${formatAge(p.startedAt)}</a> <span class="nbw-run__when">${passFacts(p)}</span></h3>
            <ul class="nbw-runs">${p.feeders.map(runRow) as unknown as SafeHtml[]}</ul>
          </section>`) as unknown as SafeHtml[]}
      </section>` : unsafeHtml('')}
  `));
}
